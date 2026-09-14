# Tooltips

Hover shows a tooltip (purely client-side, no Julia round-trip). The tooltip card follows
`prefers-color-scheme` — the same OS/browser signal official Pluto uses (there is no
notebook theme toggle). Pin `tooltip_*` to lock colors.

The `tooltip` keyword is accepted by every interactable constructor. Its type governs
the browser's rendering path:

| Value | Type | Browser behaviour |
|---|---|---|
| *(omitted / `nothing`)* | `Nothing` | Auto name/value table built from the payload |
| `holo"..."` | `Markup` | Template interpolated against the hovered element's payload |
| `false` | `Bool` | Tooltip suppressed entirely |

When `tooltip` is not set, the browser generates a name/value table from the element's
payload dict. All field names and values are HTML-escaped.

```julia
PointInteractable(ax, pts; payloads = [...], tooltip = false)  # hover highlight, no card
```

## `holo"..."` templates

`holo"..."` is a string macro that produces a `Markup` value. `$(field)` is a placeholder
for a browser-side payload lookup at hover time — it does **not** read a Julia variable.

```julia
tooltip = holo"<b>$(name)</b> — $(population:,) people"
```

| Syntax | Meaning |
|---|---|
| `$(field)` | Value of payload field `field`; HTML-escaped at hover time |
| `$(field:spec)` | Same, formatted by [d3-format](https://d3js.org/d3-format) `spec` before escaping |
| `` \$ `` | Literal dollar sign |

A fixed label with no placeholders is a template with no `$()` at all:
`holo"<em>static label</em>"`.

Literal portions of `holo"..."` are treated as raw HTML (same contract as `@htl`).
Interpolated `$(field)` values and the auto-table are HTML-escaped.

Because `holo"..."` requires a string literal, a runtime-computed string must travel as
a field inside the payload:

```julia
payloads = [(; city, pop, label = "$(city): $(pop) residents") for (city, pop) in data]
tooltip  = holo"$(label)"   # label is pre-rendered per element in the payload
```

A field present in the template but absent from the payload is a build-time `ArgumentError`.

## Styling

Official Pluto has **no notebook light/dark toggle** — Settings → Dark mode is help
text. Pluto's theme CSS uses the same `prefers-color-scheme` query, so the card already
matches stock Pluto. Pin `tooltip_bg` / `tooltip_color` to lock the card.

Figure-level style overrides are keyword arguments to `holo()`:

```julia
holo(fig, interactables...;
    tooltip_bg        = nothing,   # background  — CSS string or Makie color
    tooltip_color     = nothing,   # text color  — CSS string or Makie color
    tooltip_accent    = nothing,   # accent (emphasis / links)
    tooltip_font      = nothing,   # font-family — String
    tooltip_font_size = nothing,   # Real → appended with "px"
    tooltip_radius    = nothing,   # Real → appended with "px"
    tooltip_caret     = true,      # Bool — draw the caret (default: true)
)
```

`nothing` means "use the built-in default." An explicitly set kwarg pins that variable,
overriding dark mode. CSS custom properties (`--holo-tip-*`) also inherit across shadow
DOM boundaries if you set them from a Pluto `<style>` cell.
