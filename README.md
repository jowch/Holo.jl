# Holo.jl

[![CI](https://github.com/jowch/Holo.jl/actions/workflows/CI.yml/badge.svg)](https://github.com/jowch/Holo.jl/actions/workflows/CI.yml)

**Light, server-free interactivity for static CairoMakie plots in Pluto.**

Holo lays a thin interactive layer over a static [CairoMakie](https://docs.makie.org/stable/explanations/backends/cairomakie)
figure inside a [Pluto](https://plutojl.org) notebook — hover for tooltips, click to
select — and round-trips deliberate clicks to Julia through `@bind`. No parallel server,
no WebGL: the plot is a publication-quality static image, and a transparent JS overlay
does the hit-testing.

> **Status: early / experimental (v0.1).** Validated end-to-end in real Pluto — all five
> interactable kinds and the selection round-trip are exercised live by
> [`examples/demo.jl`](examples/demo.jl) (CI runs it headlessly on every change). APIs may
> still change.

## Why

| | CairoMakie | WGLMakie | **Holo** |
|---|---|---|---|
| Output | static, publication-quality | live, GPU | static + thin overlay |
| Interactivity | none | rich | light (hover/click) |
| Needs a live Julia process | no | **yes** | only for click → recompute |
| Survives offline / static HTML export | yes | no | **yes** (inspection layer) |

Holo fills the gap: *publication-quality 2D plots with light client-side interactivity,
Pluto-native, no server.* It is **not** a WGLMakie replacement (no 3D, no live camera).

## Install

Holo isn't registered yet:

```julia
julia> ] add https://github.com/jowch/Holo.jl
```

You'll also want `CairoMakie` and `Pluto`.

## Quick start

In a Pluto notebook:

```julia
using Holo, CairoMakie

# 1. your figure, as usual
fig = Figure(); ax = Axis(fig[1, 1])
pts = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0)]
scatter!(ax, first.(pts), last.(pts))

# 2. declare what's interactable, bind the result
@bind sel holo(fig, [PointInteractable(ax, pts; payloads = ["a", "b", "c"])])
```

```julia
# 3. react to clicks — `sel` is `nothing` until a click, then an InteractionEvent
sel === nothing ? "click a point" : "you picked $(sel.payload)"
```

Hover shows a tooltip (purely client-side, no Julia round-trip); a click sets `sel` and
re-runs downstream cells. Clicks on empty space are a no-op.

## What's interactable (v1)

Declare interactables explicitly (geometry in data space):

- `PointInteractable` — scatter-style points
- `SegmentInteractable` — lines / polylines (nearest-segment) and segment pairs
- `RectInteractable` — bars (list) and heatmap cells (compact grid)
- `PolygonInteractable` — arbitrary polygons
- `AxisInteractable` — the whole axis: click anywhere → data `(x, y)` (linear + log)
- `ThresholdInteractable` — a draggable horizontal/vertical line; drag for a live readout, commit the data value on mouse-up
- `RegionInteractable` / `FunctionInteractable` — custom interactions, no JavaScript required

Linear, log, and categorical axes; single or multiple axes; linked selection via shared
payloads through Pluto's reactive graph. Out of scope (that's WGLMakie's domain): 3D and
high-frequency live redraw; unsupported axis blocks (`PolarAxis`/`Axis3`/`LScene`) fail loud
at `holo()` time.

[`examples/demo.jl`](examples/demo.jl) is a runnable gallery of every kind below plus the
selection round-trip.

## API reference

### `holo`

```julia
holo(fig, interactables; backend = CairoBackend(), selected = nothing) -> HoloWidget
holo(fig, interactable;  …)   # single-interactable convenience
holo(fig; …)                  # zero-config: auto-extract interactables from the plots
```

Renders `fig` and overlays hit-testing for the declared interactables. Use as a Pluto
`@bind` source; the bond value is `nothing` until a click, then an [`InteractionEvent`](#interactionevent).
`holo` does not corrupt your figure (it saves/restores the background and runs the same
finalize step Makie performs at display time).

- **`backend`** — `CairoBackend(; max_width = 700, vector = false)`. `max_width` is the
  display width to target (Pluto's column); render resolution is *derived* from it (~2× the
  display width — retina-crisp, not wasteful), never a fixed DPI.
- **`selected`** — a `layer_id => indices` map (e.g. `Dict(:scatter => [0, 2])`) that
  pre-highlights elements on mount. Indices are 0-based and match `InteractionEvent.index`.
  Feed a bond value back into it to keep clicked elements highlighted across re-renders,
  flicker-free (see [Selection round-trip](#selection-round-trip)). Keys are layer ids: for
  the single-layer kinds that's the interactable's `id`, but `RegionInteractable` splits into
  suffixed layers (`:id_c` circles / `:id_r` rects / `:id_p` polygons) — key on those.

### `InteractionEvent`

The bond value after a click:

```julia
struct InteractionEvent
    layer::Symbol   # the interactable's `id`
    index::Int      # 0-based element index within the layer
    payload::Any    # the data you attached — see note
end
```

> **Payloads round-trip as a `Dict`** (via JSON), not the original `NamedTuple`. A payload
> `(; label = "a")` comes back as `Dict("label" => "a")`, so index it as
> `ev.payload["label"]`. `AxisInteractable` yields `Dict("x" => …, "y" => …)`.

### Interactables

Every interactable takes an `Axis` and geometry in **data space** (projected in Julia via
`Makie.project`). All accept `id` — the `Symbol` the event reports as `layer` — and
`payloads`, one entry per element (auto-generated with a 0-based `index` if omitted).

| Constructor | Geometry | Default payload |
|---|---|---|
| `PointInteractable(ax, points; id = :points, payloads, radius = 9)` | `points :: Vector{(x, y)}`; `radius` is the px click target | `(; index, x, y)` |
| `SegmentInteractable(ax, vertices; mode = :polyline, id = :segments, payloads, tol = 6)` | `:polyline` = connected path (hit = nearest segment); `:segments` = disjoint pairs; `tol` px slack | `(; segment_index)` |
| `RectInteractable(ax; rects, id = :rects, payloads)` | `rects = [(xc, yc, w, h), …]` — explicit boxes (e.g. bars) | `(; index)` |
| `RectInteractable(ax; grid, id, payloads)` | `grid = (xedges, yedges, values)` — a heatmap shipped as edges, not N rects | cell `(i, j, value)`, client-side |
| `PolygonInteractable(ax, rings; id = :polygons, payloads)` | `rings :: Vector{Vector{(x, y)}}` — one or more filled rings | `(; index)` |
| `AxisInteractable(ax; id = :axis)` | the whole axis: a click anywhere returns the data coordinate | `Dict("x" => …, "y" => …)` |
| `ThresholdInteractable(ax; orientation = :horizontal, value, id = :threshold)` | a draggable line (`:horizontal` = constant-y, dragged vertically; `:vertical` = constant-x); live readout while dragging, commit on mouse-up | scalar data coord (client-side, on release) |

`AxisInteractable` and `ThresholdInteractable` invert pixels→data client-side, so they support `identity` / `log10` /
`log` scales (categorical is fine); any other scale fails loud at `holo()` time.

### From a plot object (no hand-written geometry)

Pass the plot a `plot!` call returns and the geometry is pulled from it — no need to repeat
coordinates you already gave Makie. These produce the **same** interactable the explicit
constructor would, so everything above (payloads, `selected`, tooltips) still applies.

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

The `ax` is passed because a plot has no back-reference to its axis. `id`/`payloads` take the
same keywords as the explicit form (defaults: `:scatter`, `:lines`, `:segments`, `:cells`, `:bars`, `:poly`).
Other plot types still need the explicit constructor.

### Zero-config: `holo(fig)`

Skip the constructors entirely — `holo(fig)` walks every `Axis`, introspects each supported
plot, and overlays the lot:

```julia
fig = Figure(); ax = Axis(fig[1, 1])
scatter!(ax, xs, ys)
heatmap!(ax, X, Y, Z)
@bind ev holo(fig)           # both plots interactive; ev.layer tells you which was clicked
```

Layer ids are the plot kind (`:scatter`, `:lines`, `:segments`, `:cells`, `:bars`, `:poly`), suffixed
`_2`, `_3`, … when a kind repeats. Unsupported plot types are skipped with a warning.

`auto_interactables(fig)` returns the same `Vector{AbstractInteractable}` `holo(fig)` builds, so
you can grab it, tweak ids/payloads or append custom interactables, then pass it back:

```julia
ints = auto_interactables(fig)
push!(ints, RegionInteractable(ax; regions = …, payloads = …))
@bind ev holo(fig, ints)
```

### Custom interactions

For geometry the built-ins don't cover — no JavaScript required:

- **`RegionInteractable(ax; regions, payloads, id = :region, tooltip = pl -> nothing, events = (:click, :hover))`**
  (Tier A) — declarative mixed regions in data space, grouped into one layer per kind. Each
  region is one of:

  ```julia
  (:circle,  (cx, cy), r)            # r in data units
  (:rect,    (cx, cy), w, h)         # w, h in data units
  (:polygon, [(x, y), …])            # a ring of points
  ```

  `payloads` must match `regions` 1:1; `tooltip(payload) -> String | nothing` sets hover text.

- **`FunctionInteractable(f; events = (:click, :hover))`** (Tier B) — full control:
  `f(ctx) -> Vector{HitLayer}`. Project points with `data_to_image_px(ctx, ax, point)` and
  emit `HitLayer(id, kind, geometry, payloads, axis_id(ctx, ax), events)`. The escape hatch
  for a geometry kind the others don't express.

### Selection round-trip

Pass `selected` to pre-highlight, and feed a bond value back to make a selection persist.
The catch: feeding one widget's bond into *its own* `selected` is a Pluto reactive cycle
("Cyclic references") and won't run. Break it across two cells — the click source and the
highlighted display — with the accumulator in between:

```julia
# once: a persistent accumulator (the Ref survives later cells' re-runs)
picks = Ref(Int[])
```

```julia
# the click source
@bind ev holo(fig, PointInteractable(ax, pts; id = :scatter))
```

```julia
# accumulate clicked indices (acyclic: reads `ev` + the once-init Ref)
selected = begin
    ev === nothing || push!(picks[], ev.index)
    Dict(:scatter => unique!(sort(picks[])))
end
```

```julia
# the display: pre-highlights `selected` on mount (its own bond is unused)
@bind _ holo(fig2, PointInteractable(ax2, pts; id = :scatter); selected = selected)
```

The overlay re-derives highlights from `selected` on every render, so the highlighted
elements survive a re-render without flicker. This is exactly the pattern in
[`examples/demo.jl`](examples/demo.jl) (cells under "Selection round-trip"), which CI runs
headlessly on every change.

## How it works

CairoMakie renders the figure to a PNG; Holo computes a **hit-region manifest** in
Julia (via `Makie.project`) and ships it to the browser with
[`published_to_js`](https://plutojl.org/en/docs/abstractplutodingetjes/). A small
TypeScript overlay (committed as `assets/overlay.js`) mounts a shadow-root layer over the
image, hit-tests pointer events against the manifest, draws highlights/tooltips locally,
and dispatches only deliberate clicks back through `@bind`. Because the image and manifest
are embedded, the **inspection layer keeps working in an exported, offline static HTML**
(only click → recompute needs a live kernel). See [`docs/`](docs) for the full design.

## Development

The browser overlay is TypeScript, bundled to a committed `assets/overlay.js`:

```bash
cd frontend
npm ci
npm run lint && npm run typecheck && npm test   # gate
npm run build                                    # → ../assets/overlay.js
```

CI is the source of truth for the bundle (it rebuilds and commits on `main`), so committing
your local build is optional. Julia tests:

```bash
julia --project -e 'using Pkg; Pkg.test()'
```

Julia code is formatted with [Runic](https://github.com/fredrikekre/Runic.jl) (CI enforces it):

```bash
julia -e 'using Runic; exit(Runic.main(["--inplace", "src", "test"]))'
```

## License

See [LICENSE](LICENSE).
