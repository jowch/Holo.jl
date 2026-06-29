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
# Per-LAYER tooltip spec (applies to every element of the interactable's layers):
#   nothing → auto name/value table (default) · Markup → template · false → suppress.
tooltip_spec(::AbstractInteractable) = nothing
hoverstyle(::AbstractInteractable, ::Int) = (; stroke = "#ff3b30", width = 3)

abstract type AbstractSelector <: AbstractInteractable end

# Selection interface (only AbstractSelectors override these).
selects(::AbstractInteractable) = nothing
compatible_kinds(::AbstractInteractable) = ()

# validate is per-capability (architecture.md §3). Element interactables project in Julia via
# Makie.project, so they work on any Makie-projectable scale → no gate (default `nothing`).
# Only AxisInteractable relies on client-side JS inversion, so it alone restricts scales.
const _JS_INVERTIBLE = (:identity, :log10, :log)  # scales geometry.ts `invert` implements

# Min on-screen cell size (CSS px) below which a heatmap/image's values[] is dropped: a cell
# smaller than ~1 px can't be cursor-targeted, so the matrix is pure payload. See architecture.md §8.
const GRID_VALUES_MIN_SCREEN_PX = 1.0

_proj(ctx, ax, p) = data_to_image_px(ctx, ax, p)

# Quantize a finite geometry coordinate to integer image-px. MsgPack encodes a small Int in 1–3 bytes
# vs a Float32's flat 5, so per-element geometry stores Int — −58% on that term, no manifest-shape change
# (the frontend reads numbers either way), and ≤0.5px is inside the ~1px hit-test tolerance. AxisTransform
# lims/viewport stay Float64 (M4 drag inverts pixel→data through them). See architecture.md §9.
#
# Non-finite coords pass through as Float32 (NOT rounded — `round(Int, NaN/Inf)` throws): element layers
# are un-gated on scale (above), so a log out-of-domain point projects to NaN/±Inf, and `:polyline`
# uses NaN as a gap sentinel (types.ts/geometry.ts). Geometry vectors are therefore `Real[]` (Int for
# finite, Float32 for non-finite) — an abstract eltype, so the value still ships generically (the
# measured 1–3 B/coord), never via Pluto's binary typed-array path (which would be 8 B/coord for Int64).
_q(x) = isfinite(x) ? round(Int, x) : Float32(x)

# ============================ PointInteractable ============================
struct PointInteractable <: AbstractInteractable
    ax; points::Vector{Point2f}; id::Symbol; payloads::Vector{Any}; radius::Float64; tooltip::Union{Nothing, Markup, Bool}
end
function PointInteractable(
        ax, points; id = :points,
        payloads = [
            (; index = k - 1, x = Float64(p[1]), y = Float64(p[2]))
                for (k, p) in enumerate(points)
        ],
        radius = 9, tooltip = nothing
    )
    pts = [Point2f(p[1], p[2]) for p in points]
    length(payloads) == length(pts) || throw(ArgumentError("payloads must match points"))
    return PointInteractable(ax, pts, id, collect(Any, payloads), Float64(radius), tooltip)
end
tooltip_spec(i::PointInteractable) = i.tooltip
function hitlayers(i::PointInteractable, ctx)
    g = Real[]
    for p in i.points
        q = _proj(ctx, i.ax, p); append!(g, (_q(q[1]), _q(q[2]), _q(i.radius * ctx.scaling)))
    end
    return [HitLayer(i.id, :circles, g, i.payloads, axis_id(ctx, i.ax), events(i))]
end

# ============================ SegmentInteractable ==========================
struct SegmentInteractable <: AbstractInteractable
    ax; vertices::Vector{Point2f}; mode::Symbol; id::Symbol; payloads::Vector{Any}; tol::Float64; tooltip::Union{Nothing, Markup, Bool}
end
function SegmentInteractable(
        ax, vertices; mode = :polyline, id = :segments,
        payloads = nothing, tol = 6, tooltip = nothing
    )
    vs = [Point2f(v[1], v[2]) for v in vertices]
    nseg = mode === :polyline ? max(0, length(vs) - 1) : length(vs) ÷ 2
    pl = payloads === nothing ? Any[(; segment_index = k - 1) for k in 1:nseg] : collect(Any, payloads)
    return SegmentInteractable(ax, vs, mode, id, pl, Float64(tol), tooltip)
end
tooltip_spec(i::SegmentInteractable) = i.tooltip
function hitlayers(i::SegmentInteractable, ctx)
    g = Real[]
    for v in i.vertices
        q = _proj(ctx, i.ax, v); append!(g, (_q(q[1]), _q(q[2])))
    end
    kind = i.mode === :polyline ? :polyline : :segments
    return [HitLayer(i.id, kind, g, i.payloads, axis_id(ctx, i.ax), events(i))]
end

# ============================ RectInteractable =============================
# list: rects of (xc,yc,w,h) in DATA space. grid: (xedges, yedges, values) in DATA space.
struct RectInteractable <: AbstractInteractable
    ax; layout::Symbol; data::Any; id::Symbol; payloads::Vector{Any}; tooltip::Union{Nothing, Markup, Bool}
end
function RectInteractable(ax; rects = nothing, grid = nothing, id = :rects, payloads = nothing, tooltip = nothing)
    return if grid !== nothing
        xe, ye, vals = grid
        RectInteractable(ax, :grid, (collect(Float64, xe), collect(Float64, ye), vals), id, Any[], tooltip)
    else
        rs = [(Float64(r[1]), Float64(r[2]), Float64(r[3]), Float64(r[4])) for r in rects]
        pl = payloads === nothing ? Any[(; index = k - 1) for k in 1:length(rs)] : collect(Any, payloads)
        RectInteractable(ax, :list, rs, id, pl, tooltip)
    end
end
tooltip_spec(i::RectInteractable) = i.tooltip
function hitlayers(i::RectInteractable, ctx)
    if i.layout === :list
        g = Real[]
        for (xc, yc, w, h) in i.data
            a = _proj(ctx, i.ax, (xc - w / 2, yc - h / 2)); b = _proj(ctx, i.ax, (xc + w / 2, yc + h / 2))
            cx = (a[1] + b[1]) / 2; cy = (a[2] + b[2]) / 2
            append!(g, (_q(cx), _q(cy), _q(abs(b[1] - a[1])), _q(abs(b[2] - a[2]))))
        end
        return [HitLayer(i.id, :rects, g, i.payloads, axis_id(ctx, i.ax), events(i))]
    else
        xe, ye, vals = i.data
        y0 = ye[1]
        xedges = Real[_q(_proj(ctx, i.ax, (x, y0))[1]) for x in xe]
        x0 = xe[1]
        yedges = Real[_q(_proj(ctx, i.ax, (x0, y))[2]) for y in ye]
        ncols, nrows = length(xe) - 1, length(ye) - 1
        geom = Dict{String, Any}(
            "xedges" => xedges, "yedges" => yedges, "ncols" => ncols, "nrows" => nrows
        )
        # values[] is the unbounded payload term: a source-resolution matrix shipped only to power
        # the no-round-trip (i,j)=value hover. When cells render sub-pixel on screen the user can't
        # target a cell anyway, so drop it (the click still round-trips to the kernel, which has the
        # matrix). Cap by expected on-screen cell size — architecture.md §8.
        cell_px = min(
            abs(xedges[end] - xedges[1]) / ncols,
            abs(yedges[end] - yedges[1]) / nrows,
        ) * ctx.display_scale
        if cell_px >= GRID_VALUES_MIN_SCREEN_PX
            geom["values"] = Float32[Float32(vals[c, r]) for r in 1:nrows for c in 1:ncols]  # row-major: r*ncols+c
        else
            @warn "Holo: heatmap/image grid cells are ~$(round(cell_px; digits = 2)) px on screen " *
                "(sub-pixel); dropping the values[] payload to bound manifest size. Hover shows (i,j) " *
                "only; clicks still carry it (the kernel round-trip has your matrix)." maxlog = 1
        end
        return [HitLayer(i.id, :grid, geom, Any[], axis_id(ctx, i.ax), events(i))]
    end
end

# ============================ PolygonInteractable ==========================
struct PolygonInteractable <: AbstractInteractable
    ax; rings::Vector; id::Symbol; payloads::Vector{Any}; tooltip::Union{Nothing, Markup, Bool}
end
function PolygonInteractable(ax, rings; id = :polygons, payloads = nothing, tooltip = nothing)
    rs = [[Point2f(p[1], p[2]) for p in ring] for ring in rings]
    pl = payloads === nothing ? Any[(; index = k - 1) for k in 1:length(rs)] : collect(Any, payloads)
    return PolygonInteractable(ax, rs, id, pl, tooltip)
end
tooltip_spec(i::PolygonInteractable) = i.tooltip
function hitlayers(i::PolygonInteractable, ctx)
    geom = Vector{Real}[]
    for ring in i.rings
        flat = Real[]
        for p in ring
            q = _proj(ctx, i.ax, p); append!(flat, (_q(q[1]), _q(q[2])))
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

# ============================ ROIInteractable ==============================
# A draggable + resizable rectangle (Tier 0). Moves/resizes locally in JS; on mouse-up the two
# opposite pixel corners are inverted to data-space bounds via the AxisTransform and round-tripped
# to @bind. Lives entirely in the overlay — the base render never sees it.
struct ROIInteractable <: AbstractSelector
    ax; bounds::NTuple{4, Float64}; id::Symbol; selects::Union{Nothing, Symbol}   # (xmin,xmax,ymin,ymax) data space
end
function ROIInteractable(ax; bounds, id = :roi, selects = nothing)
    length(bounds) == 4 || throw(ArgumentError("ROIInteractable: bounds must be (xmin, xmax, ymin, ymax)"))
    xmin, xmax, ymin, ymax = Float64.(Tuple(bounds))
    (xmin < xmax && ymin < ymax) ||
        throw(ArgumentError("ROIInteractable: need xmin < xmax and ymin < ymax, got $(bounds)"))
    return ROIInteractable(ax, (xmin, xmax, ymin, ymax), id, selects)
end
selects(i::ROIInteractable) = i.selects
compatible_kinds(::ROIInteractable) = (:circles, :grid)
events(::ROIInteractable) = (:drag,)
function validate(i::ROIInteractable, ctx::InteractionContext)
    t = ctx.transforms[axis_id(ctx, i.ax)]
    (t.xscale in _JS_INVERTIBLE && t.yscale in _JS_INVERTIBLE) ||
        return "ROIInteractable: drag needs client-side invertible x and y scales " *
        "(x=$(t.xscale), y=$(t.yscale); supported: identity/log10/log)."
    (t.xcats === nothing && t.ycats === nothing) ||
        return "ROIInteractable: bounds need continuous axes; a categorical axis has no numeric bounds " *
        "(use AxisInteractable/ThresholdInteractable for categorical readout)."
    return nothing
end
function hitlayers(i::ROIInteractable, ctx)
    xmin, xmax, ymin, ymax = i.bounds
    a = _proj(ctx, i.ax, (xmin, ymin)); b = _proj(ctx, i.ax, (xmax, ymax))  # y flips → normalize below
    geom = Dict(
        "x" => Float32(min(a[1], b[1])), "y" => Float32(min(a[2], b[2])),
        "w" => Float32(abs(b[1] - a[1])), "h" => Float32(abs(b[2] - a[2])),
        "handle" => Float32(8 * ctx.scaling),
    )
    return [HitLayer(i.id, :roi, geom, Any[], axis_id(ctx, i.ax), events(i))]
end

# ============================ custom: RegionInteractable (Tier A) =========
# Declarative mixed regions in DATA space. Grouped into one layer per kind.
struct RegionInteractable <: AbstractInteractable
    ax; regions::Vector; payloads::Vector{Any}; id::Symbol; tooltip::Union{Nothing, Markup, Bool}; evs::Tuple
end
function RegionInteractable(
        ax; regions, payloads, id = :region,
        tooltip = nothing, events = (:click, :hover)
    )
    length(regions) == length(payloads) || throw(ArgumentError("regions/payloads length mismatch"))
    return RegionInteractable(ax, collect(regions), collect(Any, payloads), id, tooltip, events)
end
events(i::RegionInteractable) = i.evs
tooltip_spec(i::RegionInteractable) = i.tooltip
function hitlayers(i::RegionInteractable, ctx)
    circ = Real[]; cpl = Any[]; rect = Real[]; rpl = Any[]; polys = Vector{Real}[]; ppl = Any[]
    for (reg, pl) in zip(i.regions, i.payloads)
        kind = reg[1]
        if kind === :circle
            q = _proj(ctx, i.ax, reg[2]); append!(circ, (_q(q[1]), _q(q[2]), _q(Float64(reg[3]) * ctx.scaling))); push!(cpl, pl)
        elseif kind === :rect
            xc, yc = reg[2]; w, h = Float64(reg[3]), Float64(reg[4])
            a = _proj(ctx, i.ax, (xc - w / 2, yc - h / 2)); b = _proj(ctx, i.ax, (xc + w / 2, yc + h / 2))
            append!(rect, (_q((a[1] + b[1]) / 2), _q((a[2] + b[2]) / 2), _q(abs(b[1] - a[1])), _q(abs(b[2] - a[2])))); push!(rpl, pl)
        elseif kind === :polygon
            flat = Real[]; for p in reg[2]
                q = _proj(ctx, i.ax, p); append!(flat, (_q(q[1]), _q(q[2])))
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
