# M4 — Drag (Tier 0): `ThresholdInteractable`

Design for the first cut of M4's drag capability (roadmap.md §M4, line 51). Scope is one
draggable primitive — a horizontal/vertical **threshold line** — proving the Tier-0 drag
mechanism end to end. ROI box and movable points are deliberately deferred; they reuse the
same mechanism once it is proven.

Grounded in `architecture.md` (the contract; §6 interaction tiers, §3 the interactable seam)
and `roadmap.md` §M4.

## Goal

```julia
@bind thr holo(fig, ThresholdInteractable(ax; orientation = :horizontal, value = 0.5))
```

Drag the line; on mouse-up `thr` becomes an `InteractionEvent` whose `payload` is the
**scalar** data-space coordinate where the line was dropped. Dragging is local at 60 fps with
**no per-frame Julia** (Tier 0); the mouse-up commit is a single `@bind` round-trip.

## Why this fits the existing architecture (no new path)

This is a Tier-0 interaction exactly as `architecture.md` §6 frames it: *"dragging overlay
geometry … enabled by shipping `AxisTransform` to JS."* Everything needed already exists:

- **`AxisTransform` + `invertAxis` (`geometry.ts`)** already invert image-px → data coords for
  any supported scale. The drag readout and the commit value are `invertAxis(...).y` (horizontal)
  or `.x` (vertical). No new inversion math.
- **`distToSegment` (`geometry.ts`)** already does point-to-line distance. The threshold
  hit-test reuses it — a threshold is just a line spanning the viewport.
- **The `@bind` round-trip (`overlay.ts` `onClick`)** already sets `host.value` and dispatches
  `input`. Mouse-up commit reuses that verbatim, with a computed payload instead of a
  looked-up one.
- **`InteractionEvent` + `transform_value` (`render.jl`)** already carry an arbitrary
  `payload`. No bond-contract change.

The line lives **entirely in the overlay** (an SVG element), never in the CairoMakie base PNG.
That is what makes "no base redraw per drag" true, and it means threshold position survives a
re-run the same way `selected` does — by being re-emitted from the constructor's `value`.

**Not the architecture's non-goal.** `architecture.md` §7 lists "high-frequency live redraw" as
*Never (without a new backend class)* — but that non-goal is specifically *reflowing the plot per
frame* ("dragging a data point and reflowing the plot per frame", §"Non-goals"). Threshold drag
moves *overlay* geometry and never touches the base render, which is exactly the Tier-0 case §6
admits. This cut stays on the allowed side of that line; it does not approach the WGLMakie boundary.

## Components

### 1. Julia: `ThresholdInteractable` (`src/interactables.jl`)

```julia
struct ThresholdInteractable <: AbstractInteractable
    ax; orientation::Symbol; value::Float64; id::Symbol
end
ThresholdInteractable(ax; orientation = :horizontal, value, id = :threshold) = ...
```

- `orientation ∈ (:horizontal, :vertical)`. Horizontal = a line at constant data-`y = value`,
  dragged vertically. Vertical = constant data-`x = value`, dragged horizontally.
- `events(::ThresholdInteractable) = (:drag,)` — a **new event verb** (see §"Event vocabulary").
- `hitlayers` emits **one** `HitLayer` of new `kind = :threshold`:
  - `pos` (image-px): project `value` to the line's pixel coordinate. Horizontal → the `y` of
    `_proj(ctx, ax, (x_any, value))`; vertical → the `x` of `_proj(ctx, ax, (value, y_any))`.
    `x_any`/`y_any` is any in-range coordinate (use the axis `finallimits` origin via the
    transform; projection along the line is constant).
  - `span` (image-px): `[lo, hi]` the line's pixel extent along the axis viewport — read from
    the axis `AxisTransform.viewport` already in `ctx.transforms`. Horizontal → the viewport's
    `[x, x+w]`; vertical → `[y, y+h]`.
  - `payloads = Any[]` — the committed value is **computed client-side**, never looked up.
- `validate`: like `AxisInteractable`, the dragged axis must be client-side invertible. Reuse
  the existing `_JS_INVERTIBLE` tuple. Horizontal checks `yscale`; vertical checks `xscale`.
  Fail loud otherwise (architecture.md: "fail loud, never silently wrong").

Geometry serializes as a `Dict("orientation" => "h"|"v", "pos" => Float32, "span" => [lo, hi])`
(matches the `:grid` precedent of a `Dict` geometry).

Exported from `Holo.jl` alongside the other interactables.

### 2. Manifest (`src/render.jl`)

No structural change. `_layer_dict` already serializes arbitrary `geometry` and `events`; an
empty `payloads` and empty `tooltips` are already handled. The threshold layer flows through
`build_manifest` unchanged, including its `validate` call.

### 3. TS contract (`frontend/src/types.ts`)

Mirror the Julia struct (CLAUDE.md gotcha: keep `types.ts` in sync):

- Add `"threshold"` to the `Kind` union.
- Add `ThresholdGeometry { orientation: "h" | "v"; pos: number; span: [number, number] }` and
  widen `HitLayer.geometry` to include it.
- `events` already typed as `string[]`; `"drag"` needs no type change, documented in the comment.

### 4. Overlay (`frontend/src/overlay.ts`) — the substantive new code

- **Persistent rendering.** Introduce a dedicated SVG group (e.g. `<g class="perm">`) that the
  transient hover-clear (`clearHi`) never touches. On mount, for every `:threshold` layer draw
  a persistent `<line>` from its `geometry` (`span`/`pos`/`orientation`). This is isolated from
  the existing hover-highlight group, so existing hover/click/selected behavior is untouched.
- **Drag state machine** on `surface`:
  - `mousedown` → `hitTest(manifest, x, y, "drag")`. On a hit, record the dragged layer +
    orientation + its `axis` transform + viewport clamp range; begin drag.
  - `mousemove` (while dragging) → update the persistent line's `pos` along its one axis,
    **clamped to the axis viewport** (so the value stays in data range); show the live data
    value in the tooltip via `invertAxis(transform, x, y)`.
  - `mouseup` → commit: `host.value = { layer: id, index: 0, payload: <scalar> }` where the
    scalar is `invertAxis(transform, x, y).y` (horizontal) or `.x` (vertical); dispatch
    `input`. End drag.
  - Cursor affordance: when hovering a draggable line (not mid-drag), set a grab cursor.
- **Hit-test** (`frontend/src/geometry.ts`): add `case "threshold"` to `hitLayer` — line is
  `(span[0], pos)–(span[1], pos)` for horizontal (swap for vertical); hit if
  `distToSegment ≤ SEG_TOL`. Self-contained (geometry carries its own span), hence unit-testable
  without DOM.

## Data flow

```
render: value ──_proj──▶ pos (px) ──┐
                                     ├─▶ HitLayer(:threshold, {orientation,pos,span}) ─▶ manifest ─▶ published_to_js
                              viewport┘
mount:  manifest ─▶ persistent <line> at pos
drag:   mousemove ─▶ move line (clamped), tooltip = invertAxis(px,py)        [60 fps, no Julia]
mouseup:invertAxis(px,py).{y|x} = scalar ─▶ host.value ─▶ @bind ─▶ InteractionEvent(:threshold, 0, scalar)
re-run: value = ev.payload ─▶ line redrawn at the dropped position (overlay only; base PNG unchanged)
```

## Event vocabulary — `:drag`

`architecture.md` §6 (tension #2) states the package adopts Makie's `events` *vocabulary* for
forward-compat, deliberately without its propagation machinery. The existing verbs are
`:click`/`:hover`. `:drag` extends that vocabulary in the same spirit: it gates which layers the
drag hit-test considers (`hitTest(…, "drag")`), nothing more. First-match-wins manifest order is
unchanged. This is an additive, consistent extension — not a new dispatch model.

## Tiers — where the work lands (consistency with §6)

- **Per-frame drag = Tier 0**: local SVG move + `invertAxis` readout, zero Julia per frame.
- **Mouse-up commit = one Tier-2 round-trip**: a single `@bind` update, not per-frame. The
  roadmap's "commit on mouse-up … no per-frame Julia" maps exactly onto this split.

## Out of scope (deferred, consistent with roadmap §M4)

- **ROI box / movable points** — same Tier-0 mechanism, later cuts. No resize/two-handle logic now.
- **`holo(fig)` auto-extraction of thresholds** — a threshold is a *user-added* element, not
  introspected from an existing plot, so `introspect.jl` is untouched.
- **Categorical-axis thresholds** — `invertAxis` already maps to nearest category; not a target
  use, no special handling added.

## Testing

- **Julia** (`test/`): construct a `ThresholdInteractable`, build its hitlayer, assert `pos`
  equals the `_proj` of `value` along the line and `span` equals the axis viewport extent
  (rendered-geometry assertion, matching the existing per-kind test style). Plus a `validate`
  fail-loud test on a non-invertible scale.
- **TS** (`frontend/src/geometry.test.ts`): a `hitLayer` case for `:threshold` (hit within tol,
  miss outside) — pure, reuses `distToSegment`. The readout/commit math (`invertAxis`) is
  already covered by existing tests.
- **Frontend gate** (CLAUDE.md): `lint && typecheck && test && build` so the committed
  `assets/overlay.js` is regenerated.
- Live Pluto verification deferred to implementation (machinery is the same proven path as the
  shipped kinds).

## Files touched

- `src/interactables.jl` — new `ThresholdInteractable` (struct + constructor + `hitlayers` +
  `validate` + `events`).
- `src/Holo.jl` — export it.
- `frontend/src/types.ts` — `Kind`, `ThresholdGeometry`.
- `frontend/src/geometry.ts` — `hitLayer` `:threshold` case.
- `frontend/src/overlay.ts` — persistent group + drag state machine.
- `test/` + `frontend/src/geometry.test.ts` — the two checks above.
- `docs/roadmap.md` — tick the M4 drag box on completion.
