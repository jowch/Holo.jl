# Tooltips

Hovering an element shows a tooltip — purely client-side, no Julia round-trip. The `tooltip`
keyword is accepted by every interactable constructor; its type governs what the browser
renders:

| Value | Type | Browser behaviour |
|---|---|---|
| *(omitted / `nothing`)* | `Nothing` | Auto name/value table built from the payload |
| `holo"..."` | `Markup` | Template interpolated against the hovered element's payload |
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

## `holo"..."` templates

`holo"..."` is a string macro (exported; the underlying macro is `@holo_str`) that
produces a `Markup` value:

```julia
tooltip = holo"<b>$(name)</b> — $(population:,) people"
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
`holo"<em>static label</em>"`. The literal (non-`$()`) portions of the template are raw
HTML — you're responsible for escaping `<` and `&` in literal text, same as `@htl`;
`$(field)` interpolation and the auto-table are always HTML-escaped for you.

Because `holo"..."` requires a string literal, a runtime-computed string has to travel as a
field inside the payload instead:

```julia
begin
    payloads = [(; city, pop, label = "$(city): $(pop) residents") for (city, pop) in data]
    tooltip  = holo"$(label)"   # label is pre-rendered per element in the payload
end
```

### Field check

Two checks catch typos at different times. A malformed template (`$(pop+1)`, an unclosed
`$(`, an unknown d3-format type character) is a `TemplateValidationError` the instant the
cell containing `holo"..."` parses — before `holo()` ever runs. A syntactically valid field
that isn't actually a key in your payload is caught later, when `holo()` builds the
manifest: an `ArgumentError` with a "did you mean?" suggestion for a close misspelling. This
check runs whenever *any* payload in the layer is a `NamedTuple` — checked against the union
of their field names — and is skipped only when none are (e.g. every payload is a `Dict`), in
which case a missing `$(field)` just renders empty at hover instead.

## Styling

### Dark mode is automatic

The built-in tooltip follows the OS/browser `prefers-color-scheme` signal — the same one
stock Pluto uses for its own theme (official Pluto has no in-app light/dark toggle; Settings
→ Dark mode is help text, not a real switch). No author action needed; the tooltip already
matches whatever mode the user's Pluto is in.

### Figure-level overrides

Pin any of these to lock the tooltip's look (this also opts that property out of dark-mode
inversion — the author's deliberate choice):

```julia
holo(fig, interactables...;
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

The underlying `--holo-tip-*` custom properties inherit like any CSS custom property, so
setting one on any ancestor of the cell overrides it without any Julia API:

```html
<style>
main { --holo-tip-bg: #1a1a2e; --holo-tip-color: #e0e0e0; }
</style>
```

See [`architecture.md` §10](https://github.com/jowch/Holo.jl/blob/main/docs/dev/architecture.md)
for the full `--holo-tip-*` reference and the wire format behind all of this.
