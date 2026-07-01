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
  a browser WGLMakie `<canvas>` (client GPU) with the same overlay/`@bind` contract, covering
  3D, animation, and large/live data that `:cairo` can't. `CairoMakie`/`WGLMakie` are both weak
  dependencies gated behind package extensions; `holo(fig)` resolves whichever one is loaded and
  enforces exactly one backend per session (errors loudly if neither or both are loaded — never
  silently switches). See the README's "3D, animation, and large data" section and
  `docs/backend-comparison.md`.

### Notes
- Validated end-to-end in real Pluto for `PointInteractable`; other interactable kinds are
  unit-tested (geometry + manifest) but not all exercised live yet.
- Out of scope for the `:cairo` backend specifically: 3D, `PolarAxis`/`Axis3`, high-frequency
  live redraw. The `:webgl` backend (`using WGLMakie`) covers these — see the "3D, animation,
  and large data" section of the README.
