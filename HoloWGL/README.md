# HoloWGL

A **browser-GPU (`:webgl`) backend for [Holo](../)** — render a Makie figure live in a WebGL
`<canvas>` on the client GPU, with Holo's interactive overlay (`@bind` hit-testing) layered on
top. Where Holo's default `CairoBackend` ships a static PNG (2D only), HoloWGL handles **3D,
animation, and large/live data** — and it does so with **no extra server** and **no Bonito
runtime**.

> Status: **experimental / incubating.** Verified end-to-end in a real Pluto notebook (render,
> server-free delivery, overlay, and the `@bind` round-trip — see [docs/roadmap.md](docs/roadmap.md)).
> Same monorepo as Holo, mirroring how Makie ships `CairoMakie`/`GLMakie`/`WGLMakie`.

## Install

Unregistered for now (depends on the in-repo `Holo`). `HoloWGL`'s `Project.toml` uses a
`[sources]` entry pointing at `Holo` by relative path, so a single dev (or instantiate)
resolves both — no need to `dev` Holo separately:

```julia
pkg> dev /path/to/InteractivePlots.jl/HoloWGL    # Holo is pulled in via [sources]
```

## Usage

```julia
using HoloWGL          # re-exports the Makie plotting API, so this is all you need

fig = Figure()
ax  = Axis(fig[1, 1])
scatter!(ax, 1:10, rand(10))

@bind ev holo_webgl(fig)   # a live WebGL canvas + Holo overlay; ev is an InteractionEvent on click
```

`holo_webgl` mirrors `Holo.holo`: same `interactables` / `@bind` contract, same `InteractionEvent`.

## How it works

- **Julia** serializes the scene with `WGLMakie.serialize_scene` and encodes it for the browser
  (a 4-rule transform: observables, GL buffers, multi-dim arrays, scalars).
- **Delivery** is over Pluto's `published_to_js` channel (scene + the WGLMakie JS bundle + a
  ~30-line shim), turned into blob URLs in the browser — **no server, no `file://`**, works
  local / remote / export.
- **Render** uses WGLMakie's own bundle (sourced from the installed package, so the renderer
  always version-matches `serialize_scene`) driven by the shim — **no Bonito runtime**.
- **Overlay** is Holo's existing hit-test layer, reused verbatim over the canvas; the projection
  is Holo's `Makie.project` (measured to align within ~1–2 px).

## When to use which

| | `Holo.holo` (CairoBackend) | `HoloWGL.holo_webgl` |
|---|---|---|
| 2D static plots | ✅ lighter, crisp vector text, tiny PNG | works, but heavier |
| 3D / animation / large-or-live data | ✗ (out of scope) | ✅ browser GPU |
| Static HTML export | ✅ PNG + small manifest | heavier (WebGL bundle); camera offline |

Rule of thumb: **CairoBackend for static 2D; HoloWGL for 3D / animation / heavy data.**

## Caveats

- **Version-coupled** to WGLMakie's internals (`serialize_scene` shape, `setup_scene_init`
  signature). Pinned to `WGLMakie = "0.13"`; treat a WGLMakie bump as a re-verification.
- Per-cell payload is ~1 MB (the WGLMakie bundle). Sharing it once per notebook is on the roadmap.

See [docs/roadmap.md](docs/roadmap.md) and [CHANGELOG.md](CHANGELOG.md). MIT licensed.
