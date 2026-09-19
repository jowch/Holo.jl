"""
    Masque

Overlay JS interactivity — hover tooltips, click-to-select, drag-to-pan/rotate — on a static
or live Makie `Figure` for use in a [Pluto](https://plutojl.org) notebook.

Declare [`AbstractInteractable`](@ref)s (or call [`masque`](@ref)`(fig)` for zero-config
auto-extraction via [`auto_interactables`](@ref)) and bind the result with `@bind`; the bond
value is `nothing` until a click, then an [`InteractionEvent`](@ref). Needs a rendering backend
loaded: `using CairoMakie` for a static image with a JS hit-test overlay, or `using WGLMakie`
for a live browser-GPU canvas (animation, large/live data, 3D) — both expose the same
`masque`/`@bind` contract.

# Examples
```julia
using Masque, CairoMakie
fig = Figure(); ax = Axis(fig[1, 1])
scatter!(ax, [1, 2, 3], [1, 4, 9])
@bind sel masque(fig)   # zero-config: auto-extracts the scatter
```
"""
module Masque

using Makie: Makie, Point2f, Point3f, RGBAf
using FileIO
using Base64: base64encode
using HypertextLiteral: HypertextLiteral, @htl
import AbstractPlutoDingetjes
const APD = AbstractPlutoDingetjes

"""
    AbstractBackend

Supertype for a Masque rendering backend. Concrete backends live in package extensions —
`CairoBackend` (static image, from the `CairoMakie` extension) and `WebGLBackend` (live
browser-GPU canvas, from the `WGLMakie` extension) — and implement `render`, `context`,
`_ppu`, and `make_widget`. [`masque`](@ref) resolves one automatically from whichever
extension is loaded, or takes one explicitly via its `backend=` keyword.
"""
abstract type AbstractBackend end

# The committed overlay bundle, read once at module load (see docs/dev/frontend-delivery.md).
const _OVERLAY_JS = Ref{String}("")
function __init__()
    _OVERLAY_JS[] = read(joinpath(@__DIR__, "..", "assets", "overlay.js"), String)
    return nothing
end

include("makie_compat.jl")
include("backend.jl")
include("markup.jl")
include("interactables.jl")
include("introspect.jl")
include("render.jl")

export AbstractBackend
export AbstractInteractable, AbstractSelector, HitLayer, InteractionContext, AxisTransform
export PointInteractable, SegmentInteractable, RectInteractable, PolygonInteractable,
    AxisInteractable, ColorbarInteractable, LegendInteractable, RegionInteractable, FunctionInteractable,
    ThresholdInteractable, ROIInteractable, TextInteractable, ViewInteractable
export masque, auto_interactables, InteractionEvent, data_to_image_px, hitlayers
export Markup, @masque_str

end # module Masque
