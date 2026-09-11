# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Initial implementation — not yet released or registered.

### Added
- `holo(fig, interactables)` — a Pluto `@bind` widget that overlays interactivity on a
  static CairoMakie figure; returns an `InteractionEvent` on click (`nothing` until then).
- `AbstractBackend` seam with `CairoBackend` (PNG; SVG groundwork). DPI derived from the
  display width (≈2× Pluto's 700px column), opaque-background guarantee.
- `AbstractInteractable` interface (`hitlayers` / `validate` / `events` / `tooltip` /
  `hoverstyle`) and built-ins: `PointInteractable`, `SegmentInteractable`,
  `RectInteractable` (list + compact grid), `PolygonInteractable`, `AxisInteractable`.
- Custom-interaction paths with no JavaScript: `RegionInteractable` (declarative regions)
  and `FunctionInteractable` (closure).
- Categorical, log, and multi-axis support; payload-based linked selection.
- TypeScript browser overlay (shadow-root, hit-testing, highlights, tooltips), bundled to
  a committed `assets/overlay.js`; manifest shipped via `published_to_js` (survives static
  HTML export); typed bond value via `AbstractPlutoDingetjes.Bonds.transform_value`.
- `WebGLBackend` (`:webgl`) — a second, co-equal `AbstractBackend`: the figure renders live in
  a browser WGLMakie `<canvas>` (client GPU) with the same overlay/`@bind` contract, making
  animation, large/live data, and live 3D cheap where `:cairo` would re-rasterize —
  a substrate/cost difference; the interaction contract is identical on both. `CairoMakie`/`WGLMakie` are both weak
  dependencies gated behind package extensions; `holo(fig)` resolves whichever one is loaded and
  enforces exactly one backend per session (errors loudly if neither or both are loaded — never
  silently switches). See the README's "3D, animation, and large data" section and
  `docs/backend-comparison.md`.
- View manipulation via `@bind` re-render (sliders): 2D `limits` zoom, 3D `azimuth`/`elevation`
  rotation, and selection persistence across view re-renders (`selected=` feedback) — no new
  API, demonstrated in `examples/view_manip.jl` (CI-run); live-verified on `:cairo` (this
  example) and on the `:webgl` slider path (the PR #37 instrumented sweep).
  Drag gestures remain roadmap scope.

### Fixed
- `selected=` now fails loud at `build_manifest` (and at overlay mount) for unsupported
  layer kinds (`segments`/`grid`/…) and out-of-range indices — same doctrine as wrong-length
  `payloads=` (`_check_payloads`). Pre-highlight remains supported for `circles`/`rects`/
  `polygons`. Mount-time `selected=` sharing `g.sel` with box-select is covered by a unit
  test (ROI commit replaces pre-highlights — one selection at a time). Closes #39.
- `selected=` pre-highlights are now genuinely persistent: they draw into the overlay's
  persistent selection group instead of the transient hover group, so they survive hovers and
  all selected indices render (previously the first hover erased them and only the last index
  showed — an M1.2 leftover from before box-select introduced the persistent group).

### Notes
- Every overlay interaction path is now exercised live in a real Pluto + browser on **both**
  backends: the `:cairo` gallery (`examples/demo.jl`) plus per-feature live-verifies, and a
  `:webgl` sweep (`test/e2e/webgl_sweep.mjs`, local tool) driving `examples/webgl_demo.jl`'s
  kitchen-sink section — template tooltips, grid `(i,j)=value` readout, colorbar 1-D value,
  polygon/region/text clicks, threshold drag, whole-axis readout, `selected=` pre-highlight,
  and `selects`-ROI box-select, all against the live canvas (12 paths, zero divergences).
- `Axis3` parity (WS-3D core): 3D `Scatter`/`Lines` get the same point/segment overlays with
  `{index, x, y, z}` payloads on **both** backends — static base on `:cairo`, live on `:webgl` —
  projected at build time through the shared closure (`is3d` axis transforms ship degenerate
  lims; `Axis`/`Threshold`/`ROI` interactables fail loud on a 3D axis, where a screen pixel is a
  ray). `MeshScatter` (depth-correct per-element hit radii from its data-space `markersize`, via
  the new `PointInteractable` `radius3d=` option) and `Wireframe` (rendered edge segments from
  its child) are auto-extracted too; `Arrows3D` and `Surface` remain roadmap scope.
- `PolarAxis` discrete overlay parity: Scatter/Lines(/LineSegments/ScatterLines) hit geometry on
  both backends via the shared projection (`Makie.Polar` in `transform_func`); `ispolar`
  transforms ship degenerate lims so continuous θ/r consumers fail loud until the polar
  transform is serialized to JS. Separable-grid/rect recipes on polar warn-and-skip.
- Current `:cairo` scoping: `LScene` is rejected at `holo()` time — a Holo guard, not a
  CairoMakie limit (`LScene` disposition remains a roadmap decision item). High-frequency live
  redraw is a shared cost limit on both backends.
