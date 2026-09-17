# Tooltips

Hovering an element shows a tooltip — purely client-side, no Julia round-trip. The `tooltip`
keyword is accepted by the element-kind constructors — [`PointInteractable`](@ref),
[`SegmentInteractable`](@ref), [`RectInteractable`](@ref), [`PolygonInteractable`](@ref),
[`TextInteractable`](@ref), [`RegionInteractable`](@ref) — but not by the whole-axis or drag
kinds (`AxisInteractable`, `ColorbarInteractable`, `ThresholdInteractable`, `ROIInteractable`,
`ViewInteractable`) or by `FunctionInteractable`; see [Interactables](@ref) for the full
breakdown. Its type governs what the browser renders:

| Value | Type | Browser behaviour |
|---|---|---|
| *(omitted / `nothing`)* | `Nothing` | Auto name/value table built from the payload |
| `masque"..."` | `Markup` | Template interpolated against the hovered element's payload |
| `false` | `Bool` | Tooltip suppressed entirely — the hover highlight still applies |

## The default: an auto-table

When `tooltip` isn't set, the browser renders a name/value table straight from the element's
payload — every field name and value, HTML-escaped:

```julia
PointInteractable(ax, pts; payloads = [(; city = "Lyon", pop = 513_000)])
# hovering shows a two-row table: city → Lyon, pop → 513000
```

```julia
PointInteractable(ax, pts; payloads = [...], tooltip = false)
```

## `masque"..."` templates

`masque"..."` is a string macro (exported; the underlying macro is `@masque_str`) that
produces a `Markup` value:

```julia
tooltip = masque"<b>$(name)</b> — $(population:,) people"
```

`$(field)` is a placeholder resolved in the browser from the hovered element's payload entry
at hover time — it does **not** read a Julia variable, and there is no Julia-object
interpolation in templates.

| Syntax | Meaning |
|---|---|
| `$(field)` | Value of payload field `field`; HTML-escaped |
| `$(field:spec)` | Same, formatted by a [d3-format](https://d3js.org/d3-format) `spec` before escaping |
| `` \$ `` | Literal dollar sign |

A fixed label with no placeholders is a template with no `$()` at all:
`masque"<em>static label</em>"`. The literal (non-`$()`) portions of the template are raw
HTML — you're responsible for escaping `<` and `&` in literal text, same as `@htl`;
`$(field)` interpolation and the auto-table are always HTML-escaped for you.

Because `masque"..."` requires a string literal, a runtime-computed string has to travel as a
field inside the payload instead:

```julia
begin
    payloads = [(; city, pop, label = "$(city): $(pop) residents") for (city, pop) in data]
    tooltip  = masque"$(label)"   # label is pre-rendered per element in the payload
end
```

### Field check

Two checks catch typos at different times. A malformed template (`$(pop+1)`, an unclosed
`$(`, an unknown d3-format type character) is a `TemplateValidationError` the instant the
cell containing `masque"..."` parses — before `masque()` ever runs. A syntactically valid field
that isn't actually a key in your payload is caught later, when `masque()` builds the
manifest: an `ArgumentError` with a "did you mean?" suggestion for a close misspelling. This
check runs whenever *any* payload in the layer is a `NamedTuple` — checked against the union
of their field names — and is skipped only when none are (e.g. every payload is a `Dict`), in
which case a missing `$(field)` just renders empty at hover instead.

## Styling

### Dark mode follows the figure

The built-in tooltip's light/dark theme is derived from **the figure's own background
colour** — not just the OS/browser `prefers-color-scheme` signal (the one stock Pluto uses for
its own theme; official Pluto has no in-app light/dark toggle). No author action needed: a
`Figure(backgroundcolor = :gray12)` on an otherwise-light Pluto page gets a dark tooltip, and a
default white figure on a dark OS gets a light one — the tooltip matches the plot it's
attached to.

This uses CSS relative-colour syntax (`lch(from …)`); browsers without it (older than
~2023) fall back to the previous behaviour — a static light tooltip, dark only via OS
`prefers-color-scheme` — automatically, no author action needed either way.

### Accent colour

When Masque can resolve the hovered element's own colour (currently: a `scatter!` plot's
`color=`, uniform or colormapped), the tooltip gets a 3px accent border in that colour — the
tooltip text itself stays neutral. Nothing to opt into; it's omitted (a plain 1px border, same
as the other three sides) whenever the colour can't be resolved.

### Figure-level overrides

Pin any of these to lock the tooltip's look (this also opts that property out of dark-mode
inversion — the author's deliberate choice):

```julia
masque(fig, interactables...;
    tooltip_bg        = nothing,   # background  — CSS string or Makie color (:dodgerblue, RGBf(...))
    tooltip_color     = nothing,   # text color  — CSS string or Makie color
    tooltip_accent    = nothing,   # accent (emphasis / links)
    tooltip_font      = nothing,   # font-family — String
    tooltip_font_size = nothing,   # Real → appended with "px"
    tooltip_radius    = nothing,   # Real → appended with "px"
    tooltip_caret     = true,      # Bool — draw the caret pointing at the hovered element
)
```

`nothing` (the default for every kwarg except `tooltip_caret`) means "use the built-in
default"; only the kwargs you actually set change anything.

### CSS escape hatch

The underlying `--masque-tip-*` custom properties inherit like any CSS custom property, so
setting one on any ancestor of the cell overrides it without any Julia API:

```html
<style>
main { --masque-tip-bg: #1a1a2e; --masque-tip-color: #e0e0e0; }
</style>
```

A few properties are CSS-only — no Julia kwarg sets them, so this is the only way to change
them. `--masque-tip-bg`/`--masque-tip-color`/`--masque-tip-border` no longer have one fixed
light/dark pair of defaults — they're derived from the figure's background (see above) unless
set explicitly here or via a `tooltip_*` kwarg; the "Legacy fallback" column is what a browser
without CSS relative-colour syntax uses instead (static light, dark only via OS
`prefers-color-scheme`):

| Custom property | Legacy fallback (light / dark) | Julia kwarg |
|---|---|---|
| `--masque-tip-bg` | `#ffffff` / `#1e1e1e` | `tooltip_bg` |
| `--masque-tip-color` | `#1a1a1a` / `#e8e8e8` | `tooltip_color` |
| `--masque-tip-border` | `rgba(0,0,0,0.1)` / `rgba(255,255,255,0.15)` | — (CSS only) |
| `--masque-tip-accent` | `#6b7280` | `tooltip_accent` |
| `--masque-tip-font` | `system-ui, -apple-system, sans-serif` | `tooltip_font` |
| `--masque-tip-font-size` | `11px` | `tooltip_font_size` |
| `--masque-tip-radius` | `4px` | `tooltip_radius` |
| `--masque-tip-caret` | `block` (the caret's `display`) | `tooltip_caret` (`false` → `none`) |
| `--masque-tip-padding` | `8px 12px` | — (CSS only) |
| `--masque-tip-shadow` | `0 2px 4px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08)` / `0 2px 4px rgba(0,0,0,0.4), 0 8px 16px rgba(0,0,0,0.3)` | — (CSS only) |
| `--masque-tip-maxwidth` | `320px` | — (CSS only) |
| `--masque-mark-border` | *(unset — plain 1px border)* | — (set automatically from the hovered element's `colors`, see "Accent colour" above) |

### Placement

The tooltip is anchored to the hovered **mark**, not the cursor: it's centred horizontally on
the mark and placed above it with a small gap, so it doesn't sit under the pointer or obscure
neighboring marks. The anchor point depends on the kind:

- circles: the marker's centre; the box sits above its top edge.
- rects (bars): the bar's top-centre.
- segments and polylines: the point on the segment nearest the cursor — the tooltip slides
  along the line as the pointer moves. Keyboard focus (no cursor) uses the segment's midpoint.
- polygons: the centroid, if it lies inside the polygon shape; otherwise the cursor point.
- grid cells (heatmaps): the cell's centre; the box sits above the cell's top edge.
- axis, threshold, ROI, and view (continuous/drag interactions with no discrete mark): the
  cursor position, as before.

If the box would clip the surface's top edge, it flips to sit below the mark instead. If it
would clip a side, it shifts to stay inside the surface and the caret moves with it, so the
caret always points at the anchor even when the box itself isn't centred on it.

### Caret

When `tooltip_caret = true` (the default), a small triangle points from the tooltip toward
the anchor described above. For the mark-anchored kinds the caret sits at the box's bottom
centre (or top centre, when flipped below); for the cursor-following kinds (axis/threshold/
ROI/view) it keeps the previous cursor-relative offset and edge-clamping behavior.

See [`architecture.md` §10](https://github.com/jowch/Masque.jl/blob/main/docs/dev/architecture.md)
for the wire format behind all of this.
