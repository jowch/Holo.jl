# Backends

Holo has two backends. The interaction contract is the same; the cost profile is not.

## `:cairo` (the default)

CairoMakie renders the figure to a PNG; Holo computes a **hit-region manifest** in
Julia (via `Makie.project`) and ships it to the browser with
[`published_to_js`](https://plutojl.org/en/docs/abstractplutodingetjes/). A small
TypeScript overlay (committed as `assets/overlay.js`) mounts a shadow-root layer over the
image, hit-tests pointer events against the manifest, draws highlights/tooltips locally,
and dispatches only deliberate clicks back through `@bind`. Because the image and manifest
are embedded, the **inspection layer keeps working in an exported, offline static HTML**
(only click → recompute needs a live kernel).

The default `CairoBackend` renders a static PNG — great for publication figures, but every update
re-rasterizes the whole scene, so animation, frequent re-renders, and live 3D rotation are costly
there.

## `:webgl` (WGLMakie)

> **Status: experimental / incubating.** Verified end-to-end in a real Pluto notebook (render,
> server-free delivery, overlay, and the `@bind` round-trip).

`using WGLMakie` instead of `CairoMakie`
switches `holo` to a **browser-GPU backend**: the figure is rendered live in a WebGL `<canvas>`
on the client GPU, with Holo's usual overlay layered on top — same `holo`/`@bind`/
`InteractionEvent` contract, no code changes beyond the `using` line:

```julia
using Holo, WGLMakie

fig = Figure()
ax = Axis3(fig[1, 1])
scatter!(ax, x, y, z)

@bind ev holo(fig)   # a live WebGL canvas + Holo's overlay; ev is an InteractionEvent on click
```

[`examples/webgl_demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/webgl_demo.jl) is a runnable gallery of the `:webgl` backend
(CI runs it headlessly, same as `demo.jl`).

Holo resolves the backend from which extension is loaded: a missing `using` line raises an
`ArgumentError`; if both `CairoMakie` and `WGLMakie` are loaded, `backend=` wins and implicit
`holo` defaults to Cairo (so a fat sysimage is not fatal).

### How it works (`:webgl`)

- **Julia** serializes the scene with `WGLMakie.serialize_scene` and encodes it for the browser
  (a 4-rule transform: observables, GL buffers, multi-dim arrays, scalars).
- **Delivery** is over Pluto's `published_to_js` channel (scene + the WGLMakie JS bundle + a
  ~30-line shim), turned into blob URLs in the browser — no server, no `file://`, works
  local / remote / export.
- **Render** uses WGLMakie's own bundle (sourced from the installed package, so the renderer
  always version-matches `serialize_scene`) driven by the shim — no Bonito runtime.
- **Overlay** is Holo's existing hit-test layer, reused verbatim over the canvas; the projection
  is Holo's `Makie.project` (measured to align within ~1–2 px).

### Caveats

- **Version-coupled** to WGLMakie's internals (`serialize_scene` shape, `setup_scene_init`
  signature). Pinned to `WGLMakie = "0.13"`; treat a WGLMakie bump as a re-verification.
- The WGLMakie bundle ships **once per notebook**, so each cell's own cost is just its scene.
