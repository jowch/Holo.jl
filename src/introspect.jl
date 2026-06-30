# M2.1 — plot-introspection constructors. Pull geometry straight from a live Makie plot's
# post-conversion `converted[]` (data space, dodge/stack/width already applied) and delegate
# to the explicit constructor. No new types, no new manifest path — pure sugar over M1.
#
# The Axis is passed explicitly: a plot holds no back-reference to its Axis, and `axis_id`
# keys the transform by the Axis object (multi-axis figures need the right one). `holo(fig)`
# (M2.2) supplies it from the scene walk; here the user already has `ax` from `plot!(ax, …)`.

const _GB = Makie.GeometryBasics

_conv(p) = p.converted[]

# ---- Scatter -> PointInteractable ----
# markersize is a diameter in :pixel space (Makie's default markerspace) → radius = ms/2 in
# logical px, matching the explicit `radius=` (×scaling applied at hitlayer time). Fail loud on
# non-:pixel markerspace (e.g. :data), where ms/2 is the wrong unit — pass radius= instead.
function _marker_radius(p)
    p.markerspace[] === :pixel || error(
        "PointInteractable: scatter has markerspace=$(repr(p.markerspace[])); radius can only be " *
            "derived from markersize for :pixel markers (the default). Pass radius=… explicitly."
    )
    ms = p.markersize[]
    d = ms isa AbstractVector ? (isempty(ms) ? 0.0 : Float64(maximum(ms))) : Float64(ms)
    return d / 2
end
function PointInteractable(ax, p::Makie.Scatter; id = :scatter, payloads = nothing, radius = nothing)
    pts = _conv(p)[1]
    r = radius === nothing ? _marker_radius(p) : radius
    return payloads === nothing ?
        PointInteractable(ax, pts; id, radius = r) :
        PointInteractable(ax, pts; id, radius = r, payloads)
end

# ---- Lines -> SegmentInteractable(:polyline) / LineSegments -> (:pairs) ----
SegmentInteractable(ax, p::Makie.Lines; id = :lines, payloads = nothing, tol = 6) =
    SegmentInteractable(ax, _conv(p)[1]; mode = :polyline, id, payloads, tol)
SegmentInteractable(ax, p::Makie.LineSegments; id = :segments, payloads = nothing, tol = 6) =
    SegmentInteractable(ax, _conv(p)[1]; mode = :pairs, id, payloads, tol)

# ---- Heatmap / Image -> RectInteractable(:grid) ----
# converted gives (x, y, values). Makie converts cell *centers* to an edge vector (length n+1);
# the coordinate-free form gives `EndPoints` (length 2) which we expand to n+1 uniform edges.
_edges(e, n) = length(e) == n + 1 ? collect(Float64, e) :
    collect(range(Float64(e[1]), Float64(e[end]); length = n + 1))
function RectInteractable(ax, p::Union{Makie.Heatmap, Makie.Image}; id = :cells)
    xr, yr, vals = _conv(p)
    ncols, nrows = size(vals)
    return RectInteractable(ax; grid = (_edges(xr, ncols), _edges(yr, nrows), vals), id)
end

# ---- BarPlot -> RectInteractable(:list) ----
# The child Poly carries the final laid-out rectangles (dodge/stack/automatic-width applied),
# so we read those instead of replaying Makie's bar solver. (roadmap: dodge/stack are the gotcha.)
function _bar_rects(p)
    for c in p.plots
        cv = c.converted[]
        if cv isa Tuple && !isempty(cv) && cv[1] isa AbstractVector && eltype(cv[1]) <: _GB.HyperRectangle
            return [
                (r.origin[1] + r.widths[1] / 2, r.origin[2] + r.widths[2] / 2, r.widths[1], r.widths[2])
                    for r in cv[1]
            ]
        end
    end
    error("BarPlot introspection: no laid-out rectangles found in child plots (Makie internals changed?)")
end
# Per laid-out bar rect (cx,cy,w,h): value-axis extent + magnitude, keyed by bar `direction`
# (:y → value runs along y, the default; :x → along x). No `index` (that's InteractionEvent.index).
function _bar_payloads(rects, direction)
    vert = direction === :y
    return Any[
        let (cx, cy, w, h) = r
                lo, hi = vert ? (cy - h / 2, cy + h / 2) : (cx - w / 2, cx + w / 2)
                (; low = Float64(lo), high = Float64(hi), value = Float64(hi - lo))
        end
            for r in rects
    ]
end
function RectInteractable(ax, p::Makie.BarPlot; id = :bars, payloads = nothing)
    rs = _bar_rects(p)
    pl = payloads === nothing ? _bar_payloads(rs, p.direction[]) : payloads
    return RectInteractable(ax; rects = rs, id, payloads = pl)
end

# ---- Poly -> PolygonInteractable ----
# converted[1] is a single ring (Vector{Point}) or a vector of rings (Vector{Vector{Point}}).
function PolygonInteractable(ax, p::Makie.Poly; id = :poly, payloads = nothing)
    g = _conv(p)[1]
    rings = (isempty(g) || first(g) isa _GB.Point) ? [g] : g
    return PolygonInteractable(ax, rings; id, payloads)
end

# ---- Band -> PolygonInteractable ----
# A band is one filled region between a lower and an upper curve. converted[] = (lower, upper),
# each a Vector{Point} over the same x. The ring is the lower curve followed by the reversed
# upper curve (so the boundary closes). Vertices live directly in data space — no solver replay.
# Open ring (last vertex ≠ first); the :polygons even-odd hit-test closes it implicitly.
_band_ring(lower, upper) = vcat(collect(lower), reverse(collect(upper)))
function PolygonInteractable(ax, p::Makie.Band; id = :band, payloads = nothing)
    lower, upper = _conv(p)
    return PolygonInteractable(ax, [_band_ring(lower, upper)]; id, payloads)
end

# ---- Density -> PolygonInteractable ----
# density! renders its KDE fill as a descendant Band (Makie already ran the KDE at its own
# bandwidth — read that band, don't recompute it). Reuse the Band ring builder.
function PolygonInteractable(ax, p::Makie.Density; id = :density, payloads = nothing)
    b = _descendant(p, Makie.Band)
    lower, upper = _conv(b)
    return PolygonInteractable(ax, [_band_ring(lower, upper)]; id, payloads)
end

# ---- Contourf -> PolygonInteractable ----
# Makie lays out one GB.Polygon per filled level-piece on a child Poly (marching-squares already
# run). Take each polygon's EXTERIOR ring only (holes excluded; `poly.exterior` is a Vector{Point}).
# Annular bands therefore over-cover their hole at the boundary — a documented v1 limitation.
# ponytail: exterior-only; add compound-polygon (ring-group) support if a real contour use needs it.
_poly_exterior_rings(polys) = [poly.exterior for poly in polys]

# Payload (; low, high): the child Poly's `color` is one level value per polygon (the band's lower
# edge). Bracket each to (low, high) via the sorted distinct edges; the top band's high extrapolates
# one band-width up (uniform spacing for default levels).
function _contourf_payloads(poly)
    colors = Float64.(poly.color[])
    edges = sort(unique(colors))
    Δ = length(edges) >= 2 ? edges[2] - edges[1] : zero(eltype(edges))
    nexthi = Dict(edges[i] => (i < length(edges) ? edges[i + 1] : edges[i] + Δ) for i in eachindex(edges))
    return Any[(; low = c, high = nexthi[c]) for c in colors]
end
function PolygonInteractable(ax, p::Makie.Contourf; id = :contourf, payloads = nothing)
    poly = _childof(p, Makie.Poly)
    rings = _poly_exterior_rings(_conv(poly)[1])
    pl = payloads === nothing ? _contourf_payloads(poly) : payloads
    return PolygonInteractable(ax, rings; id, payloads = pl)
end

# ---- Violin -> PolygonInteractable ----
# Makie lays out one closed ring per violin on a child Poly (KDE already run). The ring's x-extent
# is centered on the violin's category position → payload (; x). One element per violin.
function _violin_payloads(rings)
    return Any[
        let xs = [Float64(pt[1]) for pt in ring]
                (; x = (minimum(xs) + maximum(xs)) / 2)
        end
            for ring in rings
    ]
end
function PolygonInteractable(ax, p::Makie.Violin; id = :violin, payloads = nothing)
    poly = _childof(p, Makie.Poly)
    rings = _conv(poly)[1]                              # Vector{Vector{Point}}, one ring per violin
    pl = payloads === nothing ? _violin_payloads(rings) : payloads
    return PolygonInteractable(ax, rings; id, payloads = pl)
end

# ---- Voronoiplot -> PolygonInteractable ----
# Makie tessellates and lays out one GB.Polygon per cell on a nested child Poly. Cells come back in
# tessellation order, NOT input-site order, so there's no cheap cell→generator mapping → default
# (; index) payload. ponytail: index-only; upgrade to (; x, y) via point-in-cell matching if needed.
function PolygonInteractable(ax, p::Makie.Voronoiplot; id = :voronoiplot, payloads = nothing)
    poly = _descendant(p, Makie.Poly)
    rings = _poly_exterior_rings(_conv(poly)[1])
    return PolygonInteractable(ax, rings; id, payloads)
end

# ---- BoxPlot (box body only) -> Rect (un-notched) / Polygon (notched) ----
# Geometry comes from the box Poly (a HyperRectangle per box, or an 11-pt notched ring per box).
# Stats come from Makie's COMPUTED-STATS node — the node whose converted is a 4-tuple
# (centers, medians, q1s, q3s); these equal Statistics.quantile(group, [.5,.25,.75]) exactly, i.e.
# the numbers Makie drew the box and median line from. Read them; don't recompute or read the
# median LineSegments. Whiskers/caps/outliers are decorative (not hit-tested) in this arc.
function _boxplot_stats_node(p)
    cv = try
        _conv(p)
    catch
        nothing
    end
    if cv isa Tuple && length(cv) == 4 && all(x -> x isa AbstractVector && eltype(x) <: Real, cv) &&
            length(cv[1]) == length(cv[2]) == length(cv[3]) == length(cv[4])
        return p
    end
    for c in p.plots
        r = try
            _boxplot_stats_node(c)
        catch
            nothing
        end
        r !== nothing && return r
    end
    return error("BoxPlot introspection: computed-stats node (4-tuple of equal-length numeric vectors) not found (Makie internals changed?)")
end
function _boxplot_payloads(statscv)
    _centers, medians, q1s, q3s = statscv
    return Any[
        (; q1 = Float64(q1s[k]), median = Float64(medians[k]), q3 = Float64(q3s[k]))
            for k in eachindex(medians)
    ]
end
function _boxplot_interactable(ax, p; id = :boxplot, payloads = nothing)
    node = _boxplot_stats_node(p)
    boxpoly = _childof(node, Makie.Poly)
    geom = _conv(boxpoly)[1]
    pl = payloads === nothing ? _boxplot_payloads(_conv(node)) : payloads
    if eltype(geom) <: _GB.HyperRectangle
        rects = [(r.origin[1] + r.widths[1] / 2, r.origin[2] + r.widths[2] / 2, r.widths[1], r.widths[2]) for r in geom]
        return RectInteractable(ax; rects, id, payloads = pl)
    else
        return PolygonInteractable(ax, geom; id, payloads = pl)   # notched: Vector{Vector{Point}}
    end
end

# ====================== M3 cheap wins (same primitives) ======================
# Each delegates to an existing explicit constructor; the only work is reading the right
# laid-out geometry off the plot (or its children). No new types, no new manifest path.

_childof(p, T) = (
    for c in p.plots
        c isa T && return c
    end; error("$(typeof(p).name.name): no $T child plot found (Makie internals changed?)")
)

# Recursive descendant search (whole subtree), fail-loud like _childof. Some recipes nest the
# plot we need below a wrapper child (e.g. Density wraps a Band; Voronoiplot nests its Poly).
_descendant_or_nothing(p, T) = p isa T ? p :
    (
        for c in p.plots
            r = _descendant_or_nothing(c, T)
            r !== nothing && return r
    end; nothing
    )
function _descendant(p, T)
    d = _descendant_or_nothing(p, T)
    d === nothing && error("$(typeof(p).name.name): no $T descendant found (Makie internals changed?)")
    return d
end

# ---- Stairs -> Segment(:polyline) ----
# The parent `converted` is the raw input points; the rendered staircase (the actual click target)
# lives in the child Lines as the pre-expanded step polyline — read that, don't replay the stepper.
SegmentInteractable(ax, p::Makie.Stairs; id = :stairs, payloads = nothing, tol = 6) =
    SegmentInteractable(ax, _childof(p, Makie.Lines).converted[][1]; mode = :polyline, id, payloads, tol)

# ---- Errorbars / Rangebars -> Segment(:pairs) ----
# One disjoint pair per element; caps/whiskers are decorative. Errorbars `converted` is Vec4
# (x, y, low, high) with low/high RELATIVE offsets; Rangebars is Vec3 (val, low, high) ABSOLUTE.
# `direction` (:y default) picks which axis the bar runs along.
function _errorbar_pairs(p)
    horiz = p.direction[] === :x
    vs = Point2f[]
    for v in p.converted[][1]
        x, y, lo, hi = v[1], v[2], v[3], v[4]
        horiz ? (push!(vs, Point2f(x - lo, y)); push!(vs, Point2f(x + hi, y))) :
            (push!(vs, Point2f(x, y - lo)); push!(vs, Point2f(x, y + hi)))
    end
    return vs
end
function _rangebar_pairs(p)
    horiz = p.direction[] === :x
    vs = Point2f[]
    for v in p.converted[][1]
        val, lo, hi = v[1], v[2], v[3]
        horiz ? (push!(vs, Point2f(lo, val)); push!(vs, Point2f(hi, val))) :
            (push!(vs, Point2f(val, lo)); push!(vs, Point2f(val, hi)))
    end
    return vs
end
SegmentInteractable(ax, p::Makie.Errorbars; id = :errorbars, payloads = nothing, tol = 6) =
    SegmentInteractable(ax, _errorbar_pairs(p); mode = :pairs, id, payloads, tol)
SegmentInteractable(ax, p::Makie.Rangebars; id = :rangebars, payloads = nothing, tol = 6) =
    SegmentInteractable(ax, _rangebar_pairs(p); mode = :pairs, id, payloads, tol)

# ---- HLines / VLines -> Segment(:pairs) spanning the axis ----
# Each line spans the full data range from `finallimits` (read post-update_state_before_display!).
# ponytail: fractional xmin/xmax (HLines) / ymin/ymax (VLines) span attrs ignored — full span only.
function _span_pairs(ax, p, ishoriz)
    fl = ax.finallimits[]
    lo = fl.origin[ishoriz ? 1 : 2]; hi = lo + fl.widths[ishoriz ? 1 : 2]
    vs = Point2f[]
    for c in p.converted[][1]
        ishoriz ? (push!(vs, Point2f(lo, c)); push!(vs, Point2f(hi, c))) :
            (push!(vs, Point2f(c, lo)); push!(vs, Point2f(c, hi)))
    end
    return vs
end
SegmentInteractable(ax, p::Makie.HLines; id = :hlines, payloads = nothing, tol = 6) =
    SegmentInteractable(ax, _span_pairs(ax, p, true); mode = :pairs, id, payloads, tol)
SegmentInteractable(ax, p::Makie.VLines; id = :vlines, payloads = nothing, tol = 6) =
    SegmentInteractable(ax, _span_pairs(ax, p, false); mode = :pairs, id, payloads, tol)

# ---- Spy -> Rect(:list) ----
# Spy renders nonzeros as a child Scatter with markerspace=:data, so markersize IS the cell size
# in data units. One unit rect per nonzero, centered on the laid-out marker. (Delegating to
# PointInteractable would fail: :data markerspace can't derive a pixel radius.)
# ponytail: default {index} payloads; survey's {i,j,value} deferred (needs nonzero↔marker ordering).
function _spy_rects(p)
    sc = _childof(p, Makie.Scatter)
    ms = sc.markersize[]
    # ms is a Vec2 cell size (uniform across nonzeros). Fail loud if it's ever a per-marker
    # size vector (length != 2) — we'd silently misread ms[1]/ms[2] as width/height.
    ms isa AbstractVector && length(ms) != 2 && error(
        "Spy introspection: expected a length-2 Vec cell size, got length-$(length(ms)) markersize " *
            "(per-marker sizes unsupported)."
    )
    w, h = ms isa AbstractVector ? (Float64(ms[1]), Float64(ms[2])) : (Float64(ms), Float64(ms))
    return [(Float64(c[1]), Float64(c[2]), w, h) for c in sc.converted[][1]]
end
RectInteractable(ax, p::Makie.Spy; id = :spy, payloads = nothing) =
    RectInteractable(ax; rects = _spy_rects(p), id, payloads)

# ---- Hist / Waterfall -> RectInteractable(:list) (child BarPlot carries laid-out bars) ----
# Hist: bar height = bin value (height = bin count only for default normalization=:none;
# with :pdf/:density/:probability the height is a density/fraction — so we call it `value`).
# Bin range = category-axis extent (cx ± w/2 for vertical).
# Waterfall: signed delta read from p.converted[][1] (Vector{Point2}, element k = (x_k, delta_k)).
function _hist_payloads(rects, direction)
    vert = direction === :y
    return Any[
        let (cx, cy, w, h) = r
                cnt = vert ? h : w                                                  # bar height = bin value
                lo, hi = vert ? (cx - w / 2, cx + w / 2) : (cy - h / 2, cy + h / 2)  # category axis = bin range
                (; value = Float64(cnt), low = Float64(lo), high = Float64(hi))
        end
            for r in rects
    ]
end
function _waterfall_payloads(p, rects)
    deltas = p.converted[][1]                      # Point2 per bar: (x, signed delta)
    return Any[
        let (cx, cy, w, h) = rects[k]
                (; low = Float64(cy - h / 2), high = Float64(cy + h / 2), value = Float64(deltas[k][2]))
        end
            for k in eachindex(rects)
    ]
end
function RectInteractable(ax, p::Makie.Hist; id = :hist, payloads = nothing)
    bar = _childof(p, Makie.BarPlot)
    rs = _bar_rects(bar)
    pl = payloads === nothing ? _hist_payloads(rs, bar.direction[]) : payloads
    return RectInteractable(ax; rects = rs, id, payloads = pl)
end
function RectInteractable(ax, p::Makie.Waterfall; id = :waterfall, payloads = nothing)
    bar = _childof(p, Makie.BarPlot)
    rs = _bar_rects(bar)
    pl = payloads === nothing ? _waterfall_payloads(p, rs) : payloads
    return RectInteractable(ax; rects = rs, id, payloads = pl)
end

# ---- HSpan / VSpan -> RectInteractable(:list) ----
# Payload: (low, high) from converted[] — the dimension the user explicitly specified.
function _span_payloads(p)
    cv = p.converted[]                                   # HSpan (ymin,ymax) / VSpan (xmin,xmax)
    lo, hi = cv[1], cv[2]
    return Any[(; low = Float64(lo[k]), high = Float64(hi[k])) for k in eachindex(lo)]
end
# Geometry: build hit-rects explicitly from converted[] (band dim) + ax.finallimits[] (full-axis dim).
# Do NOT reuse _bar_rects(p) — that reads the child Poly's HyperRectangle, which is designed for
# BarPlot (laid-out dodge/stack geometry) and can exceed the axis limits in some Makie versions or
# async contexts, causing the hit-rect to bleed into a neighboring axis's viewport.
#
# `full`: the axis direction the span fills completely (:x for HSpan, :y for VSpan).
# converted[] = (lo_vec, hi_vec) where lo/hi are the band's own-dimension bounds.
function _span_rects(ax, p, full::Symbol)
    cv = p.converted[]
    lo_vec, hi_vec = cv[1], cv[2]
    fl = ax.finallimits[]
    fa_lo = fl.origin[full === :x ? 1 : 2]
    fa_hi = fa_lo + fl.widths[full === :x ? 1 : 2]
    fa_ctr = (fa_lo + fa_hi) / 2
    fa_wid = fa_hi - fa_lo
    return [
        full === :x ?
            (fa_ctr, (Float64(lo_vec[k]) + Float64(hi_vec[k])) / 2, fa_wid, Float64(hi_vec[k]) - Float64(lo_vec[k])) :
            ((Float64(lo_vec[k]) + Float64(hi_vec[k])) / 2, fa_ctr, Float64(hi_vec[k]) - Float64(lo_vec[k]), fa_wid)
            for k in eachindex(lo_vec)
    ]
end
function RectInteractable(ax, p::Makie.HSpan; id = :hspan, payloads = nothing)
    pl = payloads === nothing ? _span_payloads(p) : payloads
    return RectInteractable(ax; rects = _span_rects(ax, p, :x), id, payloads = pl, clamp_to_viewport = true)
end
function RectInteractable(ax, p::Makie.VSpan; id = :vspan, payloads = nothing)
    pl = payloads === nothing ? _span_payloads(p) : payloads
    return RectInteractable(ax; rects = _span_rects(ax, p, :y), id, payloads = pl, clamp_to_viewport = true)
end

# ---- CrossBar -> RectInteractable(:list) ----
# Box rects are a direct child (depth 1); _bar_rects(p) finds them without _childof.
# Semantic payload (midpoint, low, high) comes from p.converted[] = (x, midpoint, low, high).
function _crossbar_payloads(p)
    _, midpts, lows, highs = p.converted[]
    return Any[(; midpoint = Float64(midpts[i]), low = Float64(lows[i]), high = Float64(highs[i])) for i in eachindex(midpts)]
end
function RectInteractable(ax, p::Makie.CrossBar; id = :crossbar, payloads = nothing)
    rs = _bar_rects(p)
    pl = payloads === nothing ? _crossbar_payloads(p) : payloads
    return RectInteractable(ax; rects = rs, id, payloads = pl)
end

# ---- Composites: one plot -> two layers (survey: ScatterLines is the model) ----
# Each half delegates to the existing child-plot constructor; the point layer keeps the base id,
# the line/segment layer gets a suffix so the two ids stay distinct in the manifest.
_stem_parts(ax, p, base) = AbstractInteractable[
    PointInteractable(ax, _childof(p, Makie.Scatter); id = base),
    SegmentInteractable(ax, _childof(p, Makie.LineSegments); id = Symbol(base, :_stems)),
]
_scatterlines_parts(ax, p, base) = AbstractInteractable[
    PointInteractable(ax, _childof(p, Makie.Scatter); id = base),
    SegmentInteractable(ax, _childof(p, Makie.Lines); id = Symbol(base, :_line)),
]

# ====================== M2.2 holo(fig) auto-extraction ======================
# Walk each Axis's top-level plots and emit the Vector{AbstractInteractable} a user could
# hand-write, via the M2.1 constructors. Unsupported plot type → skip + warn. Pure sugar.

# the layer-id base for a plot, or nothing if Holo can't introspect it
function _plotbase(p)
    p isa Makie.Scatter && return :scatter
    p isa Makie.Lines && return :lines
    p isa Makie.LineSegments && return :segments
    (p isa Makie.Heatmap || p isa Makie.Image) && return :cells
    p isa Makie.BarPlot && return :bars
    p isa Makie.Poly && return :poly
    p isa Makie.Stairs && return :stairs
    p isa Makie.Errorbars && return :errorbars
    p isa Makie.Rangebars && return :rangebars
    p isa Makie.HLines && return :hlines
    p isa Makie.VLines && return :vlines
    p isa Makie.Spy && return :spy
    p isa Makie.Hist && return :hist
    p isa Makie.Waterfall && return :waterfall
    p isa Makie.CrossBar && return :crossbar
    p isa Makie.HSpan && return :hspan
    p isa Makie.VSpan && return :vspan
    p isa Makie.Band && return :band
    p isa Makie.Density && return :density
    p isa Makie.Contourf && return :contourf
    p isa Makie.Violin && return :violin
    p isa Makie.Voronoiplot && return :voronoiplot
    p isa Makie.Stem && return :stem
    p isa Makie.ScatterLines && return :scatterlines
    p isa Makie.BoxPlot && return :boxplot
    return nothing
end

# returns a Vector{AbstractInteractable} — usually one, two for composites (Stem, ScatterLines).
function _construct(ax, p, id)
    p isa Makie.Scatter && return [PointInteractable(ax, p; id)]
    (p isa Makie.Lines || p isa Makie.LineSegments) && return [SegmentInteractable(ax, p; id)]
    (
        p isa Makie.Stairs || p isa Makie.Errorbars || p isa Makie.Rangebars ||
            p isa Makie.HLines || p isa Makie.VLines
    ) && return [SegmentInteractable(ax, p; id)]
    (p isa Makie.Heatmap || p isa Makie.Image || p isa Makie.BarPlot || p isa Makie.Spy) &&
        return [RectInteractable(ax, p; id)]
    (p isa Makie.Hist || p isa Makie.Waterfall || p isa Makie.CrossBar) && return [RectInteractable(ax, p; id)]
    (p isa Makie.HSpan || p isa Makie.VSpan) && return [RectInteractable(ax, p; id)]
    p isa Makie.Band && return [PolygonInteractable(ax, p; id)]
    p isa Makie.Density && return [PolygonInteractable(ax, p; id)]
    p isa Makie.Poly && return [PolygonInteractable(ax, p; id)]
    p isa Makie.Contourf && return [PolygonInteractable(ax, p; id)]
    p isa Makie.Violin && return [PolygonInteractable(ax, p; id)]
    p isa Makie.Voronoiplot && return [PolygonInteractable(ax, p; id)]
    p isa Makie.Stem && return _stem_parts(ax, p, id)
    p isa Makie.ScatterLines && return _scatterlines_parts(ax, p, id)
    p isa Makie.BoxPlot && return [_boxplot_interactable(ax, p; id)]
    # unreachable while _plotbase gates callers; loud if the two ever drift (kind added to one, not the other)
    return error("auto_interactables: $(typeof(p).name.name) passed _plotbase but has no _construct branch")
end

"""
    auto_interactables(fig) -> Vector{AbstractInteractable}

Introspect a Makie `Figure`: for every supported plot in every `Axis`, build the interactable
its M2.1 constructor would. Unsupported plot types are skipped with a warning. Layer ids are
the plot kind (`:scatter`, `:lines`, …), suffixed `_2`, `_3`, … when a kind repeats. Returns
the same concrete vector you could pass to [`holo`](@ref) yourself — edit or extend it freely.

Note: each interactable inherits M1's default per-element payloads (e.g. a `Scatter` materializes
one `(; index, x, y)` per point), so the zero-config path on a very large plot allocates one
payload per element. For huge data, construct the interactable with a lean `payloads=` yourself.
"""
function auto_interactables(fig)
    ints = AbstractInteractable[]
    seen = Dict{Symbol, Int}()
    for ax in fig.content
        ax isa Makie.Axis || continue
        for p in ax.scene.plots
            base = _plotbase(p)
            if base === nothing
                @warn "holo: skipping unsupported plot type $(typeof(p).name.name) (no introspection recipe)" maxlog = 16
                continue
            end
            n = get(seen, base, 0) + 1
            seen[base] = n
            id = n == 1 ? base : Symbol(base, :_, n)
            append!(ints, _construct(ax, p, id))
        end
    end
    return ints
end
