module HoloWGL

# The :webgl backend — render the figure live in a WGLMakie <canvas> on the client GPU,
# with Holo's overlay layered on top. Unlike CairoBackend (static PNG, 2D only), this
# handles 3D / animation / large data. Ships NO Bonito runtime and NO server: the scene
# is serialized to a plain payload (published_to_js) and drawn by a vendored WGLMakie
# bundle + a ~30-line shim (assets/holo-webgl.js). Validated by spikes 06/08:
# full 2D+3D fidelity, 1-2px overlay alignment, client-side animation hook.

using Holo: Holo, AbstractBackend, InteractionContext
using Reexport
@reexport using WGLMakie   # `using HoloWGL` gives the full plotting API (Figure/Axis/plots) + holo_webgl
using Bonito
import Makie
import Makie: Observable, Point2f

export WebGLBackend, holo_webgl

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
    return _plain(WGLMakie.serialize_scene(scene))
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

_ppu(b::WebGLBackend, _fig) = b.px_per_unit

function Holo.render(b::WebGLBackend, fig, ppu)
    w, h = size(fig.scene)
    return WebGLResult(scene_payload(fig), w, h, Float64(ppu))
end

# context: reuse the CairoBackend projection (Makie.project + viewport + scaling + flip).
# The spike measured this lands within 1-2px of where WGLMakie draws the data, so the
# STATIC-camera overlay rides the existing manifest unchanged.
#   NOTE: Axis3 / live-camera need client-side projection (read WGLMakie's camera) — TODO,
#   see NOTES.md. For 2D Axis this is the validated path.
function Holo.context(b::WebGLBackend, fig, ppu)
    w, h = size(fig.scene)
    scaling = Float64(ppu)
    out_w, out_h = round(Int, w * scaling), round(Int, h * scaling)
    display_scale = min(w, b.max_width) / out_w

    project = function (ax, p)
        q = Makie.project(ax.scene, Point2f(Float64(p[1]), Float64(p[2])))
        o = ax.scene.viewport[].origin
        return Point2f((q[1] + o[1]) * scaling, out_h - (q[2] + o[2]) * scaling)
    end

    axes = [c for c in fig.content if c isa Makie.Axis]
    ids = IdDict{Any, Symbol}()
    transforms = Dict{Symbol, Any}()
    for (k, ax) in enumerate(axes)
        ids[ax] = Symbol("ax", k)
    end
    return InteractionContext(project, transforms, ids, out_w, out_h, scaling, display_scale)
end

# Path to the committed shim bundle (vendored WGLMakie.bundled.js is sourced at runtime
# from the installed WGLMakie package, so the renderer always version-matches serialize_scene).
const SHIM_JS = joinpath(@__DIR__, "..", "assets", "holo-webgl.js")
wglmakie_bundle_path() = joinpath(pkgdir(WGLMakie), "src", "javascript", "WGLMakie.bundled.js")

include("widget.jl")   # holo_webgl + WebGLWidget + show (additive; reuses Holo's overlay/manifest)

end # module
