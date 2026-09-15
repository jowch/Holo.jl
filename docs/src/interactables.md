# Interactables

Declare interactables explicitly (geometry in data space):

- [`PointInteractable`](@ref) — scatter-style points
- [`SegmentInteractable`](@ref) — lines / polylines (nearest-segment) and segment pairs
- [`RectInteractable`](@ref) — bars (list) and heatmap cells (compact grid)
- [`PolygonInteractable`](@ref) — arbitrary polygons
- [`AxisInteractable`](@ref) — the whole axis: click anywhere → data `(x, y)` (linear + log)
- [`ColorbarInteractable`](@ref) — a `Makie.Colorbar` block: hover/click anywhere on the bar
  inverts the cursor to the bar's data value
- [`TextInteractable`](@ref) — `text!`/`annotation!` labels as click-to-pick buttons
  (bounding-box hit regions)
- [`ThresholdInteractable`](@ref) — a draggable horizontal/vertical line; drag for a live
  readout, commit the data value on mouse-up
- [`ROIInteractable`](@ref) — a draggable + resizable rectangle; drag the interior to move, a
  corner to resize; commit the data-space bounds on mouse-up
- [`ViewInteractable`](@ref) — drag-to-pan (2D `Axis` → new `limits`) / drag-to-rotate
  (`Axis3` → `azimuth`/`elevation`); commit on mouse-up; Shift+drag wins over ROI/threshold
- [`RegionInteractable`](@ref) / [`FunctionInteractable`](@ref) — custom interactions, no
  JavaScript required; see [Custom interactions](@ref)

Linear, log, and categorical axes; single or multiple axes; linked selection via shared
payloads through Pluto's reactive graph. `Axis3` gets the same treatment on both backends: 3D
scatter/lines carry point/segment overlays with `{index, x, y, z}` payloads, meshscatter gets
depth-correct per-marker hit radii from its data-space `markersize`, wireframe's rendered
edges are hoverable, and `arrows3d` shafts hit as start→end segments — all projected at build
time in Julia, static on `:cairo`, live on `:webgl` (see [Backends](@ref)). Continuous
pixel→data readout ([`AxisInteractable`](@ref)/[`ThresholdInteractable`](@ref)/
[`ROIInteractable`](@ref)) fails loud on a 3D axis (a screen pixel is a ray, not a data
point), and high-frequency live redraw is a shared cost limit on both backends. `PolarAxis`
gets the same discrete point/segment overlays on both backends; continuous θ/r readout is
deferred. Unsupported `LScene` blocks fail loud at `holo()` time — see
[Troubleshooting](@ref).

[`examples/demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/demo.jl) is a
runnable gallery of every kind below plus the selection round-trip.

**Pan, zoom, and 3D rotation** use the same server-authoritative `@bind` re-render model on
both backends: change `limits` (2D) or `azimuth`/`elevation` (`Axis3`) and rebuild — `holo`
re-projects the overlay so hit regions never drift. Drive those params with PlutoUI sliders
(no Holo API) or with [`ViewInteractable`](@ref) drag-to-pan / drag-to-rotate
(commit-on-release; Shift+drag arbitrates vs. box-select/ROI).
[`examples/view_manip.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/view_manip.jl)
demonstrates both.

## Constructors

Every interactable takes an `Axis` (or, for [`ColorbarInteractable`](@ref), a
`Makie.Colorbar`) and geometry in **data space**. All accept `id` — the `Symbol` the event
reports as `layer` — and `payloads`, one entry per element (auto-generated with a 0-based
`index` if omitted).

| Constructor | Geometry | Default payload |
|---|---|---|
| `PointInteractable(ax, points; id = :points, payloads, radius = 9)` | `points :: Vector{(x, y)}`; `radius` is the px click target | `(; index, x, y)` |
| `SegmentInteractable(ax, vertices; mode = :polyline, id = :segments, payloads, tol = 6)` | `:polyline` = connected path (hit = nearest segment); `:pairs` = disjoint segment pairs; `tol` px slack | `(; segment_index)` |
| `RectInteractable(ax; rects, id = :rects, payloads)` | `rects = [(xc, yc, w, h), …]` — explicit boxes (e.g. bars) | `(; index)` |
| `RectInteractable(ax; grid, id, payloads)` | `grid = (xedges, yedges, values)` — a heatmap shipped as edges, not N rects | cell `(i, j, value)`, resolved client-side |
| `PolygonInteractable(ax, rings; id = :polygons, payloads)` | `rings :: Vector{Vector{(x, y)}}` — one or more filled rings | `(; index)` |
| `AxisInteractable(ax; id = :axis)` | the whole axis: a click anywhere returns the data coordinate | `Dict("x" => …, "y" => …)` |
| `ColorbarInteractable(cb; id = :colorbar)` | takes a `Makie.Colorbar` block, not an `Axis`; hit region bounded to the colorbar's pixel bbox | `(; value)`, resolved client-side |
| `ThresholdInteractable(ax; orientation = :horizontal, value, id = :threshold)` | a draggable line (`:horizontal` = constant-y, dragged vertically; `:vertical` = constant-x); live readout while dragging, commit on mouse-up | scalar data coord, on release |
| `ROIInteractable(ax; bounds = (xmin, xmax, ymin, ymax), id = :roi)` | a draggable + resizable box; move (interior) / resize (corner); commit on mouse-up | `Dict("xmin"=>…, "xmax"=>…, "ymin"=>…, "ymax"=>…)`, on release |
| `ViewInteractable(ax; id = :view)` | drag-to-pan (2D) or drag-to-rotate (Axis3); commit on mouse-up; Shift+drag forces view over ROI/threshold | 2D: `Dict("xmin"=>…, "xmax"=>…, "ymin"=>…, "ymax"=>…)`; 3D: `Dict("azimuth"=>…, "elevation"=>…)` |

[`AxisInteractable`](@ref), [`ColorbarInteractable`](@ref), [`ThresholdInteractable`](@ref),
and [`ROIInteractable`](@ref) invert pixels→data client-side, so they support `identity` /
`log10` / `log` scales; any other scale fails loud at `holo()` time. Categorical axes are
fine for `AxisInteractable`/`ThresholdInteractable` (which read a category), but
`ROIInteractable` rejects them — its numeric bounds have no meaning on categories.
`ViewInteractable` pan needs the same invertible continuous scales; orbit mode is
Axis3-only.

## From a plot object

Pass the plot object a `plot!` call returns and the geometry is pulled from it — no need to
repeat coordinates you already gave Makie. These produce the **same** interactable the
explicit constructor would, so everything above (payloads, `selected`, tooltips) still
applies.

```julia
p = scatter!(ax, xs, ys; markersize = 14)
@bind sel holo(fig, PointInteractable(ax, p))   # radius taken from markersize
```

| Plot | Constructor | Notes |
|---|---|---|
| `Scatter` | `PointInteractable(ax, p)` | `radius` defaults to `markersize/2` (pixel markers); override with `radius =` |
| `Lines` | `SegmentInteractable(ax, p)` | `:polyline` (nearest-segment) |
| `LineSegments` | `SegmentInteractable(ax, p)` | `:pairs` (disjoint) |
| `Heatmap` / `Image` | `RectInteractable(ax, p)` | compact grid; cell `(i, j, value)` resolved client-side |
| `BarPlot` | `RectInteractable(ax, p)` | reads the laid-out bars, so dodge/stack/auto-width are honored |
| `Poly` | `PolygonInteractable(ax, p)` | one ring or many |
| `Text` / `Annotation` (`text!`/`annotation!`) | `TextInteractable(ax, p)` | bounding box per string; a rotated label gets the axis-aligned (expanded) box. `TextInteractable` has no explicit-geometry constructor — this is the only way to build one. |

The `ax` is passed because a plot has no back-reference to its axis. `id`/`payloads` take the
same keywords as the explicit form (defaults: `:scatter`, `:lines`, `:segments`, `:cells`,
`:bars`, `:poly`, `:text`). Other plot types still need the explicit constructor.

## Zero-config: `holo(fig)`

Skip the constructors entirely — `holo(fig)` walks every `Axis`, introspects each supported
plot, and overlays the lot:

```julia
fig = Figure(); ax = Axis(fig[1, 1])
scatter!(ax, xs, ys)
heatmap!(ax, X, Y, Z)
@bind ev holo(fig)           # both plots interactive; ev.layer tells you which was clicked
```

Layer ids are the plot kind (`:scatter`, `:lines`, `:segments`, `:cells`, `:bars`, `:poly`,
`:text`), suffixed `_2`, `_3`, … when a kind repeats within one figure. Unsupported plot
types are skipped with a `@warn`, not an error.

[`auto_interactables`](@ref) returns the same `Vector{AbstractInteractable}` `holo(fig)`
builds, so you can grab it, tweak ids/payloads or append custom interactables, then pass it
back:

```julia
ints = auto_interactables(fig)
push!(ints, RegionInteractable(ax; regions = ..., payloads = ...))
@bind ev holo(fig, ints)
```
