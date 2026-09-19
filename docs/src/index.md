# Masque.jl

Masque lays a thin, client-side interactive layer over a Makie figure inside a
[Pluto](https://plutojl.org) notebook: hover shows a tooltip, a click round-trips to Julia
through `@bind`. It renders through [`CairoMakie`](https://docs.makie.org/stable/explanations/backends/cairomakie)
by default (a static, publication-quality image with a transparent JS overlay doing the
hit-testing — no server, no WebGL), or through [`WGLMakie`](https://docs.makie.org/stable/explanations/backends/wglmakie)
for a live, browser-GPU canvas when you need animation, large data, or live 3D — same `masque`/
`@bind` API either way.

## When to use it

| | CairoMakie alone | WGLMakie alone | **Masque** |
|---|---|---|---|
| Output | static, publication-quality | live, GPU-rendered | static + thin overlay (`:cairo`) or live (`:webgl`) |
| Interactivity | none | rich (pan/zoom/rotate) | light: hover tooltips, click-to-select, drag-to-pan/threshold/ROI |
| Needs a live Julia process | no | yes | only for click → recompute |
| Survives offline / static HTML export | yes | no | yes on both (verified — the inspection layer keeps working; on `:webgl` the canvas is redrawn client-side, no server needed) |

Reach for Masque when you want a publication-quality static figure that also answers "what's
this point?" on hover and "which one did I click?" in Julia — without standing up a WebGL
scene. Reach for `WGLMakie` directly (no Masque) when you need free-form camera control, live
data updates, or gestures Masque doesn't wire back to Julia (arbitrary free rotation, for
example).

## Install

```julia
julia> ] add Masque
```

You'll also want `Pluto`, plus a Makie backend: `CairoMakie` for the default static path, or
`WGLMakie` for animation / large data / live 3D — see [Backends](@ref) for what happens if
you load neither or both.

## Quick start

In a Pluto notebook:

```julia
begin
    using Masque, CairoMakie

    # your figure, as usual
    fig = Figure()
    ax = Axis(fig[1, 1])
    pts = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0)]
    scatter!(ax, first.(pts), last.(pts))
end
```

```julia
# declare what's interactable, bind the result
@bind sel masque(fig, [PointInteractable(ax, pts; payloads = ["a", "b", "c"])])
```

```julia
# react to clicks — `sel` is `nothing` until a click, then an InteractionEvent
sel === nothing ? "click a point" : "you picked $(sel.payload)"
```

Hovering shows a tooltip (purely client-side, no Julia round-trip); clicking sets `sel` and
re-runs downstream cells. Clicks on empty space are a no-op.

Each of the three blocks above is a separate Pluto cell — Pluto runs exactly one top-level
expression per cell, so any snippet on this site with more than one statement is wrapped in
`begin ... end` (which counts as one expression) or split across cells the way it's shown
here. Copy each fenced block into its own cell.

Under the hood, `masque(...)` sends the browser a **manifest**: the rendered image plus hit
regions grouped into **layers**, one per interactable, keyed by its `id`. The value a
`@bind`-ed variable holds — `sel` above — is called the **bond** value.

## Where to go next

- [Getting started](@ref) — a slower walkthrough: explicit vs. zero-config, choosing a
  backend, what a bond value looks like
- [Interactables](@ref) — every built-in kind, its constructor, and its default payload
- [Selection](@ref) — reacting to clicks, linking plots, persisting a highlight
- [Legend](@ref) — hover/click a `Makie.Legend` entry to highlight the trace(s) it labels
- [Tooltips](@ref) — `masque"..."` templates and styling
- [Custom interactions](@ref) — `RegionInteractable` / `FunctionInteractable`
- [Backends](@ref) — `:cairo` vs `:webgl`, and when to reach for which
- [Troubleshooting](@ref) — common errors and what causes them
- [Examples](@ref) — every runnable notebook in the repo
- [API Reference](@ref) — full docstrings
