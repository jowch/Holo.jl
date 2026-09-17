# Keyboard and screen readers

Every overlay is a keyboard-navigable, screen-reader-announced widget — no setup required. Tab
to a plot, then use the keys below to move between its interactive elements.

## Keys

| Key | Moves to |
|---|---|
| → / ↓ | Next element |
| ← / ↑ | Previous element |
| Home / End | First / last element |
| Page Down / Page Up | First element of the next / previous layer |
| Enter / Space | Select the focused element — dispatches the same `@bind` value a click would |
| Escape | Clear focus and leave the plot |

Arrow keys and Home/End stop at the first and last element — they don't wrap around. Only
elements from click- or hover-enabled **element** layers are reachable this way: scatter
points, bars, polygons, lines, and line segments. A heatmap/image cell grid is not — hovering
and clicking still work with a mouse, but a grid can have far more cells than anyone would want
to arrow through one at a time, so keyboard focus skips it. Whole-axis readout and the
draggable threshold/ROI/view-pan interactables are mouse/touch-only in this release (see
[Limitations](@ref accessibility-limitations) below).

Moving focus draws the same highlight ring a mouse hover would (there is never a separate
"focus" look) and shows the same tooltip, positioned on the focused element.

## What gets announced

Screen readers announce each element you land on: an optional layer name, its position within
that layer, and the same content the tooltip shows, as plain text. For example:

```julia
PointInteractable(ax, pts; label = "Scatter", payloads = [(; x = 1.0, y = 4.0)])
```

might announce "Scatter, element 1 of 3: x 1.0, y 4.0". Without `label`, the announcement omits
the prefix: "element 1 of 3: x 1.0, y 4.0".

`label` is a single string per **layer** — set it once on the interactable, not per element.
(Don't confuse it with a `label` *payload* field some examples elsewhere in these docs use for
per-element tooltip data — that's unrelated, ordinary tooltip content.) It's accepted by
[`PointInteractable`](@ref), [`SegmentInteractable`](@ref), [`RectInteractable`](@ref) (the
list form), and [`PolygonInteractable`](@ref) — the same element-kind constructors `tooltip`
is accepted by, minus the kinds keyboard nav doesn't visit.

```julia
masque(fig, [
    PointInteractable(ax, pts; id = :cities, label = "City"),
    RectInteractable(ax; rects = bars, id = :bars, label = "Revenue by quarter"),
])
```

`label` isn't yet threaded through the plot-object constructors (`PointInteractable(ax,
p::Makie.Scatter)`, `RectInteractable(ax, p::Makie.BarPlot)`, and similar) or `masque(fig)`'s
auto-extraction — the same gap `tooltip` has today. Build the interactable explicitly with the
keyword-argument form above to set a label.

## [Limitations](@id accessibility-limitations)

- **Grid layers** (`:grid` — heatmap/image cells) are not keyboard-focusable, for the reasons
  above. They remain fully mouse/touch-interactive.
- **Threshold, ROI, and view-pan drags** have no keyboard equivalent yet — arrow-key nudging
  for these is on the roadmap, not in this release.
- **Screen-reader support for `aria-live` inside a shadow DOM is uneven** across browser/AT
  combinations. If announcements are silent in your setup, the visual focus ring and tooltip
  still work, and file an issue — this is the area most likely to need a fallback (e.g. moving
  the live region out of the shadow root) as real-world testing accumulates.
