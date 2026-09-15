module HoloWGLMakieExt

using Holo: Holo, AbstractBackend, InteractionContext, build_manifest, InteractionEvent, auto_interactables
using WGLMakie
import Makie
import Makie: Observable, Point2f
import AbstractPlutoDingetjes as APD
using HypertextLiteral: @htl, JavaScript

# WGLMakie already depends on Bonito (bare `using Bonito`, binding it into WGLMakie's own
# namespace); reached qualified here so Holo never declares its own Bonito dependency. This
# couples to that import style — test/webgl_ext_tests.jl's version-coupling guard checks it.
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

# Every non-public WGLMakie/Bonito surface goes through one of these three (this extension is
# the only place WGLMakie/Bonito are in scope); see test/webgl_ext_tests.jl's version-coupling guard.
# Same version split as src/makie_compat.jl's _MAKIE_SHAPE_ERRORS: struct-field reads throw
# FieldError on Julia >= 1.12, ErrorException on 1.10/1.11.
const _WGL_SHAPE_ERRORS = @static if isdefined(Base, :FieldError)
    Union{MethodError, UndefVarError, ErrorException, KeyError, FieldError}
else
    Union{MethodError, UndefVarError, ErrorException, KeyError}
end

# Narrower union for `_serialize_scene`: an ErrorException there is the plot's own recipe
# code, not a Makie internal shape change.
const _WGL_DOWNSTREAM_ERRORS = @static if isdefined(Base, :FieldError)
    Union{MethodError, UndefVarError, KeyError, FieldError}
else
    Union{MethodError, UndefVarError, KeyError}
end

_wgl_compat_error(name, expected) = error(
    "Holo: WGLMakie/Bonito internal `$(name)` changed shape under WGLMakie v$(pkgversion(WGLMakie)) — " *
        "expected $(expected); please open an issue"
)

# Sourced at runtime from the installed WGLMakie package, so the renderer always version-matches
# `_serialize_scene` — no public "give me the JS bundle" API exists.
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

# A NoConnection Session + headless Screen must be attached before `_serialize_scene` so its
# atlas tracker is populated (required for marker/text glyphs) — no public API for this exists.
# `f(screen)` runs with the screen attached; it is always detached afterward, even on error.
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

# No public headless-serialization API exists in WGLMakie; this is the only way to turn a
# live Scene into a plain, browser-serializable payload.
function _serialize_scene(scene)
    try
        return WGLMakie.serialize_scene(scene)
    catch e
        e isa _WGL_DOWNSTREAM_ERRORS || rethrow()
        return _wgl_compat_error("serialize_scene", "`WGLMakie.serialize_scene(scene)` to return a plain scene tree")
    end
end

# serialize_scene leaves live Observables and raw arrays; the browser shim expects each tagged
# so it can rebuild the structures WGLMakie's own deserialize reads:
#   Observable -> {__obs__: v}   1-D buffer -> {__t__, d}   N-D array -> {array, size}
# Symbols -> strings, closures -> dropped. Non-finite floats are scrubbed to 0 (JSON3 rejects
# NaN, and Makie occasionally emits it in transformed-position buffers for decorative slots).
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
        # Vector{T}(x) forces a plain Base.Vector; neither Float32.(x) nor collect(T, x) does —
        # on a StaticArray/Vec/SizedVector both preserve the static type, which published_to_js rejects.
        T === UInt32 && return Dict{String, Any}("__t__" => "u32", "d" => Vector{UInt32}(x))
        T === Int32 && return Dict{String, Any}("__t__" => "i32", "d" => Vector{Int32}(x))
        T === UInt8 && return Dict{String, Any}("__t__" => "u8", "d" => Vector{UInt8}(x))
        # Everything else -> Float32 (WebGL is f32-only); lossy for Int64/Float64 beyond ~7 digits,
        # fine for plot coordinates.
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
        # Drop anything published_to_js/JSON3 can't carry (Enums, Colorants, custom structs).
        return x isa Union{Real, AbstractString, Bool, Nothing} ? x : nothing
    end
end

"""
    scene_payload(fig) -> Dict

Serialize a finalized figure to the browser payload.
"""
function scene_payload(fig)
    scene = fig.scene
    return _headless_screen(scene) do screen
        _plain(_serialize_scene(scene))
    end
end

# A payload to publish (via published_to_js), not raster bytes — pixels live in the browser canvas.
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

# Uses the same shared projection closure as CairoBackend, landing within 1-2px of where
# WGLMakie draws the data.
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
        # Without this, every axis-keyed interactable KeyErrors at manifest build
        # (interactables.jl indexes ctx.transforms[axis_id]).
        transforms[id] = if ax isa Makie.Axis3
            Holo._axis3_transform(id, ax, scaling, out_h)
        elseif ax isa Makie.PolarAxis
            Holo._polar_transform(id, ax, scaling, out_h)
        else
            Holo._axis_transform(id, ax, scaling, out_h)
        end
    end
    # Required so a ColorbarInteractable resolves its own transform instead of the wrong axis.
    cbs = [c for c in fig.content if c isa Makie.Colorbar]
    for (k, cb) in enumerate(cbs)
        id = Symbol("cb", k)
        ids[cb] = id
        transforms[id] = Holo._colorbar_transform(id, cb, scaling, out_h)
    end
    return InteractionContext(project, transforms, ids, out_w, out_h, scaling, display_scale)
end

# Path to the committed shim bundle (the WGLMakie bundle itself is sourced at runtime; see
# `_wgl_bundle_path`).
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

# `*_expr`/`*_js` are JS expressions yielding the data/text: published_to_js for Pluto, or
# inlined JSON for self-contained/testing.
function _widget_html(w::WebGLWidget; scene_expr, manifest_expr, bundle_js, shim_js)
    overlay = JavaScript(Holo._OVERLAY_JS[])
    # Holo's overlay is base-agnostic (`querySelector("img, canvas")`; image-px scale from
    # `manifest.width`, not the element's intrinsic size), so it binds directly to our
    # <canvas> with no sizer shim needed.
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
    # published_to_js ids are content-addressed, so this one cached bundle string (_bundle_text)
    # always gets the same id and crosses the wire once per notebook, not once per widget.
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
