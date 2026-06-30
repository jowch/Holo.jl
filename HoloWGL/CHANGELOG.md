# Changelog

All notable changes to **HoloWGL** are documented here. This changelog is HoloWGL's own
(separate from Holo's). Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `WebGLBackend <: Holo.AbstractBackend` — the `:webgl` backend (browser-GPU WebGL canvas base
  with Holo's overlay on top). Implements `render` / `context` / `mount`.
- `holo_webgl(fig[, interactables]; …)` and `WebGLWidget` — a drop-in for `Holo.holo` that
  reuses Holo's overlay, `build_manifest`, projection, and the `@bind` / `InteractionEvent`
  contract; only the base layer differs (`<canvas>` instead of `<img>`).
- `scene_payload` + the 4-rule encoder: observables → `{__obs__}`, 1-D GL buffers → `{__t__}`,
  N-D arrays → `{array,size}`, scalars; texture atlas populated via a `NoConnection` session.
- Server-free delivery: scene + manifest + the WGLMakie bundle + a ~30-line shim shipped over
  Pluto's `published_to_js` channel and rebuilt as blob URLs in the browser — no server, no
  `file://`. WGLMakie's own bundle is sourced from the installed package (version-matched), with
  **no Bonito runtime**.
- Animation, two tiers: reactive re-render (a new figure → new payload) and in-place buffer
  update via `find_plots(uuid)` + `needsUpdate`; camera/uniform updates via observable `.notify`
  (gated behind `can_send_to_julia: true` in the shim).
- `@reexport using WGLMakie` so `using HoloWGL` provides the full Makie plotting API plus
  `holo_webgl` (no separate `using WGLMakie`, no `Figure` ambiguity).
- MIT `LICENSE`, `README.md`, `docs/roadmap.md`, `NOTES.md`, and a smoke-test suite.

### Fixed (caught by live-Pluto verification, masked by headless/JSON3 testing)
- `published_to_js` rejected `GeometryBasics.Vec` / `SizedVector` left in the payload —
  `Float32.(x)` and `collect(T, x)` preserve StaticArray types. Encode buffers with
  `Vector{T}(x)`; the unit test is now `Base.Array`-strict so this cannot regress through JSON3.
- Holo's overlay no-ops without an `<img>` base (`overlay.ts` does `querySelector("img")`); our
  base is a `<canvas>`. The widget now lays a transparent SVG `<img class="holo-webgl-sizer">`
  over the canvas (`naturalWidth == out_w`) so the overlay mounts and maps coordinates correctly.

### Verified
- End-to-end in a real Pluto kernel (Playwright-driven): widget renders at full cell width,
  `published_to_js` accepts the payload, the overlay mounts over the canvas, and clicking a
  scatter marker round-trips `InteractionEvent(:scatter, 0, …)` back to Julia via `@bind`.

### Notes
- Version-coupled to WGLMakie internals; pinned `WGLMakie = "0.13"`. A WGLMakie bump is a
  re-verification, not a free upgrade.
- `Holo` has no `[compat]` bound yet (unregistered, path-dev'd) → not General-registrable until
  Holo is registered.

[Unreleased]: https://example.invalid/HoloWGL/compare/v0.1.0...HEAD
