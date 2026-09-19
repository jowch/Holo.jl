# Legend

[`LegendInteractable`](@ref) turns a `Makie.Legend`'s entries into hit regions that link back
to the plot(s) they label: hovering an entry highlights the linked trace(s), and clicking
fires the usual bond.

## Auto extraction

`masque(fig)` picks up any `Legend` the same way it picks up a `Colorbar` — no extra call
needed:

```julia
begin
    fig = Figure()
    ax = Axis(fig[1, 1])
    lines!(ax, xs, ys1; label = "a")
    lines!(ax, xs, ys2; label = "b")
    axislegend(ax)
end
```

```julia
@bind ev masque(fig)   # entry "a" hovers/clicks -> :lines; "b" -> :lines_2
```

The link is resolved from `Makie.get_plots` on each entry's elements — the same linkage
Makie's own click-to-toggle legend uses — so it works for any auto-generated legend
(`axislegend`, `Legend(fig, ax)`, `merge = true`, duplicate labels, …) with no extra
configuration. An entry whose plot became a layer kind that can't be highlighted (currently
just heatmap/image `:grid` — see [Selection](@ref) for the full `selected=`-able kind list)
is dropped from the auto path with a warning, rather than failing the whole build.

## Hovering and clicking

Hovering a legend entry highlights every element of the layer(s) it links to, using the same
wash/ring recipe as `selected=` (see [Selection](@ref)). Clicking reports the usual
[`InteractionEvent`](@ref), `layer = :legend` (or `:legend_2`, … for a second legend),
`payload = (; label, group, targets)` — `targets` is the list of layer ids (as strings) the
entry links to, `group` is the entry's group title (`nothing` for an ungrouped legend).

```julia
ev === nothing ? "hover/click a legend entry" : "linked layers: $(ev.payload["targets"])"
```

## Custom legends

A legend built from bare `LineElement`/`MarkerElement`/`PolyElement` has nothing to
auto-link — those elements carry no plot reference unless you give them one. Two ways to
supply the link:

```julia
# Makie's own kwarg: pass the plot the element stands for
LineElement(color = :red, plots = some_plot)
```

```julia
# or tell LegendInteractable directly, keyed by entry label
LegendInteractable(leg; targets = Dict("a" => :lines, "b" => [:lines_2, :scatter]))
```

`targets` also accepts a `Vector` — one entry per legend entry, in order (top-to-bottom,
matching a titled/grouped legend's flattened `entrygroups`) — `Symbol`/`Vector{Symbol}`/
`nothing`. A `Dict` key matching no entry label, a wrong-length `Vector`, or (either form) a
target naming an unknown layer or an unselectable kind raises `ArgumentError` at build time —
unlike the auto path above, an explicit `targets=` is the caller's own claim, so a bad one
fails loud rather than being dropped.

A legend with no links at all is still fully usable — the entry is hittable, its tooltip
shows the label, and a click still fires; it just highlights nothing.

## Tooltip

The default tooltip is just the entry's label (`masque"$(label)"`); pass your own
`masque"..."` template (fields: `label`, `group`, `targets`) or `tooltip = false` to suppress
it, same as any other interactable — see [Tooltips](@ref).
