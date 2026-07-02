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
    is3d::Bool                              # Axis3: pixel→data inversion is undefined (a pixel is a ray) — lims degenerate, JS never inverts
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
# Fail loud, never silently wrong: the old `:ax1` fallback silently absorbed any
# fig.content block a backend forgot to register (a Colorbar, tomorrow a Legend) and
# rebound it to the main axis — turning a missing transform into a plausible-but-WRONG
# widget (whole-plot 2-D readout instead of the colorbar value; validate passed). An
# unregistered block is a backend context() bug or an interactable keyed to an axis
# that isn't part of the rendered figure — both must surface at build time.
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

# ---- interface (every backend extension implements methods for these) ----
function render end
function context end
function mount end        # :img (raster) | :svg (vector) | :webgl (live canvas)
function _ppu end         # (backend, fig) -> px_per_unit / device scale
function make_widget end  # (backend, <backend's RenderResult-like>, manifest, display_css) -> the @bind widget

# ---- shared projection + axis-transform helpers: both CairoBackend and WebGLBackend
# build the same projection closure and AxisTransform shape off a 2D Makie.Axis.
# WebGLBackend's context() calls these directly (see ext/HoloWGLMakieExt.jl) rather
# than duplicating them. ----

# The shared data→image-px projection closure — both backends' context() build it with
# this (ONE fix site, not two). The 2-arg `Makie.project(scene, p)` expects TRANSFORMED
# (post-transform_func) coordinates — it does NOT apply the scene's transform_func
# (verified empirically on Makie 0.24.12: raw feed lands 0/5 on a log-axis scatter's
# rendered markers; transformed feed 5/5 at 0.0px) — so apply the axis transform first,
# in input (Float64) precision: `project` f32-converts afterward, and a Float32-first
# cast would lose precision on large-magnitude coords and overflow to Inf above
# floatmax(Float32) (e.g. x=1e39 on a log axis is fine in Float64: log10 → 39).
# Out-of-domain input (e.g. log10 of a negative) throws DomainError inside
# apply_transform: NaN-guard it so the point degrades to a non-finite projection.
# (log10(0.0) is -Inf WITHOUT throwing — that degrades through the same non-finite
# path, no guard needed.) Element layers are un-gated on scale; `_q` passes non-finite
# through — see interactables.jl and the log-scale testset in core_tests.jl.
# 3D enters ONLY here (WS-3D): points widen to Point3 (z=0 for 2-coord input, so the 2D
# path is unchanged — spike-verified byte-identical incl. on log axes), Makie's 2-tuple
# transform_func applies to x/y and preserves z, Axis3's transform_func is `identity`,
# and `Makie.project` handles the 3D camera. The output stays a 2D image-px point:
# hit-testing is 2D pixel geometry on both backends regardless of scene dimensionality.
function _project_closure(scaling, out_h)
    return function (ax, p)
        tp = try
            Makie.apply_transform(
                Makie.transform_func(ax.scene),
                Makie.Point3(Float64(p[1]), Float64(p[2]), length(p) >= 3 ? Float64(p[3]) : 0.0)
            )
        catch e
            e isa DomainError || rethrow()
            Point3f(NaN32, NaN32, NaN32)
        end
        q = Makie.project(ax.scene, tp)
        o = ax.scene.viewport[].origin
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
    vp = ax.scene.viewport[]; o = vp.origin; wv = vp.widths
    vpx = (o[1] * scaling, out_h - (o[2] + wv[2]) * scaling, wv[1] * scaling, wv[2] * scaling)
    fl = ax.finallimits[]; fo = fl.origin; fw = fl.widths
    return AxisTransform(
        id,
        (fo[1], fo[1] + fw[1]), (fo[2], fo[2] + fw[2]),
        _scalesym(ax.xscale[]), _scalesym(ax.yscale[]),
        vpx, ax.xreversed[], ax.yreversed[],
        _cats(ax.dim1_conversion[]), _cats(ax.dim2_conversion[]), nothing, false
    )
end

# An Axis3's transform carries only what is well-defined for a 3D scene: its pixel viewport
# and is3d=true. Continuous pixel→data inversion has no meaning on a projected 3D axis (a
# screen pixel is a ray, not a data point), so lims are degenerate and the JS side never
# inverts them — interactables that NEED inversion (Axis/Threshold/ROI) fail loud in
# validate() on is3d. Element interactables only need `ctx.ids[ax]` set: they project in
# Julia through the shared closure, which handles the 3D camera.
function _axis3_transform(id, ax, scaling, out_h)
    vp = ax.scene.viewport[]; o = vp.origin; wv = vp.widths
    vpx = (o[1] * scaling, out_h - (o[2] + wv[2]) * scaling, wv[1] * scaling, wv[2] * scaling)
    return AxisTransform(
        id, (0.0, 1.0), (0.0, 1.0), :identity, :identity,
        vpx, false, false, nothing, nothing, nothing, true
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
        return AxisTransform(id, (0.0, 1.0), (lo, hi), :identity, sc, vpx, false, false, nothing, nothing, :y, false)
    else
        return AxisTransform(id, (lo, hi), (0.0, 1.0), sc, :identity, vpx, false, false, nothing, nothing, :x, false)
    end
end
