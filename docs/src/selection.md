# Selection

## Reacting to a click

Every `holo(...)` bond value is `nothing` until a click, then an [`InteractionEvent`](@ref)
with `layer` (the clicked interactable's `id`), `index` (0-based, within that layer), and
`payload`. A cell that reads the bond re-runs on every click:

```julia
@bind ev holo(fig, PointInteractable(ax, pts; id = :scatter))
```

```julia
ev === nothing ? "nothing selected" : "clicked #$(ev.index) in :$(ev.layer)"
```

## Linked selection across plots

Because `layer`/`index`/`payload` are plain data, one click can drive any number of
downstream cells — filter a table, highlight a second plot, recompute a fit. Give the
`payloads` on two interactables the same shape and key on it to link them without any Holo
API:

```julia
rows = ev === nothing ? data : filter(r -> r.id == ev.payload["id"], data)
```

## `selected=` — pre-highlighting on mount

Pass `selected` to any `holo(...)` call to highlight elements the moment the widget mounts,
before any click:

```julia
holo(fig, PointInteractable(ax, pts; id = :scatter); selected = Dict(:scatter => [0, 2]))
```

`selected` is a `layer_id => indices` map. Indices are 0-based and match
`InteractionEvent.index`. Supported kinds: `circles` / `rects` / `polygons` (selected wash)
and `segments` / `polyline` (selected ring). Unsupported kinds (`grid`, `axis`, …) or
out-of-range indices throw `ArgumentError` at build time — fail loud, like a wrong-length
`payloads=`. Keys are layer ids: for the single-layer kinds that's the interactable's `id`,
but [`RegionInteractable`](@ref) splits into suffixed layers (`:id_c` circles / `:id_r` rects
/ `:id_p` polygons) — key on those.

## Persisting a selection across re-renders

The natural next step — feed a widget's own bond value back into its own `selected` — is a
Pluto reactive cycle. Pluto detects it and reports **"Cyclic references"** instead of
running the cell:

```julia
# DOESN'T WORK — ev and holo(...; selected=...) are in the same cell, feeding each other
@bind ev holo(fig, PointInteractable(ax, pts; id = :scatter); selected = Dict(:scatter => [ev.index]))
```

Break the cycle across cells, with a persistent accumulator in between. A `Ref` initialized
in its own cell survives later cells' re-runs without re-initializing:

```julia
# once: a persistent accumulator
picks = Ref(Int[])
```

```julia
# the click source
@bind ev holo(fig, PointInteractable(ax, pts; id = :scatter))
```

```julia
# accumulate clicked indices (acyclic: reads `ev` + the once-init Ref, doesn't read its own output)
selected = begin
    ev === nothing || push!(picks[], ev.index)
    Dict(:scatter => unique!(sort(picks[])))
end
```

```julia
# a second figure of the same data, to display the persisted selection
begin
    fig2 = Figure()
    ax2 = Axis(fig2[1, 1])
    scatter!(ax2, first.(pts), last.(pts))
end
```

```julia
# the display: pre-highlights `selected` on mount; this widget's own bond goes unused
@bind _rt_ignore holo(fig2, PointInteractable(ax2, pts; id = :scatter); selected = selected)
```

The overlay re-derives highlights from `selected` on every render, so the highlighted
elements survive a re-render without flicker. This is exactly the pattern in
[`examples/demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/demo.jl) (cells
under "Selection round-trip"), which CI runs headlessly on every change.

## Multi-element selectors

[`ROIInteractable`](@ref) is an [`AbstractSelector`](@ref): pair it with a
`selects = :scatter` keyword pointing at another layer, and its drag box selects every
element of `:scatter` it currently encloses, rather than the single `{layer, index}` an
ordinary click reports. `selects` only works when the target layer is a `circles` or `grid`
kind — i.e. built from [`PointInteractable`](@ref) or the grid form of
[`RectInteractable`](@ref) — pointing it at any other kind fails loud. The bond value becomes
a `Vector{InteractionEvent}` — one entry per enclosed point — instead of a single
`InteractionEvent`:

```julia
begin
    scatter!(ax, first.(pts), last.(pts))
    roi = ROIInteractable(ax; bounds = (0.0, 10.0, 0.0, 10.0), selects = :scatter)
end
```

```julia
@bind picked holo(fig, [PointInteractable(ax, pts; id = :scatter), roi])
# picked isa Vector{InteractionEvent} once you release a drag over some points
```

See [`gallery/gallery.jl`](@ref Examples)'s "Box-select scatter" recipe for the full worked
example. If you're building a custom interaction that should report more than one element
per event the same way, see [`AbstractSelector`](@ref) on the [API Reference](@ref) page for
the extension point.
