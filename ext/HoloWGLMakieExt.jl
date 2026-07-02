module HoloWGLMakieExt

# The :webgl backend — render the figure live in a WGLMakie <canvas> on the client GPU,
# with Holo's overlay layered on top. Unlike CairoBackend (static PNG, 2D only), this
# handles 3D / animation / large data. Ships NO Bonito runtime and NO server: the scene
# is serialized to a plain payload (published_to_js) and drawn by a vendored WGLMakie
# bundle + a ~30-line shim (assets/holo-webgl.js). Validated by spikes 06/08:
# full 2D+3D fidelity, 1-2px overlay alignment, client-side animation hook.

using Holo: Holo, AbstractBackend, InteractionContext, build_manifest, InteractionEvent, auto_interactables
using WGLMakie
import Makie
import Makie: Observable, Point2f
import AbstractPlutoDingetjes as APD
using HypertextLiteral: @htl, JavaScript

# WGLMakie already depends on Bonito (bare `using Bonito` at WGLMakie.jl:4, which binds
# the module name into WGLMakie's own namespace) — reached qualified so Holo never
# declares its own Bonito dependency. This couples to WGLMakie's own import STYLE (a bare
# `using Bonito`, not a selective `using Bonito: X`) — the version-coupling guard testset
# in test/webgl_ext_tests.jl fails loudly if a WGLMakie bump ever changes that.
const Bonito = WGLMakie.Bonito

export WebGLBackend

"""
    WebGLBackend(; px_per_unit=2.0, max_width=700)

Browser-GPU Holo backend. `px_per_unit` is the explicit device scale (the spike confirmed
surface DPI is a controllable knob); `max_width` mirrors CairoBackend (Pluto's column).
"""
struct WebGLBackend <: AbstractBackend
    px_per_unit::Float64
    max_width::Int
end
WebGLBackend(; px_per_unit = 2.0, max_width = 700) = WebGLBackend(px_per_unit, max_width)

Holo.mount(::WebGLBackend) = :webgl
Holo._ppu(b::WebGLBackend, _fig) = b.px_per_unit

# ---------------------------------------------------------------------------
# The proven 4-rule encoder (spike 08). serialize_scene leaves live Observables and raw
# arrays; the browser shim expects each tagged so it can rebuild the structures WGLMakie's
# own deserialize reads:
#   Observable  -> {__obs__: v}          (JS rebuilds a {value, on, notify} shim)
#   1-D buffer  -> {__t__, d}            (JS rebuilds a TypedArray)
#   N-D array   -> {array, size}         (JS recurses; .array becomes a TypedArray)
# Symbols -> strings, closures -> dropped. This is the ENTIRE data bridge.
# ---------------------------------------------------------------------------
function _plain(x)
    if x isa Observable
        return Dict{String, Any}("__obs__" => _plain(x[]))
    elseif x isa AbstractDict
        return Dict{String, Any}(string(k) => _plain(v) for (k, v) in x)
    elseif x isa Function
        return nothing
    elseif x isa Symbol
        return String(x)
    elseif x isa Tuple
        return Any[_plain(v) for v in x]
    elseif x isa AbstractArray && ndims(x) >= 2 && eltype(x) <: Number
        return Dict{String, Any}("array" => _plain(vec(x)), "size" => collect(size(x)))
    elseif x isa AbstractVector && eltype(x) <: Number
        T = eltype(x)
        # Vector{T}(x) FORCES a plain Base.Vector. Neither Float32.(x) nor collect(T, x) does:
        # on a StaticArray/Vec/SizedVector both preserve the static type, which published_to_js
        # rejects ("only simple objects... vectors and dictionaries"). Real-Pluto bug; JSON3 hid it.
        T === UInt32 && return Dict{String, Any}("__t__" => "u32", "d" => Vector{UInt32}(x))
        T === Int32 && return Dict{String, Any}("__t__" => "i32", "d" => Vector{Int32}(x))
        T === UInt8 && return Dict{String, Any}("__t__" => "u8", "d" => Vector{UInt8}(x))
        # Everything else (Float32/16/64, Int64 indices, N0f8, …) -> Float32: matches WebGL, which is
        # f32-only, so this is the renderer's own precision. Lossy for Int64 indices / Float64 beyond
        # ~7 digits — fine for plot coordinates, which is all serialize_scene emits here.
        return Dict{String, Any}("__t__" => "f32", "d" => Vector{Float32}(x))
    elseif x isa AbstractVector
        return Any[_plain(v) for v in x]
    else
        return x   # Number / String / Bool / Nothing
    end
end

"""
    scene_payload(fig) -> Dict

Serialize a finalized figure to the browser payload. A `NoConnection` session + screen is
attached first so `serialize_scene`'s atlas tracker is populated — required for markers
and text glyphs (spike finding: bare `serialize_scene` emits an empty atlas).
"""
function scene_payload(fig)
    scene = fig.scene
    session = Bonito.Session(Bonito.NoConnection())
    config = Makie.merge_screen_config(WGLMakie.ScreenConfig, Dict{Symbol, Any}())
    screen = WGLMakie.Screen(scene, config)
    screen.session = session
    Makie.push_screen!(scene, screen)
    try
        return _plain(WGLMakie.serialize_scene(scene))
    finally
        Makie.delete_screen!(scene, screen)   # don't leave the NoConnection screen attached to the user's figure
    end
end

# The render result for :webgl — a payload to publish (via Holo's published_to_js), not
# raster bytes. (The :webgl mount intentionally does NOT fit render()->bytes; pixels live
# in the browser canvas.)
struct WebGLResult
    scene::Dict{String, Any}
    width::Int
    height::Int
    px_per_unit::Float64
end

function Holo.render(b::WebGLBackend, fig, ppu)
    w, h = size(fig.scene)
    return WebGLResult(scene_payload(fig), w, h, Float64(ppu))
end

# context: the same shared projection closure as CairoBackend (transform_func applied,
# then Makie.project + viewport + scaling + y-flip — Holo._project_closure). The spike
# measured this lands within 1-2px of where WGLMakie draws the data, so the STATIC-camera
# overlay rides the existing manifest unchanged. (Axis3 support: see docs/roadmap.md.)
function Holo.context(b::WebGLBackend, fig, ppu)
    w, h = size(fig.scene)
    scaling = Float64(ppu)
    out_w, out_h = round(Int, w * scaling), round(Int, h * scaling)
    display_scale = min(w, b.max_width) / out_w

    project = Holo._project_closure(scaling, out_h)

    axes = [c for c in fig.content if c isa Makie.Axis]
    ids = IdDict{Any, Symbol}()
    transforms = Dict{Symbol, Holo.AxisTransform}()
    for (k, ax) in enumerate(axes)
        id = Symbol("ax", k)
        ids[ax] = id
        # Populate the per-axis transform exactly as CairoBackend does. Without this, every
        # axis-keyed interactable (Threshold/ROI/Region/box-select) KeyErrors at manifest build
        # (interactables.jl indexes ctx.transforms[axis_id]). We call Holo._axis_transform
        # directly (both backends share it, per src/backend.jl) rather than duplicating the
        # loop — CairoBackend now lives in a sibling extension we can't (and don't need to)
        # reach from here.
        transforms[id] = Holo._axis_transform(id, ax, scaling, out_h)
    end
    # Colorbar transforms, exactly as CairoBackend builds them. This loop was missing
    # (the one-sided context() divergence the parity goldens now pin): a ColorbarInteractable
    # then fell through axis_id's old :ax1 fallback and silently rendered a whole-plot 2-D
    # {x,y} readout instead of the 1-D colorbar value. Caught by the cross-backend parity
    # invariant (colorbar figure + valueaxis oracle) in test/no_backend_tests.jl.
    cbs = [c for c in fig.content if c isa Makie.Colorbar]
    for (k, cb) in enumerate(cbs)
        id = Symbol("cb", k)
        ids[cb] = id
        transforms[id] = Holo._colorbar_transform(id, cb, scaling, out_h)
    end
    return InteractionContext(project, transforms, ids, out_w, out_h, scaling, display_scale)
end

# Path to the committed shim bundle (vendored WGLMakie.bundled.js is sourced at runtime
# from the installed WGLMakie package, so the renderer always version-matches serialize_scene).
const SHIM_JS = joinpath(@__DIR__, "..", "assets", "holo-webgl.js")
wglmakie_bundle_path() = joinpath(pkgdir(WGLMakie), "src", "javascript", "WGLMakie.bundled.js")

struct WebGLWidget
    scene::Dict{String, Any}        # serialize_scene payload (4-rule encoded)
    manifest::Dict{String, Any}
    display_css::Int
    width::Int
    height::Int
    px_per_unit::Float64
end

Holo.make_widget(b::WebGLBackend, result::WebGLResult, manifest, display_css) =
    WebGLWidget(result.scene, manifest, display_css, result.width, result.height, result.px_per_unit)

# Build the widget HTML. `*_expr`/`*_js` are JS expressions yielding the data/text:
# published_to_js for Pluto (ships over Pluto's data channel — works local/remote/export, no
# server), or inlined JSON for self-contained/testing. The bundle + shim text become blob
# URLs in the browser so `import()` works without any file:// path or hosted asset.
function _widget_html(w::WebGLWidget; scene_expr, manifest_expr, bundle_js, shim_js)
    overlay = JavaScript(Holo._OVERLAY_JS[])   # reuse Holo's committed overlay bundle verbatim
    # Holo's overlay is base-agnostic (`querySelector("img, canvas")`; image-px scale from
    # `manifest.width`, not the element's intrinsic size — design.md §6), so it binds directly to
    # our <canvas>. No transparent SVG sizer shim anymore (M3.1).
    return @htl(
        """
        <div class="ip-host" style="position:relative; display:inline-block; width:100%; max-width:$(w.display_css)px;">
          <canvas class="holo-webgl-base" width="$(w.width)" height="$(w.height)"
                  style="display:block; width:100%; height:auto;"></canvas>
          <script>
            // regular (non-module) script: document.currentScript is set here (modules' is null),
            // so this resolves the canvas in both Pluto and standalone. Blob URLs let import()
            // load the WGLMakie bundle + shim with no server / no file:// path.
            const _s = document.currentScript;
            const _canvas = _s.parentElement.querySelector("canvas.holo-webgl-base");
            // M2 bundle-sharing, browser half: install the ~1MB WGLMakie bundle + shim blob URLs
            // ONCE per notebook on window (the same idempotent-singleton trick Holo uses for
            // window.Holo). `??=` short-circuits, so on a cache hit the published 1MB bundle ref is
            // never even dereferenced — every extra widget reuses the one module (ES imports are
            // URL-cached), instead of re-blobbing + re-importing ~1MB per cell. (The wire half — why
            // the bytes cross the wire only once — is documented at Base.show.)
            const _H = (window.__HoloWGL ??= {});
            const _blob = (t) => URL.createObjectURL(new Blob([t], { type: "text/javascript" }));
            const _bundleUrl = (_H.bundleUrl ??= _blob($(bundle_js)));
            const _shimUrl = (_H.shimUrl ??= _blob($(shim_js)));
            import(_shimUrl).then(({ mountWebGL }) =>
              mountWebGL({ canvas: _canvas, wglBundleUrl: _bundleUrl,
                           scene: $(scene_expr), width: $(w.width), height: $(w.height),
                           pxPerUnit: $(w.px_per_unit) }));
          </script>
          <script>
            $(overlay)
            const _o = document.currentScript;
            const manifest = $(manifest_expr);
            window.Holo.mount(_o, manifest, typeof invalidation === "undefined" ? new Promise(() => {}) : invalidation);
          </script>
        </div>
        """
    )
end

# Cache the bundle (~1MB) + shim text once, not per render.
const _BUNDLE_TEXT = Ref{String}("")
const _SHIM_TEXT = Ref{String}("")
_bundle_text() = (isempty(_BUNDLE_TEXT[]) && (_BUNDLE_TEXT[] = read(wglmakie_bundle_path(), String)); _BUNDLE_TEXT[])
_shim_text() = (isempty(_SHIM_TEXT[]) && (_SHIM_TEXT[] = read(SHIM_JS, String)); _SHIM_TEXT[])

function Base.show(io::IO, m::MIME"text/html", w::WebGLWidget)
    # Everything ships over Pluto's published_to_js data channel — scene + manifest + the
    # bundle/shim text — so there is no server and no file:// path (works remote + export).
    # The bundle is shared once per notebook (M2), wire half: published_to_js ids are content-
    # addressed (notebook_id/objectid) and objectid(::String) is content-based, so this one cached
    # string always gets the same stable id. That id crosses the wire exactly once: across cells,
    # Pluto's notebook merge keeps a single copy on load; across re-runs of a cell, Pluto nulls
    # already-known ids before sending (known_published_objects from the prior run + format_output),
    # so a re-run re-ships only its new scene, never the stable-id bundle (re-publish != re-send).
    # The browser half — caching the blob URL on window.__HoloWGL so the module imports once — is in
    # _widget_html.
    pub = APD.Display.published_to_js
    html = _widget_html(
        w;
        scene_expr = pub(w.scene), manifest_expr = pub(w.manifest),
        bundle_js = pub(_bundle_text()), shim_js = pub(_shim_text()),
    )
    return show(io, m, html)
end

# ---- bond plumbing: identical contract to HoloWidget (same overlay, same events) ----
APD.Bonds.initial_value(::WebGLWidget) = nothing
function APD.Bonds.transform_value(::WebGLWidget, js)
    js === nothing && return nothing
    if haskey(js, "items")
        return InteractionEvent[
            InteractionEvent(Symbol(it["layer"]), Int(it["index"]), get(it, "payload", nothing))
                for it in js["items"]
        ]
    end
    return InteractionEvent(Symbol(js["layer"]), Int(js["index"]), get(js, "payload", nothing))
end

end # module HoloWGLMakieExt
