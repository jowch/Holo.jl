# `:webgl` vs `:cairo` — a backend comparison (wire **and** UX)

> **What this answers.** Holo has two backends: `:cairo` (a static CairoMakie PNG + a thin JS
> hit-test overlay) and `:webgl` (the figure rendered live in a WGLMakie `<canvas>` on the client
> GPU, same overlay on top). The open question was whether `:webgl` is just a *heavier* `:cairo`
> (pay 1.09 MB, get the same thing) or a **co-equal entry point** a user would pick on its own. The
> measurements say co-equal: they occupy **different regimes**, and `:webgl` owns a **3D-rendering**
> capability zone `:cairo` cannot enter (live view manipulation is *not* such a zone — it's gated off
> today and deferred; see §1†).
>
> **Numbers reproduce** via `julia --project=. bench/vs_cairo.jl` (WebGL measured live in this
> process, both sides `Random.seed!(0)`; Cairo measured in a subprocess, since Holo supports only
> one backend extension per session — one command, nothing hand-stamped). The **size** figures are
> byte-reproducible and reconcile with `bench/payload_envelope.jl` (`markersize=6`, same as here) for
> the shared cases — scatter-1k 187/38 KB, scatter-10k 724/379 KB. The **scatter-100k** row is this
> bench's own point; `bench/stress.jl` sweeps 100k too but at `markersize=4` (≈303 KB PNG / ~1.6 s),
> so it is *not* a corroborating source for the `markersize=6` numbers here — the marker size drives
> both the PNG and the raster time. **Timings (ms) are wall-clock** (`~` throughout) and vary
> run-to-run; only sizes are exact. Last run **2026-06-30**, WGLMakie 0.13.12 / CairoMakie 0.15 /
> Julia 1.12. Size/latency figures reconcile with `docs/perf-findings.md`'s `:webgl` section and its
> `:cairo` envelope — see that file for the full methodology.

## 1. Capability matrix — the headline is what each backend *can do*, not how fast

UX diverges on capability before it diverges on speed. `:cairo` ships a **static image**: the only
live interactions are the overlay's hit-test (hover/click) and a full server re-render when an
`@bind` changes the figure. `:webgl` ships a **live scene** (the base is a live GPU canvas) — but the
camera is gated off today (§1†), so its client-side edge is *rendering*, not view manipulation.

| interaction | `:cairo` | `:webgl` |
|---|---|---|
| pan / zoom | **impossible** (static PNG) | **not enabled today** (†) |
| rotate a 3D plot | **impossible** (`Axis3` rejected at render) | **not enabled today** (†) |
| hover tooltip | overlay hit-test (client) | overlay hit-test (client) — same |
| click → `@bind` | client hit-test + bind | client hit-test + bind — same |
| data update (`@bind` drives the data) | **full** server render + encode + PNG re-ship | server serialize + client redraw |
| animation, N frames | N × full PNG | N × scene (tier-1) → in-place patch (tier-2, roadmap) |

The rows that **match** are the current story: both backends do hover/click/`@bind` the same way, and
`:webgl`'s edge today is **rendering** (live 3D that Cairo rejects; cheap re-renders) — *not* live view
manipulation. Live pan/zoom/rotate is **not a feature of either backend right now** (†).

> **(†) Live view manipulation is currently off — and turning it on is a cross-backend design
> question, not a quick win.** `:cairo` can never pan/zoom (a PNG is dead pixels). `:webgl` *could* —
> the base is a live GPU canvas — but the widget deliberately **gates the camera off**: the shim sets
> `can_send_to_julia:()=>true` (needed for the client-side camera/uniform *observable* animation path,
> which WGLMakie's `update_cam` early-returns on when the flag is false), and WGLMakie's
> `use_orbit_cam = ()=>!(Bonito.can_send_to_julia && Bonito.can_send_to_julia())` therefore **disables
> 3D OrbitControls**; 2D `Axis` zoom/pan is Julia-side in WGLMakie and dead under the server-free
> (`NoConnection`) model. *Verified against the pinned bundle.* So there is **no live camera to drift
> against today** — the overlay misalignment is *latent*, not observed.
>
> Enabling it is a **large, staged feature** — the parked design's stages are **S1** a 2D CSS-transform
> magnifier, **S2** 3D-rotate via client-side re-projection, **S3** true data-space 2D zoom (+ `Axis3`
> support in Holo core), **S4** GPU-pick for occlusion — gated on a blocking spike (can a
> `PointInteractable` even be authored over an `Axis3` scatter, given Holo's interactable stack is 2D
> throughout?). It would exist **only in `:webgl`**, and *that* is the deciding factor — but note not
> all backend asymmetry is equal. 3D *rendering* is an **inherent support gap** (Cairo can't draw
> `Axis3` at all, so `:webgl` is simply "the capable backend"); live pan/zoom/rotate is a
> **discretionary** headline *interaction* tier we would *choose* to give only `:webgl`, deliberately
> making it "the interactive one" and splitting the user's mental model across backends. That
> discretionary split is what pulls against the **co-equal-entry-points** framing. **Status:
> investigated → deferred** (not rejected, not scheduled; revisit only on an explicit product
> decision). Fuller detail in `.superpowers/holowgl-live-camera-overlay-design.md` (local process doc);
> the roadmap records the deferral.

## 2. Wire + server cost — the measurable half

Per-figure, identical seeded data (`Random.seed!(0)` on both sides). **Cairo/render** = PNG (decoded)
+ manifest, re-shipped *every* render. **WebGL scene** = the per-render MsgPack-binary scene; the
**1.09 MB WGLMakie bundle** ships **once per notebook** (M2) on top of the first cell only. **ms** =
server work to turn a fresh figure into a shippable payload. Sizes are exact and reproducible; **ms
are wall-clock and approximate** (`~`). Units: **KB = bytes/1024, MB = bytes/1 000 000** throughout.

| figure | Cairo /render | Cairo ~ms | WebGL scene | WebGL ~ms | wire crossover N* |
|---|--:|--:|--:|--:|--:|
| line, 10 | 51 KB (51+1) | ~48 | 118 KB | ~25 | never |
| scatter, 1 000 | 225 KB (187+38) | ~75 | 87 KB | ~31 | **7.7** |
| scatter, 10 000 | 1 103 KB (724+379) | ~300 | 158 KB | ~26 | **1.1** |
| scatter, 100 000 | 3 973 KB (53+**3 920**) | **~2 280** | 861 KB | ~32 | **0.3** |
| heatmap, 200² | 386 KB (190+197) | ~49 | 1 956 KB | ~30 | never |
| heatmap, 500² | 1 012 KB (1 009+3) | ~71 | 11 843 KB | ~45 | never |
| 3D helix, 300 | **unsupported** | — | 141 KB | ~30 | WebGL-only |

*Renders after which cumulative `:webgl` (bundle + N·scene) < cumulative `:cairo` (N·(PNG+manifest)).
`:cairo` has no bundle but re-rasterizes and re-ships everything each render; `:webgl` ships the bundle
once, then only its compact scene.

Two terms move independently under stress, and both are UX terms:

- **Cairo's server time scales with the data** because it rasterizes server-side: **~48 → ~75 → ~300 →
  ~2 280 ms** from line-10 to scatter-100k. At 100k points every `@bind` update is a **~2.3-second**
  stall. **WebGL is flat at ~25–32 ms** regardless of N — it only *serializes*; the GPU draw is
  offloaded to the client. That flat line is the win, not a measurement gap.
- **Cairo's manifest — not its PNG — is the interactivity cost, and it's O(N).** At 100k the PNG
  *collapses* to 53 KB (overplotting saturates the pixels) while the manifest balloons to **3.9 MB**,
  re-shipped every render (it carries the hover/click hit-regions). The PNG plateaus; the *interactive*
  payload does not.

## 3. The three regimes

1. **Static, small–mid 2D → `:cairo`.** line / scatter-1k / small heatmap: Cairo's per-render payload
   is smaller *and* there is no 1.09 MB bundle. A rasterizer is the right tool for a static picture.
2. **Large, animated, or repeatedly-updated 2D → `:webgl`.** scatter-10k crosses over after ~**1**
   re-render; scatter-100k wins **outright on the first cell** (Cairo's 3.97 MB/render vs 1.09 MB
   bundle + 0.86 MB scene) *and* is ~70× cheaper in server time (~32 ms vs ~2 280 ms). This is the
   slider / animation / live-data case, where Cairo's re-rasterize-every-frame model is the bottleneck.
3. **3D *rendering* → `:webgl` only.** `:cairo` rejects `Axis3` outright, so only `:webgl` can *draw* a
   3D plot at all. Note this is about rendering, **not** interaction: live view manipulation
   (pan/zoom/rotate) is not enabled in either backend today, and enabling it only in `:webgl` is the
   open cross-backend design question in the (†) note above — not a shipped `:webgl` advantage.

## 4. First paint — Cairo's genuine UX win, and the tax it trades

`:cairo`'s time-to-first-pixel is excellent: a PNG decodes natively and instantly. `:webgl`'s first
cell pays a **one-time** tax — download the 1.09 MB bundle, compile it, initialize three.js, upload to
the GPU, first draw — before anything shows. Today that tax buys **cheap re-renders** (flat ~30 ms
server serialize + client redraw; §2) and live 3D *rendering*, and it amortizes across the notebook
(every later `:webgl` cell reuses the cached bundle — M2). It does **not** yet buy live view
manipulation — that's gated off (§1†/§6). So the honest framing: `:cairo` wins the first 100 ms;
`:webgl` wins repeated/animated re-renders and 3D display after it.

## 5. Anti-finding — dense rasters are Cairo's home turf

`:webgl` is **not** universally lighter. A heatmap ships as a value grid, not an image: 200² = 2.0 MB
and 500² = **11.8 MB** as a `:webgl` scene, versus a 0.4–1.0 MB Cairo PNG. For dense raster/image
content, `:cairo` is both smaller on the wire and simpler. "Choose the right backend" cuts both ways —
which is exactly what makes them **co-equal**, not light-vs-heavy.

## 6. What the source actually says about live interaction

§2 is benched and reconciled. §1's interaction rows are **architectural** — verified from the source
(a headless browser runs software GL, so a canvas paint / frame-time there would be pessimistic and not
the user's GPU anyway). Three facts, GL-independent:

- **Camera interaction is gated off today — verified.** The shim hardcodes `can_send_to_julia:()=>true`
  (`HoloWGL/frontend/src/holo-webgl.ts`); WGLMakie's
  `use_orbit_cam = ()=>!(Bonito.can_send_to_julia && Bonito.can_send_to_julia())` (pinned bundle)
  therefore **disables 3D OrbitControls**, and 2D `Axis` zoom/pan is Julia-side and dead under the
  server-free (`NoConnection`) model. So a `:webgl` plot renders live but **does not pan, zoom, or
  rotate** as shipped. (The flag is true *on purpose* — it's what lets the client-side camera/uniform
  *observable* animation path fire; `update_cam` early-returns when it's false. Note this is **not**
  roadmap tier-2 animation, which patches GL buffers via `find_plots` with no observable.)
- **If enabled, the wire/latency would be free but the overlay would drift.** Because the scene ships
  through `Bonito.Session(Bonito.NoConnection())` (`src/HoloWGL.jl:84`) with no transport back to the
  kernel, a client-side camera move would cost **zero round-trip by construction**. But the overlay's
  hit-regions are a static `Makie.project` snapshot (`src/HoloWGL.jl:113-125`; its own comment: "STATIC
  camera overlay… Axis3 / live-camera need client-side projection — TODO"), so they would **not** track
  the moving plot. Both facts are latent until the camera is turned on.
- **Turning it on is large and backend-asymmetric.** The staged shape — **S1** 2D magnifier → **S2**
  3D-rotate via client re-projection → **S3** data-space 2D zoom (+ Holo-core `z`/`Axis3` plumbing +
  shared-`overlay.ts` pointer-events change) → **S4** GPU-pick for occlusion — lands **only in
  `:webgl`** (fuller detail in `.superpowers/holowgl-live-camera-overlay-design.md`, a local process
  doc).

**Decision — investigated → deferred.** Should Holo offer live pan/zoom/rotate at all, given it would be
a headline capability that only one backend can ever have? The asymmetry pulls against the
co-equal-entry-points framing of this doc, so the feature is **deferred** — investigated, staged design
parked, not scheduled. Revisit only on an explicit product decision. Tracked in `roadmap.md`.
