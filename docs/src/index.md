# Holo.jl

Holo lays a thin, client-side interactive layer over a Makie figure inside a
[Pluto](https://plutojl.org) notebook: hover shows a tooltip, a click round-trips to Julia
through `@bind`. It renders through [`CairoMakie`](https://docs.makie.org/stable/explanations/backends/cairomakie)
by default (a static, publication-quality image with a transparent JS overlay doing the
hit-testing — no server, no WebGL), or through [`WGLMakie`](https://docs.makie.org/stable/explanations/backends/wglmakie)
for a live, browser-GPU canvas when you need animation, large data, or live 3D — same `holo`/
`@bind` API either way. Load exactly one of the two per Pluto session.

## When to use it

| | CairoMakie alone | WGLMakie alone | **Holo** |
|---|---|---|---|
| Output | static, publication-quality | live, GPU-rendered | static + thin overlay (`:cairo`) or live (`:webgl`) |
| Interactivity | none | rich (pan/zoom/rotate) | light: hover tooltips, click-to-select, drag-to-pan/threshold/ROI |
| Needs a live Julia process | no | yes | only for click → recompute |
| Survives offline / static HTML export | yes | no | yes (the inspection layer keeps working) |

Reach for Holo when you want a publication-quality static figure that also answers "what's
this point?" on hover and "which one did I click?" in Julia — without standing up a WebGL
scene. Reach for `WGLMakie` directly (no Holo) when you need free-form camera control, live
data updates, or interactions Holo doesn't model (arbitrary rotation without a bond, for
example).

## Install

```julia
julia> ] add Holo
```

You'll also want `Pluto`, plus a Makie backend: `CairoMakie` for the default static path, or
`WGLMakie` for animation / large data / live 3D. Loading both is allowed (`backend=` wins;
implicit `holo` defaults to Cairo); loading neither raises an `ArgumentError`.

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

Hovering shows a tooltip (purely client-side, no Julia round-trip); clicking sets `sel` and
re-runs downstream cells. Clicks on empty space are a no-op.

## Where to go next

- [Getting started](@ref) — a slower walkthrough: explicit vs. zero-config, choosing a
  backend, what a bond value looks like
- [Interactables](@ref) — every built-in kind, its constructor, and its default payload
- [Selection](@ref) — reacting to clicks, linking plots, persisting a highlight
- [Tooltips](@ref) — `holo"..."` templates and styling
- [Custom interactions](@ref) — `RegionInteractable` / `FunctionInteractable`
- [Backends](@ref) — `:cairo` vs `:webgl`, and when to reach for which
- [Troubleshooting](@ref) — common errors and what causes them
- [Examples](@ref) — every runnable notebook in the repo
- [API Reference](@ref) — full docstrings
