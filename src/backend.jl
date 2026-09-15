"""
    RenderResult

The displayable artifact + the numbers JS needs to map it.
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
    xcats::Union{Nothing, Vector{String}}   # nothing if not categorical
    ycats::Union{Nothing, Vector{String}}
    valueaxis::Union{Nothing, Symbol}       # nothing = 2-D {x,y}; :x/:y = 1-D colorbar readout axis
    is3d::Bool                              # pixel→data inversion is undefined on a 3D axis; lims are degenerate
    ispolar::Bool                           # continuous θ/r readout not shipped to JS; lims are degenerate
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
axis_id(ctx::InteractionContext, ax) =
    get(ctx.ids, ax) do
    throw(
        ArgumentError(
            "Holo: $(typeof(ax)) is not registered in this backend's InteractionContext — " *
                "no axis/colorbar transform was built for it. Interactables must be keyed to a " *
                "Makie.Axis or Colorbar that is part of the rendered figure. (If it IS part of " *
                "the figure, this is a backend context() bug — please report it.)"
        )
    )
end

# every backend extension implements methods for these (bodies stay empty here)
function render end
function context end
function _ppu end         # (backend, fig) -> px_per_unit / device scale
function make_widget end  # (backend, <backend's RenderResult-like>, manifest, display_css) -> the @bind widget

# `Makie.project` expects post-transform_func coordinates; transform in Float64 first —
# an early Float32 cast can overflow (e.g. log10(1e39)) or lose precision. DomainError
# (e.g. log10 of a negative) degrades to a NaN point rather than throwing; `_q` in
# interactables.jl passes non-finite coordinates through unchanged. Points widen to
# Point3 so this same closure also projects 3D scenes (Axis3's transform_func is
# `identity`; `Makie.project` applies the 3D camera itself).
function _project_closure(scaling, out_h)
    return function (ax, p)
        tp = try
            _apply_transform(
                _transform_func(ax.scene),
                Makie.Point3(Float64(p[1]), Float64(p[2]), length(p) >= 3 ? Float64(p[3]) : 0.0)
            )
        catch e
            e isa DomainError || rethrow()
            Point3f(NaN32, NaN32, NaN32)
        end
        q = _project_px(ax.scene, tp)
        o = _scene_viewport(ax).origin
        return Point2f((q[1] + o[1]) * scaling, out_h - (q[2] + o[2]) * scaling)  # flip to image coords
    end
end

_scalesym(f) = f === identity ? :identity : Symbol(nameof(f))

# ordered category labels for a categorical dim conversion, else nothing
function _cats(conv)
    conv isa Makie.CategoricalConversion || return nothing
    isempty(conv.int_to_category) && return nothing
    return String[string(c) for (_, c) in sort(conv.int_to_category; by = first)]
end

function _axis_transform(id, ax, scaling, out_h)
    vp = _scene_viewport(ax); o = vp.origin; wv = vp.widths
    vpx = (o[1] * scaling, out_h - (o[2] + wv[2]) * scaling, wv[1] * scaling, wv[2] * scaling)
    fl = _finallimits(ax); fo = fl.origin; fw = fl.widths
    return AxisTransform(
        id,
        (fo[1], fo[1] + fw[1]), (fo[2], fo[2] + fw[2]),
        _scalesym(ax.xscale[]), _scalesym(ax.yscale[]),
        vpx, ax.xreversed[], ax.yreversed[],
        _cats(ax.dim1_conversion[]), _cats(ax.dim2_conversion[]), nothing, false, false
    )
end

# A screen pixel on a 3D axis is a ray, not a data point, so pixel→data inversion is
# undefined; lims here are placeholders and Axis/Threshold/ROI must fail loud in
# validate() on is3d rather than use them.
function _axis3_transform(id, ax, scaling, out_h)
    vp = _scene_viewport(ax); o = vp.origin; wv = vp.widths
    vpx = (o[1] * scaling, out_h - (o[2] + wv[2]) * scaling, wv[1] * scaling, wv[2] * scaling)
    return AxisTransform(
        id, (0.0, 1.0), (0.0, 1.0), :identity, :identity,
        vpx, false, false, nothing, nothing, nothing, true, false
    )
end

# Continuous θ/r inversion needs the polar transform serialized to JS, not shipped yet;
# lims are placeholders and Axis/Threshold/ROI must fail loud in validate() on ispolar.
function _polar_transform(id, ax, scaling, out_h)
    vp = _scene_viewport(ax); o = vp.origin; wv = vp.widths
    vpx = (o[1] * scaling, out_h - (o[2] + wv[2]) * scaling, wv[1] * scaling, wv[2] * scaling)
    return AxisTransform(
        id, (0.0, 1.0), (0.0, 1.0), :identity, :identity,
        vpx, false, false, nothing, nothing, nothing, false, true
    )
end

# The value axis carries cb.limits/scale over the colorbar's pixel bbox; the other
# axis is degenerate and never read.
function _colorbar_transform(id, cb, scaling, out_h)
    bb = _colorbar_bbox(cb)
    o = bb.origin; wv = bb.widths
    vpx = (o[1] * scaling, out_h - (o[2] + wv[2]) * scaling, wv[1] * scaling, wv[2] * scaling)
    lims = cb.limits[]
    isnothing(lims) && error("Colorbar introspection: nothing limits (Makie internals changed?)")
    lo, hi = Float64(lims[1]), Float64(lims[2])
    sc = _scalesym(cb.scale[])
    vertical = cb.vertical[]
    if vertical
        return AxisTransform(id, (0.0, 1.0), (lo, hi), :identity, sc, vpx, false, false, nothing, nothing, :y, false, false)
    else
        return AxisTransform(id, (lo, hi), (0.0, 1.0), sc, :identity, vpx, false, false, nothing, nothing, :x, false, false)
    end
end
