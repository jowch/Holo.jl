# Assembles the manifest (a plain Dict — testable without Pluto), then emits the @bind widget:
# bundle bootstrap + published_to_js manifest + mount(). See frontend-delivery.md.

"""
    InteractionEvent(layer, index, payload)

The typed value a bond returns on click (`nothing` until the first click). `payload` is the
JSON-serializable data the interactable attached (or `(; x, y)` for `AxisInteractable`).
"""
struct InteractionEvent
    layer   :: Symbol
    index   :: Int
    payload :: Any
end

# ---- manifest assembly (pure; no published_to_js, no Pluto) -----------------

function _layer_dict(i, L::HitLayer)
    hs = hoverstyle(i, 1)
    d = Dict{String,Any}(
        "id" => string(L.id), "kind" => string(L.kind), "axis" => string(L.axis),
        "geometry" => L.geometry, "payloads" => L.payloads,
        "events" => [string(e) for e in L.events],
        "style" => Dict("stroke" => hs.stroke, "width" => hs.width))
    tips = [tooltip(i, k, pl) for (k, pl) in enumerate(L.payloads)]
    all(isnothing, tips) || (d["tooltips"] = tips)
    return d
end

_transform_dict(t::AxisTransform) = Dict{String,Any}(
    "xlims" => collect(t.xlims), "ylims" => collect(t.ylims),
    "xscale" => string(t.xscale), "yscale" => string(t.yscale),
    "viewport" => collect(t.viewport), "xreversed" => t.xreversed, "yreversed" => t.yreversed,
    "xcats" => t.xcats, "ycats" => t.ycats)

"""
    build_manifest(interactables, ctx) -> Dict

Validate every interactable (fail loud) and assemble the JS-facing manifest. Pure — the unit
tests call this directly; the Pluto-only `published_to_js` step happens later in `show`.
"""
function build_manifest(interactables, ctx::InteractionContext)
    layers = Any[]
    for i in interactables
        msg = validate(i, ctx)
        msg === nothing || throw(ArgumentError(msg))
        for L in hitlayers(i, ctx)
            push!(layers, _layer_dict(i, L))
        end
    end
    return Dict{String,Any}(
        "width" => ctx.width, "height" => ctx.height, "scaling" => ctx.scaling,
        "layers" => layers,
        "transforms" => Dict(string(id) => _transform_dict(t) for (id, t) in ctx.transforms))
end

# ---- the widget -------------------------------------------------------------

struct HoloWidget
    b64         :: String
    manifest    :: Dict{String,Any}
    display_css :: Int
end

"""
    holo(fig, interactables; backend=CairoBackend())

Render `fig` and overlay JS hit-testing for the declared `interactables`. Use as a Pluto
`@bind` source; the bond value is `nothing` until a click, then an [`InteractionEvent`](@ref).

Does not corrupt the user's figure: Makie `Figure`s can't be `deepcopy`'d (they hold module
refs), so instead the one mutation we introduce — forcing an opaque background — is saved and
restored. `update_state_before_display!` is also run, but that is exactly the step Makie performs
at display/save time, so it is benign (not corruption).
"""
function holo(fig, interactables::AbstractVector; backend::AbstractBackend = CairoBackend())
    bg0 = fig.scene.backgroundcolor[]
    try
        # opaque background (dark-mode/transparent-bg footgun); restored in finally
        fig.scene.backgroundcolor[] = RGBAf(Makie.red(bg0), Makie.green(bg0), Makie.blue(bg0), 1)
        Makie.update_state_before_display!(fig)        # finalize once; render + context share it
        ppu = _ppu(backend, fig)
        ctx = context(backend, fig, ppu)
        manifest = build_manifest(interactables, ctx)  # validates (fail loud) before rendering
        result = render(backend, fig, ppu)
        display_css = round(Int, min(size(fig.scene)[1], backend.max_width))
        return HoloWidget(base64encode(result.payload), manifest, display_css)
    finally
        fig.scene.backgroundcolor[] = bg0
    end
end
holo(fig, i::AbstractInteractable; kwargs...) = holo(fig, [i]; kwargs...)

function Base.show(io::IO, m::MIME"text/html", w::HoloWidget)
    # Inject the bundle UNCONDITIONALLY (it self-installs window.Holo and is
    # idempotent). We do NOT wrap it in `if (!window.Holo) {…}`: running the
    # esbuild IIFE inside an `if`-block makes it install `{}` instead of `{mount}` (a
    # block-scope/strict heisenbug; verified). Re-parsing ~6KB per cell is negligible.
    boot = HypertextLiteral.JavaScript(_OVERLAY_JS[])
    html = @htl("""
    <div class="ip-host" style="position:relative; display:inline-block; width:100%; max-width:$(w.display_css)px;">
      <img src="data:image/png;base64,$(w.b64)" style="display:block; width:100%; height:auto;" draggable="false">
      <script>
        $(boot)
        const manifest = $(APD.Display.published_to_js(w.manifest));
        window.Holo.mount(currentScript, manifest, invalidation);
      </script>
    </div>
    """)
    show(io, m, html)
end

# ---- bond plumbing (typed value) -------------------------------------------

APD.Bonds.initial_value(::HoloWidget) = nothing
function APD.Bonds.transform_value(::HoloWidget, js)
    js === nothing && return nothing
    return InteractionEvent(Symbol(js["layer"]), Int(js["index"]), get(js, "payload", nothing))
end
