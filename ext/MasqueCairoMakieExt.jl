module MasqueCairoMakieExt

using Masque: Masque, AbstractBackend, RenderResult, InteractionContext, AxisTransform
using CairoMakie
using FileIO
import Makie
import Makie: Point2f

"""
    CairoBackend(; max_width=700)

Static-image `Masque` backend (loaded when `CairoMakie` is `using`d): renders `fig` once to a
PNG, with a transparent JS overlay doing hit-testing over it — no server, no WebGL, and the
inspection layer keeps working in an exported, offline static HTML. This is the default
backend `masque` picks when no `WGLMakie` extension is loaded.

# Arguments
- `max_width` — the display width to target, in px (Pluto's column is 700). Render resolution
  is *derived* from it, not a fixed `px_per_unit`: output ≈ 2× `min(figure width, max_width)`
  (retina-crisp, not wasteful). Owns the render call (DPI/format/background); the user's figure
  spec is respected but its own save settings are not. Default `700`.

# Examples
```julia
using Masque, CairoMakie
masque(fig; backend = CairoBackend(; max_width = 900))
```
"""
struct CairoBackend <: AbstractBackend
    max_width::Int
end
CairoBackend(; max_width = 700) = CairoBackend(max_width)

function Masque._ppu(b::CairoBackend, fig)
    sw = size(fig.scene)[1]
    return 2 * min(sw, b.max_width) / sw
end

function Masque.render(::CairoBackend, fig, ppu)
    # backend=CairoMakie pinned explicitly as defense in depth: current_backend() is a bare
    # global Ref any loaded backend's __init__ can flip unconditionally on load.
    img = Makie.colorbuffer(fig; px_per_unit = ppu, backend = CairoMakie)
    io = IOBuffer(); save(Stream{format"PNG"}(io), img)
    return RenderResult("image/png", take!(io), size(img, 2), size(img, 1), Float64(ppu))
end

function Masque.context(b::CairoBackend, fig, ppu)
    w, h = size(fig.scene)
    scaling = Float64(ppu)
    out_w, out_h = round(Int, w * scaling), round(Int, h * scaling)
    # Lets grid hitlayers reason in true on-screen px instead of hardcoding the 2× DPI factor.
    display_scale = min(w, b.max_width) / out_w

    project = Masque._project_closure(scaling, out_h)

    # An axis-like block Masque builds no transform for (LScene today) would otherwise be
    # silently dropped, and interactables would project against the wrong axis.
    unsupported = unique(
        typeof.(
            c for c in fig.content if c isa Makie.AbstractAxis &&
                !(c isa Union{Makie.Axis, Makie.Axis3, Makie.PolarAxis})
        ),
    )
    isempty(unsupported) || throw(
        ArgumentError(
            "Masque's CairoMakie backend supports `Makie.Axis`, `Makie.Axis3`, and `Makie.PolarAxis`; found " *
                "unsupported $(join(unsupported, ", ")). This is Masque's own scoping guard, not a " *
                "CairoMakie limit — `LScene` support is still deferred (docs/dev/roadmap.md M3). " *
                "Today: restart this session with `using WGLMakie` (instead of `using CairoMakie`) " *
                "to render `LScene` live (Masque builds no overlays for it on either backend).",
        ),
    )

    axes = [c for c in fig.content if c isa Union{Makie.Axis, Makie.Axis3, Makie.PolarAxis}]
    ids = IdDict{Any, Symbol}()
    transforms = Dict{Symbol, AxisTransform}()
    for (k, ax) in enumerate(axes)
        id = Symbol("ax", k); ids[ax] = id
        transforms[id] = if ax isa Makie.Axis3
            Masque._axis3_transform(id, ax, scaling, out_h)
        elseif ax isa Makie.PolarAxis
            Masque._polar_transform(id, ax, scaling, out_h)
        else
            Masque._axis_transform(id, ax, scaling, out_h)
        end
    end
    cbs = [c for c in fig.content if c isa Makie.Colorbar]
    for (k, cb) in enumerate(cbs)
        id = Symbol("cb", k); ids[cb] = id
        transforms[id] = Masque._colorbar_transform(id, cb, scaling, out_h)
    end
    return InteractionContext(project, transforms, ids, out_w, out_h, scaling, display_scale)
end

Masque.make_widget(::CairoBackend, result::RenderResult, manifest, display_css) =
    Masque.MasqueWidget(Masque.base64encode(result.payload), manifest, display_css)

end # module MasqueCairoMakieExt
