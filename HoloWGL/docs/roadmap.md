# HoloWGL roadmap

The `:webgl` backend for Holo: render Makie figures on the **client browser GPU** (WebGL) with
Holo's overlay on top, **server-free**. This roadmap is the committed scope; status markers
reflect what is actually verified, not aspirational.

## M0 — Feasibility, scaffold, and live-Pluto verification ✅ DONE

The hard questions are answered and the backend works end-to-end in a real Pluto notebook.

- ✅ `WebGLBackend <: Holo.AbstractBackend` implementing the seam (`render`/`context`/`mount → :webgl`).
- ✅ The 4-rule scene encoder (`_plain`): observables → `{__obs__}`, GL buffers → `{__t__}`,
  multi-dim arrays → `{array,size}`, scalars; atlas populated via a `NoConnection` session.
- ✅ `holo_webgl` widget reusing Holo's overlay bundle, `build_manifest`, `context`
  (`Makie.project`, measured ~1–2 px aligned), and the `@bind`/`InteractionEvent` contract.
- ✅ Server-free delivery: scene + manifest + bundle + shim over `published_to_js` → blob URLs
  → `import()`. No server, no `file://`; works local / remote / export.
- ✅ No Bonito runtime: WGLMakie's own bundle (version-matched from the installed package) + a
  ~30-line shim.
- ✅ Full fidelity: 2D + 3D (lines, markers, text/atlas) render headless and in Pluto.
- ✅ Animation, both tiers: reactive re-render (tier 1) and in-place buffer patch via
  `find_plots(uuid)` (tier 2); camera/uniform via observable `.notify`.
- ✅ **Live-Pluto verified**: real kernel + Playwright — render, `published_to_js`, overlay
  mount, and a clicked marker round-tripping `InteractionEvent` back to Julia.
- ✅ Additive: **Holo core untouched**. 17/17 tests, Runic-clean.

## M1 — Ergonomics & robustness

- [ ] **Tier-2 data-animation API**: a Julia accessor for a plot's uuid + a tidy
      `updatePlotData(uuid, attr, frame)` JS helper (today it's a manual `find_plots` patch).
- [~] **Live view manipulation (pan/zoom/rotate) — INVESTIGATED → DEFERRED.** Investigated via a
      fan-out; the staged design lives in `.superpowers/holowgl-live-camera-overlay-design.md` (local).
      Deferred (not rejected, not scheduled) — revisit only on an explicit product decision. Two
      findings drove the deferral:
      - **It isn't wired on today.** The shim sets `can_send_to_julia:()=>true` (needed for the
        client-side camera/uniform *observable* animation path — **not** tier-2, which is the
        observable-free `find_plots` buffer patch), and WGLMakie's
        `use_orbit_cam = ()=>!(Bonito.can_send_to_julia && Bonito.can_send_to_julia())` disables 3D
        OrbitControls; 2D `Axis` zoom/pan is Julia-side and dead under `NoConnection`. So the plot renders
        live but does not pan/zoom/rotate — the overlay "drift" is *latent*, not observed (verified vs the
        pinned bundle).
      - **Enabling it is large and `:webgl`-only.** Staged shape: client-side re-projection (read the live
        per-axis `projectionview`) → Holo-core `z`/`Axis3` plumbing → a shared-`overlay.ts` pointer-events
        change → optional GPU-pick for occlusion. It would give `:webgl` a headline *interaction* tier
        `:cairo` cannot have — distinct from 3D *rendering* (an inherent support gap Cairo simply can't
        cover): this one is discretionary, so giving it only to `:webgl` is what splits the UX.
      **Decision (2026-07-01): deferred.** A discretionary feature split across backends works against the
      co-equal-entry-points UX, so we're not scheduling pan/zoom in Holo now. Not rejected — if a product
      case later justifies the backend asymmetry, the parked design has stages **S1** 2D magnifier → **S2**
      3D-rotate → **S3** data-space 2D zoom → **S4** occlusion, gated on a blocking `Axis3`-interactable
      spike. (Verified from source in `docs/backend-comparison.md` §1†/§6; fuller design in
      `.superpowers/holowgl-live-camera-overlay-design.md`, local.)
- [x] **Version-coupling guard**: a smoke test that fails loudly when a WGLMakie bump changes
      `serialize_scene`/`setup_scene_init` (the wire format is internal and unstable). *Done
      (`test/runtests.jl` "version-coupling guard"): names each Julia internal the `scene_payload`
      chain reaches (`Bonito.NoConnection`, `WGLMakie.{ScreenConfig,serialize_scene,Screen}` +
      `screen.session`, `Makie.{merge_screen_config,push_screen!,delete_screen!}`), asserts the
      serialized wire shape (scene nesting + per-plot `uuid` for tier-2 `find_plots`), and greps the
      vendored bundle for the JS exports the shim calls (`setup_scene_init`, `find_plots`) — the one
      coupling no other test covers. Wired into CI (`.github/workflows/CI.yml` `holowgl` job, Julia
      1.12) so the whole HoloWGL suite — not just this guard — gates on every PR; previously the
      subpackage ran only manually (gap inherited from #12).*
- [x] **`@bind` test in CI**: the live click test is manual; script it. *Done — **three** layers,
      cheapest→fullest, all gating in CI. (1) Julia contract (`test/runtests.jl` "@bind round-trip
      contract"): derives the click payload from the REAL built manifest, runs it through
      `transform_value`, asserts the typed `InteractionEvent` (single + `items`/selector + never-`Nothing`).
      (2) Static-page real-browser E2E (`test/e2e/click.mjs`, Playwright/Chromium, in the `holowgl` job):
      Julia emits the self-contained widget page (`make_page.jl`), Chromium clicks scatter marker 0 and
      asserts the overlay sets `host.value = {layer,index,payload}` + fires `input` (overlay.ts:273-274) —
      real overlay JS, shadow-DOM hit-test, the `:webgl` `<canvas>` base. **Seam closed:** `verify_capture.jl`
      feeds the *byte-for-byte* emitted value back through `transform_value`, no synthesized payload between
      emit and consume. (WebGL canvas init may fail headless; irrelevant — the overlay hit-tests via
      `manifest.width` + the canvas rect, not GL pixels.)
      (3) **Through-Pluto E2E** (`test/e2e/{bind_notebook.jl,serve.jl,bind_click.mjs}`, the `holowgl-bind-e2e`
      job): a live headless Pluto kernel — Chromium opens the notebook, exits safe preview, clicks the
      marker, and asserts the kernel re-runs the readout cell so the bond round-trips THROUGH Pluto (bond
      transport + reactive re-render), `BOND=nothing → InteractionEvent(:scatter, 0, …)`. Isolated in its
      own job (heaviest, most exposed to Pluto-version churn) so it's easy to drop if it ever proves flaky.*

## M2 — Delivery & performance

**Measured payload envelope:** see [`docs/perf-findings.md`](perf-findings.md) — the single source of
every `:webgl` size number (bundle, per-cell scene, gzip headroom, and the wire-vs-JSON-proxy
correction). Re-run `bench/payload_size.jl` and reconcile that file on any wire-format change (the
profiling standing practice; the `:webgl` format is distinct from Holo core's PNG+manifest envelope in
`../../docs/perf-findings.md`, which is unchanged).

**Backend comparison (`:webgl` vs `:cairo`, wire + UX):** see
[`docs/backend-comparison.md`](backend-comparison.md) (generated by `bench/vs_cairo.jl`; all figures
live there — not restated here). It quantifies the Non-goals stance below: `:cairo` wins static
small–mid 2D (smaller payload, no bundle, instant first paint); `:webgl` wins large/animated/live 2D
(flat server cost that doesn't scale with N; an early wire crossover under re-renders) and **owns 3D
rendering** (Cairo rejects `Axis3`). Live view *manipulation* (pan/zoom/rotate) is **not** a current
`:webgl` win — it's gated off (see the live-view item above). They are **co-equal entry points**, not
light-vs-heavy.

- [x] **Resolve the capability claims** (§6 of the comparison). *Done — from the source, not a
      headless browser (software GL there would corroborate, not decide). (1) **Camera is gated off
      today** — the shim sets `can_send_to_julia:()=>true`, so WGLMakie's
      `use_orbit_cam = ()=>!(Bonito.can_send_to_julia && Bonito.can_send_to_julia())` disables 3D
      OrbitControls and 2D `Axis` zoom/pan is dead under `NoConnection` (verified vs the pinned bundle).
      So pan/zoom/rotate don't happen as shipped — the "drift" below is latent, not observed. (2) **If
      enabled, zero round-trip by construction** — `scene_payload` serializes through
      `Bonito.NoConnection()` (`src/HoloWGL.jl:84`) with no transport to the kernel. (3) **Overlay would
      not track the camera** — it's a static `Makie.project` snapshot (`src/HoloWGL.jl:113-125`). All
      three are verified (architectural, not benched) in `docs/backend-comparison.md` §1†/§6. No
      GL-dependent regression test committed. Whether to enable any of this is **deferred** — see the
      live-view item above.*

The bundle was the only ~MB term (the per-cell scene is an order smaller — `perf-findings.md`), so
sharing it was the slimming target:

- [x] **Share the bundle once per notebook**: the bundle + font atlas + three.js used to ship per
      cell (correct, wasteful). *Done — no new machinery needed, because both halves were already
      content-addressable: (1) **Wire** — `published_to_js` ids are `notebook_id/objectid(x)` and
      `objectid(::String)` is content-based, so the one `Ref`-cached bundle string always gets the same
      stable id. That id ships the bundle **exactly once per notebook**, on two axes: *across cells*,
      Pluto's notebook merge (`PlutoRunner`'s `cell_published_objects` → `Dynamic.jl`) keeps a single
      copy on load; *across re-runs of a cell*, Pluto's own dedup nulls it before sending — `run_cell`
      passes `known_published_objects = collect(keys(cell.published_objects))` (the prior run's ids,
      `Run.jl`), and `formatted_result_of` sets every already-known key to `nothing` (`format_output.jl`),
      so a re-run re-ships only its new-id scene, never the stable-id bundle. The kernel re-*publishes*
      (re-calls `published_to_js`) but that is not a wire re-*send*. (2) **Browser** — each cell still
      `createObjectURL`'d + `import()`'d the bundle, making N WGLMakie module instances; `widget.jl`
      now caches the bundle/shim blob URLs once on `window.__HoloWGL` (the same idempotent-singleton
      trick Holo core uses for `window.Holo`), so every extra widget reuses the one module (`??=`
      short-circuits, so a cache hit never even dereferences the published bundle). Each additional
      cell — and each tier-1 reactive re-render — now costs just its scene (`perf-findings.md`),
      browser-side and on the wire.* The only per-frame lever left is the scene itself (gzip below, or
      tier-2 in-place patching that ships no new scene at all).
- [x] **Payload slimming**: *measured → deferred (not worth the complexity now).* Re-measuring at the
      real wire encoding showed the per-cell scene is already small (binary) — an order below the bundle
      — because Pluto's MsgPack binary-packs our typed buffers for free (sizes + gzip headroom in
      `perf-findings.md`). Two compression levers, both deferred: (1) **gzip** — gzip-of-binary is a
      modest ceiling (`perf-findings.md`), but using it means bypassing `published_to_js`'s object
      channel and hand-rolling a **msgpack decoder in JS**; the cheap path (gzip-of-JSON via
      `DecompressionStream`) buys only a fraction, since it starts from float-text — not worth a new JS
      decoder + failure surface yet.
      (2) **Atlas sharing** — the glyph-atlas tiles (`glyph_data/atlas_updates/<hash>`) carry content
      hashes **observed to repeat across scenes** (the digit/label tiles recur in all three bench
      figures), so they're shareable like the bundle; but each is small, gzip overlaps the win, and
      hoisting them to a shared channel is real complexity. **Revisit both only if tier-1 animation
      profiling (per-frame scene re-ship) shows the scene is the bottleneck** — tier-2 in-place patching
      already ships no new scene at all.
- [x] **Build pipeline**: move `assets/holo-webgl.js` into an esbuild build alongside Holo's
      `overlay.js`. *Done — brought forward for tooling + QA, not because the shim grew. The shim is
      now `HoloWGL/frontend/src/holo-webgl.ts` (its own subpackage frontend, mirroring `frontend/`),
      built by esbuild to the committed `assets/holo-webgl.js` under the same gate as `overlay.ts`:
      lint + typecheck + vitest + build, CI sole author (stale committed bundle fails PR CI). The
      vitest suite covers the JS half of the `rewrap`↔`_plain` 4-rule contract (asserts `rewrap`
      against the `_plain` tag set; it can't catch a renamed/new `_plain` tag on the Julia side —
      and neither can the overlay E2E, which renders independently of the canvas, so only the live
      render check does) — the shim
      was previously the only JS in the repo with no test/lint/typecheck. Live-verified: the
      built+minified shim renders both demo widgets (2D scatter + 3D helix) in real Pluto, identical
      to the hand-authored shim.*

## M3 — Upstream / fold-in & distribution

- [x] **Make Holo's `overlay.ts` base-agnostic** and **drop the transparent sizer `<img>`**. *Done:
      `overlay.ts` now `querySelector("img, canvas")` and takes the image-px scale from
      **`manifest.width`** (the design.md §6 "renderWidth" approach) ÷ the live `getBoundingClientRect`,
      instead of the base element's intrinsic `naturalWidth`. So it binds straight to the `:webgl`
      `<canvas>` — the sizer shim, its `base64`/SVG plumbing, and HoloWGL's `Base64` dep are gone.
      Zero-delta for the Cairo `<img>` path (`naturalWidth == manifest.width` for the PNG by
      construction). Live-verified in real browsers on **both** bases (Cairo img + WebGL canvas, static
      + through-Pluto); new `overlay.test.ts` canvas-base case; the E2E harness reads `out_w` from the
      overlay's SVG `viewBox` instead of the sizer.*
- [ ] **Distribution decision**: register `HoloWGL` as a separate package (Makie-style, after Holo
      is registered) *or* fold `src/` into `ext/HoloWGLMakieExt.jl` for zero-install auto-load.
      The subpackage layout supports both.
- [ ] **General-registry readiness**: add a `Holo` `[compat]` bound once Holo is registered
      (today `Holo` is path-dev'd and unregistered, so HoloWGL is not General-registrable yet).

## Non-goals

- **Not** the default backend. `CairoBackend` stays the default for static 2D (lighter, crisper
  text, trivial PNG export, zero WGLMakie-internals churn). HoloWGL is for 3D / animation / heavy data.
- **Not** server-side GPU rendering. That is the GLMakie-static / EGL-headless path (a separate
  backend that keeps Holo's `render()→bytes` contract) — out of scope here.
- **Not** a WGLMakie replacement or a general WGLMakie-in-Pluto tool; it is specifically a Holo backend.
