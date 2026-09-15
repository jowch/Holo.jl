# Examples

Clone the repo, start Pluto, and open [`examples/demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/demo.jl)
from its landing page:

```bash
git clone https://github.com/jowch/Holo.jl
julia -e 'using Pluto; Pluto.run()'
```

Every notebook below works the same way — each is self-contained (it `Pkg.develop`s the
local checkout and adds whatever Makie backend it needs), so it runs from a fresh clone with
no setup beyond having Pluto installed. CI runs all of them headlessly on every change
(`examples/ci_run.jl`), so they can't rot out of sync with the package API.

## [`examples/demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/demo.jl)

The main feature tour on `:cairo` — every built-in interactable kind, `holo"..."` tooltip
templates and theming, the selection round-trip, and `holo(fig)` auto-extraction over bars,
areas, polygons, a colorbar, and text labels.

## [`examples/webgl_demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/webgl_demo.jl)

The same kind of kitchen-sink tour, on `:webgl` — every overlay path running live on a
WebGL canvas instead of a static PNG.

## [`examples/view_manip.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/view_manip.jl)

Pan, zoom, and 3D rotation via the `@bind` re-render model: a `limits` slider, `azimuth`/
`elevation` sliders for `Axis3`, selection surviving a view re-render, and
[`ViewInteractable`](@ref) drag-to-pan / drag-to-rotate with commit-on-release.

## [`examples/view_manip_webgl.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/view_manip_webgl.jl)

The drag-to-pan / drag-to-rotate half of `view_manip.jl`, live-verified on `:webgl`.

## [`examples/polaraxis_webgl.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/polaraxis_webgl.jl)

Discrete point hits on a `PolarAxis`, on `:webgl` — hover for a tooltip, click for an
`@bind` event.

## [`gallery/gallery.jl`](https://github.com/jowch/Holo.jl/blob/main/gallery/gallery.jl)

Recipes closer to real applications than the feature tour, built from the same
interactables as `demo.jl`: a box-select scatter plot (drag a [`ROIInteractable`](@ref) to
select every enclosed point — its bond is a `Vector{InteractionEvent}`, one per selected
point) and an image ROI with per-channel stats.
