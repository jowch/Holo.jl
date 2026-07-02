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

### Notes
- Validated end-to-end in real Pluto for `PointInteractable`; other interactable kinds are
  unit-tested (geometry + manifest) but not all exercised live yet.
- `Axis3` parity (WS-3D core): 3D `Scatter`/`Lines` get the same point/segment overlays with
  `{index, x, y, z}` payloads on **both** backends — static base on `:cairo`, live on `:webgl` —
  projected at build time through the shared closure (`is3d` axis transforms ship degenerate
  lims; `Axis`/`Threshold`/`ROI` interactables fail loud on a 3D axis, where a screen pixel is a
  ray). `MeshScatter` (depth-correct per-element hit radii from its data-space `markersize`, via
  the new `PointInteractable` `radius3d=` option) and `Wireframe` (rendered edge segments from
  its child) are auto-extracted too; `Arrows3D` and `Surface` remain roadmap scope.
- Current `:cairo` scoping: `PolarAxis`/`LScene` are rejected at `holo()` time — a Holo
  guard, not a CairoMakie limit (their disposition — parity item or Holo-wide non-goal — is an
  explicit roadmap decision item). High-frequency live redraw is a shared cost limit on both
  backends.
