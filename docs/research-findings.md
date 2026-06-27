# Holo.jl — Feasibility Research Findings

> Output of the research workflow fact-checking the assumptions in `design.md` (Q0–Q5).
> Generated 2026-06-26. 6 parallel primary-source research agents + synthesis.

## Verdict at a glance

| # | Question | Verdict | Confidence | One-line takeaway |
|---|----------|---------|-----------|-------------------|
| Q0 | Does this need to exist? (prior art) | **Confirmed gap** | High | No package combines CairoMakie static output with @bind-driven client-side interactivity; WGLMakie is server-centric, CairoMakie is static-only. |
| Q1 | Single-cell two-way @bind widget | **Partly true** | High | Two-way binding works, but custom-element JS state does NOT survive Pluto re-renders — design must not depend on it. |
| Q2 | CairoMakie SVG structure for hit-testing | **Confirmed** | High | SVG is anonymous path-soup with no ids/groups; SVG-native hit-testing is impossible. Manifest is mandatory. |
| Q3 | Makie projection/layout API | **Confirmed** | High | All assumed APIs exist and are stable in Makie 0.24.x; no renames/deprecations. |
| Q4 | CairoMakie DPI/resolution scalar | **Confirmed** | High | Fold `device_scaling_factor` (px_per_unit for PNG) into the manifest as the single scene→pixel scalar. |
| Q5 | @bind round-trip limits | **Partly true** | Medium | Auto-throttling and MsgPack fast-path are real; payload/image-size ceilings are undocumented and must be measured. |

## Go / No-go on the core bet

**Q0 — Yes, build it.** WGLMakie/Bonito delivers rich interactivity but requires a live
WebSocket-connected Julia process, breaks on page reload, struggles on remote servers, and
Makie's standard hover (DataInspector) explicitly needs a running process. CairoMakie gives
publication-quality output but zero interactivity. Nothing serves *"publication-quality static
2D plot + light client-side hover/tooltip + @bind-only clicks, Pluto-native, no parallel
server."* Defensible niche. Position it as **light interactivity for publication 2D plots**,
not a WGLMakie/3D replacement.

**Q1 — Mechanism is real, but the design doc's framing was wrong.** Two-way @bind from one
cell works: Pluto reads the element's `.value` and listens for an `input` event; push back with
`el.value = …; el.dispatchEvent(new CustomEvent('input'))`. `pluto-cell` `id` is stable.
**BUT** Pluto replaces cell output via `innerHTML = …` (RawHTMLContainer in CellOutput.js),
destroying and recreating child custom elements on every output re-render. `connectedCallback`
fires again but arbitrary JS instance state (variables, listeners) is lost. PlutoUI widgets are
stateful by re-emitting fresh HTML from Julia, not by persisting frontend JS state. **Go — with
the stateless-view correction (see below).** This actually fits the static-image + overlay
architecture well, since the image is a static DOM node and clicks are the only round-trip.

> Caveat: Q1 cites internal frontend files (CellOutput.js, Bond.js, Cell.js). The *behaviors*
> (innerHTML replacement, `.value`+`input` dispatch, stable `pluto-cell` id) are high-confidence
> and match the official advanced-widgets examples; exact line numbers are version-dependent —
> re-confirm against the pinned Pluto version targeted.

## Per-question findings

### Q0 — Prior art
- WGLMakie+Bonito: interactive but server-centric (WebSocket + Julia process); page reload
  breaks it; remote/static-export brittle. DataInspector hover needs a running process. Browser
  tooltips only via `Bonito.App` + custom JS. Makie docs point to **BonitoBook** (not Pluto) for
  the "best WGLMakie notebook experience."
- CairoMakie: static only. AbstractPlutoDingetjes has the @bind plumbing but nobody glued it to
  CairoMakie output.
- **Implication:** clear niche; no design change. Set scope expectations: no 3D, no live
  camera/zoom round-trips.

### Q1 — Pluto single-cell two-way
- (a) Pluto **replaces** output DOM via innerHTML, not patch. (b) `closest('pluto-cell').id` is
  stable. (c) `persist_js_state` reattaches previously-rendered DOM nodes (script-id keyed) —
  does **not** preserve JS variable state. (d) push pattern: set `.value`, dispatch
  `new CustomEvent('input')`; Bond reads `.value` each render and forwards on `input`.
- **Correction:** remove any assumption that a custom element retains hover/highlight/selection
  state across reactive re-renders. Authoritative selection state lives in Julia (via @bind);
  transient hover state lives in the overlay only between renders, rehydrated from data
  attributes / sessionStorage / the @bind value on reconnect.

### Q2 — CairoMakie SVG structure
- Cairo SVG output carries no ids/metadata/grouping — a fundamental Cairo limitation (same in
  Matplotlib's Cairo backend). CairoMakie draws primitives directly (e.g. `Cairo.arc` per scatter
  point); its only SVG post-processing resets auto surface ids and salts glyph names.
- **Correction:** confirms manifest+overlay. Drop any idea of attaching listeners to SVG plot
  elements. PNG preferred for dense plots; SVG only for sparse plots, still manifest-driven.

### Q3 — Makie projection & layout API
- All confirmed in Makie 0.24.12, no deprecations: `Makie.project(scene, point)`,
  `Makie.project(ax.scene, :data, :pixel, point)`, `plot.converted[]`, `ax.scene.viewport[]`
  (`Observable{Rect2i}`), `ax.finallimits[]` (`Observable{Rect2d}`),
  `Makie.update_state_before_display!(fig)` (calls `reset_limits!`), `fig.scene.viewport[]`.
- **Correction:** none. Make `update_state_before_display!(fig)` a **mandatory** pre-manifest
  step, then `Makie.project(ax.scene, :data, :pixel, point)`.

### Q4 — CairoMakie DPI/resolution
- `px_per_unit` (default 1.0) scales PNG: `output_px = scene_size * px_per_unit`. `pt_per_unit`
  (default 0.75) scales PDF/EPS; SVG CSS-px scale = `pt_per_unit/0.75`.
  `device_scaling_factor(rendertype, config)` is the authoritative selector. Output resolution =
  `round(Int, size(scene) .* device_scaling_factor)` and is **fixed at Screen creation** — no
  post-render rescale. In-memory: `CairoImageSurface` → `show(buf, MIME"image/png"(), surface)` →
  base64; resolution via `ScreenConfig`.
- **Correction:** manifest carries `device_scaling_factor` + `rendertype` + output dimensions.
  Re-render (new Screen) whenever px_per_unit changes.

### Q5 — @bind round-trip limits
- Pluto auto-throttles: while a cell runs, queued @bind events are discarded and only the latest
  is sent (lossy, not configurable). Serialization JSON by default, with MsgPack/TypedArray
  fast-path for large `Vector{UInt8}`/`Vector{Float64}`. **No published numeric limits** on
  payload or WebSocket message size. Large base64 images cause editor lag; one source says
  <10 KB (conservative/anecdotal), more plausible working range 10–100 KB+.
- **Correction:** don't cite hard payload ceilings. Rely on built-in throttling; filter clicks
  JS-side; prefer MsgPack-friendly return types. Treat image size + latency as quantities to
  **benchmark**. Weakest-sourced finding (medium confidence).

## Remaining unknowns — resolve with a code spike, not more reading
1. **Re-render survival (Q1):** minimal CairoMakie-PNG + overlay + @bind cell — does the overlay
   flicker/reset on reactive re-render? Does `persist_js_state` (script-id tagged PNG node)
   prevent a full image reload on every bond round-trip? Can hover state rehydrate cleanly?
2. **Click-only round-trip UX (Q1/Q5):** confirm hover stays purely client-side (no Julia
   traffic) and a deliberate click round-trips without destroying in-progress interaction.
3. **Manifest pixel accuracy (Q3/Q4):** verify `Makie.project` + `device_scaling_factor` hit
   regions align to within ~1px against the actual PNG across px_per_unit values, multi-axis
   layouts, and after `update_state_before_display!`.
4. **Payload/latency envelope (Q5):** benchmark base64 sizes (100 KB → several MB) and click
   round-trip latency to find the editor-lag / responsiveness knee; confirm MsgPack fast-path
   engages.
5. **SVG viability threshold (Q2):** primitive count at which SVG file size / editor perf
   becomes unacceptable, to set the PNG-vs-SVG switch.

## Key sources
- Pluto: CellOutput.js, Cell.js, Bond.js (JuliaPluto/Pluto.jl); advanced-widgets docs;
  AbstractPlutoDingetjes README.
- Makie: projection_math.jl, axis.jl, figureplotting.jl, scenes.jl (MakieOrg/Makie.jl 0.24.12).
- CairoMakie: infrastructure.jl, primitives.jl, screen.jl; cairographics.org SVG surface docs.
- @bind: plutojl.org/docs/bind, discussions #1114, PR #1124, issue #2978.
