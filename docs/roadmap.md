# Holo.jl — Roadmap

Where v0.1 is and how the rest of the feature set gets built. Grounded in the design:
`architecture.md` (the contract + tiers), `survey-makie-surfaces.md` (the v1/v2 surface
map), `frontend-delivery.md` (build/delivery). Priorities, not promises — reorder freely.

## Guiding principles (don't drift)
- **Explicit declaration is the contract; introspection is sugar** on top of it.
- **Frontend is a stateless view**; authoritative state lives in Julia via `@bind`.
- **No parallel server**; inspection survives offline/static-export, clicks need a kernel.
- **Fail loud, never silently wrong** (per-capability `validate`).
- **YAGNI**: build a surface/feature when a real use pulls for it, not preemptively.

## Status — v0.1 (done)
Backend seam (CairoBackend) · `AbstractInteractable` + `HitLayer` · 5 built-ins
(Point/Segment/Rect[list+grid]/Polygon/Axis) with explicit-geometry constructors · custom
paths (Region/Function) · TS overlay bundle + `published_to_js` + shadow DOM · typed
`InteractionEvent` · categorical/log/multi-axis · DPI policy · CI (Julia + frontend + Runic).
**Live-verified end-to-end for `PointInteractable`**; other kinds unit-tested only.

---

## M1 — Harden v1 (finish what exists) ✅ *done*
*Goal: every shipped feature is real and demonstrated. No new surfaces.*

- [x] **Live-verify the remaining kinds** in Pluto: Segment, Rect(list+grid/heatmap), Polygon, Axis-readout. (Machinery is proven for circles; this closes the per-kind gap.) *Done: `examples/demo.jl` exercises all five live; verified via headless Pluto + Playwright.*
- [x] **Selection round-trip → re-highlight.** Wire the designed loop: bond value → Julia marks selected indices on the manifest → overlay pre-highlights on mount (`HitLayer.selected` already exists in the TS). *Done: `selected` keyword on `holo`/`build_manifest`; clicked points re-highlight flicker-free (verified live).*
- [x] **`examples/` notebook** — self-contained Pluto notebook (`examples/demo.jl`) that devs the package via a checkout-relative `@__DIR__` path. *Done: opens and runs clean from a fresh checkout; a CI job runs it headlessly so it can't rot.* (Used Pluto's self-contained notebook env, not a sidecar `Project.toml`.)
- [x] **Docs**: expanded README API section (`holo`, each interactable, custom paths, payload-is-`Dict` contract, selection round-trip). Documenter site deferred to M5 (pre-registration → YAGNI).
- [x] **Robustness validation**: fail loud on out-of-scope configs (PolarAxis/Axis3/LScene) at `holo()` time — one `AbstractAxis`-not-`Axis` guard in `context()`.

## M2 — Ergonomics (the big unlock)
*Goal: stop hand-writing geometry. `survey-makie-surfaces.md` has the extraction recipes.*

- [x] **Plot-introspection constructors**: `PointInteractable(ax, scatter)`, `RectInteractable(ax, heatmap)`, `SegmentInteractable(ax, lines)`, etc. — pull geometry from live Makie plot objects via `plot.converted[]`. *Done (`src/introspect.jl`): Scatter/Lines/LineSegments/Heatmap/Image/BarPlot/Poly delegate to the explicit constructors with identical hitlayers (tested). Gotchas handled: markersize→radius (pixel space), heatmap `EndPoints`→edge expansion, bar dodge/stack/auto-width read from the laid-out child rects. `ax` is passed (a plot has no axis back-reference); single-arg sugar arrives with M2.2's scene walk.*
- [x] **`holo(fig)` auto-extraction**: walk the scene graph, emit a concrete `Vector{AbstractInteractable}` (the same one a user could write). Unknown plot type → skip + warn. Sugar over M2.1, not a separate path. *Done (`src/introspect.jl`): `auto_interactables(fig)` walks each `Axis`'s `scene.plots`, maps each supported plot via the M2.1 constructors, dedupes layer ids (`:scatter`, `:scatter_2`, …), and skips unsupported types with a warning. `holo(fig)` is the zero-config overlay; both exported.*
- [x] **Richer tooltips (M2.3)** — `holo"…"` template macro, auto name/value table default, and figure-level `tooltip_*` theming. *Done (PR #10): see Phase 1 / `docs/tooltips.md`.*

## M3 — Surface coverage (v2 from the survey)
*Goal: more plot types, same primitives. Add per real demand.*

- [x] **Cheap wins** (existing primitives): Stairs, Errorbars/Rangebars, HLines/VLines, Stem, Spy, ScatterLines (composite → two layers). *Done (`src/introspect.jl`): introspection constructors delegating to the M1 primitives — Stairs→`Segment(:polyline)` (reads the child Lines' expanded staircase, not the raw input pts), Errorbars/Rangebars→`Segment(:pairs)`, HLines/VLines→`Segment(:pairs)` spanning `finallimits`, Spy→`Rect(:list)` of unit cells off the `:data`-markerspace child Scatter, Stem/ScatterLines→two layers (Point+Segment) via their child plots. All wired into `holo(fig)`; unit-tested against the explicit constructors + rendered-geometry. Deferred: richer `{i,j,value}`/`value`/`equation` payloads (→ M2.3 tooltips), fractional HLines/VLines span attrs.*
- [x] **Filled-area curves (Band/Density)**: Band and Density auto-extracted by `holo(fig)` as `:polygons` with `(; index)` payload. *Done (`src/introspect.jl`).*
- [x] **Computational-geometry extraction**: Contourf/Violin/Voronoiplot + BoxPlot box-body shipped; Tricontourf deferred; BoxPlot box-body-only (whiskers/outliers decorative). *Done (`src/introspect.jl`): Contourf → `:polygons` per contour level with `(; low, high)` from Makie's computed level range; Violin → `:polygons` with `(; x)` from the data position; Voronoiplot → `:polygons` with `(; index)`; BoxPlot box-body → `:rects` (un-notched) / `:polygons` (notched) with `(; q1, median, q3)` from Makie's computed-stats node. Principle: hit geometry from rendered shapes; payload values from Makie's computed values.*
- [x] **Bars/areas** *(Hist/Waterfall/CrossBar/HSpan/VSpan done; Colorbar done M3; Legend remaining)*: Hist, Waterfall, CrossBar, HSpan, VSpan now auto-extracted by `holo(fig)` as `:rects` (same primitive as BarPlot, no new JS path). Shared bar payload schema — semantic, no redundant `index` (element index lives in `InteractionEvent.index`): BarPlot/Waterfall `(; low, high, value)`, Hist `(; value, low, high)`, CrossBar `(; midpoint, low, high)`, HSpan/VSpan `(; low, high)`. Span hit-rects clamped to the owning axis's pixel viewport (prevents cross-axis bleed in multi-axis figures). Uniform fail-loud payload-length validation (`_check_payloads`) added to `SegmentInteractable`/`RectInteractable`/`PolygonInteractable` — a wrong-length `payloads=` now throws `ArgumentError` at construction. *Colorbar: done (M3) — `ColorbarInteractable` auto-extracted from `fig.content`; figure-block walk now exists and Legend slots in the same place. Remaining: Legend (deferred — a linking capability, its own arc).*
- [ ] **Text bboxes** (Text/Annotation/TextLabel): needs font-metric measurement → the `bbox` geometry primitive (rotated → degenerate polygon).
- [ ] **SVG output path**: `CairoBackend(vector=true)` is groundwork; actually emit SVG base + overlay for sparse, low-primitive plots (cleaner coords, no raster).

## M4 — Interaction depth (new capabilities, not new surfaces)
*Goal: the Tier-0/Tier-1 interactions the architecture already supports.*

- [x] **Drag (Tier 0)**: draggable overlay geometry with live data readout via the shipped `AxisTransform`; commit on mouse-up. 60 fps, no per-frame Julia. *Done (first cut): `ThresholdInteractable` — a draggable horizontal/vertical line. The line lives entirely in the overlay (base PNG never redraws); mouse-up inverts the dragged pixel to a data scalar via `invertAxis` and round-trips it through `@bind`. `ROIInteractable` adds a draggable + resizable box (data-space bounds → `@bind`); movable points reuse the same mechanism (deferred).*
- [ ] **Animation / scrubbing (Tier 1)**: precomputed frame sequence in the manifest + a JS scrubber; bond value = current frame/param. *Payload* (not latency) is the gate: total = frames × per-frame PNG = 5.5–22 MB typical, 144–481 MB at stress scale (`perf-findings.md`) — naive full-res scrub is not viable; must shrink per-frame cost (downscale / fewer frames).
- [x] **Multi-select / box-select**: `Vector{InteractionEvent}` bond via `AbstractSelector` /
  `selects`-ROI (Design D — clicks stay single; `selects`-ROI returns the vector: points target
  → N events, grid target → 1-element region descriptor for server-side stats, empty box →
  `InteractionEvent[]`). Shipped with `gallery/gallery.jl` recipes (box-select scatter;
  image ROI per-channel stats).
- [ ] **Wide mode**: `holo(fig, …; max_width=W)` vendoring the `PlutoUI.WideCell` technique inside the widget (it no-ops under `@bind` if used externally).

## M5 — Scale & polish
- [ ] **Spatial acceleration** (quadtree/grid) for large-N hit-testing — only when the documented O(n) ceiling is actually hit (`log()` the cap until then). *Phase 0 reframe:* hit-test is ~0 ms; the wall is manifest **payload size** (~290 ms serialize+transfer at 4.78 MB), so wire-encoding (int-pixel coords / capping `values[]`) outranks a quadtree (see Phase 4).
- [x] **Perf benchmarking**: the unmeasured Q5 envelope — base64 size + click latency knee; confirm MsgPack fast-path engages. *Done (`bench/payload_envelope.jl` → `docs/perf-findings.md`): single plots 50–400 KB, manifest O(N) elements, heatmaps O(cells), animation = frames × PNG (the hard ceiling, 5.5–22 MB). MsgPack confirmed (generic maps, not the TypedArray fast-path). Full click round-trip measured live (headless Pluto + Chromium): ~65 ms median — render-bound, browser overhead negligible. Editor-lag knee (editor stutter, distinct from latency) deferred.*
- [ ] **Theming**: respect Pluto light/dark for highlight/tooltip styling (shadow-DOM scoped). *(Tooltip styling already landed in M2.3 — shadow-DOM `--holo-tip-*` + `prefers-color-scheme` dark mode; what remains is following Pluto's explicit light/dark toggle and the marker-highlight styling.)*
- [ ] **GLMakie-static backend**: GPU offscreen → PNG, same `AbstractBackend` contract (for envs with a GPU).
- [ ] **Register in General** once the API stabilizes (CHANGELOG → 0.1.0 tag → Registrator/TagBot).

---

## Non-goals (by design)
3D (`Surface`, `MeshScatter`, `Arrows3D`), `PolarAxis`/`Axis3`, and **high-frequency live
redraw** (dragging a data point and reflowing the plot per frame). These need a browser-side
renderer — that's **WGLMakie's** domain, a different product. Holo stays static-base + thin overlay.

## Suggested order

Done: M1 · M2.1/M2.2 · M2.3 tooltips · M3 cheap-wins · M4 drag · M4 box-select · Phase 0 measure. What remains, sequenced for a polished
(not-MVP) first release. The order is driven by four real dependency edges, not by milestone
number — everything else is reorderable by demand.

**The four edges that constrain order:**
- **Perf envelope → everything payload-heavy.** Tooltips, animation frames, SVG, and the
  multi-select return shape all inflate the base64/manifest payload, whose ceiling is an
  *undocumented empirical unknown* (`research-findings.md` Q5, `design.md` §10). Measure it
  first so the rest is built against a known knee.
- **Richer tooltips → all surface payloads.** ✅ *Landed (M2.3, PR #10).* Every surface added after
  ships a real tooltip (a `holo"…"` template or the auto-table default) instead of payload JSON. The
  per-element `tooltip()` seam was replaced by a per-layer `tooltip_spec`; M3's deferred payloads
  (`{i,j,value}`, `value`, `equation`) now surface through it.
- **Multi-select → the bond contract.** `Vector{InteractionEvent}` is the forward-compatible
  extension v1 was shaped for (`architecture.md`:261). Land the contract change before stacking
  more surfaces on it. Preserve the "never `Nothing`" invariant (empty vector, not nothing).
- **Everything → registration.** Last, after the API stops moving.

### Phase 0 — Measure (front-loaded spike) ✅ *done*
- **Perf benchmarking** — *Done. See `docs/perf-findings.md` (`bench/payload_envelope.jl` to
  re-run).* The envelope: single interactive plots land 50–400 KB (at/just above Q5's plausible
  band, not below the <10 KB anecdote); manifest is O(N) elements (int-pixel geometry; per-element bytes
  in `perf-findings.md`) and O(cells) for heatmaps; **animation = frames × per-frame PNG is the hard ceiling (5.5–22 MB) — gate it.** Tooltip
  budget: <~200 B/element at N≈1 000. MsgPack confirmed (generic maps; geometry doesn't hit the
  TypedArray fast-path because the root is `Dict{String,Any}`). Full click round-trip measured
  live (headless Pluto + Chromium): **~65 ms median** (render-bound; browser/websocket overhead is
  ~tens of ms). Only the editor-lag *knee* (editor stutter at MB-scale output, distinct from
  latency) is deferred — a cheap follow-up if animation ships. **Stress-tested to the extremes:**
  round-trip is render-bound below ~1 MB but flips to *payload-bound* above a few MB (measured at a 1000²
  heatmap's 4.78 MB manifest → 553 ms, mostly serialize+transfer; that heatmap is now `values[]`-capped to
  KB, so high-N *scatter* — 200k → 7.72 MB — is the payload wall). The manifest is the high-N wall, not the
  PNG — it degrades gracefully, nothing breaks.

### Phase 1 — Foundations that unblock the rest
- [x] **M2.3 Richer tooltips** — *Done (PR #10; `docs/tooltips.md`).* Shipped as a **per-layer
  `holo"…"` template** interpolated browser-side from the already-shipped `payloads[]` — not the
  per-element-HTML approach first sketched here — so rich tooltips add **zero** new per-element wire
  bytes and the old per-element `tooltips[]` term was dropped (the budget concern is sidestepped, not
  just bounded). Plus an auto name/value table default, `tooltip_*` theming → `--holo-tip-*`,
  escape-by-default data, d3-format numbers, and two-phase validation. (d3-format is the first JS
  runtime dep; bundle delta in `perf-findings.md`.)
- [x] **Bound the grid `values[]` payload (robustness fix).** *Done (`src/interactables.jl`:
  `GRID_VALUES_MIN_SCREEN_PX`, gated on `InteractionContext.display_scale`; overlay tolerates an
  absent `values[]`). Day-one bug in shipped `holo(fig)`, shipped independently of M2.3.* The `:grid` manifest shipped the full
  source-resolution `values[]` matrix (by design today, tens of MB for a 2000²–4000²
  `heatmap!`/`image!`) purely for the `(i,j)=value` hover. **De-speculated** (`bench/encoding_experiment.jl`):
  dropping it is far smaller (see `perf-findings.md` for the measured ratio) and hit-testing needs only
  edges+dims. **Cap criterion =
  the cell's *expected on-screen* size, computed on the fly.** A Pluto cell is only so wide — display is
  bounded by the column (`max_width`, 700 px default), so we know it at build: `cell_screen_px =
  (viewport_image_px/ncols) × (display_css/image_width)`, `display_css = min(scene, max_width)`. (Today's DPI
  renders at 2× display, so the ratio is 0.5 ≈ ÷2 — compute it, don't hardcode.) Ship `values[]` only when
  `min(cell_screen_px) ≥ τ` (τ≈1–2 px); sub-pixel-on-screen cells can't be cursor-targeted → drop, payload
  `{i,j}`, one-time `@warn`. For a 600-wide figure: 50²≈12 px (keep), 200²≈3 px (keep), **1000²≈0.6 px (drop)**,
  2000²–4000² (drop). It's an *expected* size (overlay still hit-tests against the true runtime scale).
  Self-tuning and **subsumes the special `Image` case** (source-res > display-res → sub-pixel → auto-drop).
  See `architecture.md` §8.
- [x] **M4 Multi-select / box-select** — *Done.* `AbstractSelector <: AbstractInteractable`
  interface (`selects(sel)`, `compatible_kinds(sel)`) + `ROIInteractable(…; selects=:id)` as the
  first concrete selector. Design-D bond contract: clicks / bounds-only ROI stay single
  `InteractionEvent`; a `selects`-ROI returns `Vector{InteractionEvent}` — points target → N
  events, grid target → 1-element region descriptor `(; i0,i1,j0,j1,xmin,xmax,ymin,ymax)` for
  server-side stats (browser never needs `values[]` for selection), empty box →
  `InteractionEvent[]` (never `nothing`). Wire: only new manifest field is `selects` string on
  the ROI layer; `transform_value` keys on the `{ items: [...] }` JS envelope shape.
  `targetKind`/`arity` were dropped as redundant. Shipped with `gallery/gallery.jl` recipes
  (box-select scatter; image ROI per-channel stats).

### Phase 2 — Surface coverage (parallel; each now carries a real payload)
No new JS primitive in this phase — every surface reuses v1's `:rects`/`:polygons` tests; the
work is always a Julia-side extractor. (`update_state_before_display!(fig)` is the mandatory
pre-manifest step for all three.)
- [x] **Bars/areas** *(done except Legend — Colorbar done M3; see M3)*: Hist/Waterfall/CrossBar/HSpan/VSpan auto-extracted as `:rects`; shared bar payload schema (semantic, no `index`); span viewport-clamp; uniform payload-length validation. Colorbar: done (M3) — `ColorbarInteractable` via figure-block walk. *Remaining: Legend (deferred).*
- [x] **Filled-area curves (Band/Density)**: Band and Density auto-extracted as `:polygons` with `(; index)` payload.
- [x] **Computational-geometry extraction** (Contourf/Tricontourf, Violin, Voronoiplot, BoxPlot
  notches → polygons): Contourf/Violin/Voronoiplot + BoxPlot box-body shipped; Tricontourf
  deferred; BoxPlot box-body-only — whiskers/outliers decorative. All reuse v1's `:polygons`
  even-odd test; no new JS primitive. Principle: hit geometry from rendered shapes; payload from
  Makie's computed values.
- **Text bboxes** (Text/Annotation/TextLabel) — *not* a 7th primitive: rotated text = degenerate
  polygon reusing the polygon test. The genuinely new work is **font-metric measurement**, the
  one thing the coord system was built not to model (`design.md` §6) — do it last in this phase,
  self-contained.

These three are independent and can run concurrently.

### Phase 3 — Interaction depth
- **Animation / scrubbing (Tier 1)** — precomputed frames baked into one manifest (the snapshot
  model *forces* this, not live Observables). Rehydrate scrubber position from
  `data-*`/sessionStorage/`@bind`, never element instance state. Payload-heavy → must fit the
  Phase-0 envelope; a JS scrubber may trip the framework-revisit trigger.
- **Wide mode** (`max_width=W`) — *not* cheap: vendor the WideCell technique inside the widget
  (PlutoUI's no-ops under `@bind`), and a `max_width` change forces a full re-render (new Screen
  + regenerated manifest), not a CSS resize. Self-contained; slot anytime in this phase.

### Phase 4 — Output & scale (gated by Phase 0)
- **SVG output path** — base SVG output is already the `mount=:svg` seam; the new part is the
  overlay over a vector base. Least-validated item: gate behind a viability spike (primitive-count
  threshold; SVG uses `pt_per_unit/0.75`, not `px_per_unit`). Sparse-plot mode only — dense plots
  stay PNG. Pairs naturally with Phase 0.
- **Spatial acceleration** (quadtree/grid) — demand-gated; may never be built. Grids are already
  O(1), so scope is only flat list layers (Scatter/rect-`:list`/segments). JS-only; must preserve
  manifest-order first-match. **Phase 0 measured hit-test at ~0 ms** (scatter-50/10k) and found the
  first wall is manifest *payload size* (serialize+transfer), not hit-test CPU — so build this *only*
  if a profile ever shows JS hit-test **specifically** (not serialize/transfer) is the bottleneck.
  (Phase 0 did not stress hit-test at extreme N≈200k; but there the 7.72 MB manifest dominates anyway.)
- [x] **Int-pixel geometry quantization (perf win).** *Done (`src/interactables.jl`: per-element geometry
  vectors built as `Int` via `_q(x) = round(Int, x)` — circles/segments/rects/polygons/regions + grid edges).*
  **De-speculated** (`bench/encoding_experiment.jl`): real MsgPack gives **−58%** on the geometry term
  (5.00 → 2.10 B/coord); it needs **no manifest-shape change** (msgpack already encodes small ints in 1–3 B;
  the frontend reads numbers either way), and ≤0.5px rounding is inside the ~1px hit-test tolerance. On a
  whole realistic manifest the saving is ~17 % (geometry is one term beside the payload's Float64 `x`/`y`);
  at high-N scatter it pushed the 200k wall 9.28 → 7.72 MB (`perf-findings.md`). **Constraint (held):**
  quantize per-element geometry only — `AxisTransform` lims/viewport stay `Float64` (the M4 drag inverts
  pixel→data through them). See `architecture.md` §9.
  - *Rejected by the same experiment:* lifting geometry to a top-level typed `Vector` to engage MsgPack's
    TypedArray binary fast-path — measured only ~5% beyond int-quantization (2.00 vs 2.10 B/coord), not
    worth the manifest-shape rewrite. `Float16` is a non-starter (no msgpack float16; lossy >2048px).

### Phase 5 — Polish & release
- **Theming** (Pluto light/dark, shadow-DOM scoped) — overlay can theme freely (shadow root +
  bundled CSS already in place); the opaque base PNG can't follow the theme without a re-render —
  scope accordingly.
- **GLMakie-static backend** — first do the prerequisite seam refactor (move
  `data_to_image_px`/projection onto the rendercontext so it isn't hard-bound to CairoMakie),
  then the backend slots in behind the same contract. Must stay static→PNG (no 3D/live). Optional.
- **Register in General** — strictly last, after the API stabilizes. Needs the committed in-tree
  bundle + CI-on-GitHub; CHANGELOG → 0.1.0 tag on a CI-built commit → Registrator/TagBot.
