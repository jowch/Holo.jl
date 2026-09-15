# Backends

Holo has two backends. The interaction contract — `holo`, `@bind`, `InteractionEvent`, every
interactable — is identical on both. The cost profile is not.

## `:cairo` (the default)

`using CairoMakie` selects it. CairoMakie renders the figure to a PNG once; Holo computes a
hit-region manifest in Julia and ships both to the browser. A small TypeScript overlay
(`assets/overlay.js`) sits over the static image, hit-tests pointer events against the
manifest, draws highlights/tooltips locally, and only sends a deliberate click back through
`@bind`. Cost-wise: one render per `holo()` call, independent of how many elements are
interactive — cheap for a plot you build once and let the reader hover/click, expensive if
you're re-rendering on every animation frame (each frame re-rasterizes the whole scene).

Because the image and manifest are both embedded in the output HTML, **the inspection layer
keeps working in an exported, offline static HTML** — hover and tooltips still work with no
Julia kernel at all. Only a click that should trigger a Julia recompute needs a live kernel;
without one, the click is inert (nothing to `@bind` to).

## `:webgl` (WGLMakie)

> **Status: experimental / incubating.** Verified end-to-end in a real Pluto notebook
> (render, server-free delivery, overlay, and the `@bind` round-trip).

`using WGLMakie` instead of `CairoMakie` switches `holo` to a browser-GPU backend: the figure
renders live in a WebGL `<canvas>` on the client GPU, with Holo's usual overlay layered on
top — no code changes beyond the `using` line:

```julia
using Holo, WGLMakie

fig = Figure()
ax = Axis3(fig[1, 1])
scatter!(ax, x, y, z)

@bind ev holo(fig)   # a live WebGL canvas + Holo's overlay; ev is an InteractionEvent on click
```

Reach for `:webgl` for **3D you want to actually rotate live**, **animation / frequent
re-renders** (WebGL redraws a frame, `:cairo` re-rasterizes a whole PNG), and **large or
live-updating data** where per-frame render cost dominates. For everything else — a figure
you build once and let the reader inspect — `:cairo`'s static PNG is lighter and, unlike
`:webgl`, keeps working in an offline export.

[`examples/webgl_demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/webgl_demo.jl)
is a runnable gallery of the `:webgl` backend (CI runs it headlessly, same as `demo.jl`).
For the numeric cost model (bundle size, per-frame payload, click latency at scale), see
[`docs/dev/perf-findings.md`](https://github.com/jowch/Holo.jl/blob/main/docs/dev/perf-findings.md)
and [`docs/dev/backend-comparison.md`](https://github.com/jowch/Holo.jl/blob/main/docs/dev/backend-comparison.md)
— this page describes the cost model in words, not numbers, so it can't drift out of sync
with the measured ones.

### What exported static HTML keeps and loses

Whichever backend rendered a cell, a Pluto notebook exported to static HTML keeps hover and
tooltip inspection (both are already baked into the manifest — no kernel needed). What it
loses is anything that needs Julia to recompute: a click that should update `ev` and re-run
downstream cells does nothing without a live kernel behind it, on either backend. A
`:webgl` scene additionally keeps its **last-rendered camera state** in a static export (you
can still look at it), but pan/rotate that would normally recompute a bond has nowhere to
send its result.

### Choosing between them

Holo resolves the backend from which extension is loaded — a missing `using` line raises an
`ArgumentError` the first time `holo` runs; loading **both** `CairoMakie` and `WGLMakie` is
fine, and then `backend=` picks one explicitly while an unqualified `holo(fig)` defaults to
`:cairo` (so a Cairo-baked sysimage isn't blocked by a stray `using WGLMakie`).

### Caveats

- **Version-coupled** to WGLMakie's internals (`serialize_scene` shape, `setup_scene_init`
  signature). Pinned to a specific `WGLMakie` compat range; treat a WGLMakie version bump as
  a re-verification, not an automatic upgrade.
- The WGLMakie JS bundle ships **once per notebook**, so each additional `holo(fig)` cell's
  own cost is just its own scene, not another copy of the bundle.
