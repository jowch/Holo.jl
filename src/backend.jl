# The backend seam. A backend owns two operations — produce the artifact, and
# project data->image-px — behind which all CairoMakie specifics live. See architecture.md §2.

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

# ---- interface (every backend implements) ----
function render end
function context end
function mount end       # :img (raster) | :svg (vector)

# ---- CairoMakie: the one v1 backend ----------------------------------------

"""
    CairoBackend(; max_width=700, vector=false)

Static CairoMakie backend. Owns the render call (DPI/format/background); the user's
figure spec is respected but its save settings are not. Render resolution is derived
from `max_width` (the display width to target — Pluto's 700px column by default), not a
fixed `px_per_unit`: output ≈ 2× the display width (retina-crisp, not wasteful).
`vector=true` emits SVG.
"""
struct CairoBackend <: AbstractBackend
    max_width::Int
    vector::Bool
end
CairoBackend(; max_width = 700, vector = false) = CairoBackend(max_width, vector)

mount(b::CairoBackend) = b.vector ? :svg : :img

# px_per_unit derived from the layout fact: render at ~2× the actual display width.
function _ppu(b::CairoBackend, fig)
    sw = size(fig.scene)[1]
    return 2 * min(sw, b.max_width) / sw
end

# fig is already finalized (update_state_before_display!) by holo.
function render(::CairoBackend, fig, ppu)
    img = Makie.colorbuffer(fig; px_per_unit = ppu)   # ponytail: PNG only for v1; SVG path later
    io = IOBuffer(); save(Stream{format"PNG"}(io), img)
    return RenderResult("image/png", take!(io), size(img, 2), size(img, 1), Float64(ppu))
end

_scalesym(f) = f === identity ? :identity : Symbol(nameof(f))

# ordered category labels for a categorical dim conversion, else nothing
function _cats(conv)
    conv isa Makie.CategoricalConversion || return nothing
    isempty(conv.int_to_category) && return nothing
    return String[string(c) for (_, c) in sort(conv.int_to_category; by = first)]
end

function context(b::CairoBackend, fig, ppu)
    w, h = size(fig.scene)
    scaling = Float64(ppu)
    out_w, out_h = round(Int, w * scaling), round(Int, h * scaling)
    # how much the rendered image is downscaled to fit Pluto's column on screen — the same
    # display_css/image_width ratio the widget HTML uses (render.jl). Lets grid hitlayers reason
    # in true on-screen px instead of hardcoding the 2× DPI factor.
    display_scale = min(w, b.max_width) / out_w

    project = function (ax, p)
        q = Makie.project(ax.scene, Point2f(Float64(p[1]), Float64(p[2])))
        o = ax.scene.viewport[].origin
        return Point2f((q[1] + o[1]) * scaling, out_h - (q[2] + o[2]) * scaling)  # flip to image coords
    end

    # Fail loud, never silently wrong: an axis-like block that isn't a 2D `Makie.Axis`
    # (PolarAxis/Axis3/LScene) would be silently dropped here, then interactables would
    # project against the wrong axis. Reject it up front. (architecture.md non-goals)
    unsupported = unique(typeof.(c for c in fig.content if c isa Makie.AbstractAxis && !(c isa Makie.Axis)))
    isempty(unsupported) || throw(
        ArgumentError(
            "Holo overlays a static base + thin JS overlay and supports 2D `Makie.Axis` only; " *
                "found unsupported $(join(unsupported, ", ")). PolarAxis/Axis3/LScene need a " *
                "browser-side renderer (WGLMakie's domain), out of scope by design.",
        ),
    )

    axes = [c for c in fig.content if c isa Makie.Axis]
    ids = IdDict{Any, Symbol}()
    transforms = Dict{Symbol, AxisTransform}()
    for (k, ax) in enumerate(axes)
        id = Symbol("ax", k); ids[ax] = id
        transforms[id] = _axis_transform(id, ax, scaling, out_h)
    end
    cbs = [c for c in fig.content if c isa Makie.Colorbar]
    for (k, cb) in enumerate(cbs)
        id = Symbol("cb", k); ids[cb] = id
        transforms[id] = _colorbar_transform(id, cb, scaling, out_h)
    end
    return InteractionContext(project, transforms, ids, out_w, out_h, scaling, display_scale)
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
