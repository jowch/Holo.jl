# `:webgl` vs `:cairo` — a backend comparison (wire **and** UX)

> **What this answers.** Holo has two backends: `:cairo` (a static CairoMakie PNG + a thin JS
> hit-test overlay) and `:webgl` (the figure rendered live in a WGLMakie `<canvas>` on the client
> GPU, same overlay on top). The open question was whether `:webgl` is just a *heavier* `:cairo`
> (pay 1.09 MB, get the same thing) or a **co-equal entry point** a user would pick on its own. The
> measurements say co-equal: they occupy **different cost regimes** under an identical interaction
> contract (parity is CI-enforced by the golden-manifest harness, `test/fixtures/parity/`).
> `:webgl` renders 3D live *today*; static-`Axis3` on `:cairo` is roadmap parity scope — a Holo
> scoping guard, not a CairoMakie limit. View manipulation is planned as **backend-symmetric
> `@bind` re-render**; only the client-side GPU camera is out of scope (see §1†).
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

## 1. Interaction matrix — same contract, different cost

The interaction contract is identical on both backends; what differs is what each row *costs*.
`:cairo` ships a **static image**: hover/click hit-test in the overlay, and a full server
re-rasterize whenever `@bind` changes the figure. `:webgl` ships a **live scene**: the same
overlay on top, with re-renders that only re-serialize (the GPU draw is the client's). The
camera is deliberately not client-driven on either backend (§1†).

| interaction | `:cairo` | `:webgl` |
|---|---|---|
| pan / zoom | planned: `@bind` re-render of `limits` (†) | planned: same, gated on GL-context reuse (†) |
| rotate a 3D plot | planned: `@bind` re-render of `azimuth`/`elevation`, after the Axis3 parity item (†) | planned: same (†) — renders 3D live today |
| hover tooltip | overlay hit-test (client) | overlay hit-test (client) — same |
| click → `@bind` | client hit-test + bind | client hit-test + bind — same |
| data update (`@bind` drives the data) | **full** server render + encode + PNG re-ship | server serialize + client redraw |
| animation, N frames | N × full PNG | N × scene (tier-1) → in-place patch (tier-2, roadmap) |

The rows that **match** are the current story: both backends do hover/click/`@bind` the same way;
`:webgl`'s edge today is rendering **cost** (cheap re-renders; live 3D while `:cairo`'s Axis3 guard
is still in place). Live pan/zoom/rotate is **not shipped on either backend yet** — and when it
lands it lands on both, as server-authoritative re-render (†).

> **(†) View manipulation: planned as backend-symmetric `@bind` re-render; the client-side GPU
> camera stays out (a Holo-wide non-goal, alongside GPU-pick occlusion).** What is true today, verified from source: the widget
> deliberately gates the client camera off — the shim sets `can_send_to_julia:()=>true` (needed for
> the client-side camera/uniform *observable* animation path), so WGLMakie's
> `use_orbit_cam = ()=>!(Bonito.can_send_to_julia && Bonito.can_send_to_julia())` **disables 3D
> OrbitControls**, and 2D `Axis` zoom/pan is Julia-side in WGLMakie and dead under the server-free
> (`NoConnection`) model. That gating is *intentional and stays*: a client-driven camera moves the
> plot without Julia knowing, so the Julia-projected overlay desyncs — and it is structurally
> `:webgl`-only, which the parity doctrine forbids. It is the **Holo-wide non-goal** (with GPU-pick
> occlusion), not a deferred feature.
>
> The **in-scope path** treats view parameters as ordinary `@bind` state: 2D `limits` or 3D
> `azimuth`/`elevation` change → Julia re-renders → fresh base + freshly projected overlay. That is
> backend-symmetric and drift-free *by construction* (Julia recomputes the overlay every step).
> Cost, honestly: `:cairo` re-rasterizes per step (scales with the scene; fine for sliders and
> commit-on-release drag), `:webgl` re-serializes (~flat, §2) but is gated on **GL-context reuse**
> across cell re-runs (persist canvas+renderer; dispose-on-delete — an unresolved lifecycle spike;
> naive re-mounting leaks WebGL contexts toward the browser's cap). Continuous *smooth* drag on
> large scenes remains expensive on both — a shared cost wall, not a capability split. Status:
> **planned, unbuilt** — sliders first, drag after; 3D rotation additionally needs the Axis3
> parity item (`docs/roadmap.md` M3, same milestone as view manipulation).

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
3. **3D rendering, today → `:webgl`.** `:cairo` currently rejects `Axis3` — a Holo scoping guard
   slated to lift (CairoMakie draws static 3D natively; the projection hinge is spike-verified
   exact — figure in `perf-findings.md` §"Axis3 projection hinge spike"), after which static-3D
   overlays are parity and this regime reduces to regime 2's cost
   question (re-render price per view change). Live view manipulation ships on both or neither —
   see (†).

## 4. First paint — Cairo's genuine UX win, and the tax it trades

`:cairo`'s time-to-first-pixel is excellent: a PNG decodes natively and instantly. `:webgl`'s first
cell pays a **one-time** tax — download the 1.09 MB bundle, compile it, initialize three.js, upload to
the GPU, first draw — before anything shows. Today that tax buys **cheap re-renders** (flat ~30 ms
server serialize + client redraw; §2) and live 3D *rendering*, and it amortizes across the notebook
(every later `:webgl` cell reuses the cached bundle — M2). It does **not** yet buy live view
manipulation — unbuilt on both; when it lands, `:webgl`'s cheap re-renders are exactly what a
view-manip step costs (§1†). So the honest framing: `:cairo` wins the first 100 ms; `:webgl` wins
repeated/animated re-renders and (today) 3D display after it.

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
- **Turning the *client* camera on would be large and backend-asymmetric — which is why that path
  is retired.** Its staged design (S1 2D magnifier → S2 3D-rotate via client re-projection → S3 JS
  data-space zoom → S4 GPU-pick occlusion; parked in
  `.superpowers/holowgl-live-camera-overlay-design.md`, a local process doc) lands **only in
  `:webgl`** and exists to chase a camera Julia can't see. The in-scope replacement — server-side
  `@bind` re-render (†) — needs none of it: the overlay is re-projected by Julia each step, so the
  drift problem the client path had to solve never arises.

**Decision — superseded (2026-07-02): in scope, as parity.** The 2026-07-01 "investigated →
deferred" call answered the wrong question — it scoped view manipulation as a *client-side camera*
(which is indeed `:webgl`-only, drift-prone, and stays out). Server-authoritative `@bind`
re-render gives pan/zoom/rotate on **both** backends with the overlay recomputed each step, so
the backend-asymmetry objection dissolves; what remains is a per-step **cost** difference and the
`:webgl` GL-context-reuse prerequisite. Both scheduled in `roadmap.md` M3 (Axis3 parity + view
manipulation via `@bind` re-render); the client-side GPU camera remains a Holo-wide non-goal
(alongside GPU-pick occlusion).
