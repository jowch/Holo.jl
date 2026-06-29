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

- [x] **Drag (Tier 0)**: draggable overlay geometry with live data readout via the shipped `AxisTransform`; commit on mouse-up. 60 fps, no per-frame Julia. *Done (first cut): `ThresholdInteractable` — a draggable horizontal/vertical line. The line lives entirely in the overlay (base PNG never redraws); mouse-up inverts the dragged pixel to a data scalar via `invertAxis` and round-trips it through `@bind`. ROI box / movable points reuse the same mechanism (deferred).*
- [ ] **Animation / scrubbing (Tier 1)**: precomputed frame sequence in the manifest + a JS scrubber; bond value = current frame/param. Latency paid once, up front.
- [ ] **Multi-select / box-select**: `Vector{InteractionEvent}` (the forward-compat extension single-select was shaped for).
- [ ] **Wide mode**: `holo(fig, …; max_width=W)` vendoring the `PlutoUI.WideCell` technique inside the widget (it no-ops under `@bind` if used externally).

## M5 — Scale & polish
- [ ] **Spatial acceleration** (quadtree/grid) for large-N hit-testing — only when the documented O(n) ceiling is actually hit (`log()` the cap until then).
- [ ] **Perf benchmarking**: the unmeasured Q5 envelope — base64 size + click latency knee; confirm MsgPack fast-path engages.
- [ ] **Theming**: respect Pluto light/dark for highlight/tooltip styling (shadow-DOM scoped).
- [ ] **GLMakie-static backend**: GPU offscreen → PNG, same `AbstractBackend` contract (for envs with a GPU).
- [ ] **Register in General** once the API stabilizes (CHANGELOG → 0.1.0 tag → Registrator/TagBot).

---

## Non-goals (by design)
3D (`Surface`, `MeshScatter`, `Arrows3D`), `PolarAxis`/`Axis3`, and **high-frequency live
redraw** (dragging a data point and reflowing the plot per frame). These need a browser-side
renderer — that's **WGLMakie's** domain, a different product. Holo stays static-base + thin overlay.

## Suggested order
M1 (make it solid) → M2.1 plot-introspection (the ergonomic unlock most users will want) →
M3 cheap-wins + M4 drag (the two highest-demand expansions) → everything else as pulled.
