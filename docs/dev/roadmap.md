# Masque.jl — Roadmap

What is open, why, and in what order. The design contract is `architecture.md`; build and
delivery decisions are in `frontend-delivery.md`; every size and latency figure lives in
`perf-findings.md`. Priorities, not promises: reorder by demand. `#nn` is a GitHub issue or
PR on `jowch/Masque.jl`.

## Principles

- **Explicit declaration is the contract; introspection is sugar** on top of it.
- **The frontend is a stateless view. *Authoritative* state lives in Julia via `@bind`** — a
  value the notebook's own analysis depends on. Not every value Julia computes is authoritative
  in this sense: a value the notebook never reads (a mid-drag camera parameter, hover chrome) can
  be asked for and answered without going through `@bind` at all. The three-question split below
  is the sharpened form of this principle, not an exception to it.
- **No parallel server.** Inspection survives static export; clicks need a kernel.
- **Fail loud, never silently wrong** (per-capability `validate`).
- **Backends differ in cost, never in the interaction contract.** No feature ships on one
  backend that the other can never have (parity goldens in `test/fixtures/parity/`).
- **YAGNI.** Build a surface or feature when a real use pulls for it.
- **Live-verify on every backend** (`live-interaction-checklist.md`) before a user-facing
  change is called done. Interaction and visual, across the interactable kinds.

**Where a value lives — three questions, in order** (framing from #102): does the notebook need
this value (→ `@bind`)? Must it survive static export (→ precompute + `published_to_js`)?
Neither (→ `AbstractPlutoDingetjes.Display.with_js_link`, a pull channel outside Pluto's state
management — correct for chrome and transient parameters, wrong for anything the user considers
part of their analysis, since nothing it returns is recorded in the notebook)? This is the
general form the view-manipulation work below is the first concrete case of.

## Where things stand

v0.1.0 is unreleased and open: the pre-registration revisions can carry new work, and
everything below is a candidate for it. `CHANGELOG.md` `[Unreleased]` is the running record.

Shipped: `masque(fig)` auto-extraction over Scatter, Lines/LineSegments/ScatterLines, Stairs,
Stem, Errorbars/Rangebars, HLines/VLines, HSpan/VSpan, Heatmap, Image, Spy, BarPlot, Hist,
Waterfall, CrossBar, BoxPlot (box body), Band, Density, Violin, Contourf, Voronoiplot, Poly,
Text/Annotation, Colorbar, Legend, MeshScatter, Wireframe, Arrows3D (#91 tracks the full list);
explicit constructors for every primitive; `Axis`, `Axis3`, and `PolarAxis` (discrete hits) on both
backends; tooltips (`masque"…"` templates, auto table, figure-aware theme, mark-anchored
placement); selection round-trip and re-highlight; box-select via a `selects`-ROI; threshold
and ROI drags; drag-to-pan/rotate and slider-driven view changes through `@bind` re-render;
keyboard navigation and screen-reader announcements; the split-blend highlight (#93: a
brightening fill plus a darkening stroke, not a mark-derived colour, with `scatter!`'s drawn
radius replacing `markersize/2`); the `:cairo` (PNG) and `:webgl` (live canvas) backends behind
one contract; a Documenter site with static notebook exports; and eight CI jobs covering Julia
on two versions, the no-backend error path, the WGLMakie extension with its own real-browser
end-to-end check, a second through-Pluto bind end-to-end, every example notebook, the frontend,
Runic, and an advisory live kind sweep.

## In flight

- **#49 Registration prep** (draft, stale): superseded rather than merged. TagBot, the
  `Base64` compat bound and the README install line reached `main` by other routes, but its
  `test/registry_readiness.jl` was deliberately dropped in #55, its `docs/` paths moved under
  `docs/dev/`, the `releasing.md` it added is deleted by this PR, and the changelog freeze it
  proposed is explicitly reversed. Close it; nothing in it is still wanted.

## Open work

### Release

- **Register v0.1.0 in General.** When the maintainer decides the API has stopped moving;
  there is no fixed cut. Mechanics are one row in `frontend-delivery.md` (register a CI-green
  `main` commit; TagBot tags).
- **After registration:** drop `Pkg.develop` from the example notebooks (Pluto's package
  manager takes over) and re-enable the Binder link in `docs/export_notebooks.jl`.

### View manipulation and the remount (#82, tracking)

`ViewInteractable` is commit-on-release: nothing moves during the drag, and the commit
replaces the cell output, which on `:webgl` is a blank canvas plus a scene re-init. Two
problems and six children: three steps in this order, plus #86, which corrects an earlier
claim rather than adding work, #83, which investigated the double remount to a close rather
than a fix, and #102, which reframes the remount problem for gestures generally.

1. **#84 Last-frame hold.** Park the last painted frame (Cairo PNG `src`, or a bitmap from the
   WGL canvas) and show it until the new base is ready. Hides the remaining remount. Not a
   GL-context transfer: a context cannot move to a new canvas.
2. **#85 2D photographic preview.** During pan and wheel zoom, CSS-transform the host so the
   base and overlay slide together; commit the existing `limits` payload once on release or
   wheel idle. Julia authored the frame being slid, so this is not a client camera. Accepted
   artifacts: ticks and decorations move with the photograph until the commit.
3. **#87 3D orbit preview**: no longer parked — **#102 makes it buildable.** The blocker was
   that the overlay is a projection at the old `azimuth`/`elevation`, so a live orbit either
   freezes the overlay or needs 3D coordinates in JS, and neither respects the
   Julia-authored-projection principle this list is written to keep. #102 answers it: route the
   gesture through `with_js_link` and have Julia return a fresh manifest on every frame, so
   projection stays Julia-authored throughout the drag, not just at commit. `perf-findings.md`'s
   manifest rebuild figure (flat regardless of scene weight) is what makes a fresh manifest per
   frame affordable. Still commit-on-release for the final `@bind`ed value; #102 changes what
   happens *during* the drag, not what gets committed at the end.

**#83 investigated the double remount to a close: unsupported-shape behaviour, not a bug.** The
view-manipulation widget cell both defines the `@bind` and reads its own previous bond value back
(the camera-`Ref` pattern the steps above build on, and the same shape `selected=`-style click
persistence relies on) — a cell that does that is not a sanctioned Pluto use case. The mechanism
traces into Pluto's own bond-cache timing (a cached entry is deleted and re-added several times
within one reactive cascade, and the listener that would skip resending an unchanged mount-time
value lands in the window where the entry is absent). Two candidate Masque-side fixes were built
and rejected: dropping the `host.value` clobber, and replaying the last real value instead of
`nothing` (catastrophic in the #83 investigation's own testing — 379+ evaluations from a single
drag; this figure lives in the issue, not `perf-findings.md`). There is no Masque defect to fix
and no Pluto defect to report; closed not-planned, nothing left to build. **#102 routes around it
rather than fixing it**: a gesture channel that never remounts makes the double remount stop
mattering for view manipulation specifically, but the same self-referencing shape is still live
for every other bond in the notebook that uses it. #103 retires the main reason users write that
shape at all (the `selected=` self-referencing workaround) — the more durable answer for those
callers.

**Open, deliberately: whether live preview or commit-on-release is the default.** #102's numbers
bound what is *possible* — viable on a light scene, not on a heavy one at the resolutions
tested (`perf-findings.md`) — they don't settle what the default should be, per backend and
possibly per scene weight. That choice is left for when a real implementation exists and can be
felt, not picked from spike numbers alone. A default right for a 240-point helix may be wrong for
a large surface; the honest answer may be that it adapts rather than being fixed.

**#86 corrects an earlier roadmap claim.** The camera-only resident-scene patch for `:webgl`
is gated on DOM identity, not payload size: Pluto destroys the `<canvas>` on every cell
replacement. It needs a portaled canvas outside the cell output or a Pluto that morphs
instead of replacing. Do not build `find_plots` camera patching as if the scene survived.
Reopen only after #84 and #85 exist, commit is still too slow on large scenes, and a
canvas-identity strategy keeps projection Julia-authored.

### Overlay interactions

- **#92 Cursor slice / crosshair.** A first-class probe: invert the pointer to data x (or y),
  sample attached 1-D series client-side, draw a hairline plus dots, show every series' value
  in the tooltip. Replaces the notebook workaround of baking hundreds of full-height segments.
  Hover-only by default; gated like the other continuous invert consumers (2D `Axis`, fail
  loud on Axis3/Polar). Wants #89 so a `lines!` is one series to sample.
- **#88 Right-click passthrough.** Ignore non-primary buttons in drag start, and let
  `contextmenu` land on the base `<img>` so the browser's Save image as… works on `:cairo`.
  No custom menu. `:webgl` gets no image menu without a canvas snapshot (out of scope).
- **Cursor should say what pressing will do.** The surface already defaults to `crosshair`,
  which is right, and the drag kinds already pick a cursor per part through
  `cursorForDragHit`. The gap is everything else: hovering any hittable element sets one
  binary `hot` class, so every non-drag kind becomes the finger `pointer`. A heatmap therefore
  reads as a button across its whole area when the user is reading a value, not pressing
  anything. Replace the binary class with a per-kind mapping. `pointer` is genuinely right for
  a legend entry and arguably for a discrete mark that emits a bond, while a grid wants
  `crosshair` or the CSS `cell` cursor, which exists for exactly this. Decide the map once
  rather than special-casing heatmap.
- **Smaller, corners-only ROI handles.** Decided: drop the four edge-midpoint handles, shrink
  the corner squares, and fill them for contrast against the figure rather than in a fixed
  colour, light on a dark figure and dark grey on a light one. Edges stay resizable, losing
  only their drawn handle: hovering one still shows the vertical or horizontal resize cursor,
  which becomes the whole affordance. The theme half needs no new machinery, since tooltips
  already derive from the figure background through `--masque-fig-bg`. Take the handle size out
  of the manifest while here. Julia ships `handle` as 8 logical px times the DPI scale, in
  image pixels, only so it lands in the same coordinate space as the ROI rect. It is pure
  chrome that no Julia value depends on, and shipping it that way is actively worse: the
  overlay is displayed at `width:100%`, so an image-pixel handle grows and shrinks with the
  figure instead of staying a constant size on screen. A client-side constant in CSS pixels is
  both simpler and more correct. The eight-handle recipe is written into `CLAUDE.md` and the
  live checklist as locked, so both change with it, the same way #93 moved the highlight
  recipe.
- **The browser's focus outline boxes the whole figure on a heatmap.** The overlay surface is
  a focus stop, and the default `:focus-visible` outline is suppressed only once Masque draws
  its own keyboard focus ring, through the `kbd-ring` class. Grid layers are deliberately not
  keyboard-focusable, so on a heatmap that ring never appears, nothing suppresses the browser
  outline, and focusing the figure draws a rectangle around the entire surface. This is not
  specific to heatmaps: it is any figure where focus lands on the surface without producing a
  Masque ring. Suppress the default outline on its own terms rather than as a side effect of
  drawing a ring, without costing keyboard users their focus indicator.
- **Highlighting a large element washes the whole plot.** The hover and selected recipes
  assume an element is a small discrete mark, so they stroke and fill the element itself. That
  is wrong for any element covering much of the axis, and several shipped kinds do: `density!`
  and `band!` are a single polygon each, a span rect is clamped to the full axis viewport, an
  outer `contourf!` level or a boundary Voronoi cell can cover most of the plot, and lines from
  `hlines!` span the limits. Feedback that repaints the entire plot area is a flash, not a
  signal. Decide what the recipe becomes at that scale, perhaps outline only, or an indicator
  at the cursor rather than over the element. Related to the probe in #92, which is the other
  half of making a large filled region readable.
- **Keyboard equivalents for drags**: arrow-key nudging for threshold, ROI, and view
  interactables. Promised as "on the roadmap" in the site's accessibility page.
- **Animation / scrubbing**: precomputed frames in one manifest plus a JS scrubber; bond value
  is the frame or parameter. Gated on payload, not latency: frames × per-frame PNG is the hard
  ceiling in `perf-findings.md`, so per-frame cost must shrink first (downscale, fewer frames).
  A pull channel (#102) inverts this: ship zero frames up front, request frame *k* on demand over
  `with_js_link`, and the constraint becomes per-request latency instead of total payload.
  Animation stands to benefit more from this than orbit does, because its frame set is
  enumerable and cacheable — after one pass through, every frame requested once is local — while
  orbit's `azimuth`/`elevation` parameter space is continuous and never fully caches. Open,
  unresolved by #102: the **container** question. N separate per-frame PNGs are far larger on
  the wire than one inter-frame-compressed GIF, but an animated GIF hides the current frame from
  the overlay, so frame-accurate hit geometry is lost the moment the browser owns frame
  advancement instead of Julia. A possible way out is splitting static geometry (ships once) from
  per-frame values (pulled), but that is not designed here. Also relevant: Pluto itself preserves
  GIFs through an HTML export — `image/gif` is a first-class MIME in `PlutoRunner`'s MIME
  handling, image MIMEs keep their raw bytes, and `CellOutput.js` has an explicit case for them.
  That sets a compatibility floor: a Masque animation feature must not be worse than a plain GIF
  for export, which argues for embed-by-default (works everywhere a GIF does) with live-pull as
  an opt-in on top, not a replacement for it.
- **`:webgl` in-place buffer patching API**: the manual `find_plots(uuid)` technique works for
  data updates on a canvas that is still alive; wrap it in a Julia uuid accessor and a JS
  `updatePlotData(uuid, attr, frame)` helper. Same canvas-identity caveat as #86 across a
  remount.
- **Wide mode**: `max_width` already sets the render width; the cell-widening half (vendor
  `PlutoUI.WideCell`'s technique inside the widget, since WideCell no-ops under `@bind`) is
  not built. A `max_width` change forces a full re-render, not a CSS resize.
- **A Julia-declared theme, injected into the browser.** Wanted: a lightweight way for a user
  to set the overlay's look from Julia, which means every style becomes variable-controlled
  rather than baked in. Gated on a feasibility spike before any design is settled; this entry
  records what the spike starts from, not an answer. Supersedes the narrower idea of exposing
  hooks for the highlight recipe alone.

  The pattern is already proven on one surface. Tooltips take `tooltip_*` keywords in Julia and
  land as custom properties inside the shadow root, which is most of the `--masque-*`
  properties that exist today. Custom properties inherit across the shadow
  boundary, so the transport works and nothing leaks into the notebook.

  The gap is that the rest is not CSS at all. The hover, selected and link recipes set their
  stroke widths, opacities and the halo radius as literals through `setAttribute` in
  `highlight.ts`, so no custom property can reach them. Making them themeable is a refactor of
  imperative drawing code, not a stylesheet edit, and that is the part the spike should size
  first.

  Three questions it should answer. Whether the Julia surface mirrors Makie's own `Theme` and
  `set_theme!` vocabulary that users already know, or stays a flat keyword set like
  `tooltip_*`. Whether there is a raw-CSS escape hatch or structured keys only. And how far it
  reaches, since the locked chrome recipes in `CLAUDE.md` become defaults rather than constants
  the moment any of this ships.

### Surface coverage

All Julia-side extractors over existing primitives. The live extracted/skipped table is #91;
tick it and update the docs page (#90) whenever `_plotbase` grows a branch.

- **#89 `lines!` and `series!` as whole lines.** A `lines!` hit is one element with one
  payload, and the highlight traces the whole polyline, instead of one interactable per edge.
  `series!` becomes one layer with N polylines. `LineSegments`, Errorbars, HLines, Wireframe,
  and Arrows3D stay per-piece.
- **Informative default payloads for statistical recipes.** `architecture.md`'s rule is hit
  geometry from the rendered shape, payload values from Makie's computed values. Some
  extractors follow it — `violin!` ships `(; x)`, `contourf!` `(; low, high)`, `boxplot!`
  `(; q1, median, q3)`, `barplot!`/`hist!`/`waterfall!` `(; low, high, value)`, and `crossbar!`
  `(; midpoint, low, high)`. Others fall through to the
  primitive's generic `(; index)` and so tell the user nothing they can't see: `density!` and
  `band!` are each a single polygon whose entire payload is `index = 0`, and `voronoiplot!`
  ships a cell index where the generating point would be more useful. Give these the
  statistics Makie already computed, so the default hover is worth reading before anyone
  writes a `masque"…"` template. Distinct from #92: the probe answers "what is the height
  at this x", this answers "what is this shape". The field list per recipe is the issue's
  job, not the roadmap's.
- **Composite recipes.** `rainclouds!`, `hexbin!`, `textrepel!` and any recipe whose parent
  is unknown are skipped without visiting known children. Add a generic child walk for
  unknown parents (with a double-register guard for recipes that later get their own
  constructor), and warn with the recipe name rather than `Plot` (#91 comments).
- **Named gaps from #91**, cheapest first: `ablines!`, `arc!`, `stephist!`, `ecdfplot!`,
  `qqplot!`, `bracket!`, `timeseries!`, 2D `arrows!`, `pie!`, `contour!` lines,
  `tricontourf!`/`triplot!`, `dendrogram!`, `streamplot!`, `hexbin!` (needs hex polygons and
  count payloads), `datashader!`, `mesh!`, `volume!`/`voxels!`. Not a commitment to all of
  them; each waits for a real use.
- **`TextLabel`**: a `Block`, not a plot, so it needs the figure-block walk `Colorbar` and
  `Legend` use. Small.
- **Legend follow-ups.** First, tick Legend in #91's table, which still lists it as not
  auto-extracted even though #94 merged. Two further gaps, both already tracked elsewhere: an
  entry cannot highlight a `:grid` target, which is one of the grid's special cases listed
  above, and `series!` entries resolve to no layer until #89 extracts series. Separately,
  Makie's own `Legend(fig, polaraxis)` raises a `MethodError`, which is upstream rather than
  ours but worth confirming before promising polar legends.
- **Contour family**: compound polygons (ring groups) so Contourf levels with holes hit-test
  correctly.
- **HLines/VLines fractional span attributes** (`xmin`/`xmax`, `ymin`/`ymax`): ignored today,
  lines always span `finallimits`.
- **Dense cell fields: revisit `heatmap!`/`image!` and `surface!` together.** Not two items.
  The shipped `:grid` works but is the awkward corner of the contract, and designing `surface!`
  on its own would build a second corner with the same shape.

  What is awkward today. `:grid` is the only one of the six geometry kinds that is not a list
  of elements, so it needs its own hit-test branch, its own selection result, its own tooltip
  behaviour with no per-element payload, no keyboard focus, and it cannot be a highlight target
  for a legend. Its `values[]` matrix is the only term in the manifest bounded by source
  resolution rather than by display size, which is why it needs the on-screen-size cap at all.
  That cap makes the user-visible contract depend on a rendering detail. It is one
  all-or-nothing decision per grid, taken from the average cell size, so the same heatmap hovers
  values at one display width and only `(i, j)` at a narrower one.

  What `surface!` adds. The same dense cell field and the same unbounded per-cell payload, plus
  self-occlusion and a hit-test that is no longer a 2-D bin search. Its occlusion policy is
  already settled in `architecture.md`: document-and-accept on both backends, with a build-time
  CPU cull in Julia as the upgrade path, since GPU picking is a Masque-wide non-goal.

  The question to answer once, for both, is now three-way rather than binary:

  - **Push** per-cell values into the manifest at build time, as today plus a cap — export-safe,
    but the user-visible contract depends on a rendering detail, described above.
  - **Pull** per hit from the kernel that clicks already require ([#102](https://github.com/jowch/Masque.jl/issues/102)
    makes this concrete: `with_js_link` is exactly a mechanism for "pulled per hit from the
    kernel," previously unmechanized here) — removes the cap and the resolution-dependent
    contract, but hover stops working in a static export, which the principles say inspection
    should survive.
  - **Subsample to display resolution**
    ([#105](https://github.com/jowch/Masque.jl/issues/105)) — keep the push model, so nothing
    changes about when a kernel is needed, but bound the shipped payload by *display size* rather
    than *source resolution*: report the one cell (or the aggregate of the cells) under each
    screen pixel, not the whole matrix. This retires the `values[]` cap outright, the same way
    pull would, without giving up static-export safety. The argument isn't just convenience: a
    cap is an arbitrary size threshold, whereas declining to report per-cell values for cells the
    user cannot individually point at is a statement about what hovering *means* — a subpixel
    cell isn't hoverable in any meaningful sense, so shipping it a value was never buying real
    fidelity.

  Subsampling and the gesture channel compound if both ship: with #102 making zoom cheap,
  fidelity under subsampling becomes **navigable rather than fixed** — a user who wants the exact
  value at a cell zooms in, fewer source cells land under each screen pixel as they do, and the
  subsample resolves progressively finer. That turns a fixed contract compromise (pick a
  resolution once, live with it at every zoom level) into an interaction.

  Keep this distinct from the heavy-scene render latency in `perf-findings.md` (an 80×80
  `surface!` case) — that cost is dominated by Makie's own draw time, not by payload or hit-test,
  so subsampling what gets *reported* does nothing for it. Decimating what gets *rendered* during
  a gesture — a coarser frame mid-drag, full fidelity on release, in the spirit of #85's already-
  accepted "ticks and decorations move with the photograph until the commit" — is the separate
  companion idea for that cost; named here, not designed.

  Answer the push/pull/subsample question before any of the three is built on further.

- **PolarAxis continuous θ/r readout**: ship `Makie.Polar` (and the letterboxed scene limits)
  to the JS `invertAxis` so `AxisInteractable`, thresholds, ROIs, and the #92 probe work on
  polar axes.
- **`LScene` disposition**: decide whether it is a parity item or a Masque-wide non-goal. Until
  then `:cairo` rejects it and `:webgl` renders it with no overlay.

### Docs

- **Flesh out the site.** Thirteen pages, several of which read as reference rather than
  instruction. Each interactable and each keyword wants a worked example a reader
  can paste, the recipes that carry a non-obvious payload want that payload shown, and the
  common tasks (highlight what I clicked, drive a second cell from a selection, theme a
  tooltip) want a short end-to-end page each rather than a keyword mentioned in passing.
- **Show the interaction on the doc pages, not just in the README.** #80 shipped the hard
  part: a demo GIF, the logos, and a purpose-built recording harness in `docs/dev/readme-demo/`
  that drives a real Pluto session with Playwright and assembles frames into a GIF. The asset
  question is answered by that precedent, `docs/src/assets/` at about 100 KB for a GIF. What is
  still missing is reach: the GIF is referenced only from the README, so every page of the site
  itself still shows nothing moving. Extend it, splitting by the "clicks need a kernel"
  principle:
  - **Live embeds** for hover, tooltip and highlight. The static Pluto exports the docs build
    already ships keep the overlay alive in the browser, so these can be real rather than
    recorded, and a reader hovers the doc page itself.
  - **Recorded GIFs** for anything a kernel has to answer: the `@bind` round-trip, selection,
    threshold and ROI drags, view pan and rotate. A static export cannot show these.
  - Open: recorded media rots when overlay chrome changes, and #93 landed, changing the
    highlight recipe — every existing GIF showing a hover or a selection, including the one
    #80 shipped, is dated now, not at some future point. The harness makes re-recording cheap
    but not free, since it needs a live Pluto plus `ffmpeg` and is a manual run today. Decide
    how many of the dated scenarios are worth re-recording now, and how many are worth keeping
    current going forward.
- **#90 Supported-recipes page**: one lookup table (recipe, layer id, kind, hit unit, Axis /
  Axis3 / PolarAxis) sourced from `_plotbase`, linked from Home, Getting started, and
  Interactables. Kept in lockstep with #91.
- **#81 WGLMakie cell pattern**: return `masque(f)` from the construction cell instead of
  displaying a `Figure` (whose MIME show waits on a Bonito session Pluto never starts).
  Update `backends.md`, `getting-started.md`, `troubleshooting.md`, and `examples/webgl_demo.jl`.
  - **Open: should Masque enforce this in code, not just docs?** Idea under discussion — when
    `WGLMakie` is loaded and we are inside Pluto, intercept the figure's HTML show so a raw
    `Figure` yields an `@info` pointing at `masque(fig)` instead of a spinner that never
    resolves. The decision is whether that is worth a `Base.show` method for a Makie type from
    Masque's extension (piracy on another package's display path, affecting users who never
    call `masque`), or whether the guidance stays documentation-only as #81 proposes. Not
    decided; file an issue if we want it.

### Output and scale

- **SVG output path**: nothing exists; the old `vector` scaffolding was removed as dead code.
  Gate behind a viability spike (primitive-count threshold; SVG uses `pt_per_unit/0.75`).
  Sparse plots only, dense plots stay PNG.
- **Non-Pluto fallback in `show`**: inline the manifest and guard `currentScript`/
  `invalidation` so exports made without a Pluto runtime (PlutoStaticHTML) mount the overlay.
  Optional; static Pluto exports already work.
- **Spatial acceleration**: demand-gated and may never be built. JS hit-test is measured at
  effectively zero cost; the high-N wall is manifest payload size. Build only if a profile
  shows hit-test itself, not serialize/transfer, is the bottleneck.
- **GLMakie-static backend**: GPU offscreen → PNG behind the same `AbstractBackend`. Needs
  the projection helpers moved off CairoMakie first. Optional.

### Tooling

- **Early warning on Makie internals.** The extraction layer reads Makie internals heavily and
  compat pins one minor each of Makie, CairoMakie and WGLMakie. Keep pinning minors; that is
  the normal practice, and CompatHelper already proposes the bumps nightly. The gap is
  detection, not policy. CompatHelper only reacts to a released version, and `CI.yml` runs only
  on push and pull request, so a Makie change that moves an internal Masque reads surfaces when
  someone opens a pull request after the bound moves rather than before. Add a scheduled run of
  the canary and compat testsets against Makie's development branch, advisory like the kind
  sweep. Two things decide whether it earns attention. Scope it to the deterministic canaries
  rather than the whole suite, because the live sweeps already flake and a job that is often red
  for unrelated reasons gets ignored. And Makie, CairoMakie and WGLMakie ship from one
  repository, so the job tracks all three from a single checkout.
- **Promote the `kind-sweep` CI job to a required check** once the WebGL "hover cleared
  instantly (no remount fade)" flake is fixed. Until then agents run the sweep locally.
- **Payload-size delta per pull request, modelled on Codecov.** Payload size is the wall the
  design is organised around and every new manifest field pushes on it, so the question worth
  answering at review time is how much a change cost. Report the delta against the merge base
  with a tolerance, the way `codecov.yml` already does for coverage, rather than gating on an
  absolute number that would go stale. Three things it needs. `bench/payload_envelope.jl`
  prints formatted tables today, so it needs a machine-readable mode before anything can diff
  it. Compare sizes only and leave latency out: the bench models msgpack bytes as a pure
  function of the manifest, which is deterministic, while its render-latency section is
  wall-clock and would flake. And pick the tolerance deliberately, since `codecov.yml` already
  carries the scar of an unconfigured threshold failing a pull request on noise. The payoff
  beyond review is that `perf-findings.md` is the single source of these numbers and is meant
  to be re-run whenever the wire format changes; a delta says when that reconciliation is owed
  instead of relying on someone remembering.
- **Reconcile `perf-findings.md` scene payloads** with the sizes seen in the static notebook
  exports (glyph atlas tiles account for most of the gap).
- **Editor-lag knee**: measure Pluto editor stutter at MB-scale output. Only worth doing if
  animation ships.

## Directions (not filed, not committed)

Ideas that fit the contract and could become issues if a use pulls for them. Kept short on
purpose: enough to recognise the idea later, not a design.

**Conventions users arrive expecting.** Each is the missing companion to something already
shipped, which is a better filter than what other libraries happen to have.
- **Legend click toggles series visibility.** Every comparable tool does this, and Makie's own
  legend does it, so an interactable legend that only highlights will read as half-finished.
  Visibility is Julia state, so it is a bond round-trip and a re-render rather than overlay
  chrome.
- **Double-click resets the view.** The standard companion to drag-to-pan and wheel zoom.
  Restores the figure's original limits, or azimuth and elevation in 3D.
- **Modifier-click for additive selection.** Shift to add, and the platform modifier to
  toggle. Clicks are single today and box-select already returns a vector, so the contract
  this would extend exists.
- **Cancel and clear.** Escape aborts an in-progress threshold, ROI or view drag and restores
  the value it started from; clicking empty space clears the current selection. Escape clears
  focus today, which is a different thing.
- **Pin a tooltip.** Click to keep a tooltip open so its numbers can be read or copied,
  instead of losing it on pointer-leave.

**Linking and selection**
- **Cross-layer and cross-figure links.** The `links` field that shipped with the legend
  generalises: hovering a point in one axis highlights the same index in a facet, a table row,
  or a second `masque` widget sharing a bond. Within one figure that is mostly a question of
  how a user declares the link, since the fan-out already exists. Reaching a second widget is
  a larger job: the fan-out resolves ids against a single manifest, and each mount owns a
  private shadow root with no registry between them.
- **Colorbar range select.** A `selects`-style drag on the colorbar returns the cells (or
  points) whose value falls in the dragged range; the client only needs the range, Julia
  resolves membership.
- **Lasso / polygon select** beside the box ROI, same `Vector{InteractionEvent}` contract.
- **Client-side click-echo selection ([#103](https://github.com/jowch/Masque.jl/issues/103)).**
  Retire the five-cell self-referencing-`selected=` workaround in `selection.md` by having the
  overlay track "what was clicked" itself, in the browser, so a widget cell never needs its own
  bond fed back. `selected=` stays purely declarative on the Julia side. Resets on remount by
  design (a remount means the figure was rebuilt, and indices from before it may no longer mean
  the same thing); persistence across a rebuild becomes an explicit `selected=` from the user,
  not an inferred default. Also the reason a self-referencing `selected=` widget and a
  `with_js_link` gesture channel (#102) don't have to coexist: moving click-echo off the
  reactive path removes that collision by construction.
- **Selection persistence across reload.** Rehydrate `selected=` and the last bond from
  `sessionStorage` so a re-opened notebook shows the state the user left.
- **Nearest-mark snapping.** An opt-in hover mode that picks the nearest mark within a radius
  instead of requiring the pointer inside it; sparse scatter and thin lines benefit.

**Probing and readout**
- **2D profile probe.** #92 in two dimensions: hovering a heatmap cell shows the row and column
  profiles as sparklines in the tooltip or as overlay traces along the axes.
- **Delta readout.** Two parked probe lines (or a two-click gesture) report the difference
  in x and each series' y between them.
- **Hit priority control.** Hit-test is first-match in manifest order, and the legend work
  already had to hardcode a precedence rule: legend layers sort ahead of plot geometry so an
  in-axis `axislegend` does not lose contested pixels to the plot beneath it, with `:view`
  still last. A per-layer priority would replace that special case rather than add a second
  one, and a cursor probe would need the same thing.

**Tooltips and chrome**
- **Richer tooltip content.** Small inline images or sparklines from a payload column, under
  the same payload budget the template macro respects; markdown-lite formatting.
- **High-contrast mode.** Honour `prefers-contrast`, alongside the existing keyboard and
  screen-reader support. `prefers-reduced-motion` already ships.
- **Touch gestures.** Long-press for tooltip, one-finger pan, pinch to zoom mapped onto the
  #85 preview and a single commit.

**Coverage and payload**
- **Level-of-detail hit layers.** For high-N scatter, ship a decimated layer plus per-cell
  counts and resolve exact membership in Julia on click; the manifest is the measured wall.
- **Manifest compaction.** Delta or column-wise encoding of per-element geometry and payload
  columns before MsgPack; re-run `bench/payload_envelope.jl` to decide.
- **`DataFrame`-backed payloads.** Accept a table as `payloads=` and let `masque"…"` name its
  columns, so tooltips and bond values carry the user's own row.

**Hosts beyond Pluto**
- **Static inspector export.** A `save_html(widget)` that writes a self-contained page with the
  hover layer alive and no bond, for Documenter pages and sharing.
- **Other notebook hosts.** An inspection-only mode without `@bind` for IJulia and Quarto,
  reusing the non-Pluto `show` fallback above.

**Testing**
- **Overlay visual regression.** Golden screenshots of hover, selected, ROI, and tooltip
  chrome from the kind sweep, diffed in CI once the sweep is a required check.

## Non-goals

- **Client-side GPU camera.** A camera Julia never hears about desyncs the Julia-projected
  overlay and is structurally `:webgl`-only. #85 and #87 are written to respect this.
- **GPU-pick occlusion.** Same reason; the symmetric alternative is the CPU cull above.
- **High-frequency live redraw** as a smooth-drag guarantee. Per-frame kernel round-trips are
  a shared cost limit on both backends. #102 measured this limit rather than lifting it: a light
  scene lands in an interactive frame-rate range over `with_js_link`, a heavier scene does not,
  on the same mechanism. A viable case on one scene is not a guarantee across scenes, and does
  not reopen this non-goal.
- **Per-backend feature splits.** `:cairo` ships a static base, `:webgl` a live canvas; the
  difference is cost.
- **A live Bonito connection** under `:webgl`. That is a different product.

## Order

A proposed sequence, not a decided one. Only the dependency edges are real: #92 wants #89,
#85 wants #84, #86 is not reconsidered until #84 and #85 exist, and registration wants
the API to have stopped moving. (#83 closed not-planned — nothing left to build, so it is not
a dependency of anything below.)

1. Resolve #49.
2. Pre-registration revisions, including new work wanted in 0.1.0. Self-contained and cheap:
   #88, #89, #81, #90, keyboard drag nudging, and the composite-recipe child walk.
3. The remount path (#84 hold, then #85 preview). Both backends, live-verified on view-pan.
4. #92 cursor slice, after #89.
5. Register v0.1.0, then the notebook cleanup (drop `Pkg.develop`, re-enable Binder).
6. Remaining coverage items as demand arrives (#91 list).
7. Payload-gated items (animation, LOD layers) wait on a measured per-frame or per-element
   cost reduction.
8. Spike-gated items wait for a real use or for the spike that sizes them: the Julia-declared
   theme, SVG output, spatial acceleration, GLMakie-static.
