# Holo.jl — agent notes

Julia package (`Holo`, entry fn `holo`) that overlays JS interactivity on static CairoMakie
plots in Pluto. Browser layer is TypeScript in `frontend/`, bundled by esbuild to a **committed**
`assets/overlay.js`, read by Julia at `__init__`. Manifest shipped to JS via `published_to_js`.

## Commands
- Julia tests: `julia --project=. test/runtests.jl`
- Frontend gate: `cd frontend && npm run lint && npm run typecheck && npm test && npm run build` (build → `../assets/overlay.js`)
- Format (Runic, CI-enforced): `julia -e 'using Runic; exit(Runic.main(["--inplace","src","test"]))'`
- Registry name-clash check: `grep '^name = "X"$' ~/.julia/registries/General/Registry.toml`

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

## Pluto integration testing (slow — minutes)
- A fresh per-notebook env re-resolves + precompiles the Makie stack (~6 min first open).
- To test the local package: `Pkg.develop(path=...)` in a notebook cell (disables Pluto's pkg mgmt).
- Headless: `Pluto.run(; port=1234, launch_browser=false, require_secret_for_open_links=false, require_secret_for_access=false)`; open `localhost:1234/open?path=…`; click "Run notebook code" to exit Safe preview; export HTML via `localhost:1234/notebookexport?id=…`.

## Layout
- Design docs in `docs/` (architecture.md = the contract; frontend-delivery.md = build/delivery decisions). `spike/` is gitignored scratch.
- Process docs (brainstorming specs, implementation plans) go in `.superpowers/` — gitignored, local-only, not part of the package.
- Repo folder is `InteractivePlots.jl/` but the package is `Holo` (cosmetic mismatch; remote is `Holo.jl`).
