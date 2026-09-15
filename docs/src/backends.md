# Backends

Holo has two backends. The interaction contract — `holo`, `@bind`, `InteractionEvent`, every
interactable — is identical on both. The cost profile is not.

## `:cairo` (the default)

`using CairoMakie` selects it. CairoMakie renders the figure to a PNG once; Holo computes a
hit-region manifest in Julia and ships both to the browser. A small TypeScript overlay
(`assets/overlay.js`) sits over the static image, hit-tests pointer events against the
manifest, draws highlights/tooltips locally, and only sends a deliberate click back through
`@bind`. Cost-wise: one render per `holo()` call, independent of how many elements are
interactive — cheap for a plot you build once and let the user hover/click, expensive if
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
begin
    using Holo, WGLMakie
    x, y, z = randn(200), randn(200), randn(200)
    fig = Figure()
    ax = Axis3(fig[1, 1])
    scatter!(ax, x, y, z)
end
```

```julia
@bind ev holo(fig)   # a live WebGL canvas + Holo's overlay; ev is an InteractionEvent on click
```

Reach for `:webgl` for **3D you want to actually rotate live**, **animation / frequent
re-renders** (WebGL redraws a frame, `:cairo` re-rasterizes a whole PNG), and **large or
live-updating data** where per-frame render cost dominates. For everything else — a figure
you build once and let the user inspect — `:cairo`'s static PNG is lighter, and its offline
export behavior is the one that's actually verified (see below).

[`examples/webgl_demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/webgl_demo.jl)
is a runnable gallery of the `:webgl` backend (CI runs it headlessly, same as `demo.jl`).
For the numeric cost model (bundle size, per-frame payload, click latency at scale), see
[`docs/dev/perf-findings.md`](https://github.com/jowch/Holo.jl/blob/main/docs/dev/perf-findings.md)
and [`docs/dev/backend-comparison.md`](https://github.com/jowch/Holo.jl/blob/main/docs/dev/backend-comparison.md)
— this page describes the cost model in words, not numbers, so it can't drift out of sync
with the measured ones.

### What exported static HTML keeps and loses

On `:cairo`, a Pluto notebook exported to static HTML keeps hover and tooltip inspection —
the PNG and the hit-test manifest are both already baked into the exported page, so no
kernel is needed for them (verified end-to-end against a real Pluto export). On **either**
backend, what's lost is anything that needs Julia to recompute: a click that should update
`ev` and re-run downstream cells does nothing without a live kernel behind it. `:webgl`'s
export behavior for hover/tooltip specifically hasn't been verified the same way — treat it
as unconfirmed rather than assuming it matches `:cairo`.

### Choosing between them

Holo resolves the backend from which extension is loaded — a missing `using` line raises an
`ArgumentError` the first time `holo` runs; loading **both** `CairoMakie` and `WGLMakie` is
fine, and then `backend=` picks one explicitly while an unqualified `holo(fig)` defaults to
`:cairo` (so a Cairo-baked sysimage isn't blocked by a stray `using WGLMakie`).

`max_width` — the display width to target (Pluto's column, in px; `CairoMakie` renders at
roughly `2 × max_width` for a crisp static image) — is a keyword on `holo` itself, on both
backends:

```julia
holo(fig, interactables; max_width = 900)
```

`CairoBackend`/`WebGLBackend` are the two concrete backend types `backend=` actually takes,
but neither is exported from `Holo` — they live in Holo's package extensions
(`ext/HoloCairoMakieExt.jl`, `ext/HoloWGLMakieExt.jl`), reachable only via
`Base.get_extension`, which is how `holo` itself resolves them internally. You only need this
for a WebGL-only knob `holo` doesn't expose directly, `px_per_unit` (the canvas's
device-pixel ratio — raise it for a sharper `:webgl` canvas at a proportional GPU/bandwidth
cost):

```julia
holo(fig, interactables; backend = Base.get_extension(Holo, :HoloWGLMakieExt).WebGLBackend(; px_per_unit = 3.0))
```

Because they're unexported extension types, `CairoBackend`/`WebGLBackend` aren't in the
[API Reference](@ref)'s `@docs` blocks — see the note there.

### Caveats

- **Version-coupled** to WGLMakie's internals (`serialize_scene` shape, `setup_scene_init`
  signature). Pinned to a specific `WGLMakie` compat range; treat a WGLMakie version bump as
  a re-verification, not an automatic upgrade.
- The WGLMakie JS bundle ships **once per notebook**, so each additional `holo(fig)` cell's
  own cost is just its own scene, not another copy of the bundle.
