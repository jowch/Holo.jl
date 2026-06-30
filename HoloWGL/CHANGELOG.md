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
- `docs/perf-findings.md` — the single source of every `:webgl` size number (bundle, per-cell scene,
  gzip headroom, wire-vs-JSON-proxy); `roadmap.md`/`NOTES.md`/the bench now cite it instead of
  restating the envelope (mirrors root Holo's `docs/perf-findings.md`; avoids the cross-file drift
  root CLAUDE.md flags).

### Performance
- **Bundle shared once per notebook (M2).** The ~1.09 MB WGLMakie bundle no longer costs per
  cell. Wire: `published_to_js` ids are content-addressed (`notebook_id/objectid`, and
  `objectid(::String)` is content-based), so the one `Ref`-cached bundle string has a stable id
  that crosses the wire **exactly once per notebook** — across cells (Pluto's notebook merge keeps
  one copy on load) and across re-runs of a cell (Pluto nulls already-known ids before sending:
  `known_published_objects` from the prior run + `format_output.jl`, so a re-run re-ships only its
  new scene, never the stable-id bundle — the kernel re-*publishes* but does not re-*send*). Browser:
  the bundle/shim blob URLs are now cached once on `window.__HoloWGL` (the idempotent-singleton
  trick Holo core uses for `window.Holo`), so the WGLMakie module imports once instead of per cell
  (`??=` short-circuits — a cache hit never dereferences the published 1 MB). Each additional
  `:webgl` cell, and each tier-1 reactive re-render, now costs just its 0.07–0.14 MB scene.
- **Payload envelope corrected; scene slimming measured → deferred (M2).** The bench reported
  `JSON3.write` size, but `published_to_js` ships the scene over Pluto's MsgPack, which binary-packs
  our typed `Vector`s (`Float32`/`Int32`/`UInt32`/`UInt8`) — so the real per-cell wire is **0.07–0.14
  MB**, ~4–5× under the JSON proxy. The bench now reports both, plus two `gzip` columns. Compression
  was measured and deferred: gzip-of-binary (the bench's `gzip-bin` column) cuts ~3× more but needs a
  JS msgpack decoder (gzip-of-JSON, the cheap path, buys only ~25%), and the atlas glyph-tiles are
  observed to repeat across scenes (shareable) but are small and gzip overlaps — revisit only if
  tier-1 animation profiling shows the scene is the bottleneck.

### Fixed (caught by live-Pluto verification, masked by headless/JSON3 testing)
- `published_to_js` rejected `GeometryBasics.Vec` / `SizedVector` left in the payload —
  `Float32.(x)` and `collect(T, x)` preserve StaticArray types. Encode buffers with
  `Vector{T}(x)`; the unit test is now `Base.Array`-strict so this cannot regress through JSON3.
- Holo's overlay was `<img>`-only (`querySelector("img")` + `img.naturalWidth`); our base is a
  `<canvas>`. Made the shared `overlay.ts` **base-agnostic** — `querySelector("img, canvas")` and the
  image-px scale taken from `manifest.width` (the design.md §6 "renderWidth" approach) ÷ the live
  rect, not the element's intrinsic size — so it binds straight to the canvas. No sizer shim, and the
  `Base64` dep is dropped. Zero-delta for the Cairo `<img>` path (`naturalWidth == manifest.width` by
  construction); live-verified on both bases (Cairo + WebGL, static + through-Pluto).
- `context` left the per-axis `transforms` map empty, so any axis-keyed interactable
  (Threshold/ROI/Region/box-select) `KeyError`'d at manifest build — only `PointInteractable`
  (pre-projected geometry) worked. Now populated via `Holo._axis_transform`, typed `AxisTransform`.
- `scene_payload` left the `NoConnection` serialization screen attached to the user's figure;
  now removed via `Makie.delete_screen!` in a `finally`.

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
