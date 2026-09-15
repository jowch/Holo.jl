# ax is passed explicitly: a plot holds no back-reference to its Axis, and `axis_id`
# keys the transform by the Axis object.

const _GB = Makie.GeometryBasics

_conv(p) = _converted(p)

# markersize is a :pixel-space diameter (Makie's default markerspace); radius = ms/2. Fails
# loud on non-:pixel markerspace (e.g. :data), where ms/2 would be the wrong unit.
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

# markersize is DATA-space (no markerspace attribute), so pixel radius is camera/depth-dependent;
# normalize to per-element Vec3f half-extents (radius3d) and let hitlayers project them. The
# axis-aligned half-extent approximation can underestimate the true silhouette; pass
# radius=/radius3d= explicitly if it's too coarse.
function _meshscatter_extents(ms, n)
    ms isa Makie.VecTypes{3} && return fill(Makie.Vec3f(ms...), n)
    ms isa Real && return fill(Makie.Vec3f(ms, ms, ms), n)
    if ms isa AbstractVector && length(ms) == n
        return Makie.Vec3f[v isa Real ? Makie.Vec3f(v, v, v) : Makie.Vec3f(v...) for v in ms]
    end
    return error(
        "PointInteractable: can't derive hit radii from meshscatter markersize " *
            "$(typeof(ms)) for $(n) elements; pass radius= (pixels) or radius3d= explicitly."
    )
end
function PointInteractable(ax, p::Makie.MeshScatter; id = :meshscatter, payloads = nothing, radius = nothing, radius3d = nothing)
    pts = _conv(p)[1]
    r3 = radius !== nothing || radius3d !== nothing ? radius3d : _meshscatter_extents(p.markersize[], length(pts))
    kw = (; id, radius = something(radius, 9), radius3d = r3)
    return payloads === nothing ?
        PointInteractable(ax, pts; kw...) :
        PointInteractable(ax, pts; kw..., payloads)
end

SegmentInteractable(ax, p::Makie.Lines; id = :lines, payloads = nothing, tol = 6) =
    SegmentInteractable(ax, _conv(p)[1]; mode = :polyline, id, payloads, tol)
SegmentInteractable(ax, p::Makie.LineSegments; id = :segments, payloads = nothing, tol = 6) =
    SegmentInteractable(ax, _conv(p)[1]; mode = :pairs, id, payloads, tol)

# The rendered edges live in the child LineSegments' converted (DATA space), including
# mesh-triangulation diagonals a grid-edge reconstruction would miss.
SegmentInteractable(ax, p::Makie.Wireframe; id = :wireframe, payloads = nothing, tol = 6) =
    SegmentInteractable(ax, _conv(_childof(p, Makie.LineSegments))[1]; mode = :pairs, id, payloads, tol)

# Raw pos→pos+dir is wrong: arrows3d autoscales and renders via MeshScatter children in a
# normalized, anisotropically-scaled space. Read the processed startpoints/endpoints instead
# (already post-align/lengthscale/normalize, in DATA coords).
function SegmentInteractable(ax, p::Makie.Arrows3D; id = :arrows3d, payloads = nothing, tol = 6)
    starts, ends_ = p.startpoints[], p.endpoints[]
    length(starts) == length(ends_) || error(
        "Arrows3D introspection: startpoints/endpoints length mismatch ($(length(starts)) vs $(length(ends_)))"
    )
    verts = Makie.Point3f[]
    sizehint!(verts, 2 * length(starts))
    for (a, b) in zip(starts, ends_)
        push!(verts, Makie.Point3f(a...), Makie.Point3f(b...))
    end
    if payloads === nothing
        pts, dirs = p.points[], p.directions[]
        length(pts) == length(starts) || error(
            "Arrows3D introspection: points/startpoints length mismatch ($(length(pts)) vs $(length(starts)))"
        )
        payloads = [
            (;
                index = k - 1,
                x = Float64(pts[k][1]), y = Float64(pts[k][2]), z = Float64(pts[k][3]),
                u = Float64(dirs[k][1]), v = Float64(dirs[k][2]), w = Float64(dirs[k][3]),
            )
                for k in eachindex(pts)
        ]
    end
    return SegmentInteractable(ax, verts; mode = :pairs, id, payloads, tol)
end

# Makie converts cell centers to an edge vector (length n+1); the coordinate-free form gives
# `EndPoints` (length 2), expanded here to n+1 uniform edges.
_edges(e, n) = length(e) == n + 1 ? collect(Float64, e) :
    collect(range(Float64(e[1]), Float64(e[end]); length = n + 1))
function RectInteractable(ax, p::Union{Makie.Heatmap, Makie.Image}; id = :cells)
    xr, yr, vals = _conv(p)
    ncols, nrows = size(vals)
    return RectInteractable(ax; grid = (_edges(xr, ncols), _edges(yr, nrows), vals), id)
end

# The child Poly carries the final laid-out rectangles (dodge/stack/automatic-width applied);
# read those instead of replaying Makie's bar solver.
function _bar_rects(p)
    for c in _child_plots(p)
        cv = _converted(c)
        if cv isa Tuple && !isempty(cv) && cv[1] isa AbstractVector && eltype(cv[1]) <: _GB.HyperRectangle
            return [
                (r.origin[1] + r.widths[1] / 2, r.origin[2] + r.widths[2] / 2, r.widths[1], r.widths[2])
                    for r in cv[1]
            ]
        end
    end
    error("BarPlot introspection: no laid-out rectangles found in child plots (Makie internals changed?)")
end
# Value-axis extent is keyed by bar `direction` (:y default runs along y, :x along x).
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

# converted[1] is a single ring (Vector{Point}) or a vector of rings (Vector{Vector{Point}}).
function PolygonInteractable(ax, p::Makie.Poly; id = :poly, payloads = nothing)
    g = _conv(p)[1]
    rings = (isempty(g) || first(g) isa _GB.Point) ? [g] : g
    return PolygonInteractable(ax, rings; id, payloads)
end

# Ring = lower curve followed by the reversed upper curve, in data space. Open ring (last
# vertex ≠ first); the :polygons even-odd hit-test closes it implicitly.
_band_ring(lower, upper) = vcat(collect(lower), reverse(collect(upper)))
function PolygonInteractable(ax, p::Makie.Band; id = :band, payloads = nothing)
    lower, upper = _conv(p)
    return PolygonInteractable(ax, [_band_ring(lower, upper)]; id, payloads)
end

# density! renders its KDE fill as a descendant Band; read that instead of recomputing the KDE.
function PolygonInteractable(ax, p::Makie.Density; id = :density, payloads = nothing)
    b = _descendant(p, Makie.Band)
    lower, upper = _conv(b)
    return PolygonInteractable(ax, [_band_ring(lower, upper)]; id, payloads)
end

# Takes each filled polygon's EXTERIOR ring only; holes are excluded, so annular bands
# over-cover their hole at the boundary (documented v1 limitation).
_poly_exterior_rings(polys) = [poly.exterior for poly in polys]

# Makie's `computed_levels` are the true band edges, but the child Poly's per-polygon `color`
# is the band MIDPOINT, not the lower edge — map each color to its nearest midpoint to recover
# (low, high).
function _contourf_payloads(p, poly)
    edges = sort(Float64.(_computed_levels(p)))
    length(edges) >= 2 || error("Contourf introspection: <2 computed level edges (Makie internals changed?)")
    mids = [(edges[k] + edges[k + 1]) / 2 for k in 1:(length(edges) - 1)]
    colors = Float64.(poly.color[])
    return Any[
        let k = argmin(abs.(mids .- c))
            (; low = edges[k], high = edges[k + 1])
        end
            for c in colors
    ]
end
function PolygonInteractable(ax, p::Makie.Contourf; id = :contourf, payloads = nothing)
    poly = _childof(p, Makie.Poly)
    rings = _poly_exterior_rings(_conv(poly)[1])
    pl = payloads === nothing ? _contourf_payloads(p, poly) : payloads
    return PolygonInteractable(ax, rings; id, payloads = pl)
end

# Payload x is read from Makie's converted category data (not ring geometry) to avoid Float32
# projection noise; each ring's geometry-center is used only to snap to the nearest category.
function _violin_payloads(p, rings)
    cats = sort(unique(Float64.(_conv(p)[1])))
    return Any[
        let xs = [Float64(pt[1]) for pt in ring]
            ctr = (minimum(xs) + maximum(xs)) / 2
            (; x = cats[argmin(abs.(cats .- ctr))])
        end
            for ring in rings
    ]
end
function PolygonInteractable(ax, p::Makie.Violin; id = :violin, payloads = nothing)
    poly = _childof(p, Makie.Poly)
    rings = _conv(poly)[1]
    pl = payloads === nothing ? _violin_payloads(p, rings) : payloads
    return PolygonInteractable(ax, rings; id, payloads = pl)
end

# Cells come back in tessellation order, not input-site order, so there's no cheap
# cell→generator mapping; default payload is (; index) only.
function PolygonInteractable(ax, p::Makie.Voronoiplot; id = :voronoiplot, payloads = nothing)
    poly = _descendant(p, Makie.Poly)
    rings = _poly_exterior_rings(_conv(poly)[1])
    return PolygonInteractable(ax, rings; id, payloads)
end

# Stats come from Makie's computed-stats node (converted is a 4-tuple centers/medians/q1s/q3s,
# the exact numbers Makie drew the box and median line from) — read them rather than
# recomputing or reading the median LineSegments.
function _boxplot_stats_node(p)
    cv = try
        _conv(p)
    catch e
        e isa InterruptException && rethrow()
        nothing
    end
    if cv isa Tuple && length(cv) == 4 && all(x -> x isa AbstractVector && eltype(x) <: Real, cv) &&
            length(cv[1]) == length(cv[2]) == length(cv[3]) == length(cv[4])
        return p
    end
    for c in _child_plots(p)
        r = try
            _boxplot_stats_node(c)
        catch e
            e isa InterruptException && rethrow()
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

_childof(p, T) = (
    for c in _child_plots(p)
        c isa T && return c
    end; error("$(typeof(p).name.name): no $T child plot found (Makie internals changed?)")
)

# Recursive (whole-subtree) search: some recipes nest the target plot below a wrapper child
# (Density wraps Band; Voronoiplot nests Poly), where _childof (direct children only) misses it.
_descendant_or_nothing(p, T) = p isa T ? p :
    (
        for c in _child_plots(p)
            r = _descendant_or_nothing(c, T)
            r !== nothing && return r
    end; nothing
    )
function _descendant(p, T)
    d = _descendant_or_nothing(p, T)
    d === nothing && error("$(typeof(p).name.name): no $T descendant found (Makie internals changed?)")
    return d
end

# The parent `converted` is the raw input points; the rendered staircase (the actual click
# target) lives in the child Lines as the pre-expanded step polyline.
SegmentInteractable(ax, p::Makie.Stairs; id = :stairs, payloads = nothing, tol = 6) =
    SegmentInteractable(ax, _converted(_childof(p, Makie.Lines))[1]; mode = :polyline, id, payloads, tol)

# Errorbars `converted` is Vec4 (x, y, low, high) with low/high RELATIVE offsets; Rangebars is
# Vec3 (val, low, high) ABSOLUTE.
function _errorbar_pairs(p)
    horiz = p.direction[] === :x
    vs = Point2f[]
    for v in _converted(p)[1]
        x, y, lo, hi = v[1], v[2], v[3], v[4]
        horiz ? (push!(vs, Point2f(x - lo, y)); push!(vs, Point2f(x + hi, y))) :
            (push!(vs, Point2f(x, y - lo)); push!(vs, Point2f(x, y + hi)))
    end
    return vs
end
function _rangebar_pairs(p)
    horiz = p.direction[] === :x
    vs = Point2f[]
    for v in _converted(p)[1]
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

# Each line spans the full data range from `finallimits`; fractional xmin/xmax (HLines) /
# ymin/ymax (VLines) span attrs are ignored.
function _span_pairs(ax, p, ishoriz)
    fl = _finallimits(ax)
    lo = fl.origin[ishoriz ? 1 : 2]; hi = lo + fl.widths[ishoriz ? 1 : 2]
    vs = Point2f[]
    for c in _converted(p)[1]
        ishoriz ? (push!(vs, Point2f(lo, c)); push!(vs, Point2f(hi, c))) :
            (push!(vs, Point2f(c, lo)); push!(vs, Point2f(c, hi)))
    end
    return vs
end
function SegmentInteractable(ax, p::Makie.HLines; id = :hlines, payloads = nothing, tol = 6)
    vs = _span_pairs(ax, p, true)
    nseg = length(vs) ÷ 2
    pl = payloads === nothing ? Any[(; segment_index = k - 1) for k in 1:nseg] : _check_payloads(payloads, nseg, "SegmentInteractable")
    return _segment_with_resolve(ax, vs, :pairs, id, pl, tol, _ax -> _span_pairs(_ax, p, true))
end
function SegmentInteractable(ax, p::Makie.VLines; id = :vlines, payloads = nothing, tol = 6)
    vs = _span_pairs(ax, p, false)
    nseg = length(vs) ÷ 2
    pl = payloads === nothing ? Any[(; segment_index = k - 1) for k in 1:nseg] : _check_payloads(payloads, nseg, "SegmentInteractable")
    return _segment_with_resolve(ax, vs, :pairs, id, pl, tol, _ax -> _span_pairs(_ax, p, false))
end

# Spy renders nonzeros as a child Scatter with markerspace=:data, so markersize IS the cell
# size in data units (PointInteractable would fail: :data markerspace can't derive a pixel
# radius).
function _spy_rects(p)
    sc = _childof(p, Makie.Scatter)
    ms = sc.markersize[]
    ms isa AbstractVector && length(ms) != 2 && error(
        "Spy introspection: expected a length-2 Vec cell size, got length-$(length(ms)) markersize " *
            "(per-marker sizes unsupported)."
    )
    w, h = ms isa AbstractVector ? (Float64(ms[1]), Float64(ms[2])) : (Float64(ms), Float64(ms))
    return [(Float64(c[1]), Float64(c[2]), w, h) for c in _converted(sc)[1]]
end
RectInteractable(ax, p::Makie.Spy; id = :spy, payloads = nothing) =
    RectInteractable(ax; rects = _spy_rects(p), id, payloads)

# Hist bar height is the bin value: a count only for default normalization=:none; with
# :pdf/:density/:probability it's a density/fraction (hence `value`, not `count`).
function _hist_payloads(rects, direction)
    vert = direction === :y
    return Any[
        let (cx, cy, w, h) = r
            cnt = vert ? h : w
            lo, hi = vert ? (cx - w / 2, cx + w / 2) : (cy - h / 2, cy + h / 2)
            (; value = Float64(cnt), low = Float64(lo), high = Float64(hi))
        end
            for r in rects
    ]
end
function _waterfall_payloads(p, rects)
    deltas = _converted(p)[1]
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

function _span_payloads(p)
    cv = _converted(p)                                   # HSpan (ymin,ymax) / VSpan (xmin,xmax)
    lo, hi = cv[1], cv[2]
    return Any[(; low = Float64(lo[k]), high = Float64(hi[k])) for k in eachindex(lo)]
end
# Do NOT reuse _bar_rects(p): it reads the child Poly's HyperRectangle, which can exceed the
# axis limits and bleed into a neighboring axis's viewport. `full` is the axis direction the
# span fills completely (:x for HSpan, :y for VSpan).
function _span_rects(ax, p, full::Symbol)
    cv = _converted(p)
    lo_vec, hi_vec = cv[1], cv[2]
    fl = _finallimits(ax)
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
    rs = _span_rects(ax, p, :x)
    pl = payloads === nothing ? _span_payloads(p) : _check_payloads(payloads, length(rs), "RectInteractable")
    return _rect_with_resolve(ax, rs, id, pl, true, _ax -> _span_rects(_ax, p, :x))
end
function RectInteractable(ax, p::Makie.VSpan; id = :vspan, payloads = nothing)
    rs = _span_rects(ax, p, :y)
    pl = payloads === nothing ? _span_payloads(p) : _check_payloads(payloads, length(rs), "RectInteractable")
    return _rect_with_resolve(ax, rs, id, pl, true, _ax -> _span_rects(_ax, p, :y))
end

function _crossbar_payloads(p)
    _, midpts, lows, highs = _converted(p)
    return Any[(; midpoint = Float64(midpts[i]), low = Float64(lows[i]), high = Float64(highs[i])) for i in eachindex(midpts)]
end
function RectInteractable(ax, p::Makie.CrossBar; id = :crossbar, payloads = nothing)
    rs = _bar_rects(p)
    pl = payloads === nothing ? _crossbar_payloads(p) : payloads
    return RectInteractable(ax; rects = rs, id, payloads = pl)
end

# Point layer keeps the base id; the line/segment layer gets a suffix so the two ids stay
# distinct in the manifest.
_stem_parts(ax, p, base) = AbstractInteractable[
    PointInteractable(ax, _childof(p, Makie.Scatter); id = base),
    SegmentInteractable(ax, _childof(p, Makie.LineSegments); id = Symbol(base, :_stems)),
]
_scatterlines_parts(ax, p, base) = AbstractInteractable[
    PointInteractable(ax, _childof(p, Makie.Scatter); id = base),
    SegmentInteractable(ax, _childof(p, Makie.Lines); id = Symbol(base, :_line)),
]

# Only DATA-anchored text projects to a meaningful (x, y); other space= text is skipped loudly
# but specifically, not via the generic "unsupported plot type" path.
function _text_interactables(ax, p::Makie.Text, id)
    if p.space[] !== :data
        @warn "holo: skipping non-data-space text (space=$(p.space[]))" maxlog = 16
        return AbstractInteractable[]
    end
    return AbstractInteractable[TextInteractable(ax, p; id)]
end

# the layer-id base for a plot, or nothing if Holo can't introspect it
function _plotbase(p)
    p isa Makie.Scatter && return :scatter
    p isa Makie.MeshScatter && return :meshscatter
    p isa Makie.Lines && return :lines
    p isa Makie.LineSegments && return :segments
    p isa Makie.Wireframe && return :wireframe
    p isa Makie.Arrows3D && return :arrows3d
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
    p isa Makie.Text && return :text
    p isa Makie.Annotation && return :annotation
    return nothing
end

# returns a Vector{AbstractInteractable} — usually one, two for composites (Stem, ScatterLines).
function _construct(ax, p, id)
    p isa Makie.Scatter && return [PointInteractable(ax, p; id)]
    p isa Makie.MeshScatter && return [PointInteractable(ax, p; id)]
    (p isa Makie.Lines || p isa Makie.LineSegments || p isa Makie.Wireframe || p isa Makie.Arrows3D) &&
        return [SegmentInteractable(ax, p; id)]
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
    p isa Makie.Text && return _text_interactables(ax, p, id)
    p isa Makie.Annotation && return _text_interactables(ax, _descendant(p, Makie.Text), id)
    # unreachable while _plotbase gates callers; loud if the two ever drift (kind added to one, not the other)
    return error("auto_interactables: $(typeof(p).name.name) passed _plotbase but has no _construct branch")
end

"""
    auto_interactables(fig) -> Vector{AbstractInteractable}

Introspect a Makie `Figure`: for every supported plot in every `Axis`, `Axis3`, or `PolarAxis`,
build the interactable its explicit constructor would. On `Axis3`, only `Scatter`/`Lines`/
`LineSegments`/`MeshScatter`/`Wireframe`/`Arrows3D` are supported; on `PolarAxis`, only
`Scatter`/`Lines`/`LineSegments`/`ScatterLines`. Other kinds are skipped with a warning.
Layer ids are the plot kind (`:scatter`, `:lines`, …), suffixed `_2`, `_3`, … when a kind
repeats. Returns the same concrete vector you could pass to [`holo`](@ref) yourself — edit or
extend it freely.

Each interactable inherits its constructor's default per-element payloads, so the zero-config
path on a very large plot allocates one payload per element; construct with a lean `payloads=`
yourself for huge data.
"""
function auto_interactables(fig)
    ints = AbstractInteractable[]
    seen = Dict{Symbol, Int}()
    for ax in fig.content
        ax isa Union{Makie.Axis, Makie.Axis3, Makie.PolarAxis} || continue
        for p in _child_plots(ax.scene)
            base = _plotbase(p)
            if base === nothing
                @warn "holo: skipping unsupported plot type $(typeof(p).name.name) (no introspection recipe)" maxlog = 16
                continue
            end
            # Other 2D recipes extract pixel-separable geometry that a 3D perspective
            # projection silently misaligns; skip loudly rather than construct.
            if ax isa Makie.Axis3 && !(
                    p isa Union{
                        Makie.Scatter, Makie.Lines, Makie.LineSegments,
                        Makie.MeshScatter, Makie.Wireframe, Makie.Arrows3D,
                    }
                )
                @warn "holo: skipping $(typeof(p).name.name) on Axis3 — only Scatter/Lines/" *
                    "LineSegments/MeshScatter/Wireframe/Arrows3D have 3D-valid extraction today; " *
                    "other kinds are roadmap scope (docs/roadmap.md M3 per-type extraction)" maxlog = 16
                continue
            end
            # Separable-edge / axis-aligned rect recipes assume Cartesian pixel geometry;
            # polar maps those into arcs and wedges, so an AABB/grid hit layer would be
            # silently wrong. Point/segment recipes project per-vertex and are fine.
            if ax isa Makie.PolarAxis && !(p isa Union{Makie.Scatter, Makie.Lines, Makie.LineSegments, Makie.ScatterLines})
                @warn "holo: skipping $(typeof(p).name.name) on PolarAxis — only Scatter/Lines/" *
                    "LineSegments/ScatterLines have polar-valid extraction today; continuous " *
                    "θ/r readout and grid/rect recipes are roadmap scope (docs/roadmap.md M3)" maxlog = 16
                continue
            end
            n = get(seen, base, 0) + 1
            seen[base] = n
            id = n == 1 ? base : Symbol(base, :_, n)
            append!(ints, _construct(ax, p, id))
        end
    end
    # Colorbar blocks live in fig.content, not in an Axis's scene.
    nc = 0
    for c in fig.content
        c isa Makie.Colorbar || continue
        nc += 1
        id = nc == 1 ? :colorbar : Symbol(:colorbar_, nc)
        push!(ints, ColorbarInteractable(c; id))
    end
    return ints
end
