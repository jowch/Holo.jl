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

Every notebook below also has a static export you can open in the browser with no Julia
installed — hover tooltips, highlights and (for `:webgl` notebooks) the live canvas all
work; only clicks that `@bind` back to Julia need the notebook running, for which see the
clone-and-run instructions above.

## [`examples/demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/demo.jl)

The main feature tour on `:cairo` — every built-in interactable kind, `holo"..."` tooltip
templates and theming, the selection round-trip, and `holo(fig)` auto-extraction over bars,
areas, polygons, a colorbar, and text labels.

[Open the static export](notebooks/demo.html)

## [`examples/webgl_demo.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/webgl_demo.jl)

The same kind of kitchen-sink tour, on `:webgl` — every overlay path running live on a
WebGL canvas instead of a static PNG.

[Open the static export](notebooks/webgl_demo.html)

## [`examples/view_manip.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/view_manip.jl)

Pan, zoom, and 3D rotation via the `@bind` re-render model: a `limits` slider, `azimuth`/
`elevation` sliders for `Axis3`, selection surviving a view re-render, and
[`ViewInteractable`](@ref) drag-to-pan / drag-to-rotate with commit-on-release.

[Open the static export](notebooks/view_manip.html)

## [`examples/view_manip_webgl.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/view_manip_webgl.jl)

The drag-to-pan / drag-to-rotate half of `view_manip.jl`, live-verified on `:webgl`.

[Open the static export](notebooks/view_manip_webgl.html)

## [`examples/polaraxis_webgl.jl`](https://github.com/jowch/Holo.jl/blob/main/examples/polaraxis_webgl.jl)

Discrete point hits on a `PolarAxis`, on `:webgl` — hover for a tooltip, click for an
`@bind` event.

[Open the static export](notebooks/polaraxis_webgl.html)

## [`gallery/gallery.jl`](https://github.com/jowch/Holo.jl/blob/main/gallery/gallery.jl)

Recipes closer to real applications than the feature tour, built from the same
interactables as `demo.jl`: a box-select scatter plot (drag a [`ROIInteractable`](@ref) to
select every enclosed point — its bond is a `Vector{InteractionEvent}`, one per selected
point) and an image ROI with per-channel stats.

[Open the static export](notebooks/gallery.html)
