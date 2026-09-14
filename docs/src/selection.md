# Selection

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
[`examples/demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/demo.jl) (cells under "Selection round-trip"), which CI runs
headlessly on every change.

`selected` is a `layer_id => indices` map (e.g. `Dict(:scatter => [0, 2])`). Indices are
0-based and match `InteractionEvent.index`. Supported kinds: `circles` / `rects` /
`polygons` (selected wash) and `segments` / `polyline` (selected ring). Unsupported kinds
(`grid`, `axis`, …) or out-of-range indices throw `ArgumentError` at build time (fail loud,
like wrong-length `payloads=`). Keys are layer ids: for the single-layer kinds that's the
interactable's `id`, but `RegionInteractable` splits into suffixed layers (`:id_c` circles /
`:id_r` rects / `:id_p` polygons) — key on those.
