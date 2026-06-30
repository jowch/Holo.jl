# Holo.jl — agent notes

Julia package (`Holo`, entry fn `holo`) that overlays JS interactivity on static CairoMakie
plots in Pluto. Browser layer is TypeScript in `frontend/`, bundled by esbuild to a **committed**
`assets/overlay.js`, read by Julia at `__init__`. Manifest shipped to JS via `published_to_js`.

## Commands
- Julia tests: `julia --project=. test/runtests.jl`
- Frontend gate: `cd frontend && npm run lint && npm run typecheck && npm test && npm run build` (build → `../assets/overlay.js`)
- Format (Runic, CI-enforced): `julia -e 'using Runic; exit(Runic.main(["--inplace","src","test","bench","gallery","examples"]))'` — pass every dir with `.jl`, since CI formats the whole repo (PR #11 slipped because `gallery/` was omitted here). **CI's `runic-action` has no `paths:` filter → it checks the WHOLE repo** (incl. `bench/`, `examples/`), and tracks the latest Runic (1.7+); a locally-old Runic can pass a file CI rejects. Format every `.jl` you add, with current Runic.
- Registry name-clash check: `grep '^name = "X"$' ~/.julia/registries/General/Registry.toml`
- **Always verify CI is green before merging.** A merged PR can leave `main` red (PR #11 merged with Runic failing). After a PR's checks finish, `gh run list` / `gh pr checks <n>` must show all green — don't merge on a stale or pending run.

## Gotchas (verified this session)
- Bundle injection: inject the esbuild IIFE **unconditionally** — wrapping it in `if(!window.Holo){…}` installs `{}` not `{mount}` (block-scope heisenbug).
- Makie `Figure`s **can't `deepcopy`** (module refs) — save/restore `fig.scene.backgroundcolor[]` instead.
- `save(Stream{format"PNG"}, fig)` is broken — use `Makie.colorbuffer(fig; px_per_unit)` then `save(Stream, img_matrix)`.
- Entry fn is lowercase `holo`: a function named `Holo` clashes with `module Holo`.
- `published_to_js` needs a live Pluto — tests call `build_manifest`/`widget.manifest` directly, never `show`.
- `frontend/src/types.ts` mirrors the Julia `HitLayer`/`AxisTransform`/`Manifest` structs — keep in sync.

## Conventions
- Coords: image px, top-left origin = `Makie.project(ax.scene, pt)` + axis `viewport.origin`, ×`px_per_unit`, y-flipped. Tests assert projected coords land on rendered markers.
- DPI is derived, not fixed: `px_per_unit = 2·min(scene_width, max_width=700)` (Pluto's column).
- CI is the **sole author** of `assets/overlay.js` (rebuilds + commits on `main`); committing your local bundle is optional, but a stale committed bundle fails PR CI.

## Live verification (standing practice — not optional)
Unit/frontend tests assert the manifest and the JS in isolation; they don't prove the rendered
widget behaves for the user. **Any change that can alter what the user interacts with must be
live-verified in a real Pluto + browser before it's called done** — and "user-facing" includes
**backend/Julia-only changes**: the manifest shape, payload contents, hit-test geometry, projection/
DPI, `@bind` value, hover/tooltip text, and overlay behavior all originate in Julia. The test passing
is necessary, not sufficient. (E.g. the grid `values[]` cap is a pure-Julia change with no visible
markup, yet it changes hover text and the bond payload → it gets a live check.)
- **What "live-verified" means:** open the affected case in headless Pluto, drive it with Playwright
  (hover/click), and confirm the actual on-screen result — tooltip text, highlight, `@bind` round-trip,
  no console errors — matches intent. Inspect the real `published_to_js` manifest in-page when the
  change is about payload shape (a thing the unit tests can't reach — they never call `show`).
- **Skip only** pure-internal refactors with zero observable delta (and say so). When unsure, it's
  user-facing — verify.
- Mechanics below. Reuse `examples/demo.jl`'s dev-the-local-package env cell.

## Pluto integration testing (slow — minutes)
- A fresh per-notebook env re-resolves + precompiles the Makie stack (~6 min first open).
- To test the local package: `Pkg.develop(path=...)` in a notebook cell (disables Pluto's pkg mgmt).
- Headless: `Pluto.run(; port=1234, launch_browser=false, require_secret_for_open_links=false, require_secret_for_access=false)`; open `localhost:1234/open?path=…`; click "Run notebook code" to exit Safe preview; export HTML via `localhost:1234/notebookexport?id=…`.
- **Readiness: poll the port (`curl localhost:1234` → 200), not the log** — Pluto doesn't reliably flush its "Go to…" line, so a log-grep readiness loop hangs on a server that's actually up.
- **Selected/highlight is overlay-drawn, so the PNG is byte-identical across clicks** — don't detect interaction by watching `img.src`; assert the overlay/tooltip/`@bind` value instead (bake state into the figure only if you specifically need the PNG to differ).

## Profiling → design feedback (standing practice)
Profiling exists to inform the design, not to sit in a file. The loop is anchored on the committed
`bench/payload_envelope.jl` + `bench/stress.jl` → `docs/perf-findings.md` pair.
- **`perf-findings.md` is the single source of every size/latency number.** Other docs (architecture/
  design/survey/research/roadmap) **cite** it — never restate figures (numbers duplicated across docs
  drift; one reconciliation already had to fix exactly that).
- **Re-run + reconcile whenever the wire format changes**: a new interactable kind / geometry layout, a
  new payload field (e.g. M2.3 tooltips), an encoding change, or an animation/frames slot. Each is a
  "manifest-shape change" that can invalidate the envelope. Re-run the benches, update `perf-findings.md`
  (note the commit), then grep the other docs for size/latency claims that now contradict it.
- Treat each milestone that touches the manifest as re-opening a mini Phase 0 (measure → reconcile) before
  it's marked done — same gating spirit as M5 spatial-acceleration. A whole-`docs/` reconciliation can be
  fanned out as a workflow (see how Phase 0 was propagated).

## Layout
- Design docs in `docs/` (architecture.md = the contract; perf-findings.md = the measured payload/latency envelope + the single source of those numbers; frontend-delivery.md = build/delivery decisions). `spike/` is gitignored scratch; `bench/` holds the committed, re-runnable benchmarks.
- Process docs (brainstorming specs, implementation plans) go in `.superpowers/` — gitignored, local-only, not part of the package.
- Repo folder is `InteractivePlots.jl/` but the package is `Holo` (cosmetic mismatch; remote is `Holo.jl`).
