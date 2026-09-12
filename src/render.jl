# Assembles the manifest (a plain Dict — testable without Pluto), then emits the @bind widget:
# bundle bootstrap + published_to_js manifest + mount(). See frontend-delivery.md.

"""
    InteractionEvent(layer, index, payload)

The typed value a bond returns on click (`nothing` until the first click). `payload` is the
JSON-serializable data the interactable attached (or `(; x, y)` for `AxisInteractable`).
"""
struct InteractionEvent
    layer::Symbol
    index::Int
    payload::Any
end

# ---- tooltip styling: tooltip_* kwargs -> CSS custom-property dict (figure-level) ------------
# Accepts a CSS string or any Makie-convertible color. Only set knobs are emitted; everything else
# falls through to the overlay's built-in NYT defaults (incl. the dark-mode media query).
function _css_color(c)
    c isa AbstractString && return c
    rgba = Makie.RGBAf(Makie.to_color(c))
    r, g, b = round(Int, 255 * rgba.r), round(Int, 255 * rgba.g), round(Int, 255 * rgba.b)
    return rgba.alpha >= 1 ? "rgb($r,$g,$b)" : "rgba($r,$g,$b,$(round(rgba.alpha; digits = 3)))"
end

function tip_style_dict(;
        tooltip_bg = nothing, tooltip_color = nothing, tooltip_accent = nothing,
        tooltip_font = nothing, tooltip_font_size = nothing, tooltip_radius = nothing,
        tooltip_caret = true,
    )
    d = Dict{String, String}()
    tooltip_bg === nothing || (d["--holo-tip-bg"] = _css_color(tooltip_bg))
    tooltip_color === nothing || (d["--holo-tip-color"] = _css_color(tooltip_color))
    tooltip_accent === nothing || (d["--holo-tip-accent"] = _css_color(tooltip_accent))
    tooltip_font === nothing || (d["--holo-tip-font"] = String(tooltip_font))
    tooltip_font_size === nothing || (d["--holo-tip-font-size"] = "$(tooltip_font_size)px")
    tooltip_radius === nothing || (d["--holo-tip-radius"] = "$(tooltip_radius)px")
    tooltip_caret === false && (d["--holo-tip-caret"] = "none")
    return d
end

# ---- manifest assembly (pure; no published_to_js, no Pluto) -----------------

# union of NamedTuple field names across a payload vector (empty if none are NamedTuples)
function _payload_keys(payloads)
    ks = Set{Symbol}()
    for pl in payloads
        pl isa NamedTuple && union!(ks, keys(pl))
    end
    return ks
end

function _layer_dict(i, L::HitLayer)
    hs = hoverstyle(i, 1)
    d = Dict{String, Any}(
        "id" => string(L.id), "kind" => string(L.kind), "axis" => string(L.axis),
        "geometry" => L.geometry, "payloads" => L.payloads,
        "events" => [string(e) for e in L.events],
        "style" => Dict("stroke" => hs.stroke, "width" => hs.width),
    )
    s = selects(i)
    s === nothing || (d["selects"] = string(s))
    spec = tooltip_spec(i)
    spec === true && throw(ArgumentError("tooltip = true is not meaningful — omit `tooltip` for the auto name/value table (the default), pass holo\"…\" for a template, or `false` to suppress."))
    if spec isa Markup
        ks = _payload_keys(L.payloads)
        isempty(ks) || check_fields(spec, ks)      # build-time field check (skip if no NamedTuple payloads)
        d["template"] = markup_segments(spec)
    elseif spec === false
        d["tooltip"] = false
    end
    return d
end

# Kinds the overlay can draw as a persistent pre-highlight (`hitLayerByIndex` / `makeHiElement`).
# Unsupported kinds (segments/grid/axis/…) with `selected=` used to silently draw nothing — fail loud
# instead, same doctrine as wrong-length `payloads=` (`_check_payloads`).
const _SELECTED_KINDS = (:circles, :rects, :polygons)

# Element count for a HitLayer geometry, matching the JS layout in types.ts / hitLayerByIndex.
function _layer_n_elements(kind::Symbol, geometry)
    return if kind === :circles
        length(geometry) ÷ 3
    elseif kind === :rects
        length(geometry) ÷ 4
    elseif kind === :polygons
        length(geometry)
    elseif kind === :segments
        length(geometry) ÷ 4
    elseif kind === :polyline
        max(0, length(geometry) ÷ 2 - 1)
    elseif kind === :grid
        Int(geometry["ncols"]) * Int(geometry["nrows"])
    else
        0   # :axis / :threshold / :roi / :view — not element-indexed for selected=
    end
end

# Validate `selected=` indices for one layer: supported kind + in-range (0-based). Throws ArgumentError.
function _check_selected(L::HitLayer, sel)
    kind = L.kind
    if !(kind in _SELECTED_KINDS)
        throw(
            ArgumentError(
                "selected: layer :$(L.id) has kind :$kind, which does not support pre-highlight " *
                    "(supported: $(join(_SELECTED_KINDS, ", ")))",
            ),
        )
    end
    n = _layer_n_elements(kind, L.geometry)
    idxs = collect(Int, sel)
    for idx in idxs
        (0 <= idx < n) || throw(
            ArgumentError(
                "selected: layer :$(L.id) index $idx out of range for $n elements" *
                    (n > 0 ? " (valid: 0:$(n - 1))" : ""),
            ),
        )
    end
    return idxs
end

# Fail loud when a selector's `selects` target is absent or has an incompatible kind.
function _validate_selectors(interactables, layers)
    kinds = Dict(l["id"] => l["kind"] for l in layers)
    layer_ids = Set(Symbol(l["id"]) for l in layers)
    for i in interactables
        s = selects(i)
        s === nothing && continue
        prefix = string(nameof(typeof(i)))
        if !haskey(kinds, string(s))
            sug = _suggest(s, layer_ids)
            hint = sug === nothing ? "" : " Did you mean `:$sug`?"
            throw(
                ArgumentError(
                    "$prefix: `selects = :$s` names a layer not present in this holo() call.$hint" *
                        " (available: $(join(sort(string.(collect(layer_ids))), ", ")))",
                ),
            )
        end
        target_kind = Symbol(kinds[string(s)])
        if !(target_kind in compatible_kinds(i))
            throw(
                ArgumentError(
                    "$prefix: `selects = :$s` targets a `:$target_kind` layer, " *
                        "but $prefix only supports $(compatible_kinds(i)).",
                ),
            )
        end
    end
    return
end

_transform_dict(t::AxisTransform) = Dict{String, Any}(
    "xlims" => collect(t.xlims), "ylims" => collect(t.ylims),
    "xscale" => string(t.xscale), "yscale" => string(t.yscale),
    "viewport" => collect(t.viewport), "xreversed" => t.xreversed, "yreversed" => t.yreversed,
    "xcats" => t.xcats, "ycats" => t.ycats,
    "valueaxis" => t.valueaxis === nothing ? nothing : string(t.valueaxis),
    "is3d" => t.is3d,
    "ispolar" => t.ispolar,
)

"""
    build_manifest(interactables, ctx; selected) -> Dict

Validate every interactable (fail loud) and assemble the JS-facing manifest. Pure — the unit
tests call this directly; the Pluto-only `published_to_js` step happens later in `show`.

`selected` pre-highlights elements on mount: a `layer_id => indices` map keyed by the same
`Symbol` a click returns in `InteractionEvent.layer`. The overlay re-derives highlights from
it each render, so threading a bond value back keeps a selection flicker-free across re-renders.
"""
function build_manifest(interactables, ctx::InteractionContext; selected = nothing, tip_style = nothing)
    layers = Any[]
    for i in interactables
        msg = validate(i, ctx)
        msg === nothing || throw(ArgumentError(msg))
        for L in hitlayers(i, ctx)
            d = _layer_dict(i, L)
            sel = selected === nothing ? nothing : get(selected, L.id, nothing)
            if sel !== nothing && !isempty(sel)
                d["selected"] = _check_selected(L, sel)
            end
            push!(layers, d)
        end
    end
    _validate_selectors(interactables, layers)
    # View (pan/orbit) layers are catch-all viewport hits — keep them after Tier-0
    # threshold/ROI so ordinary drag still wins without a modifier. Shift+drag still
    # forces view in the overlay (see frontend overlay.ts).
    sort!(layers; by = (d) -> (d["kind"] == "view", 0), alg = Base.Sort.DEFAULT_STABLE)
    m = Dict{String, Any}(
        "width" => ctx.width, "height" => ctx.height, "scaling" => ctx.scaling,
        "layers" => layers,
        "transforms" => Dict(string(id) => _transform_dict(t) for (id, t) in ctx.transforms),
    )
    (tip_style === nothing || isempty(tip_style)) || (m["tipStyle"] = tip_style)
    return m
end

# ---- the widget -------------------------------------------------------------

struct HoloWidget
    b64::String
    manifest::Dict{String, Any}
    display_css::Int
end

# Backend choice is tied to which package extension is active — never guessed from
# figure content. See .superpowers/specs/2026-06-30-holo-backend-selection-design.md:
# Makie's `current_backend()` is a bare global `Ref` that any loaded backend's `__init__`
# flips unconditionally, so we do not sniff Makie state. `explicit` is the caller's
# `backend=` override. A session with both extensions loaded (e.g. a fat sysimage) is
# no longer fatal: honor `backend=` or default to Cairo. Still throw when *no* renderer
# is loaded — that is a missing `using` line, not an ambiguous one.
function _resolve_backend(explicit; max_width)
    cairo_ext = Base.get_extension(@__MODULE__, :HoloCairoMakieExt)
    wgl_ext = Base.get_extension(@__MODULE__, :HoloWGLMakieExt)
    explicit !== nothing && return explicit
    # Both loaded: prefer Cairo so a preloaded WGLMakie (sysimage, stray `using`) does
    # not block the default static path. Callers who want WebGL pass `backend=`.
    cairo_ext !== nothing && return cairo_ext.CairoBackend(; max_width)
    wgl_ext !== nothing && return wgl_ext.WebGLBackend(; max_width)
    throw(
        ArgumentError(
            "holo(fig) needs a rendering backend loaded: `using CairoMakie` for a static base, or " *
                "`using WGLMakie` for animation/large or frequently re-rendered data — then call " *
                "`holo` again. (Both expose the same interactions, `Axis3` included; the choice " *
                "is a cost profile.)",
        ),
    )
end

"""
    holo(fig, interactables; selected=nothing)

Render `fig` and overlay JS hit-testing for the declared `interactables`. Use as a Pluto
`@bind` source; the bond value is `nothing` until a click, then an [`InteractionEvent`](@ref).
Needs a rendering backend loaded: `using CairoMakie` for a static base, or
`using WGLMakie` for animation/large or frequently re-rendered data. If both are loaded
(e.g. a fat sysimage), `backend=` wins and implicit calls default to Cairo. Both expose the same
interaction feature set — the backend choice is a cost/substrate profile, not a capability fork
(see `docs/backend-comparison.md`). `Axis3` works on both: static overlays on `:cairo`, live
rendering on `:webgl`; element interactables (points/segments/polygons) project through the
same shared closure, while continuous pixel→data readout (Axis/Threshold/ROI) fails loud on a
3D axis (a screen pixel is a ray).

`selected` (a `layer_id => indices` map) pre-highlights elements on mount. Feed a bond value
back into it — `Dict(ev.layer => [ev.index])` — to keep clicked elements highlighted across
re-renders. See [`build_manifest`](@ref).

Does not corrupt the user's figure: Makie `Figure`s can't be `deepcopy`'d (they hold module
refs), so instead the one mutation we introduce — forcing an opaque background — is saved and
restored. `update_state_before_display!` is also run, but that is exactly the step Makie performs
at display/save time, so it is benign (not corruption).
"""
function holo(
        fig, interactables::AbstractVector; backend::Union{Nothing, AbstractBackend} = nothing,
        max_width = 700, selected = nothing,
        tooltip_bg = nothing, tooltip_color = nothing, tooltip_accent = nothing,
        tooltip_font = nothing, tooltip_font_size = nothing, tooltip_radius = nothing, tooltip_caret = true,
    )
    backend = _resolve_backend(backend; max_width)
    bg0 = fig.scene.backgroundcolor[]
    try
        fig.scene.backgroundcolor[] = RGBAf(Makie.red(bg0), Makie.green(bg0), Makie.blue(bg0), 1)
        Makie.update_state_before_display!(fig)        # finalize once; render + context share it
        ppu = _ppu(backend, fig)
        ctx = context(backend, fig, ppu)
        tip_style = tip_style_dict(;
            tooltip_bg, tooltip_color, tooltip_accent, tooltip_font, tooltip_font_size, tooltip_radius, tooltip_caret,
        )
        manifest = build_manifest(interactables, ctx; selected, tip_style)
        result = render(backend, fig, ppu)
        display_css = round(Int, min(size(fig.scene)[1], backend.max_width))
        return make_widget(backend, result, manifest, display_css)
    finally
        fig.scene.backgroundcolor[] = bg0
    end
end
holo(fig, i::AbstractInteractable; kwargs...) = holo(fig, [i]; kwargs...)

"""
    holo(fig; selected=nothing)

Auto-extract interactables from `fig` (see [`auto_interactables`](@ref)) and overlay them —
the zero-config path. Equivalent to `holo(fig, auto_interactables(fig))`; unsupported plot
types are skipped with a warning. For control over ids/payloads, build the vector yourself.
"""
function holo(fig; kwargs...)
    # Finalize layout BEFORE auto-extraction: introspection that reads post-layout axis state
    # (e.g. `_span_rects`/hlines/vlines read `ax.finallimits[]`) would otherwise see stale limits,
    # since `holo(fig, ints)` only finalizes after `auto_interactables` has already built them.
    Makie.update_state_before_display!(fig)
    ints = auto_interactables(fig)
    isempty(ints) && @warn "holo(fig): no introspectable plots found — overlaying nothing (static image only)"
    return holo(fig, ints; kwargs...)
end

function Base.show(io::IO, m::MIME"text/html", w::HoloWidget)
    # Inject the bundle UNCONDITIONALLY (it self-installs window.Holo and is
    # idempotent). We do NOT wrap it in `if (!window.Holo) {…}`: running the
    # esbuild IIFE inside an `if`-block makes it install `{}` instead of `{mount}` (a
    # block-scope/strict heisenbug; verified). Re-parsing ~6KB per cell is negligible.
    boot = HypertextLiteral.JavaScript(_OVERLAY_JS[])
    html = @htl(
        """
        <div class="ip-host" style="position:relative; display:inline-block; width:100%; max-width:$(w.display_css)px;">
          <img src="data:image/png;base64,$(w.b64)" style="display:block; width:100%; height:auto;" draggable="false">
          <script>
            $(boot)
            const manifest = $(APD.Display.published_to_js(w.manifest));
            window.Holo.mount(currentScript, manifest, invalidation);
          </script>
        </div>
        """
    )
    return show(io, m, html)
end

# ---- bond plumbing (typed value) -------------------------------------------

APD.Bonds.initial_value(::HoloWidget) = nothing
function APD.Bonds.transform_value(::HoloWidget, js)
    js === nothing && return nothing
    if haskey(js, "items")   # a selector's declared multi output (Design D) — always a vector
        return InteractionEvent[
            InteractionEvent(Symbol(it["layer"]), Int(it["index"]), get(it, "payload", nothing))
                for it in js["items"]
        ]
    end
    return InteractionEvent(Symbol(js["layer"]), Int(js["index"]), get(js, "payload", nothing))
end
