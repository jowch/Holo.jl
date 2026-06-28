module Holo

using Makie: Makie, Point2f, RGBAf
using CairoMakie
using FileIO
using Base64: base64encode
using HypertextLiteral: HypertextLiteral, @htl
import AbstractPlutoDingetjes
const APD = AbstractPlutoDingetjes

abstract type AbstractBackend end

# The committed overlay bundle, read once at module load (see frontend-delivery.md).
const _OVERLAY_JS = Ref{String}("")
function __init__()
    _OVERLAY_JS[] = read(joinpath(@__DIR__, "..", "assets", "overlay.js"), String)
    return nothing
end

include("backend.jl")
include("interactables.jl")
include("introspect.jl")
include("render.jl")

export AbstractBackend, CairoBackend
export AbstractInteractable, HitLayer, InteractionContext, AxisTransform
export PointInteractable, SegmentInteractable, RectInteractable, PolygonInteractable,
    AxisInteractable, RegionInteractable, FunctionInteractable
export holo, auto_interactables, InteractionEvent, data_to_image_px, hitlayers

end # module Holo
