# `:webgl` vs `:cairo` — a backend comparison (wire **and** UX)

> **What this answers.** Holo now has two backends: `:cairo` (core — a static CairoMakie PNG +
> a thin JS hit-test overlay) and `:webgl` (this package — the figure rendered live in a WGLMakie
> `<canvas>` on the client GPU, same overlay on top). The open question was whether `:webgl` is just
> a *heavier* `:cairo` (pay 1.09 MB, get the same thing) or a **co-equal entry point** a user would
> pick on its own. The measurements say co-equal: they occupy **different regimes**, and `:webgl`
> owns a capability zone `:cairo` cannot enter at all.
>
> **Numbers reproduce** via `julia --project=HoloWGL HoloWGL/bench/vs_cairo.jl` (WebGL measured live;
> Cairo measured in a root-env subprocess — one command, nothing hand-stamped). The size figures
> reconcile with the two envelopes (`../../docs/perf-findings.md` for Cairo, `perf-findings.md` for
> `:webgl`) and root `bench/stress.jl`; re-run all on any wire-format change. Last run **2026-06-30**,
> WGLMakie 0.13.12 / CairoMakie 0.15 / Julia 1.12.

## 1. Capability matrix — the headline is what each backend *can do*, not how fast

UX diverges on capability before it diverges on speed. `:cairo` ships a **static image**: the only
live interactions are the overlay's hit-test (hover/click) and a full server re-render when an
`@bind` changes the figure. `:webgl` ships a **live scene**: the client GPU owns view manipulation.

| interaction | `:cairo` | `:webgl` |
|---|---|---|
| pan / zoom | **impossible** (static PNG) | client GPU — **no server round-trip** |
| rotate a 3D plot | **impossible** (`Axis3` rejected at render) | client GPU — no round-trip |
| hover tooltip | overlay hit-test (client) | overlay hit-test (client) — same |
| click → `@bind` | client hit-test + bind | client hit-test + bind — same |
| data update (`@bind` drives the data) | **full** server render + encode + PNG re-ship | server serialize + client redraw |
| animation, N frames | N × full PNG | N × scene (tier-1) → in-place patch (tier-2, roadmap) |

The **blank cells are the finding.** A symmetric latency table would print a number in the pan/zoom
row and hide that `:cairo` cannot pan or zoom at all. So "wire crossover" (below) and "UX value" are
different axes: a 100-point scatter never crosses over on bytes — but if the user wants to *zoom into
it*, `:webgl` is the only backend that does.

## 2. Wire + server cost — the measurable half

Per-figure, identical seeded data. **Cairo/render** = PNG (decoded) + manifest, re-shipped *every*
render. **WebGL scene** = the per-render MsgPack-binary scene; the **1.09 MB WGLMakie bundle** ships
**once per notebook** (M2) on top of the first cell only. **ms** = server work to turn a fresh figure
into a shippable payload.

| figure | Cairo /render | Cairo ms | WebGL scene | WebGL ms | wire crossover N* |
|---|--:|--:|--:|--:|--:|
| line, 10 | 51 KB (51+1) | 47 | 103 KB | 26 | never |
| scatter, 1 000 | 225 KB (187+38) | 72 | 87 KB | 31 | **7.7** |
| scatter, 10 000 | 1 103 KB (724+379) | 277 | 158 KB | 27 | **1.1** |
| scatter, 100 000 | 3 973 KB (53+**3 920**) | **2 219** | 861 KB | 34 | **0.3** |
| heatmap, 200² | 386 KB (190+197) | 47 | 1 956 KB | 32 | never |
| heatmap, 500² | 1 012 KB (1 009+3) | 71 | 11 843 KB | 45 | never |
| 3D helix, 300 | **unsupported** | — | 141 KB | 28 | WebGL-only |

*Renders after which cumulative `:webgl` (bundle + N·scene) < cumulative `:cairo` (N·(PNG+manifest)).
`:cairo` has no bundle but re-rasterizes and re-ships everything each render; `:webgl` ships the bundle
once, then only its compact scene.

Two terms move independently under stress, and both are UX terms:

- **Cairo's server time scales with the data** because it rasterizes server-side: **47 → 72 → 277 →
  2 219 ms** across scatter 10 → 100k. At 100k points every `@bind` update is a **~2.2-second** stall.
  **WebGL is flat at ~26–34 ms** regardless of N — it only *serializes*; the GPU draw is offloaded to
  the client. That flat line is the win, not a measurement gap.
- **Cairo's manifest — not its PNG — is the interactivity cost, and it's O(N).** At 100k the PNG
  *collapses* to 53 KB (overplotting saturates the pixels) while the manifest balloons to **3.9 MB**,
  re-shipped every render (it carries the hover/click hit-regions). The PNG plateaus; the *interactive*
  payload does not.

## 3. The three regimes

1. **Static, small–mid 2D → `:cairo`.** line / scatter-1k / small heatmap: Cairo's per-render payload
   is smaller *and* there is no 1.09 MB bundle. A rasterizer is the right tool for a static picture.
2. **Large, animated, or repeatedly-updated 2D → `:webgl`.** scatter-10k crosses over after ~**1**
   re-render; scatter-100k wins **outright on the first cell** (Cairo's 3.97 MB/render vs 1.09 MB
   bundle + 0.86 MB scene) *and* is ~65× cheaper in server time (34 ms vs 2 219 ms). This is the
   slider / animation / live-data case, where Cairo's re-rasterize-every-frame model is the bottleneck.
3. **3D, or client-side view manipulation → `:webgl` only.** `:cairo` rejects `Axis3` outright, and a
   PNG cannot be panned, zoomed, or rotated. There is no crossover to compute — the capability simply
   does not exist on `:cairo`.

## 4. First paint — Cairo's genuine UX win, and the tax it trades

`:cairo`'s time-to-first-pixel is excellent: a PNG decodes natively and instantly. `:webgl`'s first
cell pays a **one-time** tax — download the 1.09 MB bundle, compile it, initialize three.js, upload to
the GPU, first draw — before anything shows. That tax buys **unlimited zero-latency interaction
afterward** (§1) and amortizes across the notebook (every later `:webgl` cell reuses the cached bundle
— M2). So the honest framing: `:cairo` wins the first 100 ms; `:webgl` wins every interaction after it.

## 5. Anti-finding — dense rasters are Cairo's home turf

`:webgl` is **not** universally lighter. A heatmap ships as a value grid, not an image: 200² = 2.0 MB
and 500² = **11.8 MB** as a `:webgl` scene, versus a 0.4–1.0 MB Cairo PNG. For dense raster/image
content, `:cairo` is both smaller on the wire and simpler. "Choose the right backend" cuts both ways —
which is exactly what makes them **co-equal**, not light-vs-heavy.

## 6. What's asserted here vs. still to live-verify

§2 is benched and reconciled. §1's capability rows are **architectural** (a static PNG has no pan/zoom;
`Axis3` is rejected in code) — but two client-side UX claims still deserve a real Pluto + browser check
per CLAUDE.md's live-verification mandate, and are **not yet run**:

- **Round-trip proof:** panning/zooming a `:webgl` canvas fires **zero** network requests (client-local),
  while a `:cairo` `@bind` update fires a full PNG round-trip. (Count requests, not FPS — headless
  Chromium is software GL, so any frame-time it reports is pessimistic and not the user's GPU.)
- **Overlay alignment under transform:** does the Holo hit-region overlay stay aligned with the plot
  when the `:webgl` canvas is panned/zoomed? If the regions don't track the canvas transform, that's a
  real UX bug the wire benches can't see.

These are tracked as the next step for this comparison (see `roadmap.md`).
