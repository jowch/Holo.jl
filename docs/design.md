# Holo.jl — Design Notes

> Distilled from the brainstorming conversation in `../pluto-makie-interactive-plots.md`.
> Status: **core architecture validated by spike** (2026-06-26). See `research-findings.md`
> for the desk research and `../spike/` for the working proof.

## 0. Validated by spike (2026-06-26)

A working end-to-end spike (`../spike/`) proved the load-bearing claims in real Pluto:

- **Projection math is pixel-accurate** (`spike/projection_check.jl`): at `px_per_unit=2.0`,
  all data points project onto their rendered markers via `update_state_before_display!` →
  `Makie.project(ax.scene, pt)` → `+ viewport.origin` → `× px_per_unit` → y-flip.
- **Single-cell two-way `@bind` works**: clicking a point set `sel` in Julia (one cell, no server).
- **No flicker**: the click did **not** re-render the `@bind` cell — the image DOM node survived;
  the highlight was drawn in the JS overlay. The corrected stateless-frontend model (§5) is right
  and sufficient — no `window` cache or `persist_js_state` needed for the basic loop.
- **CSS-scaled coordinates handled**: image shown at 680px (natural 1200px, scale 1.765); hit-test
  via `scale = naturalWidth/rect.width` landed exactly on the marker.
- **Hover stays client-side**; **clicks on empty space are a no-op** (hit-test miss → no dispatch).

Operational note: opening a notebook cold cost ~6 min because Pluto resolves a *per-notebook*
package env and precompiled the Makie stack fresh. Ship pinned `Project.toml`/`Manifest.toml`
with demo notebooks so users don't pay that on first open.

## 1. Goal

Add click/hover interactivity to **CairoMakie** figures rendered inside
**Pluto.jl** notebooks — tooltips, point selection, region toggles — without
running a parallel server. Everything lives in the notebook process and the
browser. The author (Jonathan) already shipped a one-off version of this
(click image "pixels" → toggle → render box → base64 → HTML canvas → JS event
handler → `@bind` round-trip → Pluto reactivity re-renders). The package
generalizes that hack.

Hard constraints:
- **No parallel server.** Notebook process + browser only.
- **Single cell.** The full interaction (including cleanup) must work from one
  `@bind` cell, not an orchestration of multiple cells.
- **CairoMakie stays the renderer.** This is a deliberate stack preference, not
  a limitation to route around (see Open Question Q0).

## 2. Core architecture (agreed)

Two-layer system:

1. **Base image layer** — CairoMakie renders a static image. The *package* owns
   the render call (DPI, format, size, background), not the user.
2. **Interaction overlay** — a transparent JS/HTML layer on top does all
   hit-testing, hover tooltips, and highlight rendering. **Annotations render in
   JS, never round-trip to Julia for hover.**

Data flow (two streams, asymmetric):
- **Julia → JS, once per render:** a "hit-region manifest" — geometry + payload + style for every
  declared interactable, emitted atomically with the base image so they can never desync. It crosses
  the wire via `published_to_js` as **MsgPack** (not inlined JSON). This manifest — *not* the base64
  PNG — is the scaling wall: O(#hit-elements) (~46 B/element, Float32 geometry) plus O(source-cells)
  for heatmap/image. A realistic plot is 50–400 KB total and render-bound (~65 ms round-trip); high-N
  scatter / large grids reach multi-MB and flip to payload-bound (~553 ms at a 4.78 MB heatmap manifest).
  Measured in `perf-findings.md` — the authoritative source for these numbers; see `architecture.md` §8.
- **JS → Julia, only on deliberate interaction:** clicks/selections via `@bind`
  (`dispatchEvent(new Event('input'))`). Hover never crosses this boundary. The return value
  (`{layer,index,payload}`) is tiny — never a size factor, so multi-select is a contract change, not a
  payload concern.

Division of ownership:
- **Julia owns:** the rendered image + the hit-region manifest (ground truth).
- **JS owns:** ephemeral overlay state (hover, tooltip position, highlight
  toggles, scroll/zoom).
- **Bond value carries:** deliberate events only, never hover.

## 3. Decisions locked in

| Decision | Choice | Rationale |
|---|---|---|
| Interaction model | **Opt-in by declaration.** Only declared elements respond. | Stable bond type (always `InteractionEvent`, never `Nothing`); JS drops out-of-region clicks with zero round-trip; notebook is self-documenting. |
| Click on empty/undeclared space | **No-op, no push.** Want global clicks? Declare the whole axis. | Falls out of opt-in model. |
| Tooltip content | **Julia declares** which elements have tooltips and what they say (pre-serialized into payload). | Avoids round-trip; extensible with JS templates later. |
| Render parameters | **Package owns DPI/format/size/background; ignores user's save settings.** Snapshot the figure so user's object isn't mutated. | Guarantees coordinate correctness; decouples interactive render from save render. |
| Snapshot model | `holo` takes a **one-shot snapshot**. Observable updates require re-calling it (natural in Pluto's reactive graph). | Keeps Julia side stateless. |
| Coordinate sync | Manifest + image emitted **together as one payload**, regenerated every render. `window` cache holds only ephemeral JS state. | No stale-manifest risk. |
| Robustness | **Explicit tier support + graceful degradation.** `validate()` at construction time — fail loud on unsupported configs, never produce plausible-but-wrong manifests. | Silent coordinate mismatch is the worst failure mode. |

## 4. Type hierarchy (proposed)

```julia
abstract type AbstractInteractable end

# Required interface:
hitregions(i::AbstractInteractable)::Vector{HitRegion}   # JS-facing
payload(i::AbstractInteractable, idx::Int)               # what @bind returns
validate(i::AbstractInteractable, fig)::Union{Nothing,String}  # fail-fast check

# Element-level: hit-test in pixel space, return index + payload
struct PointInteractable   <: AbstractInteractable  # Scatter
struct CellInteractable    <: AbstractInteractable  # Heatmap / image pixels
#   ^ grid payload ships the full SOURCE-resolution values[] matrix (O(cells)) to power the
#     (i,j)=value hover — source-bounded, unlike the display-bounded PNG, so a 2000²–4000²
#     heatmap/image reaches tens of MB (4.78 MB at 1000²). Committed fix: ship values[] only when
#     the cell's expected on-screen size (display bounded by the Pluto column) is targetable
#     (≥~1–2 px), else drop → payload {i,j} + @warn; subsumes Image. See architecture.md §8.
struct SegmentInteractable <: AbstractInteractable  # Lines (nearest-segment in JS)

# Axis-level: hit-test = bbox check, returns data-space (x,y)
struct AxisInteractable     <: AbstractInteractable  # whole axis (simplest JS!)

# User-defined: arbitrary declared zones with user payload
struct RegionInteractable   <: AbstractInteractable  # polygon/rect
```

`HitRegion` is the unit of currency Julia↔JS:

```julia
struct HitRegion
    geometry :: HitGeometry      # Circle | Rect | Polygon (image-pixel coords)
    payload  :: Dict{String,Any} # returned to Julia on interaction
    style    :: HitStyle         # tooltip template, cursor, highlight
end
```

`AbstractInteractable → Vector{HitRegion}` happens once at render time.
Everything downstream (JS, serialization, bond value) knows only `HitRegion`.
New backend (e.g. WGLMakie) = implement `hitregions`, nothing else changes.

Bond return type — typed wrapper, not raw dict:

```julia
struct InteractionEvent
    type     :: Symbol             # :click (:hover only if explicitly routed)
    plot_id  :: Symbol            # which interactable
    index    :: Int              # element within it
    metadata :: Dict{String,Any}  # the pre-serialized payload
end
```

**Declaration is the contract; scene inspection is sugar.** `holo(fig, auto=true)`
walks the scene graph and emits a concrete `Vector{AbstractInteractable}` the
user *could have written by hand*. Unknown plot type → skip + warn. Not a
separate code path.

## 5. Single-cell two-way mechanism (the crux) — VERIFIED, framing corrected

**Research (Q1) confirmed the mechanism works but corrected the state model.**
Pluto **replaces** the output DOM via `innerHTML = …` (RawHTMLContainer in
CellOutput.js) on every output re-render — it destroys and recreates child custom
elements. `connectedCallback` fires again, but **arbitrary JS instance state
(variables, listeners, references) is lost.** `persist_js_state` only reattaches
previously-rendered DOM nodes (script-id keyed); it does **not** preserve JS
variable state. So we must **not** architect around a stateful custom element.

The correct model — **frontend is a stateless view:**
- **Authoritative state (selection) lives in Julia**, via @bind round-trips.
- **Transient state (hover, tooltip position) lives in the overlay only between
  renders**, rehydrated each render from `data-*` attributes / `sessionStorage` /
  the @bind value on reconnect.
- Push bond values with the verified pattern: `el.value = payload;
  el.dispatchEvent(new CustomEvent('input'))`. Bond reads `.value` each render
  and forwards on `input`.
- Stable per-cell key: `this.closest('pluto-cell').id` (confirmed stable).

This fits the static-image + overlay architecture naturally: the PNG/SVG is a
static DOM node (tag it with a script id so `persist_js_state` avoids a full
image reload every round-trip), and clicks are the *only* thing that crosses to
Julia. Round-trip for highlight continuity: user clicks → `state` bond updates →
cell re-runs → Julia draws highlights into the new image → new base64. A
`previous = selection` kwarg feeds last selection back so Julia can pre-draw
highlights.

Cleanup (still a priority, but simpler given the stateless model):
- Re-attach listeners on each (re)connect; nothing to persist across renders.
- `ResizeObserver` for scale factor, disconnected on teardown.
- No `window` global cache needed for authoritative state (it lives in Julia);
  use `sessionStorage` keyed by cell id for transient hover state if desired.

Cited basis (verified): Pluto CellOutput.js / Bond.js / Cell.js, PlutoUI
advanced-widgets, AbstractPlutoDingetjes README. See `research-findings.md` Q1.

## 6. Coordinate handling

Because we own the render:
- Render at fixed resolution, embed `{renderWidth, renderHeight}` in manifest.
- `ResizeObserver` computes scale once = `canvas.getBoundingClientRect().width /
  manifest.renderWidth`; re-measures on layout change. Robust to Pluto cell
  padding/version drift — never hardcode cell width.
- HiDPI: render 2×, CSS 1×, hit regions in render-pixel space, JS divides.
- Extract viewports **after `Makie.update_state_before_display!(fig)`** (mandatory
  pre-manifest step — verified Q3) — this is when layout is final. Project with
  `Makie.project(ax.scene, :data, :pixel, point)`. Normalize all coords to
  **output-image-pixel space** inside `build_manifest` by folding in the single
  scalar **`device_scaling_factor`** (= `px_per_unit` for PNG; verified Q4) so DPI
  is invisible downstream. Manifest carries `device_scaling_factor`, `rendertype`,
  and output image dimensions. Resolution is fixed at Screen creation — re-render
  (new Screen) when it changes; never rescale post-render.

Cosmetics (font size, col/rowgap, padding, decorations) need **no** modeling —
`ax.scene.viewport[]` already reflects post-layout result. Exceptions:
`resize_to_layout!` (mitigated by calling `update_state_before_display!`
ourselves) and `pt_per_unit` DPI scaling (fold into manifest).

## 7. PNG vs SVG

| Plot type | Prefer |
|---|---|
| Scatter (small N < ~5k) | SVG (clean hit-test, native coords) |
| Scatter (large N) | PNG (SVG = one element/point) |
| Heatmap | PNG (SVG = one `<rect>`/cell, untenable) |
| Line plots | SVG (paths compact regardless of density) |
| Mixed/unknown | PNG + manifest, SVG overlay for annotations |

SVG buys clean coordinates (`getScreenCTM().inverse()`), no `ResizeObserver` for
coord math, DOM-native highlights without Julia re-render. But CairoMakie SVG is
**path soup** — no per-element IDs, no semantic grouping (**needs verification —
Q2**). So the manifest doesn't disappear; it moves to `viewBox` coords.
SVG size is O(primitives), not O(pixels) — kills dense plots.

**Likely best default: PNG base + SVG overlay** (overlay `viewBox="0 0 1 1"`
normalized; highlights/tooltips toggle in JS, no Julia re-render).

## 8. Robustness tiers

- **Tier 1 (high confidence):** `Axis` linear scales, `Scatter`/`Lines`/`Heatmap`,
  single axis, fixed size, no linking.
- **Tier 2 (tractable, explicit handling):** log scales, `Colorbar`, multiple
  axes, reversed axes, `DataAspect`.
- **Tier 3 (hard):** `PolarAxis`, `Axis3`, `LScene`, `GridLayout` size overrides,
  linked axes.
- **Tier 4 (intractable w/o deep internals):** recipe plot types, custom
  transforms, custom `Block`s, live-mutating Observables.

**v1 scope:** Tier 1 + log scale & multi-axis from Tier 2. Everything else
warns or errors at construction. The Observable snapshot constraint is documented,
not engineered around.

## 9. Proposed API surface

```julia
@bind selection holo(
    fig,                        # re-renders when this changes upstream
    interactables,              # Vector{AbstractInteractable}
    previous = selection,       # feed back for highlight continuity
)
```

## 10. Open questions — RESOLVED by research (see `research-findings.md`)

> Q0–Q4 confirmed; Q1 confirmed with the state-model correction now in §5; Q5
> partly confirmed (throttling is built-in, no debounce needed in Julia; no hard
> payload limits documented — benchmark image size + latency). The remaining
> empirical unknowns move to a **code spike**, not more reading:
> (1) re-render survival of the overlay, (2) click-only round-trip UX,
> (3) ~1px manifest accuracy across px_per_unit/multi-axis, (4) payload/latency
> envelope, (5) SVG primitive-count threshold.
>
> **Update — (4) RESOLVED by the Phase 0 perf spike (`perf-findings.md`).** The manifest, not the
> PNG, is the scaling wall: render-bound below ~1 MB total (~65 ms round-trip), payload-bound above a
> few MB (335 ms scatter-10k → 553 ms heatmap-1000²). Q5's "MsgPack fast-path" was found *not* to
> engage for our manifest (generic maps, not TypedArray). The editor-lag *knee* itself remains
> deliberately unmeasured (only round-trip latency was). See also `architecture.md` §8–§9.
>
> Original questions, for the record:

- **Q0 — Does this need to exist?** Do WGLMakie/Bonito (or GLMakie, or an
  existing package) already provide click/hover interactivity inside Pluto well
  enough that the CairoMakie approach is redundant? What's the real gap?
- **Q1 — Single-cell two-way in Pluto.** Does `AbstractPlutoDingetjes.Bond` +
  custom-element lifecycle actually support stateful two-way in one cell? Does
  Pluto truly replace (not patch) the DOM on re-render? Is `this.closest('pluto-cell').id`
  stable across re-renders? How do PlutoUI widgets actually do this today?
- **Q2 — CairoMakie SVG output structure.** Is it really anonymous path soup, or
  does it carry any group/id structure we could exploit? (Decides PNG-only vs SVG path.)
- **Q3 — Makie projection API surface.** Do `Makie.project(scene, point)`,
  `plot.converted`, `ax.scene.viewport[]`, `ax.finallimits[]`,
  `update_state_before_display!`, `fig.scene.viewport[]` exist and behave as
  assumed across current Makie versions? What's the actual stable API?
- **Q4 — Coordinate / DPI specifics.** How does `pt_per_unit`/`px_per_unit`
  relate scene units to output pixels in CairoMakie? Confirm the fold-in.
- **Q5 — Prior art / patterns.** Any existing Pluto packages doing image+overlay
  interaction we can learn from or reuse (rung 2)?
- **Q6 — Bond payload limits.** Any size/perf limits on `@bind` round-trips that
  constrain how much metadata we ship per event?
