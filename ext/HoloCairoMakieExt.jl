module HoloCairoMakieExt

# CairoMakie: the static 2D backend. Owns the render call (DPI/format/background); the
# user's figure spec is respected but its save settings are not.

using Holo: Holo, AbstractBackend, RenderResult, InteractionContext, AxisTransform
using CairoMakie
using FileIO
import Makie
import Makie: Point2f

"""
    CairoBackend(; max_width=700, vector=false)

Static CairoMakie backend. Owns the render call (DPI/format/background); the user's
figure spec is respected but its save settings are not. Render resolution is derived
from `max_width` (the display width to target — Pluto's 700px column by default), not a
fixed `px_per_unit`: output ≈ 2× the display width (retina-crisp, not wasteful).
`vector=true` emits SVG.
"""
struct CairoBackend <: AbstractBackend
    max_width::Int
    vector::Bool
end
CairoBackend(; max_width = 700, vector = false) = CairoBackend(max_width, vector)

Holo.mount(b::CairoBackend) = b.vector ? :svg : :img

# px_per_unit derived from the layout fact: render at ~2× the actual display width.
function Holo._ppu(b::CairoBackend, fig)
    sw = size(fig.scene)[1]
    return 2 * min(sw, b.max_width) / sw
end

# fig is already finalized (update_state_before_display!) by holo.
function Holo.render(::CairoBackend, fig, ppu)
    # backend=CairoMakie pinned explicitly: current_backend() is a bare global Ref that
    # ANY loaded backend's __init__ can flip (confirmed: CairoMakie.jl:39-40 and
    # WGLMakie.jl:70-74 both call activate!() unconditionally on load). Holo enforces
    # "exactly one backend loaded" at the holo() call site, but this stays pinned as
    # defense in depth — see the spec's hardening note.
    img = Makie.colorbuffer(fig; px_per_unit = ppu, backend = CairoMakie)
    io = IOBuffer(); save(Stream{format"PNG"}(io), img)
    return RenderResult("image/png", take!(io), size(img, 2), size(img, 1), Float64(ppu))
end

function Holo.context(b::CairoBackend, fig, ppu)
    w, h = size(fig.scene)
    scaling = Float64(ppu)
    out_w, out_h = round(Int, w * scaling), round(Int, h * scaling)
    # how much the rendered image is downscaled to fit Pluto's column on screen — the same
    # display_css/image_width ratio the widget HTML uses (render.jl). Lets grid hitlayers reason
    # in true on-screen px instead of hardcoding the 2× DPI factor.
    display_scale = min(w, b.max_width) / out_w

    # shared closure: transform_func applied, then Makie.project + viewport + scaling + y-flip
    project = Holo._project_closure(scaling, out_h)

    # Fail loud, never silently wrong: an axis-like block that isn't a 2D `Makie.Axis`
    # (PolarAxis/Axis3/LScene) would be silently dropped here, then interactables would
    # project against the wrong axis. Reject it up front. (architecture.md non-goals)
    unsupported = unique(typeof.(c for c in fig.content if c isa Makie.AbstractAxis && !(c isa Makie.Axis)))
    isempty(unsupported) || throw(
        ArgumentError(
            "Holo's CairoMakie backend overlays a static base + thin JS overlay and supports 2D " *
                "`Makie.Axis` only; found unsupported $(join(unsupported, ", ")). PolarAxis/Axis3/" *
                "LScene need a browser-side renderer: restart this session with `using WGLMakie` " *
                "(instead of `using CairoMakie`) and call `holo` again.",
        ),
    )

    axes = [c for c in fig.content if c isa Makie.Axis]
    ids = IdDict{Any, Symbol}()
    transforms = Dict{Symbol, AxisTransform}()
    for (k, ax) in enumerate(axes)
        id = Symbol("ax", k); ids[ax] = id
        transforms[id] = Holo._axis_transform(id, ax, scaling, out_h)
    end
    cbs = [c for c in fig.content if c isa Makie.Colorbar]
    for (k, cb) in enumerate(cbs)
        id = Symbol("cb", k); ids[cb] = id
        transforms[id] = Holo._colorbar_transform(id, cb, scaling, out_h)
    end
    return InteractionContext(project, transforms, ids, out_w, out_h, scaling, display_scale)
end

Holo.make_widget(::CairoBackend, result::RenderResult, manifest, display_css) =
    Holo.HoloWidget(Holo.base64encode(result.payload), manifest, display_css)

end # module HoloCairoMakieExt
