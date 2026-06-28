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
# logical px, matching the explicit `radius=` (×scaling applied at hitlayer time).
# ponytail: assumes markerspace=:pixel (the default); :data markers would need projecting.
function _marker_radius(p)
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
RectInteractable(ax, p::Makie.BarPlot; id = :bars, payloads = nothing) =
    RectInteractable(ax; rects = _bar_rects(p), id, payloads)

# ---- Poly -> PolygonInteractable ----
# converted[1] is a single ring (Vector{Point}) or a vector of rings (Vector{Vector{Point}}).
function PolygonInteractable(ax, p::Makie.Poly; id = :poly, payloads = nothing)
    g = _conv(p)[1]
    rings = (isempty(g) || first(g) isa _GB.Point) ? [g] : g
    return PolygonInteractable(ax, rings; id, payloads)
end
