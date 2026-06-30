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

## M1 — Ergonomics & robustness (near-term)

- [ ] **Tier-2 data-animation API**: a Julia accessor for a plot's uuid + a tidy
      `updatePlotData(uuid, attr, frame)` JS helper (today it's a manual `find_plots` patch).
- [ ] **3D live-camera overlay**: `context` reuses `Makie.project` (correct for *static* 2D/3D).
      Interactive 3D pan/zoom changes the projection at runtime → the overlay must read WGLMakie's
      client-side camera (`project`/`pick`). Static 3D renders today; the live-camera overlay is the gap.
- [ ] **Version-coupling guard**: a smoke test that fails loudly when a WGLMakie bump changes
      `serialize_scene`/`setup_scene_init` (the wire format is internal and unstable).
- [ ] **`@bind` test in CI**: the live click test is manual; script it (headless Pluto + Playwright).

## M2 — Delivery & performance

**Measured payload envelope** (committed bench `bench/payload_size.jl`; re-run on any wire-format
change — the profiling standing practice, scoped to HoloWGL since this is a *new* format distinct
from Holo core's PNG+manifest envelope in `../../docs/perf-findings.md`, which is unchanged):

| | shipped | 2026-06-30 (WGLMakie 0.13.12) |
|---|---|---|
| WGLMakie bundle | once per widget | **1.09 MB** |
| scene JSON — 2D lines (200 pts) | per cell | 0.33 MB |
| scene JSON — 2D scatter + text (40) | per cell | 0.44 MB |
| scene JSON — 3D helix (300 pts) | per cell | 0.56 MB |

So a `:webgl` cell ships ~1.1 MB (bundle) + ~0.3–0.6 MB (scene). The bundle dominates and is the
slimming target:

- [ ] **Share the bundle once per notebook**: the 1.09 MB bundle + font atlas + three.js currently
      ship per cell (correct, wasteful). Publish once, reference from each widget → each extra cell
      drops to just its 0.3–0.6 MB scene.
- [ ] **Payload slimming**: msgpack/gzip for the scene JSON (atlas-dominated).
- [ ] **Build pipeline**: move `assets/holo-webgl.js` into an esbuild build alongside Holo's
      `overlay.js` if/when the shim grows.

## M3 — Upstream / fold-in & distribution

- [ ] **Make Holo's `overlay.ts` base-agnostic** (`querySelector("img, canvas")` + `naturalWidth ??
      width`) and **drop the transparent sizer `<img>`** — the current additive workaround.
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
