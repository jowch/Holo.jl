# Holo.jl — Perf findings (Phase 0 spike)

> Resolves `research-findings.md` Q5 / `design.md` §10 unknown (4): the payload/latency envelope.
> A measurement spike, not a feature — it **bounds the scope** of every payload-heavy roadmap
> item after it (M2.3 tooltips, M4 animation, SVG output, multi-select return shape).
>
> Reproduce: `julia --project=. bench/payload_envelope.jl` (numbers below from 2026-06-28,
> CairoMakie 0.15, Julia 1.12). Re-run after any feature that changes the manifest — the bench
> is committed so these numbers can't silently rot.

## The two payload terms

From `src/render.jl` `show`, a rendered cell ships two payloads (the click *return* value —
`{layer,index,payload}` — is tiny and not a factor):

| Term | Carried by | Cost driver | Regenerated |
|------|-----------|-------------|-------------|
| **base64 PNG** | HTML `<img src="data:…">` | output pixel area × visual density | every render |
| **manifest** | `published_to_js` (MsgPack on the wire) | #hit-elements × per-element payload | every render |

The "large base64 → editor lag" warning in Q5 is about the **PNG**. The manifest is the term
that **future features inflate** (tooltips, animation frames, multi-select).

## Measured envelope

base64 PNG decoded size (KB) and manifest MsgPack size (KB), default 700px column (px_per_unit 2):

| Plot | PNG | manifest | note |
|------|----:|---------:|------|
| line, 10 pts | 55 | 0.6 | ~55 KB antialiasing/text floor for any plot |
| scatter, 100 | 35 | 6 | |
| scatter, 1 000 | 187 | 58 | typical interactive plot |
| scatter, 10 000 | 724 | 576 | manifest ≈ PNG; both O(N) |
| heatmap, 50×50 | 30 | 23 | |
| heatmap, 200×200 | 190 | 356 | grid edges are compact, but `values[]` is O(cells) |

**The knee.** A realistic single interactive plot is **50–400 KB total** — at/just above the
"10–100 KB+ plausible" band from Q5, not below the "<10 KB" anecdote. Editor lag is not expected
here. It becomes a real risk only at the extremes below.

### What scales the manifest
- **Per-element count** is linear: ~58 bytes/element (3 geometry floats + a small payload).
  10 000 elements → ~576 KB.
- **Heatmaps carry the full value matrix** (`:grid` geometry's `values[]`, O(cells)): 200×200 ≈
  356 KB. By design — that value already feeds the deferred `{i,j,value}` tooltip, so M2.3 adds
  no extra cost for heatmaps.
- **px_per_unit (display width)** scales the PNG ~quadratically with width but **does not** touch
  the manifest (geometry is pixel coords; the count is unchanged): scatter-1000 PNG 89 KB @300px
  → 187 KB @700px, manifest 58 KB both.

### Render latency (Julia half of the click→re-render round-trip)
`@elapsed holo(fig)`, warmed, best-of-3. The click message is tiny and Pluto auto-throttles stale
events, so the felt latency is dominated by Julia re-rendering + re-encoding. Browser paint +
websocket transfer ride on top (needs live Pluto to measure — see Not measured).

| Plot | render + encode |
|------|----:|
| scatter 1 000 | 67 ms |
| scatter 10 000 | 296 ms |
| heatmap 200×200 | 46 ms |

Sub-second for click selection across the board. The floor is the ~46–67 ms Cairo render.

### Full click round-trip (live Pluto + headless browser)
Measured end-to-end in a real Pluto kernel + Chromium: reproduce the overlay's exact bond commit
(`host.value = {layer,index,payload}` + `dispatchEvent(new CustomEvent("input"))`, what
`overlay.ts` does on click), then time until the downstream cell's re-rendered `<img>` lands in
the DOM. The downstream cell bakes the event index into the figure so a **genuinely new ~40 KB
PNG** is rendered, shipped over the websocket, decoded and painted each round-trip (the heavy
path, not just an overlay re-highlight). 15 samples, scatter-50:

| | round-trip |
|------|----:|
| median | **65 ms** |
| min | 61 ms |
| p90 | 121 ms |
| max | 241 ms |

The round-trip is **essentially the Julia render floor (~46–67 ms) plus only ~tens of ms** of
websocket transfer + decode + paint. So browser overhead is *not* the bottleneck — render time is.
Extrapolating with the render table: a scatter-10 000 click (~296 ms render + ~724 KB PNG over
localhost) lands well under ~400 ms. The client-side hit-test (~0 ms, not in this number) adds
nothing felt. Two caveats: localhost websocket (no network latency), and Pluto's selection
*re-highlight* is cheaper still (overlay-drawn → no new PNG, manifest-only round-trip).

## Stress test — the extremes (where it stops being render-bound)

Pushing past the normal envelope (live round-trips + a pure-Julia sweep to 10× the sizes above):

**Live round-trip vs total payload — the crossover.** Same method as above, heavier downstream:

| Downstream re-render | PNG | manifest | round-trip (median) | render floor | non-render overhead |
|----------------------|----:|---------:|--------------------:|-------------:|--------------------:|
| scatter 50 (tiny) | 40 KB | ~6 KB | 65 ms | ~50 ms | ~15 ms |
| scatter 10 000 | 768 KB | 576 KB | 335 ms | 296 ms | **~40 ms** |
| heatmap 1000×1000 | 2.13 MB | **8.6 MB** | **553 ms** | ~160 ms | **~390 ms** |

Below ~1 MB total, the round-trip is **render-bound** and browser/transfer overhead is a near-constant
~15–40 ms. Above a few MB it flips to **payload-bound**: the heatmap's 553 ms is mostly *not* render —
it's `published_to_js` msgpack-serializing 8.6 MB + shipping ~11 MB over the wire + paint. Nothing
crashed; it degrades gracefully into the half-second range. The crossover sits around **1–10 MB total**.

**The manifest is the high-N wall, not the PNG** (pure-Julia sweep):

| Case | PNG | manifest | render |
|------|----:|---------:|-------:|
| scatter 50 000 | 794 KB | 2.85 MB | 954 ms |
| scatter 100 000 | 302 KB | 5.75 MB | 1.5 s |
| scatter 200 000 | 71 KB | **11.6 MB** | 2.9 s |
| heatmap 1000×1000 | 2.26 MB | 8.6 MB | 159 ms |
| scatter 50 000 + 200 B tooltip/elem | 46 KB | **11.2 MB** | 1.5 s |

- **PNG is non-monotonic in N** — past saturation, dense random scatter compresses to a near-solid mass
  (200 000 pts → only 71 KB), while the **manifest grows strictly O(N) to 11.6 MB**. At high element
  counts the manifest, not the image, is the ceiling.
- **Heatmap render stays cheap (~160 ms even at 1 M cells)** — Cairo blits the raster — but the manifest
  carries the full value matrix (O(cells)), so 1000² = 8.6 MB. Payload, not render, is the cost.
- **Raw canvas pixels are *not* a payload driver for sparse content**: a 3200×2000 figure with 2 000
  points produced a *smaller* PNG (131 KB) than a 600×400 one — density drives PNG size, not resolution.
- **This is where the binary fast-path would finally pay off** (see below): at multi-MB manifests, the
  ~390 ms serialize+transfer is exactly the cost lifting geometry/values to typed `Vector{Float64}`
  (engaging MsgPack's TypedArray path) would cut. A real optimization *if* high-N surfaces get built —
  still YAGNI until one does.

## Scope bounds for downstream phases

- **M2.3 Richer tooltips** — manifest grows by `Σ(tooltip bytes)`. Measured: 1 000 elements ×
  200-byte HTML each = +196 KB (34 → 230 KB). **Budget: keep per-element tooltip HTML under
  ~200 bytes at N≈1 000** to stay in the sub-300-KB band. Rich per-element HTML at N≈10 000 will
  push the manifest into MB territory — gate it (truncate, or hand-roll only on hover via a
  template) before shipping unbounded HTML. (Stress confirms: 50 000 elements × 200 B each =
  **11.2 MB manifest** → a payload-bound ~0.5 s+ round-trip.)
- **M4 Animation / scrubbing** — frames are pre-baked PNGs: **total = frames × per-frame PNG**.
  Measured: a 245-KB plot × 30 frames = **7.2 MB**, × 120 = **29 MB**. This is the hard ceiling
  of the roadmap. Animation **must** shrink per-frame cost (smaller canvas / lower px_per_unit /
  fewer frames) or it trips the "framework-revisit" payload trigger. A naive full-res scrub is
  not viable. (Stress: a 1200×800 / 5 k-scatter frame is 645 KB → 300 frames = 189 MB, 1000 = 630 MB.)
- **SVG output path** — out of this bench (raster only). The roadmap already gates SVG behind a
  primitive-count viability spike; the PNG floor here (~55 KB even for 10 points) is the number
  SVG must *beat* to be worth it for sparse plots.
- **Multi-select** — affects only the tiny *return* value (`Vector{InteractionEvent}`), not these
  payloads. K selected events × ~tens of bytes; never a size concern. The contract change, not
  the size, is the work.

## MsgPack fast-path (Q5 sub-claim)

`published_to_js` always serializes via **MsgPack** (not JSON) — confirmed by the format Pluto
uses for published objects. The *TypedArray binary fast-path* (the Q5 "MsgPack fast-path") only
kicks in for top-level typed numeric vectors (`Vector{UInt8}`/`Vector{Float64}`…). **Our manifest
root is `Dict{String,Any}` with `Any[]` layers**, so the bulk serializes as generic MsgPack
maps/arrays, *not* binary blobs — even though leaf geometry is `Vector{Float32}`, it's nested
inside `Any` containers. Practical impact is small (generic MsgPack ≈ JSON/1.5–2 within the same
order). If manifest size ever becomes the bottleneck at high N, lifting geometry to top-level
typed `Vector{Float64}` would engage the binary fast-path — a micro-opt, not needed now.

## Not measured (deliberately deferred)

- **Editor-lag knee** — the actual point where the Pluto *editor* (not the kernel) stutters from
  large cell output. Our payloads sit at/just above the anecdotal band; the only way to pin the
  real knee is to load increasingly heavy cells in a live notebook and watch the editor. Cheap
  follow-up if MB-scale features (animation) get built. (The round-trip *latency* — distinct from
  editor stutter — is now measured above.)

Payload size, the thing that drives every cost here, is now known — and the live round-trip
confirms render time, not the browser, is the latency bottleneck.
