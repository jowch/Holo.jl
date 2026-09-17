# Getting started

This walks through the same three steps as the [Home](index.md) quick start, slower, and covers
the two ways to tell Masque what's clickable.

## 1. A figure, like any other

Nothing Masque-specific yet:

```julia
begin
    using CairoMakie

    pts = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0)]
    fig = Figure()
    ax = Axis(fig[1, 1])
    scatter!(ax, first.(pts), last.(pts))
    fig
end
```

## 2. `masque(fig)` — zero-config

Load `Masque` and call `masque(fig)` instead of just showing `fig`. Masque walks the figure, finds
every plot it knows how to introspect (`scatter!`, `lines!`, `heatmap!`, `barplot!`, …), and
overlays hit-testing for all of them automatically — no interactable to write:

```julia
using Masque
```

```julia
@bind ev masque(fig)
```

This is the fastest way to get *something* clickable. `ev` is the bond value: `nothing`
until you click a marker, then an [`InteractionEvent`](@ref). Unsupported plot types are
skipped with a `@warn`, not an error.

## 3. Explicit interactables — when you want control

Zero-config is sugar over an explicit vector of interactables. Building it yourself gets you
custom `payloads`, a chosen `id`, and non-default styling — on the *same* `fig`/`ax` from
step 1, without plotting `pts` a second time. **Replace** the `@bind ev masque(fig)` cell
above with this — Pluto rejects two cells that both bind `ev`:

```julia
labels = ["a", "b", "c"]
```

```julia
@bind ev masque(fig, [PointInteractable(ax, pts; id = :points, payloads = labels)])
```

Every built-in kind, its constructor, and its default payload are on the
[Interactables](@ref) page. You can also start from `auto_interactables(fig)` (the same
vector `masque(fig)` builds internally), tweak it, and pass it back — see
[Zero-config: `masque(fig)`](@ref).

## 4. A cell that reacts

`@bind` re-runs every cell that reads `ev` whenever the bond value changes:

```julia
ev === nothing ? "click a point" : "you picked $(ev.payload)"
```

Before the first click, `ev` is `nothing`. After a click, `ev` is an
[`InteractionEvent`](@ref):

```julia
struct InteractionEvent
    layer::Symbol   # the interactable's `id`
    index::Int      # 0-based element index within the layer
    payload::Any    # the data you attached
end
```

**The payload comes back as a `Dict`, not the `NamedTuple` (or whatever) you gave it.**
Julia round-trips it through JSON to the browser and back, and JSON has no `NamedTuple`. A
payload you built as `(; label = "a")` arrives as `Dict("label" => "a")` — index it as
`ev.payload["label"]`, not `ev.payload.label`. `AxisInteractable` yields
`Dict("x" => ..., "y" => ...)` the same way.

## 5. Choosing the backend

Masque doesn't have a `backend` package to install separately — it picks its backend from
whichever Makie package you `using`:

```julia
using Masque, CairoMakie   # :cairo — static PNG + overlay (the default)
```

```julia
using Masque, WGLMakie      # :webgl — live browser-GPU canvas
```

Everything above (`masque`, `@bind`, `InteractionEvent`, every interactable) is identical on
both — see [Backends](@ref) for when to reach for which, and what happens if you load
neither or both.
