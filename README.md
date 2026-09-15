# Holo.jl

[![CI](https://github.com/jowch/Holo.jl/actions/workflows/CI.yml/badge.svg)](https://github.com/jowch/Holo.jl/actions/workflows/CI.yml)
[![codecov](https://codecov.io/gh/jowch/Holo.jl/branch/main/graph/badge.svg)](https://codecov.io/gh/jowch/Holo.jl)
[![Docs stable](https://img.shields.io/badge/docs-stable-blue.svg)](https://jowch.github.io/Holo.jl/stable)
[![Docs dev](https://img.shields.io/badge/docs-dev-blue.svg)](https://jowch.github.io/Holo.jl/dev)

**Light, server-free interactivity for Makie plots in Pluto — the same interactions on either
backend: CairoMakie (static base) by default, or WGLMakie (live base) for animation / large
data / live 3D.** Holo lays a thin JS overlay over a Makie figure — hover for tooltips, click
to select — and round-trips deliberate clicks to Julia through `@bind`.

## When to use it

| | CairoMakie alone | WGLMakie alone | **Holo** |
|---|---|---|---|
| Output | static, publication-quality | live, GPU-rendered | static + thin overlay (`:cairo`) or live (`:webgl`) |
| Interactivity | none | rich | light: hover tooltips, click-to-select, drag gestures |
| Needs a live Julia process | no | yes | only for click → recompute |
| Survives offline / static HTML export | yes | no | yes on `:cairo` (verified); `:webgl` not verified |

## Install

```julia
julia> ] add Holo
```

You'll also want `Pluto`, plus a Makie backend: `CairoMakie` for the default static path, or
`WGLMakie` for animation / large data / live 3D.

## Quick start

In a Pluto notebook:

```julia
begin
    using Holo, CairoMakie

    # your figure, as usual
    fig = Figure()
    ax = Axis(fig[1, 1])
    pts = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0)]
    scatter!(ax, first.(pts), last.(pts))
end
```

```julia
# declare what's interactable, bind the result
@bind sel holo(fig, [PointInteractable(ax, pts; payloads = ["a", "b", "c"])])
```

```julia
# react to clicks — `sel` is `nothing` until a click, then an InteractionEvent
sel === nothing ? "click a point" : "you picked $(sel.payload)"
```

(Each fenced block above is its own Pluto cell — Pluto allows one top-level expression per
cell, so multi-statement setup goes in `begin ... end`.)

## Read the docs

The full site — getting started, every interactable, tooltips, custom interactions,
backends, troubleshooting, and the API reference — is at
**[jowch.github.io/Holo.jl](https://jowch.github.io/Holo.jl)**.

See [`examples/`](examples/) for runnable Pluto notebooks covering the same ground.

## License

See [LICENSE](LICENSE).
