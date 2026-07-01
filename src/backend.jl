# The backend seam. A backend owns: produce the displayable artifact, project
# data->image-px, and build the @bind widget — behind which each rendering backend's
# specifics live. See architecture.md §2. Concrete backends (CairoBackend, WebGLBackend)
# live in package extensions (ext/HoloCairoMakieExt.jl, ext/HoloWGLMakieExt.jl) — this
# file only holds what's shared across all backends.

"""
    RenderResult

The displayable artifact + the numbers JS needs to map it. `payload` is bytes (raster)
or a string (svg); `mount` reports which.
"""
struct RenderResult
    mime::String
    payload::Union{Vector{UInt8}, String}
    width::Int
    height::Int
    scaling::Float64
end

"""
    AxisTransform

One axis expressed declaratively, in the artifact's pixel space, so JS can invert
pixels↔data for `AxisInteractable` and live hover-coordinate readout.
"""
struct AxisTransform
    id::Symbol
    xlims::Tuple{Float64, Float64}
    ylims::Tuple{Float64, Float64}
    xscale::Symbol
    yscale::Symbol
    viewport::NTuple{4, Float64}      # (x,y,w,h) image px, top-left origin
    xreversed::Bool
    yreversed::Bool
    xcats::Union{Nothing, Vector{String}}   # categorical tick map (v1; nothing if not categorical)
    ycats::Union{Nothing, Vector{String}}
    valueaxis::Union{Nothing, Symbol}       # nothing = 2-D {x,y} readout; :x/:y = 1-D colorbar value readout
end

"""
    InteractionContext

Backend-produced bridge handed to every interactable. `project` is the backend's
data→image-px closure (so projection is not hard-wired to Makie). `transforms` are
serialized to JS; `ids` maps an axis object to its transform id.
"""
struct InteractionContext
    project::Function                       # (ax, point) -> Point2f, image px
    transforms::Dict{Symbol, AxisTransform}
    ids::IdDict{Any, Symbol}
    width::Int
    height::Int
    scaling::Float64
    display_scale::Float64                  # CSS px per image px on screen (image is rendered above display res)
end

"the one coordinate primitive interactables call — never re-derive projection"
data_to_image_px(ctx::InteractionContext, ax, p) = ctx.project(ax, p)
axis_id(ctx::InteractionContext, ax) = get(ctx.ids, ax, :ax1)

# ---- interface (every backend extension implements methods for these) ----
function render end
function context end
function mount end        # :img (raster) | :svg (vector) | :webgl (live canvas)
function _ppu end         # (backend, fig) -> px_per_unit / device scale
function make_widget end  # (backend, <backend's RenderResult-like>, manifest, display_css) -> the @bind widget

# ---- shared axis-transform helpers: both CairoBackend and WebGLBackend build the same
# AxisTransform shape off a 2D Makie.Axis. WebGLBackend's context() calls these directly
# (see ext/HoloWGLMakieExt.jl) rather than duplicating the loop. ----
_scalesym(f) = f === identity ? :identity : Symbol(nameof(f))

# ordered category labels for a categorical dim conversion, else nothing
function _cats(conv)
    conv isa Makie.CategoricalConversion || return nothing
    isempty(conv.int_to_category) && return nothing
    return String[string(c) for (_, c) in sort(conv.int_to_category; by = first)]
end

function _axis_transform(id, ax, scaling, out_h)
    vp = ax.scene.viewport[]; o = vp.origin; wv = vp.widths
    vpx = (o[1] * scaling, out_h - (o[2] + wv[2]) * scaling, wv[1] * scaling, wv[2] * scaling)
    fl = ax.finallimits[]; fo = fl.origin; fw = fl.widths
    return AxisTransform(
        id,
        (fo[1], fo[1] + fw[1]), (fo[2], fo[2] + fw[2]),
        _scalesym(ax.xscale[]), _scalesym(ax.yscale[]),
        vpx, ax.xreversed[], ax.yreversed[],
        _cats(ax.dim1_conversion[]), _cats(ax.dim2_conversion[]), nothing
    )
end

# A Colorbar is a 1-D scale: its value runs along the long axis (y if vertical, x if horizontal).
# Build an AxisTransform whose value axis carries cb.limits/scale over the colorbar's pixel bbox;
# the other axis is degenerate (never read). Geometry from the laid-out block, converted with the
# same ×scaling + y-flip as an axis viewport.
function _colorbar_transform(id, cb, scaling, out_h)
    bb = cb.layoutobservables.computedbbox[]
    o = bb.origin; wv = bb.widths
    vpx = (o[1] * scaling, out_h - (o[2] + wv[2]) * scaling, wv[1] * scaling, wv[2] * scaling)
    lims = cb.limits[]
    isnothing(lims) && error("Colorbar introspection: nothing limits (Makie internals changed?)")
    lo, hi = Float64(lims[1]), Float64(lims[2])
    sc = _scalesym(cb.scale[])
    vertical = cb.vertical[]
    if vertical
        return AxisTransform(id, (0.0, 1.0), (lo, hi), :identity, sc, vpx, false, false, nothing, nothing, :y)
    else
        return AxisTransform(id, (lo, hi), (0.0, 1.0), sc, :identity, vpx, false, false, nothing, nothing, :x)
    end
end
