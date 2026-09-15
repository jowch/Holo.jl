# Getting started

This walks through the same three steps as the [Home](@ref) quick start, slower, and covers
the two ways to tell Holo what's clickable.

## 1. A figure, like any other

Nothing Holo-specific yet:

```julia
using CairoMakie

fig = Figure()
ax = Axis(fig[1, 1])
scatter!(ax, [1.0, 2.0, 3.0], [1.0, 4.0, 9.0])
fig
```

## 2. `holo(fig)` — zero-config

Load `Holo` and call `holo(fig)` instead of just showing `fig`. Holo walks the figure, finds
every plot it knows how to introspect (`scatter!`, `lines!`, `heatmap!`, `barplot!`, …), and
overlays hit-testing for all of them automatically — no interactable to write:

```julia
using Holo

@bind ev holo(fig)
```

This is the fastest way to get *something* clickable. `ev` is the bond value: `nothing`
until you click a marker, then an [`InteractionEvent`](@ref). Unsupported plot types are
skipped with a `@warn`, not an error.

## 3. Explicit interactables — when you want control

Zero-config is sugar over an explicit vector of interactables. Building it yourself gets you
custom `payloads`, a chosen `id`, and non-default styling:

```julia
pts = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0)]
labels = ["a", "b", "c"]
scatter!(ax, first.(pts), last.(pts))

@bind ev holo(fig, [PointInteractable(ax, pts; id = :points, payloads = labels)])
```

Every built-in kind, its constructor, and its default payload are on the
[Interactables](@ref) page. You can also start from `auto_interactables(fig)` (the same
vector `holo(fig)` builds internally), tweak it, and pass it back — see
[Zero-config: `holo(fig)`](@ref).

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

Holo doesn't have a `backend` package to install separately — it picks its backend from
whichever Makie package you `using`:

```julia
using Holo, CairoMakie   # :cairo — static PNG + overlay (the default)
```

```julia
using Holo, WGLMakie      # :webgl — live browser-GPU canvas
```

Everything above (`holo`, `@bind`, `InteractionEvent`, every interactable) is identical on
both — see [Backends](@ref) for when to reach for which. Loading neither raises an
`ArgumentError` the first time you call `holo`; loading both is fine (`backend=` picks one
explicitly, and an unqualified `holo` call defaults to `:cairo`).
