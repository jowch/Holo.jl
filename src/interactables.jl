# The interactable seam. Every interactable — built-in or user-authored — implements
# this one contract and flows through the identical manifest/overlay path. See architecture.md §3.

"""
    HitLayer

The serialized unit: one geometry `kind` for one interactable, plus the data to resolve
a hit to an element index + payload. Compact by design (a heatmap ships edges, not N rects).
`geometry` layout is keyed by `kind` (see architecture.md §3).
"""
struct HitLayer
    id::Symbol
    kind::Symbol          # :circles|:polyline|:segments|:rects|:grid|:polygons|:axis|:threshold
    geometry::Any
    payloads::Vector{Any}
    axis::Symbol
    events::Tuple
end

abstract type AbstractInteractable end

# ---- the contract (hitlayers required; rest defaulted) ----
function hitlayers end
validate(::AbstractInteractable, ::InteractionContext) = nothing
events(::AbstractInteractable) = (:click, :hover)
tooltip(::AbstractInteractable, ::Int, payload) = nothing
hoverstyle(::AbstractInteractable, ::Int) = (; stroke = "#ff3b30", width = 3)

# validate is per-capability (architecture.md §3). Element interactables project in Julia via
# Makie.project, so they work on any Makie-projectable scale → no gate (default `nothing`).
# Only AxisInteractable relies on client-side JS inversion, so it alone restricts scales.
const _JS_INVERTIBLE = (:identity, :log10, :log)  # scales geometry.ts `invert` implements

_proj(ctx, ax, p) = data_to_image_px(ctx, ax, p)

# ============================ PointInteractable ============================
struct PointInteractable <: AbstractInteractable
    ax; points::Vector{Point2f}; id::Symbol; payloads::Vector{Any}; radius::Float64
end
function PointInteractable(
        ax, points; id = :points,
        payloads = [
            (; index = k - 1, x = Float64(p[1]), y = Float64(p[2]))
                for (k, p) in enumerate(points)
        ],
        radius = 9
    )
    pts = [Point2f(p[1], p[2]) for p in points]
    length(payloads) == length(pts) || throw(ArgumentError("payloads must match points"))
    return PointInteractable(ax, pts, id, collect(Any, payloads), Float64(radius))
end
function hitlayers(i::PointInteractable, ctx)
    g = Float32[]
    for p in i.points
        q = _proj(ctx, i.ax, p); append!(g, (q[1], q[2], i.radius * ctx.scaling))
    end
    return [HitLayer(i.id, :circles, g, i.payloads, axis_id(ctx, i.ax), events(i))]
end

# ============================ SegmentInteractable ==========================
struct SegmentInteractable <: AbstractInteractable
    ax; vertices::Vector{Point2f}; mode::Symbol; id::Symbol; payloads::Vector{Any}; tol::Float64
end
function SegmentInteractable(
        ax, vertices; mode = :polyline, id = :segments,
        payloads = nothing, tol = 6
    )
    vs = [Point2f(v[1], v[2]) for v in vertices]
    nseg = mode === :polyline ? max(0, length(vs) - 1) : length(vs) ÷ 2
    pl = payloads === nothing ? Any[(; segment_index = k - 1) for k in 1:nseg] : collect(Any, payloads)
    return SegmentInteractable(ax, vs, mode, id, pl, Float64(tol))
end
function hitlayers(i::SegmentInteractable, ctx)
    g = Float32[]
    for v in i.vertices
        q = _proj(ctx, i.ax, v); append!(g, (q[1], q[2]))
    end
    kind = i.mode === :polyline ? :polyline : :segments
    return [HitLayer(i.id, kind, g, i.payloads, axis_id(ctx, i.ax), events(i))]
end

# ============================ RectInteractable =============================
# list: rects of (xc,yc,w,h) in DATA space. grid: (xedges, yedges, values) in DATA space.
struct RectInteractable <: AbstractInteractable
    ax; layout::Symbol; data::Any; id::Symbol; payloads::Vector{Any}
end
function RectInteractable(ax; rects = nothing, grid = nothing, id = :rects, payloads = nothing)
    return if grid !== nothing
        xe, ye, vals = grid
        RectInteractable(ax, :grid, (collect(Float64, xe), collect(Float64, ye), vals), id, Any[])
    else
        rs = [(Float64(r[1]), Float64(r[2]), Float64(r[3]), Float64(r[4])) for r in rects]
        pl = payloads === nothing ? Any[(; index = k - 1) for k in 1:length(rs)] : collect(Any, payloads)
        RectInteractable(ax, :list, rs, id, pl)
    end
end
function hitlayers(i::RectInteractable, ctx)
    if i.layout === :list
        g = Float32[]
        for (xc, yc, w, h) in i.data
            a = _proj(ctx, i.ax, (xc - w / 2, yc - h / 2)); b = _proj(ctx, i.ax, (xc + w / 2, yc + h / 2))
            cx = (a[1] + b[1]) / 2; cy = (a[2] + b[2]) / 2
            append!(g, (cx, cy, abs(b[1] - a[1]), abs(b[2] - a[2])))
        end
        return [HitLayer(i.id, :rects, g, i.payloads, axis_id(ctx, i.ax), events(i))]
    else
        xe, ye, vals = i.data
        y0 = ye[1]
        xedges = Float32[_proj(ctx, i.ax, (x, y0))[1] for x in xe]
        x0 = xe[1]
        yedges = Float32[_proj(ctx, i.ax, (x0, y))[2] for y in ye]
        ncols, nrows = length(xe) - 1, length(ye) - 1
        flat = Float32[Float32(vals[c, r]) for r in 1:nrows for c in 1:ncols]  # row-major: r*ncols+c
        geom = Dict(
            "xedges" => xedges, "yedges" => yedges,
            "ncols" => ncols, "nrows" => nrows, "values" => flat
        )
        return [HitLayer(i.id, :grid, geom, Any[], axis_id(ctx, i.ax), events(i))]
    end
end

# ============================ PolygonInteractable ==========================
struct PolygonInteractable <: AbstractInteractable
    ax; rings::Vector; id::Symbol; payloads::Vector{Any}
end
function PolygonInteractable(ax, rings; id = :polygons, payloads = nothing)
    rs = [[Point2f(p[1], p[2]) for p in ring] for ring in rings]
    pl = payloads === nothing ? Any[(; index = k - 1) for k in 1:length(rs)] : collect(Any, payloads)
    return PolygonInteractable(ax, rs, id, pl)
end
function hitlayers(i::PolygonInteractable, ctx)
    geom = Vector{Float32}[]
    for ring in i.rings
        flat = Float32[]
        for p in ring
            q = _proj(ctx, i.ax, p); append!(flat, (q[1], q[2]))
        end
        push!(geom, flat)
    end
    return [HitLayer(i.id, :polygons, geom, i.payloads, axis_id(ctx, i.ax), events(i))]
end

# ============================ AxisInteractable ============================
# No regions; rides the axis-transform channel. JS inverts pixels->data on hover/click.
struct AxisInteractable <: AbstractInteractable
    ax; id::Symbol
end
AxisInteractable(ax; id = :axis) = AxisInteractable(ax, id)
function validate(i::AxisInteractable, ctx::InteractionContext)
    t = ctx.transforms[axis_id(ctx, i.ax)]
    (t.xscale in _JS_INVERTIBLE && t.yscale in _JS_INVERTIBLE) ||
        return "AxisInteractable: scale (x=$(t.xscale), y=$(t.yscale)) is not invertible client-side; " *
        "supported: identity/log10/log (categorical is fine)."
    return nothing
end
hitlayers(i::AxisInteractable, ctx) =
    [HitLayer(i.id, :axis, nothing, Any[], axis_id(ctx, i.ax), events(i))]

# ============================ ThresholdInteractable ========================
# A draggable horizontal/vertical line (Tier 0). Drags locally in JS; on mouse-up the
# pixel is inverted to a data-space scalar via the shipped AxisTransform and round-tripped
# to @bind. Lives entirely in the overlay — the base render never sees it.
struct ThresholdInteractable <: AbstractInteractable
    ax; orientation::Symbol; value::Float64; id::Symbol
end
function ThresholdInteractable(ax; orientation = :horizontal, value, id = :threshold)
    orientation in (:horizontal, :vertical) ||
        throw(ArgumentError("ThresholdInteractable: orientation must be :horizontal or :vertical, got $(orientation)"))
    return ThresholdInteractable(ax, orientation, Float64(value), id)
end
events(::ThresholdInteractable) = (:drag,)
function validate(i::ThresholdInteractable, ctx::InteractionContext)
    t = ctx.transforms[axis_id(ctx, i.ax)]
    sc = i.orientation === :horizontal ? t.yscale : t.xscale
    sc in _JS_INVERTIBLE || return "ThresholdInteractable: $(i.orientation) drag needs a client-side " *
        "invertible $(i.orientation === :horizontal ? "y" : "x")-scale ($(sc) is not; supported: identity/log10/log)."
    return nothing
end
function hitlayers(i::ThresholdInteractable, ctx)
    t = ctx.transforms[axis_id(ctx, i.ax)]
    vx, vy, vw, vh = t.viewport
    if i.orientation === :horizontal
        pos = _proj(ctx, i.ax, (t.xlims[1], i.value))[2]   # constant data-y → its pixel-y
        span = Float32[vx, vx + vw]; orient = "h"
    else
        pos = _proj(ctx, i.ax, (i.value, t.ylims[1]))[1]   # constant data-x → its pixel-x
        span = Float32[vy, vy + vh]; orient = "v"
    end
    geom = Dict("orientation" => orient, "pos" => Float32(pos), "span" => span)
    return [HitLayer(i.id, :threshold, geom, Any[], axis_id(ctx, i.ax), events(i))]
end

# ============================ custom: RegionInteractable (Tier A) =========
# Declarative mixed regions in DATA space. Grouped into one layer per kind.
struct RegionInteractable <: AbstractInteractable
    ax; regions::Vector; payloads::Vector{Any}; id::Symbol; tip::Function; evs::Tuple
end
function RegionInteractable(
        ax; regions, payloads, id = :region,
        tooltip = (pl -> nothing), events = (:click, :hover)
    )
    length(regions) == length(payloads) || throw(ArgumentError("regions/payloads length mismatch"))
    return RegionInteractable(ax, collect(regions), collect(Any, payloads), id, tooltip, events)
end
events(i::RegionInteractable) = i.evs
tooltip(i::RegionInteractable, ::Int, pl) = i.tip(pl)
function hitlayers(i::RegionInteractable, ctx)
    circ = Float32[]; cpl = Any[]; rect = Float32[]; rpl = Any[]; polys = Vector{Float32}[]; ppl = Any[]
    for (reg, pl) in zip(i.regions, i.payloads)
        kind = reg[1]
        if kind === :circle
            q = _proj(ctx, i.ax, reg[2]); append!(circ, (q[1], q[2], Float64(reg[3]) * ctx.scaling)); push!(cpl, pl)
        elseif kind === :rect
            xc, yc = reg[2]; w, h = Float64(reg[3]), Float64(reg[4])
            a = _proj(ctx, i.ax, (xc - w / 2, yc - h / 2)); b = _proj(ctx, i.ax, (xc + w / 2, yc + h / 2))
            append!(rect, ((a[1] + b[1]) / 2, (a[2] + b[2]) / 2, abs(b[1] - a[1]), abs(b[2] - a[2]))); push!(rpl, pl)
        elseif kind === :polygon
            flat = Float32[]; for p in reg[2]
                q = _proj(ctx, i.ax, p); append!(flat, (q[1], q[2]))
            end
            push!(polys, flat); push!(ppl, pl)
        else
            throw(ArgumentError("RegionInteractable: unknown region kind $(kind)"))
        end
    end
    aid = axis_id(ctx, i.ax); ls = HitLayer[]
    isempty(cpl) || push!(ls, HitLayer(Symbol(i.id, :_c), :circles, circ, cpl, aid, i.evs))
    isempty(rpl) || push!(ls, HitLayer(Symbol(i.id, :_r), :rects, rect, rpl, aid, i.evs))
    isempty(ppl) || push!(ls, HitLayer(Symbol(i.id, :_p), :polygons, polys, ppl, aid, i.evs))
    return ls
end

# ============================ custom: FunctionInteractable (Tier B) =======
struct FunctionInteractable <: AbstractInteractable
    f::Function; evs::Tuple
end
FunctionInteractable(f; events = (:click, :hover)) = FunctionInteractable(f, events)
events(i::FunctionInteractable) = i.evs
hitlayers(i::FunctionInteractable, ctx) = i.f(ctx)
