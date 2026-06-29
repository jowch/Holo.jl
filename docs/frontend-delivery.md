# Frontend Delivery & Build — Decisions

> How the browser-side code is authored, bundled, delivered, and how data crosses
> Julia→JS. Decisions from the browser-side design pass; the export claim is verified
> by spike (`spike/export_spike.jl`, 2026-06-27).

## Decisions

| Topic | Decision | Why |
|---|---|---|
| **Framework** | No Preact/React for v1. Plain TS modules. | The overlay is imperative hit-test + SVG draw; a component framework adds nothing on the hot path. Preact doesn't persist state across Pluto's DOM-replace re-render anyway. Revisit only if rich UI *chrome* (panels/legends) appears. |
| **Language/tooling** | **TypeScript + esbuild + eslint + LSP.** | Chosen for the *agents* who maintain this: types as guardrails, LSP navigation, lint consistency. A typed manifest/`HitLayer` contract catches Julia↔JS drift across the 6 geometry kinds. |
| **Bundle** | esbuild → one self-contained `assets/overlay.js` (+ CSS bundled in). **Committed** to the repo. | Julia ships the registered git *tree*, not GitHub release assets — the built file must be in the tree. Committing it = no Node at user install, works offline. (`Pkg.Artifacts` is overkill; see `perf-findings.md` for the current bundle size.) |
| **Delivery to browser** | Inline the committed bundle in cell output and run it **unconditionally** (it self-installs `window.Holo` and is idempotent); per-cell script is bundle + data + `mount()`. `__init__` caches the bundle string in a Julia `const`. | No Pluto package-asset HTTP route and no parallel server exist; inlining is the only self-contained path (survives offline/export, no CDN). **No `if (!window…)` guard** — running the esbuild IIFE inside an `if`-block makes it install `{}` instead of `{mount}` (verified block-scope/strict heisenbug). Re-parsing ~6KB per cell is negligible. `__init__` can't reach the browser; only cell output can. |
| **Manifest transport** | **`published_to_js`** (MsgPack on the wire), not inlined JSON. | Binary-efficient, no HTML bloat — **and verified to survive static export with no kernel** (below). Inlined JSON remains the trivial fallback for non-Pluto contexts. *(Not a "lossless Float64" win — geometry is quantized to `Int` pixels (§9) and JSON would be lossless for coords too; the real point is binary compactness.)* Efficient for typical single plots (50–400 KB); but the manifest is the O(#hit-elements) / O(source-cells) scaling term and reaches multi-MB at high-N scatter / large grids — see `perf-findings.md` / `architecture.md` §8. |
| **Bond return** | Typed `InteractionEvent` via `Bonds.transform_value` (APD ≥0.17.1). | Better ergonomics than a raw `Dict`; already on the roadmap. |
| **Styling** | Bundle CSS into the artifact; mount the overlay in a **shadow root**. | True encapsulation — overlay styles can't leak into the notebook and Pluto's theme can't fight them. |
| **DPI / sizing** | Render output px ≈ **2 × the display width**; display width = Pluto's **700px** column by default (or `max_width` in wide mode). Force an **opaque background**; display `width:100%`. | DPI is derived from the known layout fact, not a magic `px_per_unit`. Verified: `main { max-width: calc(700px + 25px + 6px) }` is a hard column. Opaque bg avoids the dark-mode/transparent-bg footgun. Hit-testing stays correct via runtime `getBoundingClientRect` scale regardless. **This policy bounds the base64 PNG (display-bounded); it does *not* bound the manifest** — the `:grid` layer ships the source-resolution `values[]` matrix, so a large `heatmap!`/`image!` ships an O(cells) value matrix on top of a display-bounded PNG (`perf-findings.md`). |
| **Wide mode** | **Package-owned** `max_width` option that vendors `PlutoUI.WideCell`'s technique (cell `width` + negative `margin-left` + editor `ResizeObserver`) **inside our widget**, and renders at `2 × max_width`. | `PlutoUI.WideCell` **no-ops under `@bind`** (it checks `parentElement === PLUTO-OUTPUT`; the `<bond>` breaks that) and can't tell our renderer how big to draw (→ blurry on widen). Owning it sidesteps both and removes a PlutoUI dep. The rare case where reimplementing beats reuse. |
| **JS testing** | **vitest** for hit-test geometry math; the **Pluto + Playwright** harness (see `spike/`) for browser integration in CI. | Geometry is unit-testable in Node; the round-trip/export behavior needs a real browser. |
| **Dependencies** | **Julia hard deps:** `AbstractPlutoDingetjes` + `HypertextLiteral` (no package extension). **JS runtime dep (bundled):** `d3-format` v3 (M2.3; first runtime JS dep; bundle-size delta in `perf-findings.md`). | For a Pluto-targeted widget the extension only buys "core usable headless," which isn't a real use case here — it'd be ceremony. JS deps are bundled into `assets/overlay.js` — no CDN, works offline. |
| **CI** | A GitHub Action is the **sole author** of the committed bundle: builds + commits on push to `main` (loop-safe via `GITHUB_TOKEN`); test jobs build-before-test; fork-PR fallback is `git diff --exit-code`. | Main head bundle is never stale; agents committing their local build becomes optional. Activates once the repo is on GitHub. |
| **Release** | CI gate only for now; release automation (Registrator/TagBot or GitHub-only tagging) deferred. | Sufficient until we publish. Tag a CI-built commit when we do. |

## Export-survival spike (verified)

`spike/export_spike.jl` ships the manifest via `published_to_js`, rendered the figure, was
exported through Pluto's export endpoint, and the exported HTML was served on an **isolated port
with no Julia kernel** and opened in a real browser:

- **Live**: `published_to_js` manifest arrived in JS (`M.length == 5`). ✓
- **In the export statefile**: decoding the embedded base64 statefile shows our base64 PNG *and*
  the published manifest data (labels + `cx`, "published" markers) are serialized into it — **not
  live-channel-only**. ✓
- **No kernel**: served on port 8765 (no Pluto backend), the page reconstructed the image + the
  published manifest (`window.__exportSpikeManifestLen == 5`) and the **client-side hit-test
  worked** — hover gamma → tooltip "gamma" at the CSS-scaled 1.76 ratio; miss → hidden. ✓

**Conclusion:** the inspection layer (hover/tooltip/highlight/coordinate readout) **survives static
HTML export and runs with no Julia process** — exactly the offline read-only-inspector story we
wanted — and `published_to_js` is the correct manifest transport.

**Caveats (honest):**
- What does **not** survive export: click → `@bind` → Julia recompute (no kernel in a static export;
  the bond is inert unless served by PlutoSliderServer/Binder). Client-side interactivity is the
  half that works offline; reactive recomputation is not.
- The one CDN dependency in the export is **Pluto's own frontend** (jsdelivr), *not* our widget.
  Truly-no-network rendering requires Pluto's all-inclusive (frontend-inlined) export — Pluto's
  concern, not ours. Our bytes (image + manifest + JS) are all embedded/vendored.

## Resulting per-cell runtime shape

```
holo show()  emits:
  <img data:image/png;base64,…>           (the static render)
  <svg>/overlay + shadow-root styles
  <script>
    /* committed bundle IIFE — self-installs window.Holo; idempotent, no guard */
    const manifest = $(published_to_js(manifest))      // MsgPack, survives export
    window.Holo.mount(currentScript, manifest, invalidation)
  </script>
```
