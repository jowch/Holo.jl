# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Vitest coverage for `frontend/src` uploads to Codecov (`flags: frontend`).
  Committed `assets/` bundles are ignored.

### Removed
- Dead `vector`/`mount` scaffolding: `CairoBackend(; vector=false)` and the
  `AbstractBackend` `mount` interface function (plus `WebGLBackend`'s `mount = :webgl`
  method) had zero callers — `Holo.render` always rasterizes to PNG, and `Base.show`
  hardcodes a PNG `<img>`. SVG output remains a roadmap item to build from scratch
  (`docs/roadmap.md`), not groundwork already in place.

### Changed
- `hoverstyle(::AbstractInteractable, ::Int)` narrowed to `hoverstyle(::AbstractInteractable)`
  — the manifest ships one hover style per layer, not per element; the old per-element
  signature implied styling that was never actually per-element.
- Browser TypeScript lives in one `frontend/` package with two modules: the
  shared overlay IIFE (`assets/overlay.js`) and the `:webgl` ESM shim
  (`assets/holo-webgl.js`, source `frontend/src/wgl-shim.ts`). The old
  `frontend-webgl/` package and its CI job are gone.

### Fixed
- `SegmentInteractable(...; mode=...)` now validates `mode` at construction
  (`ArgumentError` for anything but `:polyline`/`:pairs`) instead of silently treating any
  other symbol as `:pairs`.
- `RectInteractable(ax; grid=(xedges, yedges, values))` now validates `values` has shape
  `(length(xedges)-1, length(yedges)-1)` at construction, instead of surfacing a raw
  `BoundsError` inside `hitlayers`. A non-`Matrix` `values` (e.g. `nothing` or a vector)
  now raises the same `ArgumentError` instead of a bare `MethodError` from `size`.
- `tooltip = true` (never meaningful) now fails at interactable construction, with the
  same error message as before, instead of only failing later at manifest build.
- `holo(fig, interactables)` finalizes the figure only after the caller has already built
  `interactables` — unlike `holo(fig)`, which finalizes first. `SegmentInteractable`/
  `RectInteractable` built from `HLines`/`VLines`/`HSpan`/`VSpan` plot objects could bake
  stale `ax.finallimits[]` into the span geometry if constructed before the figure was
  finalized. They now defer that axis-limits read to `hitlayers` time (resolved fresh
  against the finalized axis), matching `TextInteractable`'s existing
  construction-vs-hitlayers split for layout-dependent reads.

### Internal
- Every non-public Makie/WGLMakie/Bonito internal Holo relies on (`converted`, child
  `plots`, `finallimits`, scene `viewport`, Contourf's `computed_levels`, a Colorbar's
  `computedbbox`, `string_boundingboxes`, `transform_func`/`apply_transform`/`project`,
  `update_state_before_display!`, and the WGL-only screen/serialization internals) now
  goes through one small fail-loud accessor in `src/makie_compat.jl` (WGL-only internals
  route through an equivalent block in `ext/HoloWGLMakieExt.jl`). A future Makie/WGLMakie
  bump that moves one of these surfaces now fails with one clear message at the accessor,
  not scattered wrong-pixel/`MethodError` symptoms across the codebase. Added a canary
  testset (`test/makie_compat_tests.jl`, first in the Core group) asserting each
  accessor's actual return shape, including that a moved/renamed internal produces the
  compat error rather than a raw exception. A CompatHelper workflow (so Makie/CairoMakie/
  WGLMakie compat bumps arrive as PRs that run this canary automatically) is planned as a
  follow-up — not part of this change. Pure internal
  refactor — no manifest/payload/behavior change (parity goldens pass unchanged).

## [0.1.0] - 2026-09-12

First General release. Frozen after drag-to-pan / drag-to-rotate
(`ViewInteractable`, #48) and the overlay visual / live-verify playbook (#50,
#52, #53) — not a sliders-only shortcut. Jonathan comments
`@JuliaRegistrator register` on a CI-green `main` commit after the prep PR
merges. See [`docs/releasing.md`](docs/releasing.md).

### Changed
- Overlay hover skips rewriting tooltip HTML and remeasuring tip size on
  same-hit `mousemove`; extra pointer ticks coalesce to one animation frame.
  The 100 ms fade and locked wash / ring recipes are unchanged.
- Agent live-verify playbook (`docs/live-interaction-checklist.md`) now requires
  **visual** fidelity as well as interaction: wash / ring / halo / overlay-pin,
  remount fade (no pulse), Pluto/OS `prefers-color-scheme` (no notebook toggle),
  and steel-teal `#3A6F7C` not `#ff3b30`. Agents run `kind_sweep.mjs` **and**
  `polish_verify.mjs` on Cairo and WGL across the interactable kinds.
- Overlay chrome uses the locked inspector ink `#3A6F7C` (JS fallback + Julia
  `hoverstyle` default) instead of iOS-alert red `#ff3b30`. Hover is stroke-only;
  selected closed geometry gets a wash fill; selected open kinds (segments /
  polylines) get a two-stroke ring. Tip show/hide and highlight mount fade in
  100 ms on state change (not remounted on every pointer frame) and honor
  `prefers-reduced-motion`. The tooltip card is edge-clamped
  with caret flip. Tooltip dark follows `prefers-color-scheme` (official Pluto's
  theme signal; there is no notebook toggle). `selected=` now accepts `segments`
  / `polyline` so the ring recipe is reachable; `grid` / `axis` / … still fail
  loud.

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
  dependencies gated behind package extensions; `holo(fig)` resolves whichever one is loaded
  (errors if neither is). If both are loaded, `backend=` wins and implicit `holo` defaults to
  Cairo. See the README's "3D, animation, and large data" section and
  `docs/backend-comparison.md`.
- View manipulation via `@bind` re-render: 2D `limits` zoom/pan, 3D `azimuth`/`elevation`
  rotation, and selection persistence across view re-renders (`selected=` feedback).
  Sliders need no Holo API; **drag-to-pan / drag-to-rotate** use `ViewInteractable`
  (commit-on-release; Shift+drag arbitrates vs box-select/ROI). Demonstrated in
  `examples/view_manip.jl` (CI-run); live-verified on `:cairo` and `:webgl`.
  Live drag *preview* (high-frequency redraw) remains deferred with animation.
- `Arrows3D` auto-extraction on `Axis3`: `SegmentInteractable(:pairs)` from processed
  `startpoints`/`endpoints` (DATA space), with `{index,x,y,z,u,v,w}` payloads. Raw
  `pos→pos+dir` is intentionally not used — it misses under `lengthscale`/`align` and the
  MeshScatter children live in float32convert space (premise from #36).

### Changed
- Cloud sysimage bake is CairoMakie (+ Makie, Pluto, Holo workload) only — WGLMakie is
  not preloaded. Default `julia` still uses `-J` that image; `JULIA_NOSYSIMAGE=1` is the
  stock/WGL live-verify escape hatch.
- `_resolve_backend` no longer throws when both backends are loaded: honor `backend=` or
  default to Cairo. Still throws when no backend is loaded.

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
- Every overlay interaction path is now exercised live in a real Pluto + browser on **every
  supported backend** (today `:cairo` and `:webgl`): the `:cairo` gallery (`examples/demo.jl`)
  plus per-feature live-verifies, and a `:webgl` sweep (`test/e2e/webgl_sweep.mjs`, local tool)
  driving `examples/webgl_demo.jl`'s kitchen-sink section — template tooltips, grid `(i,j)=value`
  readout, colorbar 1-D value, polygon/region/text clicks, threshold drag, whole-axis readout,
  `selected=` pre-highlight, and `selects`-ROI box-select, all against the live canvas (12 paths,
  zero divergences).
- `Axis3` parity (WS-3D core): 3D `Scatter`/`Lines` get the same point/segment overlays with
  `{index, x, y, z}` payloads on **both** backends — static base on `:cairo`, live on `:webgl` —
  projected at build time through the shared closure (`is3d` axis transforms ship degenerate
  lims; `Axis`/`Threshold`/`ROI` interactables fail loud on a 3D axis, where a screen pixel is a
  ray). `MeshScatter` (depth-correct per-element hit radii from its data-space `markersize`, via
  the new `PointInteractable` `radius3d=` option) and `Wireframe` (rendered edge segments from
  its child) are auto-extracted too; `Arrows3D` emits start→end segments from processed
  `startpoints`/`endpoints` (not raw `pos→pos+dir` — that misses under `lengthscale`/`align`).
  `Surface` remains roadmap scope.
- `PolarAxis` discrete overlay parity: Scatter/Lines(/LineSegments/ScatterLines) hit geometry on
  both backends via the shared projection (`Makie.Polar` in `transform_func`); `ispolar`
  transforms ship degenerate lims so continuous θ/r consumers fail loud until the polar
  transform is serialized to JS. Separable-grid/rect recipes on polar warn-and-skip.
- Current `:cairo` scoping: `LScene` is rejected at `holo()` time — a Holo guard, not a
  CairoMakie limit (`LScene` disposition remains a roadmap decision item). High-frequency live
  redraw is a shared cost limit on both backends.

[Unreleased]: https://github.com/jowch/Holo.jl/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jowch/Holo.jl/releases/tag/v0.1.0
