# Holo.jl — Template system and tooltips

> The `holo"..."` / `Markup` template system. Tooltips are its first consumer; the
> mechanism generalises to any surface that overlays structured content on hover
> (labels, annotations, panels). `architecture.md` covers the overall manifest contract
> and payload-size analysis; `perf-findings.md` is the single source of bundle and
> payload-size numbers.

## 1. Mental model

Every Holo interactable carries a `payloads` array — one JSON-serialisable value per
element, built at render time in Julia. **The payload is data; the template is layout.**
When the user hovers over an element, the browser reads that element's payload entry
and interpolates it into the template to produce the tooltip HTML — no round-trip to
Julia, no live callback.

This architecture is forced by the no-server constraint: a statically-exported Holo
widget has no Julia kernel to call. Any content the tooltip shows must already be in
the manifest at render time, either as a template (O(1) per layer) or as data in the
payload (O(N) per element, the same O(N) the interactable already ships for
hit-testing). A per-element callback (`tooltip = p -> @htl"..."`) would require either
a live kernel or pre-calling it for every element at build time — the former is
unavailable offline, the latter collapses into a per-element string array and is O(N ×
string-bytes) on the wire. The template approach avoids both.

## 2. The `holo"..."` macro and `Markup` type

`holo"..."` is a string macro (exported; underlying function `@holo_str`) that produces
a `Holo.Markup` value. It is the only way to author a template; there is no
`holo(runtime_string)` form.

```julia
tooltip = holo"<b>$(name)</b> — $(population:,) people"
```

`Markup` stores the parsed template as an ordered list of segments: each segment is
either a literal `String` (emitted verbatim as HTML into the tooltip) or a
`Field(name::Symbol, spec::Union{Nothing,String})` (a placeholder resolved in the
browser from the hovered element's payload entry).

### Syntax

| Syntax | Meaning |
|---|---|
| `$(field)` | Value of payload field `field`; HTML-escaped at hover time |
| `$(field:spec)` | Same, formatted by [d3-format](https://d3js.org/d3-format) `spec` before escaping |
| `` \$ `` | Literal dollar sign |

`$(field)` **does not read a Julia variable** — it is a placeholder for a browser-side
payload lookup resolved at hover time. There is no Julia-object interpolation in
templates.

A fixed label with no placeholders is a template with no `$()` at all:
`holo"<em>static label</em>"`. The same `Markup` mechanism handles both.

### Literal HTML in the template

The literal portions of `holo"..."` are treated as raw HTML; the author is responsible
for escaping `<` and `&` in literal text (same contract as `@htl`). The common safe
paths — the auto-table default and `$(field)` interpolation — are both HTML-escaped by
the browser. The macro may warn on a suspicious bare `<` in a literal segment as a
courtesy, but it is not an error.

### Runtime-computed content

Because `holo"..."` requires a string literal, a runtime-computed string must travel as
a field inside the payload:

```julia
payloads = [(; city, pop, label = "$(city): $(pop) residents") for (city, pop) in data]
tooltip  = holo"$(label)"   # label is pre-rendered per element in the payload
```

This adds one small string per element — acceptable, because the payload is already
O(N).

## 3. Validation

Template validation happens at two distinct points. The **documented boundary** between
them is: *Julia validates structure; the browser validates meaning.*

### Phase 1 — macro-expansion (structural, no payload)

The macro parses the template string at compile time and catches:
- Unbalanced, empty, or unclosed `$(...)` delimiters (bare `$`, `$()`, unclosed `$(`)
- Non-identifier field names (`$(pop+1)` is rejected)
- Structurally-invalid d3-format specs (`$(x:.2z)` — unknown type `z` — is rejected)

Errors surface as `TemplateValidationError` with a caret underline pointing at the
offending span, attached to the source file and line of the `holo"..."` call. The user
sees them the instant the cell parses, before `holo()` is ever called.

### Phase 2 — build-time field check (payload-aware)

When `holo()` / `build_manifest` is called with a `Markup` tooltip, each template's
field names are resolved against the actual payload keys. A field present in the
template but absent from the payload is a build-time `ArgumentError`, with a
"did you mean?" suggestion (Levenshtein edit distance ≤ 2).

### The spec-validation boundary

d3-format spec *structure* (the type character and arrangement of flags) is validated
in Julia against d3's canonical grammar; the *meaning* of precision, trim, and sign
modifiers is only resolved by the browser's `format()`:

```julia
holo"$(x:.2c)"   # passes Julia (.2 is structurally valid); browser ignores precision on 'c'
holo"$(x:~d)"    # passes Julia; trim (~) is a no-op on integers in d3-format
```

When a format does not produce the expected output, check d3-format's behaviour for
that type character — the spec was accepted structurally but its meaning is a
browser-side concern.

### Deferred: compile-time check

A `@generated` check to surface field typos before `build_manifest` is deferred (it
requires concretely-typed `NamedTuple` payloads and is a no-op on `Vector{Any}` /
heterogeneous payloads). Build-time field validation runs when the layer's payloads are
`NamedTuple`s (the default for the built-in interactables). For `Dict`-valued or
heterogeneous payloads, the build-time check is skipped — a missing `$(field)` renders
empty at hover rather than raising at build.

`:grid` (heatmap/image) layers carry no per-element payload; a template there resolves the
fields **`$(i)`, `$(j)`, and `$(value)`** synthesised from the hovered cell. Those references
are likewise not field-validated at build (a typo renders empty at hover).

## 4. Tooltip content — defaults and suppress

The `tooltip` keyword is accepted by every interactable constructor. Its type governs
the browser's rendering path:

| Value | Type | Browser behaviour |
|---|---|---|
| *(omitted / `nothing`)* | `Nothing` | Auto name/value table built from the payload |
| `holo"..."` | `Markup` | Template interpolated against the hovered element's payload |
| `false` | `Bool` | Tooltip suppressed entirely |

### Auto-table default

When `tooltip` is not set, the browser generates a name/value table from the element's
payload dict. All field names and values are HTML-escaped. The table is styled with the
same defaults as custom templates. This generalises the per-surface `(i,j)=value`,
`x=,y=`, and JSON-dict readouts from earlier versions into one uniform client-side
renderer over `payloads[i]`.

### Suppress

```julia
PointInteractable(ax, pts; payloads = [...], tooltip = false)
```

The tooltip panel is not shown on hover. The hover highlight still applies.

## 5. Styling system

Three layers of control; most users never leave the first.

### Layer 1 — zero-config default

The built-in CSS produces an NYT-clean card: light background, dark text, rounded
corners, a drop shadow, and a small CSS triangle (caret) pointing toward the hovered data point. A
`prefers-color-scheme: dark` media query inverts the card automatically. No author
action required.

### Layer 2 — `tooltip_*` kwargs on `holo()`

Figure-level style overrides are keyword arguments to `holo()`:

```julia
holo(fig, interactables...;
    tooltip_bg        = nothing,   # background  — CSS string or Makie color (:dodgerblue, RGBf(…))
    tooltip_color     = nothing,   # text color  — CSS string or Makie color
    tooltip_accent    = nothing,   # accent (emphasis / links)
    tooltip_font      = nothing,   # font-family — String
    tooltip_font_size = nothing,   # Real → appended with "px"
    tooltip_radius    = nothing,   # Real → appended with "px"
    tooltip_caret     = true,      # Bool — draw the caret (default: true)
)
```

`nothing` is the default for every styling kwarg and means "use the built-in default." (`tooltip_caret` is the exception: it defaults to `true` and takes a `Bool` — pass `false` to drop the caret.) Julia emits a
`--holo-tip-*` CSS custom property **only** for kwargs the user explicitly sets. Unset
kwargs resolve to the locked-in defaults via `var(--holo-tip-*, <default>)` fallbacks
in the overlay CSS, leaving the dark-mode variant untouched. An explicitly set kwarg
pins that variable, overriding dark mode — the author's deliberate choice. Makie colors
are converted to CSS hex; numeric sizes get `"px"` appended.

Set kwargs are collected into a single top-level manifest field `tipStyle` (a CSS-var
dict) and applied once to the shadow host at mount — O(1) cost for the whole figure,
independent of element count.

### Layer 3 — CSS escape hatch

CSS custom properties inherit across shadow DOM boundaries. A power user can set
`--holo-tip-*` from a Pluto `<style>` cell without any Julia API:

```html
<!-- in a Pluto HTML cell -->
<style>
  :root { --holo-tip-bg: #1a1a2e; --holo-tip-color: #e0e0e0; }
</style>
```

The overlay CSS uses `var(--holo-tip-*, <locked-default>)` throughout, so any custom
property set on an ancestor element takes effect.

### Caret

When `tooltip_caret = true` (the default), a speech-bubble tail is drawn between the
card and the hovered data point. The caret is a fixed CSS triangle (`::before`)
pointing toward the hovered point; the card is offset from the cursor by a fixed
translate and is not clamped to the figure bounds.

### `--holo-tip-*` custom property reference

| Custom property | Light default | Dark default | Julia kwarg |
|---|---|---|---|
| `--holo-tip-bg` | `#ffffff` | `#1e1e1e` | `tooltip_bg` |
| `--holo-tip-color` | `#1a1a1a` | `#e8e8e8` | `tooltip_color` |
| `--holo-tip-accent` | `#6b7280` | *(same)* | `tooltip_accent` |
| `--holo-tip-font` | `system-ui, -apple-system, sans-serif` | *(same)* | `tooltip_font` |
| `--holo-tip-font-size` | `11px` | *(same)* | `tooltip_font_size` |
| `--holo-tip-radius` | `4px` | *(same)* | `tooltip_radius` |
| `--holo-tip-caret` | `block` (the caret's `display`) | *(same)* | `tooltip_caret` (`false` → `none`) |
| `--holo-tip-padding` | `8px 12px` | *(same)* | — (CSS only) |
| `--holo-tip-border` | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.15)` | — (CSS only) |
| `--holo-tip-shadow` | `0 2px 4px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08)` | `0 2px 4px rgba(0,0,0,0.4), 0 8px 16px rgba(0,0,0,0.3)` | — (CSS only) |
| `--holo-tip-maxwidth` | `320px` | *(same)* | — (CSS only) |

## 6. Wire format

This section documents the manifest fields introduced by M2.3. See `architecture.md`
for the overall manifest contract, geometry layout by kind, and the payload-scaling
analysis (`perf-findings.md` is the single source for size numbers).

### Per-layer fields

Each entry in the manifest `layers` array carries at most one of these two optional
fields:

| Field | Wire type | Present when |
|---|---|---|
| `template` | `Segment[]` | `tooltip` is a `Markup` |
| `tooltip` | `false` | suppress requested |
| *(neither present)* | — | auto-table default |

`Segment` is `string \| { f: string, spec?: string }` — a literal run or a field
placeholder. The template is **pre-parsed in Julia** at build time and shipped as
structured data; the browser never re-parses a template string.

The per-element `tooltips[]` string array that earlier versions emitted is **retired**.
Tooltip content is now entirely client-side, rendered on hover from the existing
`payloads[i]` entry. This keeps the tooltip wire cost O(1) per layer regardless of
element count; the per-element envelope is unchanged (see `perf-findings.md` §"Scope
bounds for downstream phases" for the measured comparison).

### Top-level manifest field

| Field | Wire type | Purpose |
|---|---|---|
| `tipStyle` | `Record<string,string>` (optional) | CSS-var dict of set `tooltip_*` kwargs; applied once to the shadow host at mount |

### TypeScript mirrors

`HitLayer` carries `template?: TemplateSegment[]` and `tooltip?: false`; `Manifest`
carries `tipStyle?: Record<string, string>`. The retired `tooltips?` field is removed
from both. See `frontend/src/types.ts`.

## 7. Security model

**Template markup is author-trusted.** The literal HTML in `holo"..."` is inserted as
`innerHTML` without sanitisation. The author who writes a Pluto notebook already has
arbitrary Julia code execution, so sanitising their own template structure is theater
(and a sanitisation library such as DOMPurify adds ~8–15 KB gzip for no real benefit
in this context). A `<script>` tag in a literal template segment executes — this is
expected for authors who intentionally embed scripts in their tooltips.

**Interpolated data is escaped by default.** Every value resolved from `$(field)` and
every cell in the auto-table is HTML-escaped with the OWASP five-character set
(`& < > " '`) before insertion. A dataset value containing `<script>alert(1)</script>`
renders as inert literal text in the tooltip card.

**URL-context caveat.** HTML escaping does not neutralise scheme injection. If `$(x)`
is used as a *whole* `href` or `src` attribute value and the data contains a
`javascript:` URL, the scheme survives escaping and can execute. This is relevant once
a `$(field:raw)` or link-insertion feature ships, or if an author constructs an
`<a href="$(x)">` template over untrusted URL data — author responsibility in that
case.

## 8. Deferred / forward path

The following capabilities were considered for M2.3 and intentionally deferred. None
require breaking changes to add.

| Capability | Status | Forward path |
|---|---|---|
| Per-element function tier (`tooltip = p -> @htl"..."`) | **Cut** — O(N) build footgun; per-element *values* belong in the payload | Partially covered by `$(field:raw)` (below) |
| `$(field:raw)` — unescaped field interpolation | Deferred | Explicit opt-in marker (Bokeh `{safe}`-style); pre-render HTML into a payload field, inject unescaped |
| Per-layer `tooltip_*` style override | Deferred | Non-breaking kwarg on the per-layer interactable constructor |
| Compile-time field validation (`@generated`) | Deferred | No-op on heterogeneous payloads; build-time Phase 2 runs for `NamedTuple` payloads |
| Caret edge-flipping / viewport-collision clamping | Deferred | Keep card inside viewport bounds on figure edges; auto-flip caret |
| Inline date formatting | Deferred (would add `d3-time-format`) | Format dates in Julia into a payload string field |
| Following Pluto's own dark-mode toggle | Deferred | Pluto exposes no stable JS event for this; `prefers-color-scheme` is the correct current default |
