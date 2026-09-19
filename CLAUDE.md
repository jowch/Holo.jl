# Masque.jl — agent notes

Julia package (`Masque`, entry fn `masque`) that overlays JS interactivity on static CairoMakie
plots in Pluto. Browser layer is TypeScript in `frontend/`, bundled by esbuild to a **committed**
`assets/overlay.js`, read by Julia at `__init__`. Manifest shipped to JS via `published_to_js`.

## Commands
- Julia tests: `julia --project=. test/runtests.jl`
- Frontend gate: `cd frontend && npm run lint && npm run typecheck && npm test && npm run build` (build → `../assets/overlay.js` IIFE + `../assets/masque-webgl.js` ESM)
- Format (Runic, CI-enforced): `julia -e 'using Runic; exit(Runic.main(["--inplace","src","test","bench","gallery","examples","docs"]))'` — pass every dir with `.jl`, since CI formats the whole repo (PR #11 slipped because `gallery/` was omitted here). **CI's `runic-action` has no `paths:` filter → it checks the WHOLE repo** (incl. `bench/`, `gallery/`, `examples/`, `docs/make.jl`), and tracks the latest Runic (1.7+); a locally-old Runic can pass a file CI rejects. Format every `.jl` you add, with current Runic.
- Registry name-clash check (manual, not `Pkg.test`): packed General (typical
  depot / CI) is a 129-byte `~/.julia/registries/General.toml` pointer +
  `General.tar.gz`. Package rows are inline tables (`uuid = { name = "Masque",
  path = "M/Masque" }`). `grep '^name = "X"$'` only hits `name = "General"` and
  **false-passes** if the index is missing or packed. Use
  `tar -xOf ~/.julia/registries/General.tar.gz Registry.toml | rg '{ name = "Masque"'`
  (or the unpacked `General/Registry.toml` if present). Do not assert
  unregistered in CI — that fails once General indexes the package and needs
  network.
- **Always verify CI is green before merging.** A merged PR can leave `main` red (PR #11 merged with Runic failing). After a PR's checks finish, `gh run list` / `gh pr checks <n>` must show all green — don't merge on a stale or pending run.

## Gotchas (verified this session)
- Bundle injection: inject the esbuild IIFE **unconditionally** — wrapping it in `if(!window.Masque){…}` installs `{}` not `{mount}` (block-scope heisenbug).
- Makie `Figure`s **can't `deepcopy`** (module refs) — save/restore `fig.scene.backgroundcolor[]` instead.
- `save(Stream{format"PNG"}, fig)` is broken — use `Makie.colorbuffer(fig; px_per_unit)` then `save(Stream, img_matrix)`.
- Entry fn is lowercase `masque`: a function named `Masque` clashes with `module Masque`.
- `published_to_js` needs a live Pluto — tests call `build_manifest`/`widget.manifest` directly, never `show`.
- `frontend/src/types.ts` mirrors the Julia `HitLayer`/`AxisTransform`/`Manifest` structs — keep in sync.

## Conventions
- Coords: image px, top-left origin = `Makie.project(ax.scene, pt)` + axis `viewport.origin`, ×`px_per_unit`, y-flipped. Tests assert projected coords land on rendered markers.
- DPI is derived, not fixed: `px_per_unit = 2·min(scene_width, max_width=700)` (Pluto's column).
- CI is the **sole author** of `assets/overlay.js` and `assets/masque-webgl.js` (rebuilds + commits on `main`); committing your local bundle is optional, but a stale committed bundle fails PR CI.

## Live verification (standing practice — not optional)
Unit/frontend tests assert the manifest and the JS in isolation; they don't prove the rendered
widget behaves for the user. **Any change that can alter what the user interacts with — or
what they see — must be live-verified in a real Pluto + browser on every supported backend
across the interactable kinds before it's called done** (today: CairoMakie and WGLMakie /
`:webgl`; same rule for any future backend — all backends, not one). A 2-plot kitchen-sink
is **not** enough. Agents run the playbook — do not ask the maintainer to click through
plots.

"User-facing" includes **backend/Julia-only changes**: the manifest shape, payload contents,
hit-test geometry, projection/DPI, `@bind` value, hover/tooltip text, overlay chrome, and
visual recipes all originate in Julia. The test passing is necessary, not sufficient. (E.g.
the grid `values[]` cap is a pure-Julia change with no visible markup, yet it changes hover
text and the bond payload → it gets a live check on every backend × the kinds it touches.)
- **What "live-verified" means:** on each backend, open the affected cases in headless Pluto,
  drive them with Playwright (hover/click/drag), and confirm the actual on-screen result —
  tooltip text **and** tooltip theme, highlight recipe (wash / ring / hover outline), remount
  fade (no pulse), `@bind` round-trip, geometry on the mark (not offset), no console errors —
  matches intent. Inspect the real `published_to_js` manifest in-page when the change is
  about payload shape (unit tests never call `show`). **Agents run**
  `docs/dev/live-interaction-checklist.md` via **both** `test/e2e/kind_sweep.mjs` **and**
  `test/e2e/polish_verify.mjs` (Cairo **and** WGL) across scatter, lines/segments,
  heatmap/image, barplot, poly, polar, dark-figure scatter, arrows3d, hlines/vlines,
  threshold, ROI, and view-pan. Interaction without visual is unfinished; visual chrome
  without the kind sweep is unfinished. Overlay recipes (locked — cite, do not reopen):
  highlight is a blend-mode tint, not a mark-derived colour — `colors` (today `scatter!`'s
  `color=`) no longer touches the highlight at all, only the tooltip accent (below). The shadow
  root holds two overlay svgs with identical box/viewBox. Every hover/selected highlight without
  an explicit Julia `hoverstyle` stroke is a BARE shape (no per-element wrapper) inside
  `svg.masque-blend` (DOM-first) — `mix-blend-mode` (`multiply` on light figures, `screen` on
  dark, chosen at mount from the figure background) sits on that svg element itself, since
  Firefox only honours it on a top-level svg, not nested SVG content. Fixed greys: hover
  fill/stroke `#8c8c8c`/`#555555` (dark figure `#737373`/`#aaaaaa`), fill-opacity 1, 1.5px stroke
  flush on the mark's own drawn edge (`masque-hi masque-hover` — a `<line>` for seg hover carries
  the same class and fill too, and reads as stroke-only on screen only because a line has no
  interior area to fill); selected uses the stronger `#666666`/`#333333` (dark
  `#999999`/`#cccccc`) pair at 2px, fill-opacity 1 (`masque-hi masque-wash`). The second svg,
  `svg.masque-plain` (unblended), holds ROI box/handles, the threshold line, the selected-seg
  ring (2px + 4px @ 0.25, unchanged ink), and hover/selected highlights for a layer with an
  explicit `hoverstyle` stroke — single element, stroke verbatim + 18%/35% tint in that colour
  (the pre-blend recipe, unchanged), open shapes staying stroke-only there (no `masque-hover`,
  `fill: none`); browsers without `mix-blend-mode` fall back to that same neutral-ink tint. A
  scatter circle's highlight `r` is the marker's DRAWN radius, not `markersize / 2` — flush
  against the visible disc (default `:circle` marker ≈0.3525×`markersize`; a `Circle`/`Rect`
  geometry marker draws at `markersize`; anything else falls back to `markersize / 2`); the
  overlay's own 4px hit slack keeps clicking as forgiving as before. 80–120 ms fade — a plain
  opacity fade on the highlight shape itself (`masque-enter`/`masque-leave`; the blend lives on
  the svg root, so a fading child doesn't isolate it); tooltip theme derived from the FIGURE's
  own background (CSS relative-colour syntax, `--masque-fig-bg`) — not just OS
  `prefers-color-scheme` (official Pluto has no notebook toggle), which is now only the
  fallback for browsers without relative-colour support — tooltip anchored ABOVE the hovered
  mark (not the cursor) with a 10px gap and the caret on the anchor — flips below on a
  top-clip, shifts + moves the caret (`--masque-caret-x`) on a side-clip; a resolvable
  per-element `colors` (currently: `scatter!`'s `color=`) adds a 3px tooltip accent border in
  that colour (`--masque-mark-border`), text stays neutral; ROI has 8 square handles (4 corners +
  4 edge midpoints, corners resize two axes, edges resize one) with directional resize cursors;
  a `selects`-ROI's grid cell-block union rect is fill-only (no stroke, `"rectfill"` geom tag)
  — the ROI box itself is the outline, so the rect doesn't double it into two parallel edges
  (a `selected=` pre-highlight or a `selects`-ROI over `circles` keeps its stroke).
- **Skip only** pure-internal refactors with zero observable delta (and say so). When unsure,
  it's user-facing — verify all backends × the kinds the change can touch, interaction
  **and** visual.
- Mechanics below. Kind-sweep notebooks: `test/e2e/kind_sweep_cairo.jl` / `kind_sweep_webgl.jl`
  (both drivers). Demo envs (`examples/demo.jl`, `examples/webgl_demo.jl`) and
  `test/e2e/webgl_sweep.mjs` remain useful extras, not a substitute.
- CI's `kind-sweep` job runs both drivers on both backends advisorily
  (`continue-on-error: true`) — agents still run the sweep locally before calling a
  user-facing change done, until the job is promoted to a required check.

## Pluto integration testing (slow — minutes)
- A fresh per-notebook env re-resolves + precompiles the Makie stack (~6 min first open).
- To test the local package: `Pkg.develop(path=...)` in a notebook cell (disables Pluto's pkg mgmt).
- Headless: `Pluto.run(; port=1234, launch_browser=false, require_secret_for_open_links=false, require_secret_for_access=false)`; open `localhost:1234/open?path=…`; click "Run notebook code" to exit Safe preview; export HTML via `localhost:1234/notebookexport?id=…`.
- **Readiness: poll the port (`curl localhost:1234` → 200), not the log** — Pluto doesn't reliably flush its "Go to…" line, so a log-grep readiness loop hangs on a server that's actually up.
- **Selected/highlight is overlay-drawn, so the PNG is byte-identical across clicks** — don't detect interaction by watching `img.src`; assert the overlay/tooltip/`@bind` value instead (bake state into the figure only if you specifically need the PNG to differ).

## Profiling → design feedback (standing practice)
Profiling exists to inform the design, not to sit in a file. The loop is anchored on the committed
`bench/payload_envelope.jl` + `bench/stress.jl` → `docs/dev/perf-findings.md` pair.
- **`perf-findings.md` is the single source of every size/latency number.** Other docs
  (architecture/backend-comparison/roadmap) **cite** it — never restate figures (numbers
  duplicated across docs drift; one reconciliation already had to fix exactly that).
- **Re-run + reconcile whenever the wire format changes**: a new interactable kind / geometry layout, a
  new payload field (e.g. M2.3 tooltips), an encoding change, or an animation/frames slot. Each is a
  "manifest-shape change" that can invalidate the envelope. Re-run the benches, update `perf-findings.md`
  (note the commit), then grep the other docs for size/latency claims that now contradict it.
- Treat each milestone that touches the manifest as re-opening a mini Phase 0 (measure → reconcile) before
  it's marked done — same gating spirit as M5 spatial-acceleration. A whole-`docs/` reconciliation can be
  fanned out as a workflow (see how Phase 0 was propagated).

## Layout
- User docs are the Documenter site, built from `docs/src/` (`docs/make.jl`, deployed by
  `.github/workflows/Documentation.yml`). Maintainer/design docs live in `docs/dev/`
  (architecture.md = the contract; perf-findings.md = the measured payload/latency envelope +
  the single source of those numbers; frontend-delivery.md = build/delivery decisions).
  `spike/` is gitignored scratch; `bench/` holds the committed, re-runnable benchmarks.
- Process docs (brainstorming specs, implementation plans) go in `.superpowers/` — gitignored, local-only, not part of the package.
- The package was renamed from `Holo` to `Masque` on 2026-09-17 (same UUID). The local checkout folder and the GitHub remote may still be called `Holo.jl` until renamed; the package, module, and all in-repo references are `Masque`.
