# Holo.jl

**Light, server-free interactivity for Makie plots in Pluto — the same interactions on either
backend: CairoMakie (static base) by default, or WGLMakie (live base) for animation / large
data / live 3D.**

Holo lays a thin interactive layer over a Makie figure inside a [Pluto](https://plutojl.org)
notebook — hover for tooltips, click to select — and round-trips deliberate clicks to Julia
through `@bind`. The default [`CairoMakie`](https://docs.makie.org/stable/explanations/backends/cairomakie)
backend renders a publication-quality **static** image with a transparent JS overlay doing the
hit-testing (no parallel server, no WebGL). Load [`WGLMakie`](https://docs.makie.org/stable/explanations/backends/wglmakie)
instead and the same `holo`/`@bind` contract drives a **live**, browser-GPU backend for
animation, large/live data, and live 3D. Exactly one backend may be loaded per Pluto session.

> **Status: v0.1.0.** Frozen after drag-to-pan / drag-to-rotate (`ViewInteractable`) and overlay
> visual polish. Validated end-to-end in real Pluto on every supported backend — CairoMakie via
> [`examples/demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/demo.jl), WGLMakie via
> [`examples/webgl_demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/webgl_demo.jl)
> (CI runs both headlessly). `0.1.x` stays additive; breaking changes go to `0.2`.

## Why

| | CairoMakie | WGLMakie | **Holo** |
|---|---|---|---|
| Output | static, publication-quality | live, GPU | static + thin overlay |
| Interactivity | none | rich | light (hover/click) |
| Needs a live Julia process | no | **yes** | only for click → recompute |
| Survives offline / static HTML export | yes | no | **yes** (inspection layer) |

Holo fills the gap: *publication-quality 2D plots with light client-side interactivity,
Pluto-native, no server.* By default (`CairoBackend`) it is **not** a WGLMakie replacement —
static 3D only, no live camera. But `holo` also ships a `:webgl` backend: `using WGLMakie` instead
of `CairoMakie` and the same API gets you live 3D, animation, and large/live data on the client
GPU — see [Backends](@ref).

## Install

```julia
julia> ] add Holo
```

You'll also want `Pluto`, plus a Makie backend: `CairoMakie` for the default static
path, or `WGLMakie` for animation / large data / live 3D — a cost profile, not a
feature fork. Loading both is allowed (`backend=` wins; implicit `holo` defaults to Cairo);
loading neither raises an `ArgumentError`.

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
re-runs downstream cells. Clicks on empty space are a no-op. The tooltip card follows
`prefers-color-scheme` — the same OS/browser signal official Pluto uses (there is no
notebook theme toggle). Pin `tooltip_*` to lock colors. See [Tooltips](@ref).

[`examples/demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/demo.jl) is a
runnable gallery of every kind plus the selection round-trip.

## What's next

- [Interactables](@ref) — declare geometry, or pull it from a `plot!` return value
- [Custom interactions](@ref) — `RegionInteractable` / `FunctionInteractable`
- [Selection](@ref) — persist highlights across Pluto re-renders
- [Tooltips](@ref) — `holo"..."` templates and `tooltip_*` styling
- [Backends](@ref) — `:cairo` (static PNG) vs `:webgl` (live canvas)
- [API](@ref) — `holo`, `InteractionEvent`, `auto_interactables`
