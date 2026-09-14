module HoloWGLMakieExt

# The :webgl backend — render the figure live in a WGLMakie <canvas> on the client GPU,
# with Holo's overlay layered on top. Same interaction contract as CairoBackend (2D and
# Axis3 alike — the shared projection closure handles both); the difference is COST: the
# live canvas makes animation, large data, and frequent re-renders cheap where the static
# PNG re-rasterizes. Ships NO Bonito runtime and NO server: the scene is serialized to a
# plain payload (published_to_js) and drawn by a vendored WGLMakie bundle + a ~30-line
# shim (assets/holo-webgl.js), giving full 2D+3D fidelity with the overlay aligned to
# within 1-2px of the live canvas.

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

Browser-GPU Holo backend. `px_per_unit` is the explicit device scale (surface DPI is a
controllable knob); `max_width` mirrors CairoBackend (Pluto's column).
"""
struct WebGLBackend <: AbstractBackend
    px_per_unit::Float64
    max_width::Int
end
WebGLBackend(; px_per_unit = 2.0, max_width = 700) = WebGLBackend(px_per_unit, max_width)

Holo._ppu(b::WebGLBackend, _fig) = b.px_per_unit

# ---------------------------------------------------------------------------
# WGL-only Makie/WGLMakie/Bonito internals: every non-public surface unique to the WebGL
# backend goes through exactly one of these three, same fail-loud doctrine as
# src/makie_compat.jl (which these deliberately do NOT live in — they're WGL-only and this
# extension is the only place `WGLMakie`/`Bonito` are in scope). See test/webgl_ext_tests.jl's
# "version-coupling guard".
# Same version split as src/makie_compat.jl's _MAKIE_SHAPE_ERRORS: struct-field reads throw
# `FieldError` on Julia >= 1.12 (doesn't exist before), `ErrorException` on 1.10/1.11.
const _WGL_SHAPE_ERRORS = @static if isdefined(Base, :FieldError)
    Union{MethodError, UndefVarError, ErrorException, KeyError, FieldError}
else
    Union{MethodError, UndefVarError, ErrorException, KeyError}
end

# Narrower union for `_serialize_scene`, which walks every plot's own recipe code — an
# `ErrorException` raised there is the plot's, not a Makie internal shape change.
const _WGL_DOWNSTREAM_ERRORS = @static if isdefined(Base, :FieldError)
    Union{MethodError, UndefVarError, KeyError, FieldError}
else
    Union{MethodError, UndefVarError, KeyError}
end

_wgl_compat_error(name, expected) = error(
    "Holo: WGLMakie/Bonito internal `$(name)` changed shape under WGLMakie v$(pkgversion(WGLMakie)) — " *
        "expected $(expected); please open an issue"
)

# The vendored bundle is sourced at runtime from the installed WGLMakie package (so the
# renderer always version-matches `_serialize_scene`) — no public "give me the JS bundle" API.
function _wgl_bundle_path()
    path = try
        joinpath(pkgdir(WGLMakie), "src", "javascript", "WGLMakie.bundled.js")
    catch e
        e isa _WGL_SHAPE_ERRORS || rethrow()
        return _wgl_compat_error("WGLMakie.bundled.js path", "`pkgdir(WGLMakie)/src/javascript/WGLMakie.bundled.js` to exist")
    end
    isfile(path) || return _wgl_compat_error("WGLMakie.bundled.js path", "the vendored bundle to exist at $(path)")
    return path
end

# A NoConnection Session + headless Screen must be attached to the scene before
# `_serialize_scene` so its atlas tracker is populated (required for marker/text glyphs) — no
# public headless-serialization API exists in WGLMakie. `f(screen)` runs with the screen
# attached; the screen is always detached afterward, even on error.
function _headless_screen(f, scene)
    screen = try
        session = Bonito.Session(Bonito.NoConnection())
        config = Makie.merge_screen_config(WGLMakie.ScreenConfig, Dict{Symbol, Any}())
        s = WGLMakie.Screen(scene, config)
        s.session = session
        Makie.push_screen!(scene, s)
        s
    catch e
        e isa _WGL_SHAPE_ERRORS || rethrow()
        return _wgl_compat_error(
            "headless screen construction",
            "`Bonito.Session(Bonito.NoConnection())` + `Makie.merge_screen_config`/`WGLMakie.ScreenConfig`/" *
                "`WGLMakie.Screen`/`Makie.push_screen!` to compose a headless screen"
        )
    end
    try
        return f(screen)
    finally
        try
            Makie.delete_screen!(scene, screen)
        catch e
            e isa _WGL_SHAPE_ERRORS || rethrow()
            _wgl_compat_error("delete_screen!", "`Makie.delete_screen!(scene, screen)` to detach a screen")
        end
    end
end

# The only way to turn a live Scene into a plain, browser-serializable payload — no public
# headless serialization API exists in WGLMakie.
function _serialize_scene(scene)
    try
        return WGLMakie.serialize_scene(scene)
    catch e
        e isa _WGL_DOWNSTREAM_ERRORS || rethrow()
        return _wgl_compat_error("serialize_scene", "`WGLMakie.serialize_scene(scene)` to return a plain scene tree")
    end
end

# ---------------------------------------------------------------------------
# The proven 4-rule encoder (spike 08). serialize_scene leaves live Observables and raw
# arrays; the browser shim expects each tagged so it can rebuild the structures WGLMakie's
# own deserialize reads:
#   Observable  -> {__obs__: v}          (JS rebuilds a {value, on, notify} shim)
#   1-D buffer  -> {__t__, d}            (JS rebuilds a TypedArray)
#   N-D array   -> {array, size}         (JS recurses; .array becomes a TypedArray)
# Symbols -> strings, closures -> dropped. This is the ENTIRE data bridge.
# Non-finite floats (NaN/±Inf) are scrubbed: JSON3 (and the self-contained e2e HTML path that
# uses it) rejects NaN, and Makie occasionally emits NaN in transformed-position buffers for
# decorative/empty slots. Zero is a safe GPU placeholder (those slots are not drawn as data).
# ---------------------------------------------------------------------------
_json_float(x::Real) = (f = Float32(x); isfinite(f) ? f : Float32(0))
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
        # Scrub non-finite so JSON3.write(scene) (e2e / unit HTML) never trips "NaN not allowed".
        # Build a plain Base.Vector (not StaticArrays) — same force as Vector{Float32}(x).
        d = Vector{Float32}(undef, length(x))
        @inbounds for (i, v) in enumerate(x)
            d[i] = _json_float(v)
        end
        return Dict{String, Any}("__t__" => "f32", "d" => d)
    elseif x isa AbstractVector
        return Any[_plain(v) for v in x]
    elseif x isa AbstractFloat
        return isfinite(x) ? x : Float32(0)
    else
        # Drop anything published_to_js / JSON3 can't carry (Enums, Colorants, custom structs).
        # Scalars that are already JSON-safe pass through.
        return x isa Union{Real, AbstractString, Bool, Nothing} ? x : nothing
    end
end

"""
    scene_payload(fig) -> Dict

Serialize a finalized figure to the browser payload. A `NoConnection` session + screen is
attached first so `serialize_scene`'s atlas tracker is populated — required for markers
and text glyphs (an unattached scene serializes with an empty atlas).
"""
function scene_payload(fig)
    scene = fig.scene
    return _headless_screen(scene) do screen
        _plain(_serialize_scene(scene))
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
# then Makie.project + viewport + scaling + y-flip — Holo._project_closure), which lands
# within 1-2px of where WGLMakie draws the data, so the static-camera overlay rides the
# existing manifest unchanged; Axis3 rides the same closure (3D enters only at the
# projection step — src/backend.jl).
function Holo.context(b::WebGLBackend, fig, ppu)
    w, h = size(fig.scene)
    scaling = Float64(ppu)
    out_w, out_h = round(Int, w * scaling), round(Int, h * scaling)
    display_scale = min(w, b.max_width) / out_w

    project = Holo._project_closure(scaling, out_h)

    axes = [c for c in fig.content if c isa Union{Makie.Axis, Makie.Axis3, Makie.PolarAxis}]
    ids = IdDict{Any, Symbol}()
    transforms = Dict{Symbol, Holo.AxisTransform}()
    for (k, ax) in enumerate(axes)
        id = Symbol("ax", k)
        ids[ax] = id
        # Populate the per-axis transform exactly as CairoBackend does. Without this, every
        # axis-keyed interactable (Threshold/ROI/Region/box-select) KeyErrors at manifest build
        # (interactables.jl indexes ctx.transforms[axis_id]). Calls the shared constructors
        # directly (src/backend.jl) rather than sharing a loop with CairoBackend, which lives in
        # a sibling extension not reachable from here. PolarAxis rides `_polar_transform`
        # (ispolar; continuous θ/r deferred).
        transforms[id] = if ax isa Makie.Axis3
            Holo._axis3_transform(id, ax, scaling, out_h)
        elseif ax isa Makie.PolarAxis
            Holo._polar_transform(id, ax, scaling, out_h)
        else
            Holo._axis_transform(id, ax, scaling, out_h)
        end
    end
    # Colorbar transforms, exactly as CairoBackend builds them — required so a
    # ColorbarInteractable resolves its own 1-D value transform instead of falling back to
    # the wrong axis. Covered by the cross-backend parity invariant in test/no_backend_tests.jl.
    cbs = [c for c in fig.content if c isa Makie.Colorbar]
    for (k, cb) in enumerate(cbs)
        id = Symbol("cb", k)
        ids[cb] = id
        transforms[id] = Holo._colorbar_transform(id, cb, scaling, out_h)
    end
    return InteractionContext(project, transforms, ids, out_w, out_h, scaling, display_scale)
end

# Path to the committed shim bundle. The WGLMakie bundle itself is sourced at runtime from
# the installed WGLMakie package (`_wgl_bundle_path`, above), so the renderer always
# version-matches `_serialize_scene`.
const SHIM_JS = joinpath(@__DIR__, "..", "assets", "holo-webgl.js")

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
    # our <canvas> with no sizer shim needed.
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
_bundle_text() = (isempty(_BUNDLE_TEXT[]) && (_BUNDLE_TEXT[] = read(_wgl_bundle_path(), String)); _BUNDLE_TEXT[])
_shim_text() = (isempty(_SHIM_TEXT[]) && (_SHIM_TEXT[] = read(SHIM_JS, String)); _SHIM_TEXT[])

function Base.show(io::IO, m::MIME"text/html", w::WebGLWidget)
    # Everything ships over Pluto's published_to_js data channel — scene + manifest + the
    # bundle/shim text — so there is no server and no file:// path (works remote + export).
    # The bundle is shared once per notebook: published_to_js ids are content-addressed
    # (notebook_id/objectid) and objectid(::String) is content-based, so this one cached string
    # always gets the same stable id. That id crosses the wire exactly once: across cells,
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
