"""
    HitLayer

The unit `holo` serializes to the browser: one geometry `kind` for one interactable, plus the
data needed to resolve a pointer hit to an element index and its payload. Built by
[`hitlayers`](@ref); user-facing mainly when writing a [`FunctionInteractable`](@ref).

# Fields
- `id::Symbol` — the layer id; becomes `InteractionEvent.layer` on a hit.
- `kind::Symbol` — one of `:circles`, `:polyline`, `:segments`, `:rects`, `:grid`, `:polygons`,
  `:axis`, `:threshold`, `:roi`, `:view`. `geometry`'s layout depends on it:
  - `:circles` — flat `Real[]`, `(cx, cy, r)` per element (image px)
  - `:rects` — flat `Real[]`, `(cx, cy, w, h)` per element (image px)
  - `:polyline` / `:segments` — flat `Real[]`, `(x, y)` per vertex — one connected path /
    disjoint pairs, respectively (image px)
  - `:polygons` — `Vector{Real}[]`, one flat `(x, y)`-per-vertex ring per element (image px)
  - `:grid` — a `Dict` with `"xedges"`, `"yedges"`, `"ncols"`, `"nrows"`, optional `"values"`
  - `:axis` / `:threshold` / `:roi` / `:view` — `nothing` or a small `Dict` (viewport bbox,
    orientation, current camera, …); not element-indexed
- `payloads::Vector{Any}` — one JSON-serializable entry per element, positional (`payloads[k]`
  binds element `k`); empty for the element-count-free kinds above.
- `axis::Symbol` — the id of this layer's [`AxisTransform`](@ref) in
  `InteractionContext.transforms` (see `axis_id`).
- `events::Tuple` — the pointer events this layer responds to (`:click`, `:hover`, `:drag`).
"""
struct HitLayer
    id::Symbol
    kind::Symbol          # :circles|:polyline|:segments|:rects|:grid|:polygons|:axis|:threshold|:roi|:view
    geometry::Any
    payloads::Vector{Any}
    axis::Symbol
    events::Tuple
end

"""
    AbstractInteractable

Supertype for everything [`holo`](@ref) can turn into hit-testable JS layers. The built-in
kinds ([`PointInteractable`](@ref), [`SegmentInteractable`](@ref), [`RectInteractable`](@ref),
[`PolygonInteractable`](@ref), [`AxisInteractable`](@ref), [`ColorbarInteractable`](@ref),
[`ThresholdInteractable`](@ref), [`ROIInteractable`](@ref), [`TextInteractable`](@ref),
[`ViewInteractable`](@ref), [`RegionInteractable`](@ref), [`FunctionInteractable`](@ref))
cover most needs; implement this interface for anything else.

# Interface

Required:
- `hitlayers(i, ctx::InteractionContext) -> Vector{HitLayer}` — see [`hitlayers`](@ref).

Optional (default shown):
- `validate(i, ctx::InteractionContext) -> Union{Nothing,String}` — return an error message if
  `i` can't be built against `ctx` (`holo` raises it as `ArgumentError`), else `nothing`.
  Default: always valid.
- `events(i) -> Tuple` — the pointer events this interactable's layer(s) respond to (`:click`,
  `:hover`, `:drag`). Default: `(:click, :hover)`.
- `tooltip_spec(i)` — `nothing` for the auto name/value table, a [`Markup`](@ref) (built with
  `holo"..."`) template, or `false` to suppress. Default: `nothing`.
- `hoverstyle(i) -> NamedTuple` — one `(; stroke, width)` hover outline style per *layer* (the
  manifest ships one style per layer, not per element). Default:
  `(; stroke = "#3A6F7C", width = 2)`.

[`AbstractSelector`](@ref) subtypes additionally implement `selects`/`compatible_kinds`.
"""
abstract type AbstractInteractable end

"""
    hitlayers(interactable, ctx::InteractionContext) -> Vector{HitLayer}

Build the [`HitLayer`](@ref)(s) an interactable contributes to the manifest — the only method
every [`AbstractInteractable`](@ref) subtype must implement. Project data-space geometry with
`data_to_image_px(ctx, ax, point)`; never re-derive projection. Most built-ins return a single
`HitLayer`; [`RegionInteractable`](@ref) can return several (one per region kind), and
[`FunctionInteractable`](@ref) delegates entirely to a user function of `ctx`.
"""
function hitlayers end
validate(::AbstractInteractable, ::InteractionContext) = nothing
events(::AbstractInteractable) = (:click, :hover)
# Per-layer: nothing = auto name/value table (default), Markup = template, false = suppress.
tooltip_spec(::AbstractInteractable) = nothing
# One hover style per LAYER (the manifest ships one `style` dict per layer, not per element).
hoverstyle(::AbstractInteractable) = (; stroke = "#3A6F7C", width = 2)

"""
    AbstractSelector

Supertype for interactables that highlight elements on another layer — today just
[`ROIInteractable`](@ref)'s `selects` mode, brushing a `:circles`/`:grid` layer. Subtypes
additionally implement:
- `selects(i) -> Union{Nothing,Symbol}` — the target layer id, or `nothing`.
- `compatible_kinds(i) -> Tuple` — the target `HitLayer.kind`s this selector accepts; `holo`
  raises `ArgumentError` at build time if `selects` names a layer of an unlisted kind.
"""
abstract type AbstractSelector <: AbstractInteractable end

# Only AbstractSelectors override these.
selects(::AbstractInteractable) = nothing
compatible_kinds(::AbstractInteractable) = ()

# Only AxisInteractable relies on client-side JS inversion and restricts scales.
const _JS_INVERTIBLE = (:identity, :log10, :log)  # scales geometry.ts `invert` implements

# A heatmap/image cell smaller than this (screen px) can't be cursor-targeted, so values[] is dropped.
const GRID_VALUES_MIN_SCREEN_PX = 1.0

_proj(ctx, ax, p) = data_to_image_px(ctx, ax, p)

# Points widen to Point3f (z=0 for 2-coord input) so 2D and 3D geometry share one storage path.
_pt3(p) = Point3f(p[1], p[2], length(p) >= 3 ? p[3] : 0)

# Round to Int (MsgPack encodes it far more compactly than Float32). `round(Int, NaN/Inf)`
# throws, so non-finite values pass through as Float32 — NaN is the polyline gap sentinel
# (geometry.ts). Geometry vectors use `Real[]`, not a concrete eltype, to allow this mix.
_q(x) = isfinite(x) ? round(Int, x) : Float32(x)

# A payloads-length mismatch would otherwise surface as an `undefined` tooltip at hover time.
# Positional: payloads[k] binds element k; a wrong order is undetectable here.
function _check_payloads(payloads, n, what)
    length(payloads) == n ||
        throw(ArgumentError("$(what): got $(length(payloads)) payloads for $(n) elements"))
    return collect(Any, payloads)
end

# Checked at construction (not manifest build time) so the error points at the caller's own call.
_check_tooltip(tooltip) =
    tooltip === true && throw(
    ArgumentError(
        "tooltip = true is not meaningful — omit `tooltip` for the auto name/value table " *
            "(the default), pass holo\"…\" for a template, or `false` to suppress.",
    ),
)

# ============================ PointInteractable ============================
"""
    PointInteractable(ax, points; id=:points, payloads=<auto>, radius=9, radius3d=nothing, tooltip=nothing)
    PointInteractable(ax, p::Makie.Scatter; id=:scatter, payloads=nothing, radius=nothing)
    PointInteractable(ax, p::Makie.MeshScatter; id=:meshscatter, payloads=nothing, radius=nothing, radius3d=nothing)

Scatter-style points, hit-tested as circles. Produces one `:circles` [`HitLayer`](@ref).

# Arguments
- `points` — data-space points, each a 2- or 3-element point/tuple (`Axis3` scatters use 3).
- `id` — the layer id; becomes `InteractionEvent.layer` on a hit.
- `payloads` — one entry per point (`ArgumentError` if the length doesn't match `points`).
  Default: `(; index, x, y)`, or `(; index, x, y, z)` for 3-coordinate points — `index` is
  0-based.
- `radius` — click-target radius in px (scaled to the rendered image's DPI), the same for
  every point. Default `9`.
- `radius3d` — per-point data-space half-extents (`Vector{Makie.Vec3f}`), for markers whose
  on-screen size is camera/depth-dependent (e.g. `meshscatter`). When set, overrides `radius`
  with an axis-aligned pixel-radius approximation projected per point — it can underestimate
  the true silhouette (worst case ~29%, at adversarial azimuth/elevation). Must have one entry
  per point (`ArgumentError` otherwise).
- `tooltip` — `nothing` for the auto name/value table (default), `holo"..."` for a template, or
  `false` to suppress. `tooltip = true` is rejected (`ArgumentError`; not meaningful).

# From a plot object
`PointInteractable(ax, p::Makie.Scatter)` reads points from `p`'s converted data and derives
`radius` from `markersize / 2` — this requires `markerspace = :pixel` (the default); pass
`radius=` explicitly for any other markerspace, or it errors. `PointInteractable(ax,
p::Makie.MeshScatter)` derives `radius3d` from `p`'s data-space `markersize` (a `Vec3f`, a
`Real`, or a per-element vector of either); pass `radius=`/`radius3d=` explicitly if it can't
be derived.

# Examples
```julia
pts = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0)]
PointInteractable(ax, pts; payloads = ["a", "b", "c"])

p = scatter!(ax, xs, ys; markersize = 14)
PointInteractable(ax, p)   # radius = 14/2, taken from markersize
```
"""
struct PointInteractable <: AbstractInteractable
    ax; points::Vector{Point3f}; id::Symbol; payloads::Vector{Any}; radius::Float64
    # Data-space half-extents (meshscatter markers are data-sized); overrides `radius` via an
    # axis-aligned pixel-radius approximation that can underestimate the true silhouette
    # (worst case ~29%, at adversarial azimuth/elevation).
    radius3d::Union{Nothing, Vector{Makie.Vec3f}}
    tooltip::Union{Nothing, Markup, Bool}
end
function PointInteractable(
        ax, points; id = :points,
        payloads = [
            length(p) >= 3 ?
                (; index = k - 1, x = Float64(p[1]), y = Float64(p[2]), z = Float64(p[3])) :
                (; index = k - 1, x = Float64(p[1]), y = Float64(p[2]))
                for (k, p) in enumerate(points)
        ],
        radius = 9, radius3d = nothing, tooltip = nothing
    )
    _check_tooltip(tooltip)
    pts = [_pt3(p) for p in points]
    length(payloads) == length(pts) || throw(ArgumentError("payloads must match points"))
    r3 = radius3d === nothing ? nothing : Vector{Makie.Vec3f}(radius3d)
    r3 === nothing || length(r3) == length(pts) ||
        throw(ArgumentError("radius3d must have one entry per point (got $(length(r3)) for $(length(pts)))"))
    return PointInteractable(ax, pts, id, collect(Any, payloads), Float64(radius), r3, tooltip)
end
tooltip_spec(i::PointInteractable) = i.tooltip
# Max projected displacement over the ±axis half-extents; non-finite offsets are skipped.
function _px_radius3d(ctx, ax, p, e, q)
    m = 0.0
    for d in (
            (e[1], 0, 0), (-e[1], 0, 0), (0, e[2], 0),
            (0, -e[2], 0), (0, 0, e[3]), (0, 0, -e[3]),
        )
        q2 = _proj(ctx, ax, (p[1] + d[1], p[2] + d[2], p[3] + d[3]))
        r = hypot(q2[1] - q[1], q2[2] - q[2])
        isfinite(r) && (m = max(m, r))
    end
    return m
end
function hitlayers(i::PointInteractable, ctx)
    g = Real[]
    for (k, p) in enumerate(i.points)
        q = _proj(ctx, i.ax, p)
        r = i.radius3d === nothing ? i.radius * ctx.scaling : _px_radius3d(ctx, i.ax, p, i.radius3d[k], q)
        append!(g, (_q(q[1]), _q(q[2]), _q(r)))
    end
    return [HitLayer(i.id, :circles, g, i.payloads, axis_id(ctx, i.ax), events(i))]
end

# ============================ SegmentInteractable ==========================
"""
    SegmentInteractable(ax, vertices; mode=:polyline, id=:segments, payloads=nothing, tol=6, tooltip=nothing)
    SegmentInteractable(ax, p; id=<kind-specific>, payloads=nothing, tol=6)   # from a plot object

Lines / polylines (nearest-segment hit) or disjoint segment pairs. Produces one `:polyline` or
`:segments` [`HitLayer`](@ref) (per `mode`).

# Arguments
- `vertices` — data-space points, each a 2- or 3-element point/tuple.
- `mode` — `:polyline` (default): `vertices` is one connected path, `length(vertices) - 1`
  segments, hit-tested against the nearest segment. `:pairs`: `vertices` is disjoint pairs
  `(v1,v2), (v3,v4), …`, `length(vertices) ÷ 2` segments. Any other value raises
  `ArgumentError`.
- `id` — the layer id; becomes `InteractionEvent.layer` on a hit.
- `payloads` — one entry per segment (count per `mode` above); `ArgumentError` if the length
  doesn't match. Default: `(; segment_index)`, 0-based.
- `tol` — hit-test slack in px around each segment. Default `6`.
- `tooltip` — `nothing` for the auto name/value table (default), `holo"..."` for a template, or
  `false` to suppress. `tooltip = true` is rejected (`ArgumentError`).

# From a plot object
`SegmentInteractable(ax, p)` reads vertices from `p` (no `mode`/`tooltip` keyword — `mode` and
the source geometry are fixed by the plot type):

| `p` | default `id` | `mode` | vertices from |
|---|---|---|---|
| `Makie.Lines` | `:lines` | `:polyline` | converted data |
| `Makie.LineSegments` | `:segments` | `:pairs` | converted data |
| `Makie.Wireframe` | `:wireframe` | `:pairs` | the child `LineSegments`' edges (incl. mesh-triangulation diagonals) |
| `Makie.Arrows3D` | `:arrows3d` | `:pairs` | processed `startpoints`/`endpoints` (post-align/lengthscale); default payload `(; index, x, y, z, u, v, w)` from `points`/`directions` |
| `Makie.Stairs` | `:stairs` | `:polyline` | the child `Lines`' pre-expanded step polyline |
| `Makie.Errorbars` | `:errorbars` | `:pairs` | each bar's low→high endpoints |
| `Makie.Rangebars` | `:rangebars` | `:pairs` | each bar's low→high endpoints |
| `Makie.HLines` | `:hlines` | `:pairs` | each line spanning the axis's current data range (re-resolved on limit changes) |
| `Makie.VLines` | `:vlines` | `:pairs` | each line spanning the axis's current data range (re-resolved on limit changes) |

# Examples
```julia
p = lines!(ax, xs, ys)
SegmentInteractable(ax, p)                       # :polyline, nearest-segment hit

SegmentInteractable(ax, [(0,0), (1,1), (2,0)]; mode = :polyline)
```
"""
struct SegmentInteractable <: AbstractInteractable
    ax; vertices::Vector{Point3f}; mode::Symbol; id::Symbol; payloads::Vector{Any}; tol::Float64; tooltip::Union{Nothing, Markup, Bool}
    # When set, hitlayers calls resolve(ax) instead of using the stored vertices — for geometry
    # (e.g. HLines/VLines spanning `ax.finallimits[]`) only correct after construction.
    resolve::Union{Nothing, Function}
end
function SegmentInteractable(
        ax, vertices; mode = :polyline, id = :segments,
        payloads = nothing, tol = 6, tooltip = nothing
    )
    _check_tooltip(tooltip)
    mode in (:polyline, :pairs) ||
        throw(ArgumentError("SegmentInteractable: mode must be :polyline or :pairs, got :$mode"))
    vs = [_pt3(v) for v in vertices]
    nseg = mode === :polyline ? max(0, length(vs) - 1) : length(vs) ÷ 2
    pl = payloads === nothing ? Any[(; segment_index = k - 1) for k in 1:nseg] : _check_payloads(payloads, nseg, "SegmentInteractable")
    return SegmentInteractable(ax, vs, mode, id, pl, Float64(tol), tooltip, nothing)
end
# Internal-only: construct with a lazy `resolve(ax) -> vertices`.
function _segment_with_resolve(ax, vertices, mode, id, payloads, tol, resolve)
    return SegmentInteractable(ax, [_pt3(v) for v in vertices], mode, id, payloads, Float64(tol), nothing, resolve)
end
tooltip_spec(i::SegmentInteractable) = i.tooltip
function hitlayers(i::SegmentInteractable, ctx)
    vs = i.resolve === nothing ? i.vertices : [_pt3(v) for v in i.resolve(i.ax)]
    g = Real[]
    for v in vs
        q = _proj(ctx, i.ax, v); append!(g, (_q(q[1]), _q(q[2])))
    end
    kind = i.mode === :polyline ? :polyline : :segments
    return [HitLayer(i.id, kind, g, i.payloads, axis_id(ctx, i.ax), events(i))]
end

# ============================ RectInteractable =============================
"""
    RectInteractable(ax; rects, id=:rects, payloads=nothing, tooltip=nothing, clamp_to_viewport=false)
    RectInteractable(ax; grid, id=:rects, payloads=nothing, tooltip=nothing)
    RectInteractable(ax, p; id=<kind-specific>, payloads=nothing)   # from a plot object

Axis-aligned rectangles: an explicit list (bars, boxes) or a compact heatmap/image grid.
Exactly one of `rects`/`grid` must be given. Produces one `:rects` or `:grid` [`HitLayer`](@ref).

# Arguments (list form: `rects=`)
- `rects` — data-space boxes `[(xc, yc, w, h), …]` (center + width/height).
- `id` — the layer id; becomes `InteractionEvent.layer` on a hit. Default `:rects`.
- `payloads` — one entry per rect; `ArgumentError` if the length doesn't match. Default:
  `(; index)`, 0-based.
- `tooltip` — `nothing` for the auto name/value table (default), `holo"..."` for a template, or
  `false` to suppress. `tooltip = true` is rejected (`ArgumentError`).
- `clamp_to_viewport` — clamp each rect's pixel bounds to the axis viewport (inward rounding,
  so integer quantization never expands past the edge) before shipping geometry. Used
  internally by the `HSpan`/`VSpan` introspection methods below; rarely needed directly.
  Default `false`.

# Arguments (grid form: `grid=`)
- `grid` — `(xedges, yedges, values)`: `xedges`/`yedges` are cell-edge vectors (length
  `ncols+1`/`nrows+1`), `values` an `(ncols, nrows)` `Matrix` of per-cell values. Shape mismatch
  raises `ArgumentError`. `id`/`tooltip` as above; `payloads` is unused (cell `(i, j, value)`
  is resolved client-side from `values`). If a cell renders under ~1 screen px, `values` is
  dropped from the manifest to bound its size (hover then shows `(i, j)` only; a `@warn` notes
  it) — clicks still carry the cell index.

# From a plot object
`RectInteractable(ax, p)` builds `rects`/`grid` and default payloads from `p`:

| `p` | default `id` | form | notes |
|---|---|---|---|
| `Makie.Heatmap` / `Makie.Image` | `:cells` | grid | edges from converted coordinate/coordinate-free ranges |
| `Makie.BarPlot` | `:bars` | list | reads the laid-out child `Poly` (dodge/stack/auto-width honored); payload `(; low, high, value)` |
| `Makie.Spy` | `:spy` | list | cell size from the child `Scatter`'s data-space `markersize` (length-2 vector or scalar; other shapes error) |
| `Makie.Hist` | `:hist` | list | payload `(; value, low, high)` (`value` is a count only for `normalization = :none`) |
| `Makie.Waterfall` | `:waterfall` | list | payload `(; low, high, value)` |
| `Makie.CrossBar` | `:crossbar` | list | payload `(; midpoint, low, high)` |
| `Makie.HSpan` | `:hspan` | list | spans the full x-range of `ax`'s current limits; `clamp_to_viewport = true`; payload `(; low, high)` (y-bounds); re-resolved on limit changes |
| `Makie.VSpan` | `:vspan` | list | spans the full y-range of `ax`'s current limits; `clamp_to_viewport = true`; payload `(; low, high)` (x-bounds); re-resolved on limit changes |

# Examples
```julia
RectInteractable(ax; rects = [(0.0, 0.0, 1.0, 1.0)], payloads = [(; label = "a")])

xedges = 0:0.5:2; yedges = 0:1:3; vals = rand(4, 3)
RectInteractable(ax; grid = (xedges, yedges, vals))

p = heatmap!(ax, X, Y, Z)
RectInteractable(ax, p)
```
"""
struct RectInteractable <: AbstractInteractable
    ax; layout::Symbol; data::Any; id::Symbol; payloads::Vector{Any}; tooltip::Union{Nothing, Markup, Bool}
    # Spans only: clamp the pixel rect to the axis viewport with inward rounding (ceil near
    # edge, floor far edge) so integer quantization never expands it past the bounds.
    clamp_to_viewport::Bool
    # :list only. Same resolve-in-hitlayers mechanism as SegmentInteractable.resolve.
    resolve::Union{Nothing, Function}
end
function RectInteractable(
        ax; rects = nothing, grid = nothing, id = :rects, payloads = nothing,
        tooltip = nothing, clamp_to_viewport = false
    )
    _check_tooltip(tooltip)
    return if grid !== nothing
        xe, ye, vals = grid
        xe = collect(Float64, xe); ye = collect(Float64, ye)
        expected = (length(xe) - 1, length(ye) - 1)
        vals isa AbstractMatrix && size(vals) == expected || throw(
            ArgumentError(
                "RectInteractable: grid `values` must be a Matrix with shape (length(xedges)-1, length(yedges)-1) " *
                    "= $(expected), got $(vals isa AbstractMatrix ? size(vals) : typeof(vals))",
            ),
        )
        RectInteractable(ax, :grid, (xe, ye, vals), id, Any[], tooltip, false, nothing)
    else
        rs = [(Float64(r[1]), Float64(r[2]), Float64(r[3]), Float64(r[4])) for r in rects]
        pl = payloads === nothing ? Any[(; index = k - 1) for k in 1:length(rs)] : _check_payloads(payloads, length(rs), "RectInteractable")
        RectInteractable(ax, :list, rs, id, pl, tooltip, clamp_to_viewport, nothing)
    end
end
# Internal-only: construct a :list RectInteractable with a lazy `resolve(ax) -> rects`.
function _rect_with_resolve(ax, rects, id, payloads, clamp_to_viewport, resolve)
    rs = [(Float64(r[1]), Float64(r[2]), Float64(r[3]), Float64(r[4])) for r in rects]
    return RectInteractable(ax, :list, rs, id, payloads, nothing, clamp_to_viewport, resolve)
end
tooltip_spec(i::RectInteractable) = i.tooltip
function hitlayers(i::RectInteractable, ctx)
    if i.layout === :list
        rects = i.resolve === nothing ? i.data : i.resolve(i.ax)
        g = Real[]
        vp = i.clamp_to_viewport ? ctx.transforms[axis_id(ctx, i.ax)].viewport : nothing
        for (xc, yc, w, h) in rects
            a = _proj(ctx, i.ax, (xc - w / 2, yc - h / 2)); b = _proj(ctx, i.ax, (xc + w / 2, yc + h / 2))
            cx = (a[1] + b[1]) / 2; cy = (a[2] + b[2]) / 2
            ww = abs(b[1] - a[1]); hh = abs(b[2] - a[2])
            if vp === nothing || !all(isfinite, (cx, cy, ww, hh))
                append!(g, (_q(cx), _q(cy), _q(ww), _q(hh)))
            else
                # ceil/floor on NaN/Inf throws, so non-finite coords take the _q path above.
                vp_x, vp_y, vp_w, vp_h = vp
                x_lo = ceil(Int, max(cx - ww / 2, vp_x))
                x_hi = floor(Int, min(cx + ww / 2, vp_x + vp_w))
                y_lo = ceil(Int, max(cy - hh / 2, vp_y))
                y_hi = floor(Int, min(cy + hh / 2, vp_y + vp_h))
                px_w = max(0, x_hi - x_lo); px_h = max(0, y_hi - y_lo)
                append!(g, (round(Int, (x_lo + x_hi) / 2), round(Int, (y_lo + y_hi) / 2), px_w, px_h))
            end
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

# ============================ TextInteractable =============================
"""
    TextInteractable(ax, p::Makie.Text; id=:text, payloads=nothing, tooltip=nothing)

Click-to-pick text labels (from `text!`/`annotation!`), hit-tested as bounding-box rects. Has
**no explicit-geometry constructor** — this from-a-plot-object form is the only way to build
one. Produces one `:rects` [`HitLayer`](@ref), one box per string.

# Arguments
- `p` — a `Makie.Text` plot (for `annotation!`, pass its descendant `Text`, e.g. via
  [`auto_interactables`](@ref)).
- `id` — the layer id; becomes `InteractionEvent.layer` on a hit. Default `:text`.
- `payloads` — one entry per string; `ArgumentError` if the length doesn't match. Default:
  `(; text, index, x, y)` — `text` is the string, `index` 0-based, `(x, y)` its data-space
  anchor.
- `tooltip` — `nothing` for the auto name/value table (default), `holo"..."` for a template, or
  `false` to suppress. `tooltip = true` is rejected (`ArgumentError`).

Geometry is each string's axis-aligned bounding box (`Makie.string_boundingboxes`), not
projected data coordinates — a rotated label gets its expanded axis-aligned box. Boxes are
read lazily in `hitlayers`, not at construction, so a `TextInteractable` can be built before
the figure is finalized.

# Examples
```julia
p = text!(ax, "hello"; position = (1.0, 2.0))
TextInteractable(ax, p)
```
"""
struct TextInteractable <: AbstractInteractable
    ax; p; id::Symbol; payloads::Vector{Any}; tooltip::Union{Nothing, Markup, Bool}   # p::Makie.Text
end
function TextInteractable(ax, p::Makie.Text; id = :text, payloads = nothing, tooltip = nothing)
    _check_tooltip(tooltip)
    strs = p.text[]
    anchors = p.positions[]
    length(anchors) == length(strs) ||
        error("TextInteractable: $(length(anchors)) positions for $(length(strs)) strings (Makie internals changed?)")
    pl = if payloads === nothing
        Any[
            (; text = string(strs[k]), index = k - 1, x = Float64(anchors[k][1]), y = Float64(anchors[k][2]))
                for k in eachindex(strs)
        ]
    else
        _check_payloads(payloads, length(strs), "TextInteractable")
    end
    return TextInteractable(ax, p, id, pl, tooltip)
end
tooltip_spec(i::TextInteractable) = i.tooltip
function hitlayers(i::TextInteractable, ctx)
    boxes = _string_bboxes(i.p)
    length(boxes) == length(i.payloads) ||
        error("TextInteractable: $(length(boxes)) boxes for $(length(i.payloads)) payloads (Makie internals changed?)")
    o = _scene_viewport(i.ax).origin
    g = Real[]
    # Empty strings are not skipped: a zero-area box keeps box-count == payload-count.
    for b in boxes
        bx, by = Float64(b.origin[1]), Float64(b.origin[2])
        bw, bh = Float64(b.widths[1]), Float64(b.widths[2])
        # scene-local (y-up) → image px (y-down): same ×scaling + y-flip as the backend `project` closure.
        x_left = (bx + o[1]) * ctx.scaling
        y_top = ctx.height - (by + bh + o[2]) * ctx.scaling
        w = bw * ctx.scaling; h = bh * ctx.scaling
        append!(g, (_q(x_left + w / 2), _q(y_top + h / 2), _q(w), _q(h)))   # :rects list = (cx, cy, w, h)
    end
    return [HitLayer(i.id, :rects, g, i.payloads, axis_id(ctx, i.ax), events(i))]
end

# ============================ PolygonInteractable ==========================
"""
    PolygonInteractable(ax, rings; id=:polygons, payloads=nothing, tooltip=nothing)
    PolygonInteractable(ax, p; id=<kind-specific>, payloads=nothing)   # from a plot object

Arbitrary filled polygons, hit-tested even-odd. Produces one `:polygons` [`HitLayer`](@ref).

# Arguments
- `rings` — `Vector{Vector{point}}`, one or more rings, each a `Vector` of 2- or 3-element
  data-space points/tuples (one polygon per ring; a ring need not be closed — the hit-test
  closes it implicitly).
- `id` — the layer id; becomes `InteractionEvent.layer` on a hit. Default `:polygons`.
- `payloads` — one entry per ring; `ArgumentError` if the length doesn't match. Default:
  `(; index)`, 0-based.
- `tooltip` — `nothing` for the auto name/value table (default), `holo"..."` for a template, or
  `false` to suppress. `tooltip = true` is rejected (`ArgumentError`).

# From a plot object
`PolygonInteractable(ax, p)` builds `rings` and default payloads from `p`:

| `p` | default `id` | rings from | notes |
|---|---|---|---|
| `Makie.Poly` | `:poly` | converted geometry | one ring, or many for a multi-ring `Poly` |
| `Makie.Band` | `:band` | lower curve + reversed upper curve | one open ring per band |
| `Makie.Density` | `:density` | its descendant `Band`'s KDE fill | same shape as `Band` |
| `Makie.Contourf` | `:contourf` | each filled level's **exterior** ring only (holes excluded — a v1 limitation: an annular band over-covers its hole at the boundary) | payload `(; low, high)`, the band edges nearest each polygon's fill color |
| `Makie.Violin` | `:violin` | each violin's outline | payload `(; x)`, the nearest category to the ring's geometric center |
| `Makie.Voronoiplot` | `:voronoiplot` | each cell's exterior ring | cells come back in tessellation order (no cheap cell→generator map), so default payload is `(; index)` only |

# Examples
```julia
PolygonInteractable(ax, [[(0,0), (1,0), (1,1), (0,1)]])

p = poly!(ax, points)
PolygonInteractable(ax, p)
```
"""
struct PolygonInteractable <: AbstractInteractable
    ax; rings::Vector; id::Symbol; payloads::Vector{Any}; tooltip::Union{Nothing, Markup, Bool}
end
function PolygonInteractable(ax, rings; id = :polygons, payloads = nothing, tooltip = nothing)
    _check_tooltip(tooltip)
    rs = [[_pt3(p) for p in ring] for ring in rings]
    pl = payloads === nothing ? Any[(; index = k - 1) for k in 1:length(rs)] : _check_payloads(payloads, length(rs), "PolygonInteractable")
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
"""
    AxisInteractable(ax; id=:axis)

The whole axis as one hit region: a click or hover anywhere returns the data coordinate under
the cursor. No per-element geometry — the browser inverts pixels→data live via the shipped
[`AxisTransform`](@ref) (no Julia round-trip on hover). Produces one `:axis` [`HitLayer`](@ref)
with `geometry = nothing`.

# Arguments
- `ax` — a `Makie.Axis` (linear, log, or categorical). `id` — the layer id; becomes
  `InteractionEvent.layer` on a hit. Default `:axis`.

Payload on hit (client-side): `Dict("x" => …, "y" => …)`.

`holo` raises `ArgumentError` at build time if `ax` is an `Axis3` (a screen pixel is a ray, not
a data point — continuous readout is undefined), a `PolarAxis` (continuous θ/r inversion isn't
shipped to JS yet), or either scale isn't client-invertible (supported: `identity`, `log10`,
`log`; categorical axes are fine).

# Examples
```julia
AxisInteractable(ax)
```
"""
struct AxisInteractable <: AbstractInteractable
    ax; id::Symbol
end
AxisInteractable(ax; id = :axis) = AxisInteractable(ax, id)
function validate(i::AxisInteractable, ctx::InteractionContext)
    t = ctx.transforms[axis_id(ctx, i.ax)]
    t.is3d && return "AxisInteractable: continuous pixel→data readout is undefined on an Axis3 " *
        "(a screen pixel is a ray, not a data point). Use element interactables " *
        "(points/segments/polygons) on 3D axes."
    t.ispolar && return "AxisInteractable: continuous θ/r readout on PolarAxis needs the polar " *
        "transform serialized to JS (not yet shipped). Use element interactables " *
        "(points/segments) on PolarAxis for discrete hits."
    (t.xscale in _JS_INVERTIBLE && t.yscale in _JS_INVERTIBLE) ||
        return "AxisInteractable: scale (x=$(t.xscale), y=$(t.yscale)) is not invertible client-side; " *
        "supported: identity/log10/log (categorical is fine)."
    return nothing
end
hitlayers(i::AxisInteractable, ctx) =
    [HitLayer(i.id, :axis, nothing, Any[], axis_id(ctx, i.ax), events(i))]

# ============================ ColorbarInteractable =========================
"""
    ColorbarInteractable(cb; id=:colorbar)

A `Makie.Colorbar` block as one hit region, bounded to its pixel bounding box: a click or
hover anywhere on the bar inverts the cursor position to the bar's data value, client-side —
like [`AxisInteractable`](@ref) but scoped to the colorbar and 1-D. Produces one `:axis`
[`HitLayer`](@ref) with `geometry` set to the colorbar's pixel bbox.

# Arguments
- `cb` — a `Makie.Colorbar` (not an `Axis`). `id` — the layer id; becomes
  `InteractionEvent.layer` on a hit. Default `:colorbar`.

Payload on hit (client-side): `(; value)`.

`holo` raises `ArgumentError` at build time if the colorbar's value-axis scale isn't
client-invertible (supported: `identity`, `log10`, `log`).

# Examples
```julia
cb = Colorbar(fig[1, 2], plotobj)
ColorbarInteractable(cb)
```
"""
struct ColorbarInteractable <: AbstractInteractable
    cb
    id::Symbol
end
ColorbarInteractable(cb; id = :colorbar) = ColorbarInteractable(cb, id)
function validate(i::ColorbarInteractable, ctx::InteractionContext)
    t = ctx.transforms[axis_id(ctx, i.cb)]
    va = t.valueaxis
    sc = va === :y ? t.yscale : t.xscale
    sc in _JS_INVERTIBLE ||
        return "ColorbarInteractable: scale $(sc) is not invertible client-side; supported: identity/log10/log."
    return nothing
end
function hitlayers(i::ColorbarInteractable, ctx)
    aid = axis_id(ctx, i.cb)
    vp = ctx.transforms[aid].viewport
    bbox = Real[vp[1], vp[2], vp[3], vp[4]]
    return [HitLayer(i.id, :axis, bbox, Any[], aid, events(i))]
end

# ============================ ViewInteractable =============================
"""
    ViewInteractable(ax; id=:view)

Drag-to-pan (2D `Axis`) or drag-to-rotate (`Axis3`), committed on mouse-up. Produces one
`:view` [`HitLayer`](@ref) covering `ax`'s whole viewport; it sorts after Tier-0
`:threshold`/`:roi` layers so an ordinary drag on those wins without a modifier —
**Shift+drag** forces the view gesture even over a `ThresholdInteractable`/`ROIInteractable`
hit.

# Arguments
- `ax` — a `Makie.Axis` (pan) or `Makie.Axis3` (orbit). `id` — the layer id; becomes
  `InteractionEvent.layer` on commit. Default `:view`.

Payload on commit (client-side): 2D — `Dict("xmin"=>…, "xmax"=>…, "ymin"=>…, "ymax"=>…)` (the
new `limits`); 3D — `Dict("azimuth"=>…, "elevation"=>…)`. Drive the returned value back into
`ax.limits[]` / `ax.azimuth[]`+`ax.elevation[]` and re-render to make the gesture stick.

`holo` raises `ArgumentError` at build time if `ax` is a `PolarAxis` (continuous θ/r view
gestures aren't shipped), a `Colorbar`'s value axis (no pan/orbit view applies), a categorical
2D axis (pan needs numeric limits to shift), or (2D only) either scale isn't client-invertible
(supported: `identity`, `log10`, `log`). `Axis3` has no scale/categorical restriction — camera
angles are read live from `ax` at render time.

# Examples
```julia
ViewInteractable(ax)
```
"""
struct ViewInteractable <: AbstractInteractable
    ax; id::Symbol
end
ViewInteractable(ax; id = :view) = ViewInteractable(ax, id)
events(::ViewInteractable) = (:drag,)
function validate(i::ViewInteractable, ctx::InteractionContext)
    t = ctx.transforms[axis_id(ctx, i.ax)]
    t.ispolar && return "ViewInteractable: PolarAxis view gestures need continuous θ/r " *
        "transforms (not yet shipped). Use element interactables for discrete hits."
    t.valueaxis !== nothing && return "ViewInteractable: a Colorbar has no pan/orbit view; " *
        "key ViewInteractable to an Axis or Axis3."
    if t.is3d
        # Axis3: azimuth/elevation are read from the live axis in hitlayers — nothing else to gate.
        return nothing
    end
    (t.xcats === nothing && t.ycats === nothing) ||
        return "ViewInteractable: pan needs continuous numeric axes; a categorical axis has " *
        "no numeric limits to shift (use AxisInteractable for categorical readout)."
    (t.xscale in _JS_INVERTIBLE && t.yscale in _JS_INVERTIBLE) ||
        return "ViewInteractable: pan needs client-side invertible x and y scales " *
        "(x=$(t.xscale), y=$(t.yscale); supported: identity/log10/log)."
    return nothing
end
function hitlayers(i::ViewInteractable, ctx)
    t = ctx.transforms[axis_id(ctx, i.ax)]
    vx, vy, vw, vh = t.viewport
    geom = Dict{String, Any}(
        "x" => Float32(vx), "y" => Float32(vy),
        "w" => Float32(vw), "h" => Float32(vh),
        "mode" => t.is3d ? "orbit" : "pan",
    )
    if t.is3d
        # Current camera — JS computes the committed (azimuth, elevation) from the pixel delta.
        geom["azimuth"] = Float64(i.ax.azimuth[])
        geom["elevation"] = Float64(i.ax.elevation[])
    end
    return [HitLayer(i.id, :view, geom, Any[], axis_id(ctx, i.ax), events(i))]
end

# ============================ ThresholdInteractable ========================
"""
    ThresholdInteractable(ax; orientation=:horizontal, value, id=:threshold)

A draggable horizontal or vertical line: drag for a live client-side readout, and the pixel
position inverts to a data-space scalar via [`AxisTransform`](@ref) on mouse-up. Produces one
`:threshold` [`HitLayer`](@ref).

# Arguments
- `ax` — a `Makie.Axis`.
- `orientation` — `:horizontal` (constant-y line, dragged vertically) or `:vertical`
  (constant-x line, dragged horizontally). Any other value raises `ArgumentError`. Default
  `:horizontal`.
- `value` — the line's initial data-space position (a y-value for `:horizontal`, x-value for
  `:vertical`). Required, no default.
- `id` — the layer id; becomes `InteractionEvent.layer` on commit. Default `:threshold`.

Payload on commit (client-side): the scalar data coordinate.

`holo` raises `ArgumentError` at build time if `ax` is an `Axis3` (a screen pixel is a ray, not
a data value — inversion is undefined), a `PolarAxis` (continuous inversion isn't shipped), or
the dragged axis's scale isn't client-invertible (`:horizontal` needs the y-scale, `:vertical`
the x-scale; supported: `identity`, `log10`, `log`).

# Examples
```julia
ThresholdInteractable(ax; orientation = :horizontal, value = 5.0)
```
"""
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
    t.is3d && return "ThresholdInteractable: drag inverts a pixel to a data scalar via the axis " *
        "transform, which is undefined on an Axis3 (a screen pixel is a ray, not a data value)."
    t.ispolar && return "ThresholdInteractable: drag inverts a pixel via Cartesian axis scales; " *
        "PolarAxis continuous θ/r inversion is not yet shipped. Use element interactables for discrete hits."
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
"""
    ROIInteractable(ax; bounds, id=:roi, selects=nothing)

A draggable and resizable rectangle: drag the interior to move it, a corner to resize; on
mouse-up its two opposite pixel corners invert to data-space bounds via
[`AxisTransform`](@ref). An `AbstractSelector` — with `selects` set, it also brushes a
compatible layer, reporting the contained elements. Produces one `:roi` [`HitLayer`](@ref).

# Arguments
- `ax` — a `Makie.Axis`.
- `bounds` — initial `(xmin, xmax, ymin, ymax)` in data space. Requires `xmin < xmax` and
  `ymin < ymax` (`ArgumentError` otherwise); length must be 4 (`ArgumentError` otherwise).
- `id` — the layer id; becomes `InteractionEvent.layer` on commit. Default `:roi`.
- `selects` — the `id` of a `:circles` or `:grid` layer to brush: on mouse-up, elements whose
  geometry falls inside the ROI are reported. `holo` raises `ArgumentError` at build time if
  `selects` names a layer absent from the same call, or one of an unsupported kind.

Payload on commit (client-side, no `selects`): `Dict("xmin"=>…, "xmax"=>…, "ymin"=>…,
"ymax"=>…)`. With `selects` set, the bond value instead becomes a `Vector{InteractionEvent}`
(one per contained element, each layer'd to the target) — see [`InteractionEvent`](@ref).

`holo` raises `ArgumentError` at build time if `ax` is an `Axis3` (a screen pixel is a ray, not
a data point), a `PolarAxis` (continuous inversion isn't shipped), a categorical axis (bounds
need numeric limits), or either scale isn't client-invertible (supported: `identity`, `log10`,
`log`).

# Examples
```julia
ROIInteractable(ax; bounds = (0.0, 1.0, 0.0, 1.0))

# brush a scatter layer named :scatter
ROIInteractable(ax; bounds = (0.0, 1.0, 0.0, 1.0), selects = :scatter)
```
"""
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
    t.is3d && return "ROIInteractable: drag inverts pixel corners to data-space bounds via the axis " *
        "transform, which is undefined on an Axis3 (a screen pixel is a ray, not a data point)."
    t.ispolar && return "ROIInteractable: drag inverts pixel corners via Cartesian axis scales; " *
        "PolarAxis continuous θ/r inversion is not yet shipped. Use element interactables for discrete hits."
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
"""
    RegionInteractable(ax; regions, payloads, id=:region, tooltip=nothing, events=(:click, :hover))

Declarative mixed hit regions in data space — circles, rects, and polygons in one call, no
JavaScript required. Grouped into up to three [`HitLayer`](@ref)s (one per geometry kind
present), so a single call can mix shapes freely.

# Arguments
- `regions` — a `Vector`, each element one of:
  - `(:circle, (cx, cy), r)` — `r` in data units
  - `(:rect, (cx, cy), w, h)` — `w`, `h` in data units
  - `(:polygon, [(x, y), …])` — a ring of points
  Any other first element raises `ArgumentError`.
- `payloads` — one entry per region, matched 1:1 by position (`ArgumentError` on a length
  mismatch); no auto-generated default (unlike the other built-ins, this keyword is required).
- `id` — the base layer id. The generated layers are `Symbol(id, :_c)` (circles),
  `Symbol(id, :_r)` (rects), `Symbol(id, :_p)` (polygons) — only the kinds actually present are
  emitted. `InteractionEvent.layer` and `selected=` keys use these suffixed ids, not `id`
  itself. Default `:region`.
- `tooltip` — `nothing` for the auto name/value table (default), `holo"..."` for a template, or
  `false` to suppress; applies to every generated layer. `tooltip = true` is rejected
  (`ArgumentError`).
- `events` — the pointer events all generated layers respond to. Default `(:click, :hover)`.

# Examples
```julia
RegionInteractable(
    ax;
    regions = [(:circle, (0.0, 0.0), 1.0), (:rect, (3.0, 0.0), 2.0, 1.0)],
    payloads = [(; label = "circle"), (; label = "rect")],
)
```
"""
struct RegionInteractable <: AbstractInteractable
    ax; regions::Vector; payloads::Vector{Any}; id::Symbol; tooltip::Union{Nothing, Markup, Bool}; evs::Tuple
end
function RegionInteractable(
        ax; regions, payloads, id = :region,
        tooltip = nothing, events = (:click, :hover)
    )
    _check_tooltip(tooltip)
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
"""
    FunctionInteractable(f; events=(:click, :hover))

Full-control escape hatch for a geometry kind the other built-ins don't express: `f(ctx) ->
Vector{HitLayer}` is called at manifest-build time and its result is used verbatim.

# Arguments
- `f` — a function `(ctx::InteractionContext,) -> Vector{HitLayer}`. Project data-space points
  with `data_to_image_px(ctx, ax, point)`, and look up an axis's transform id with
  `Holo.axis_id(ctx, ax)` (not exported) when constructing a `HitLayer`.
- `events` — the pointer events reported by `Holo.events(::FunctionInteractable)`; `f` is free
  to give its `HitLayer`s different `events` per layer if it wants. Default `(:click, :hover)`.

# Examples
```julia
FunctionInteractable() do ctx
    q = data_to_image_px(ctx, ax, (1.0, 2.0))
    [HitLayer(:custom, :circles, [q[1], q[2], 10], [(; label = "manual")], Holo.axis_id(ctx, ax), (:click, :hover))]
end
```
"""
struct FunctionInteractable <: AbstractInteractable
    f::Function; evs::Tuple
end
FunctionInteractable(f; events = (:click, :hover)) = FunctionInteractable(f, events)
events(i::FunctionInteractable) = i.evs
hitlayers(i::FunctionInteractable, ctx) = i.f(ctx)
