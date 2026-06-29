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
- [ ] **Richer tooltips**: per-element HTML/template tooltips (beyond payload JSON), still pre-serialized (no round-trip).

## M3 — Surface coverage (v2 from the survey)
*Goal: more plot types, same primitives. Add per real demand.*

- [x] **Cheap wins** (existing primitives): Stairs, Errorbars/Rangebars, HLines/VLines, Stem, Spy, ScatterLines (composite → two layers). *Done (`src/introspect.jl`): introspection constructors delegating to the M1 primitives — Stairs→`Segment(:polyline)` (reads the child Lines' expanded staircase, not the raw input pts), Errorbars/Rangebars→`Segment(:pairs)`, HLines/VLines→`Segment(:pairs)` spanning `finallimits`, Spy→`Rect(:list)` of unit cells off the `:data`-markerspace child Scatter, Stem/ScatterLines→two layers (Point+Segment) via their child plots. All wired into `holo(fig)`; unit-tested against the explicit constructors + rendered-geometry. Deferred: richer `{i,j,value}`/`value`/`equation` payloads (→ M2.3 tooltips), fractional HLines/VLines span attrs.*
- [ ] **Computational-geometry extraction**: Contourf/Tricontourf, Violin, Voronoiplot, BoxPlot notches — produce polygons.
- [ ] **Bars/areas**: BarPlot/Hist/Waterfall (list rects), HSpan/VSpan, Colorbar/Legend.
- [ ] **Text bboxes** (Text/Annotation/TextLabel): needs font-metric measurement → the `bbox` geometry primitive (rotated → degenerate polygon).
- [ ] **SVG output path**: `CairoBackend(vector=true)` is groundwork; actually emit SVG base + overlay for sparse, low-primitive plots (cleaner coords, no raster).

## M4 — Interaction depth (new capabilities, not new surfaces)
*Goal: the Tier-0/Tier-1 interactions the architecture already supports.*

- [x] **Drag (Tier 0)**: draggable overlay geometry with live data readout via the shipped `AxisTransform`; commit on mouse-up. 60 fps, no per-frame Julia. *Done (first cut): `ThresholdInteractable` — a draggable horizontal/vertical line. The line lives entirely in the overlay (base PNG never redraws); mouse-up inverts the dragged pixel to a data scalar via `invertAxis` and round-trips it through `@bind`. `ROIInteractable` adds a draggable + resizable box (data-space bounds → `@bind`); movable points reuse the same mechanism (deferred).*
- [ ] **Animation / scrubbing (Tier 1)**: precomputed frame sequence in the manifest + a JS scrubber; bond value = current frame/param. Latency paid once, up front.
- [ ] **Multi-select / box-select**: `Vector{InteractionEvent}` (the forward-compat extension single-select was shaped for).
- [ ] **Wide mode**: `holo(fig, …; max_width=W)` vendoring the `PlutoUI.WideCell` technique inside the widget (it no-ops under `@bind` if used externally).

## M5 — Scale & polish
- [ ] **Spatial acceleration** (quadtree/grid) for large-N hit-testing — only when the documented O(n) ceiling is actually hit (`log()` the cap until then).
- [x] **Perf benchmarking**: the unmeasured Q5 envelope — base64 size + click latency knee; confirm MsgPack fast-path engages. *Done (`bench/payload_envelope.jl` → `docs/perf-findings.md`): single plots 50–400 KB, manifest O(N) elements, heatmaps O(cells), animation = frames × PNG (the hard ceiling, 7–29 MB). MsgPack confirmed (generic maps, not the TypedArray fast-path). Full click round-trip measured live (headless Pluto + Chromium): ~65 ms median — render-bound, browser overhead negligible. Editor-lag knee (editor stutter, distinct from latency) deferred.*
- [ ] **Theming**: respect Pluto light/dark for highlight/tooltip styling (shadow-DOM scoped).
- [ ] **GLMakie-static backend**: GPU offscreen → PNG, same `AbstractBackend` contract (for envs with a GPU).
- [ ] **Register in General** once the API stabilizes (CHANGELOG → 0.1.0 tag → Registrator/TagBot).

---

## Non-goals (by design)
3D (`Surface`, `MeshScatter`, `Arrows3D`), `PolarAxis`/`Axis3`, and **high-frequency live
redraw** (dragging a data point and reflowing the plot per frame). These need a browser-side
renderer — that's **WGLMakie's** domain, a different product. Holo stays static-base + thin overlay.

## Suggested order

Done: M1 · M2.1/M2.2 · M3 cheap-wins · M4 drag · Phase 0 measure. What remains, sequenced for a polished
(not-MVP) first release. The order is driven by four real dependency edges, not by milestone
number — everything else is reorderable by demand.

**The four edges that constrain order:**
- **Perf envelope → everything payload-heavy.** Tooltips, animation frames, SVG, and the
  multi-select return shape all inflate the base64/manifest payload, whose ceiling is an
  *undocumented empirical unknown* (`research-findings.md` Q5, `design.md` §10). Measure it
  first so the rest is built against a known knee.
- **Richer tooltips → all surface payloads.** M3 cheap-wins already deferred their good
  payloads (`{i,j,value}`, `value`, `equation`) to it; every surface added after ships a real
  tooltip instead of payload JSON. Rides the existing `tooltip(i,idx,payload)::Union{Nothing,String}`
  seam + `HitStyle` field — additive, not a rework.
- **Multi-select → the bond contract.** `Vector{InteractionEvent}` is the forward-compatible
  extension v1 was shaped for (`architecture.md`:261). Land the contract change before stacking
  more surfaces on it. Preserve the "never `Nothing`" invariant (empty vector, not nothing).
- **Everything → registration.** Last, after the API stops moving.

### Phase 0 — Measure (front-loaded spike) ✅ *done*
- **Perf benchmarking** — *Done. See `docs/perf-findings.md` (`bench/payload_envelope.jl` to
  re-run).* The envelope: single interactive plots land 50–400 KB (at/just above Q5's plausible
  band, not below the <10 KB anecdote); manifest is O(N) elements (~58 B/elem) and O(cells) for
  heatmaps; **animation = frames × per-frame PNG is the hard ceiling (7–29 MB) — gate it.** Tooltip
  budget: <~200 B/element at N≈1 000. MsgPack confirmed (generic maps; geometry doesn't hit the
  TypedArray fast-path because the root is `Dict{String,Any}`). Full click round-trip measured
  live (headless Pluto + Chromium): **~65 ms median** (render-bound; browser/websocket overhead is
  ~tens of ms). Only the editor-lag *knee* (editor stutter at MB-scale output, distinct from
  latency) is deferred — a cheap follow-up if animation ships. **Stress-tested to the extremes:**
  round-trip is render-bound below ~1 MB but flips to *payload-bound* above a few MB (1000² heatmap:
  2.13 MB PNG + 8.6 MB manifest → 553 ms, mostly serialize+transfer). The manifest (O(N) elements,
  O(cells) heatmaps) is the high-N wall, not the PNG — it degrades gracefully, nothing breaks.

### Phase 1 — Foundations that unblock the rest
- **M2.3 Richer tooltips** — pre-serialized per-element HTML/template; extends the existing
  tooltip seam. (Watch: per-element HTML edges toward the "rich UI chrome" framework-revisit
  trigger in `frontend-delivery.md`, and inflates payload — stay inside the Phase-0 envelope.)
- **M4 Multi-select / box-select** — the `Vector{InteractionEvent}` contract extension. Builds
  on the M2 typed bond (`Bonds.transform_value`) + v1 manifest selected-state. Kernel-only
  (inert in static export); accumulate selection client-side since Pluto throttling is lossy.

### Phase 2 — Surface coverage (parallel; each now carries a real payload)
No new JS primitive in this phase — every surface reuses v1's `:rects`/`:polygons` tests; the
work is always a Julia-side extractor. (`update_state_before_display!(fig)` is the mandatory
pre-manifest step for all three.)
- **Bars/areas** (Waterfall/CrossBar, HSpan/VSpan, Colorbar/Legend) — cheapest: existing
  rect-`:list`. Colorbar/Legend are the tractable slice; Waterfall's dodge/stack math is the
  sharp edge.
- **Computational-geometry extraction** (Contourf/Tricontourf, Violin, Voronoiplot, BoxPlot
  notches → polygons) — hardest M3 item: Tier-4 Makie *recipes*, reach into recipe internals to
  recover polygons. No new primitive (even-odd polygon test), but the extractor is the cost.
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
  manifest-order first-match. Build *only* if Phase 0 shows the O(n) knee is real.

### Phase 5 — Polish & release
- **Theming** (Pluto light/dark, shadow-DOM scoped) — overlay can theme freely (shadow root +
  bundled CSS already in place); the opaque base PNG can't follow the theme without a re-render —
  scope accordingly.
- **GLMakie-static backend** — first do the prerequisite seam refactor (move
  `data_to_image_px`/projection onto the rendercontext so it isn't hard-bound to CairoMakie),
  then the backend slots in behind the same contract. Must stay static→PNG (no 3D/live). Optional.
- **Register in General** — strictly last, after the API stabilizes. Needs the committed in-tree
  bundle + CI-on-GitHub; CHANGELOG → 0.1.0 tag on a CI-built commit → Registrator/TagBot.
