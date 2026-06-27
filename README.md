# Holo.jl

[![CI](https://github.com/jowch/Holo.jl/actions/workflows/CI.yml/badge.svg)](https://github.com/jowch/Holo.jl/actions/workflows/CI.yml)

**Light, server-free interactivity for static CairoMakie plots in Pluto.**

Holo lays a thin interactive layer over a static [CairoMakie](https://docs.makie.org/stable/explanations/backends/cairomakie)
figure inside a [Pluto](https://plutojl.org) notebook — hover for tooltips, click to
select — and round-trips deliberate clicks to Julia through `@bind`. No parallel server,
no WebGL: the plot is a publication-quality static image, and a transparent JS overlay
does the hit-testing.

> **Status: early / experimental (v0.1).** The architecture is validated end-to-end in
> real Pluto for scatter points; other plot surfaces are unit-tested but not yet all
> exercised live. APIs may change.

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
- `RegionInteractable` / `FunctionInteractable` — custom interactions, no JavaScript required

Linear, log, and categorical axes; single or multiple axes; linked selection via shared
payloads through Pluto's reactive graph. Out of scope: 3D, `PolarAxis`/`Axis3`, and
high-frequency live redraw (that's WGLMakie's domain).

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
