# HoloWGL — `:webgl` backend (browser GPU)

Separate package, same repo (mirrors Makie's CairoMakie/GLMakie subpackages). Keeps
WGLMakie/Bonito out of Holo core's deps. Implements Holo's backend seam
(`AbstractBackend` / `render` / `context` / `mount`).

## What's wired (lifted from the validated spikes)
- `_plain` — the 4-rule encoder (`{__obs__}` / `{__t__}` / `{array,size}` / symbol+closure).
- `scene_payload(fig)` — NoConnection Session+Screen so the glyph atlas (markers/text) populates.
- `WebGLBackend <: AbstractBackend`, `mount → :webgl`, `render → WebGLResult`, `context`
  reusing the CairoBackend projection (measured 1–2px aligned on the WGLMakie canvas).
- `assets/holo-webgl.js` — the Bonito shim + `mountWebGL(...)`, **built from
  `HoloWGL/frontend/src/holo-webgl.ts` by esbuild** (lint/typecheck/vitest gate; CI sole author,
  like Holo core's `overlay.js`). Imports WGLMakie's own `WGLMakie.bundled.js` (sourced at runtime
  from the installed package → always version-matched).

## Widget integration — DONE additively (Holo core untouched)
`holo_webgl(fig, interactables)` (src/widget.jl) is a drop-in for `Holo.holo`, returning a
`WebGLWidget`. Its `show` reuses Holo's overlay bundle (`Holo._OVERLAY_JS`), `build_manifest`,
`context` (the 1–2px-aligned projection), and the `@bind` contract verbatim — only the base
layer differs (`<canvas>` + `mountWebGL` instead of `<img>`). No change to Holo core was
needed; the `:webgl` path lives entirely in this package. **Verified end-to-end**: a real
`holo_webgl` widget renders the canvas base + mounts the overlay in a headless browser.

Gotcha fixed: the widget scripts use `document.currentScript` in **regular** (non-module)
scripts + dynamic `import()`, because ES-module scripts have `document.currentScript === null`.
Works in both Pluto and standalone.

## Live-Pluto verified (the export path) — and it caught two real bugs
Ran the notebook headless in a real Pluto kernel + exported to HTML + rendered it. The widget
displays through the genuine `published_to_js` channel. Two bugs that headless (JSON3) masked:
- **Ergonomics:** `using HoloWGL` gave no plotting API + `Figure` was ambiguous (Holo's
  CairoMakie vs WGLMakie). Fixed: `@reexport using WGLMakie` → `using HoloWGL` is self-contained.
- **`published_to_js` strictness:** `_plain` left `GeometryBasics.Vec`/`SizedVector` in the
  payload; JSON3 serialized them but `published_to_js` rejects non-`Base.Vector`. Fixed:
  `Vector{T}(x)` (NOT `Float32.(x)`/`collect`, which preserve StaticArray types). The unit test
  is now `Base.Array`-strict so this can't regress through JSON3 again.
## Live `@bind` round-trip — VERIFIED (and caught a third bug)
Drove a real Pluto server with Playwright: clicked a scatter marker, and the bond updated to
`InteractionEvent(:scatter, 0, Dict("x"=>0,"index"=>0,"y"=>0))` — correct marker, correct payload,
round-tripped to Julia. The bug it caught: Holo's `overlay.ts` does `host.querySelector("img")`
and **no-ops without an `<img>`** — our base is a `<canvas>`, so the overlay never mounted.
Interim fix (M0): a transparent SVG `<img class="holo-webgl-sizer">` over the canvas with
`naturalWidth == out_w`, so the overlay found its base. **Resolved at the source in M3.1:**
`overlay.ts` is now base-agnostic (`querySelector("img, canvas")`, image-px scale from
`manifest.width` not the element's intrinsic size) and binds straight to the canvas — sizer dropped.

## Asset delivery — DONE (no server, works local/remote/export)
`show` ships the scene, manifest, **and the bundle + shim text** over Pluto's `published_to_js`
data channel; the browser builds **blob URLs** from the text and `import()`s them. No server,
no `file://`. **Verified end-to-end** with a fully self-contained HTML (everything inlined as
blobs — the exact mechanism `published_to_js` uses) rendering in a headless browser.

## Animation — both tiers PROVEN (client-side, no server)
- **Tier 1 (Pluto-reactive):** a slider/`@bind` drives a new figure → `holo_webgl` re-renders.
  Works today, zero new code. Each frame re-ships only the scene (small — binary wire;
  `docs/perf-findings.md`); the bundle is deduped across re-runs too (see bundle-sharing below), not
  just across cells.
- **Tier 2 (in-place):** `mountWebGL` returns `WGL`; the driver patches a plot's buffer by
  uuid — `WGL.find_plots([uuid])[0].geometry.attributes.wgl_positions.array.set(frame);
  attr.needsUpdate = true` — smooth, no Julia round-trip. **Verified**: scatter markers
  shifted in place (12k px changed). Camera/uniform animation works via observable `.notify`.
  Remaining glue: a Julia accessor for the target plot's uuid + a tidy `updatePlotData` helper.

## TODO (implementation, all de-risked)
2. **Axis3 / live-camera projection** — `context` reuses `Makie.project` (2D Axis, validated).
   3D pan/zoom needs the overlay to read WGLMakie's client-side camera (the `project`/`pick`
   seam). Static 3D renders today; the overlay for 3D is the follow-on.
3. **Share the bundle once per notebook** — DONE (M2). The bundle no longer costs per cell:
   `published_to_js` ids are content-addressed (`notebook_id/objectid`, `objectid(::String)` is
   content-based), so the one `Ref`-cached bundle string has a stable id that ships **exactly once
   per notebook** — across cells (Pluto's notebook merge keeps one copy on load) AND across re-runs
   of a cell (Pluto nulls already-known ids before sending: `known_published_objects` from the prior
   run + `format_output.jl`, so a re-run re-ships only its new scene, never the stable-id bundle; the
   kernel re-*publishes* but does not re-*send*). The browser then caches the bundle/shim blob URLs
   once on `window.__HoloWGL` (like Holo's `window.Holo`) so it imports the WGLMakie module once, not
   per cell. No deferral — tier-1 reactive re-renders cost just the scene; scene slimming (#4) /
   tier-2 in-place are the only per-frame levers left.
4. **Payload slimming** — MEASURED → deferred. The real per-cell wire is already small (binary), not
   the JSON proxy figure: Pluto's MsgPack binary-packs our typed buffers (`Vector{Float32}` etc.) for
   free. gzip-of-binary cuts further but needs a JS msgpack decoder (the cheap gzip-of-JSON path
   buys only a fraction); the atlas glyph-tiles are observed to repeat across scenes (shareable) but
   are small and gzip overlaps. Both deferred until tier-1 animation profiling shows the scene is the
   bottleneck. Numbers + the gzip columns: `docs/perf-findings.md` (re-run `bench/payload_size.jl`).
5. **Build pipeline** — DONE. `assets/holo-webgl.js` is now built from
   `HoloWGL/frontend/src/holo-webgl.ts` by esbuild, under the same gate as Holo core's
   `overlay.ts` (lint + typecheck + vitest + build; CI sole author). The vitest suite locks the
   `rewrap`↔`_plain` 4-rule contract — previously the least-tested JS in the repo.

## Dev
```
pkg> activate .            # or the examples/test env
pkg> dev . HoloWGL         # dev both Holo (root) and HoloWGL together
pkg> test HoloWGL
```
Register from the subdir (like GLMakie from the Makie monorepo) when ready, or collapse
into `ext/HoloWGLMakieExt.jl` if zero-install auto-load UX is preferred later.
