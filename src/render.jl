"""
    InteractionEvent(layer, index, payload)

The typed value a `holo` bond returns on a deliberate click (`nothing` until the first one).

# Fields
- `layer::Symbol` — the hit `HitLayer`'s (i.e. the interactable's) `id`.
- `index::Int` — 0-based element index within that layer (meaningless for element-count-free
  kinds like `:axis`, which report `0`).
- `payload::Any` — the data the interactable attached to that element, or the client-computed
  value for kinds without static payloads (e.g. `Dict("x" => …, "y" => …)` for
  [`AxisInteractable`](@ref)). Round-trips through JSON: a Julia `NamedTuple` payload
  `(; label = "a")` comes back as `Dict{String,Any}("label" => "a")`, not the original
  `NamedTuple` — index it as `ev.payload["label"]`.

A `ROIInteractable` built with `selects` reports differently: the bond value is a
`Vector{InteractionEvent}` (one entry per element the ROI contains on mouse-up), not a single
`InteractionEvent`.
"""
struct InteractionEvent
    layer::Symbol
    index::Int
    payload::Any
end

# c can be a CSS string or any Makie-convertible color.
function _css_color(c)
    c isa AbstractString && return c
    rgba = Makie.RGBAf(Makie.to_color(c))
    r, g, b = round(Int, 255 * rgba.r), round(Int, 255 * rgba.g), round(Int, 255 * rgba.b)
    return rgba.alpha >= 1 ? "rgb($r,$g,$b)" : "rgba($r,$g,$b,$(round(rgba.alpha; digits = 3)))"
end

# Only set kwargs are emitted; unset ones fall through to the overlay's built-in defaults.
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

# union of NamedTuple field names across a payload vector (empty if none are NamedTuples)
function _payload_keys(payloads)
    ks = Set{Symbol}()
    for pl in payloads
        pl isa NamedTuple && union!(ks, keys(pl))
    end
    return ks
end

function _layer_dict(i, L::HitLayer, ctx::InteractionContext)
    hs = hoverstyle(i)
    d = Dict{String, Any}(
        "id" => string(L.id), "kind" => string(L.kind), "axis" => string(L.axis),
        "geometry" => L.geometry, "payloads" => L.payloads,
        "events" => [string(e) for e in L.events],
        "style" => Dict("stroke" => hs.stroke, "width" => hs.width),
    )
    if L.kind === :segments || L.kind === :polyline
        t = hit_tol(i)
        t === nothing || (d["tol"] = round(Int, t * ctx.scaling))
    end
    s = selects(i)
    s === nothing || (d["selects"] = string(s))
    L.label === nothing || (d["label"] = L.label)
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

# Closed kinds get the selected wash; open kinds (:segments/:polyline) get the ring. `selected=`
# on any other kind fails loud.
const _SELECTED_KINDS = (:circles, :rects, :polygons, :segments, :polyline)

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
            d = _layer_dict(i, L, ctx)
            sel = selected === nothing ? nothing : get(selected, L.id, nothing)
            if sel !== nothing && !isempty(sel)
                d["selected"] = _check_selected(L, sel)
            end
            push!(layers, d)
        end
    end
    _validate_selectors(interactables, layers)
    # View layers are catch-all viewport hits; sort after Tier-0 threshold/ROI so ordinary
    # drag wins without a modifier (Shift+drag still forces view in overlay.ts).
    sort!(layers; by = (d) -> (d["kind"] == "view", 0), alg = Base.Sort.DEFAULT_STABLE)
    m = Dict{String, Any}(
        "width" => ctx.width, "height" => ctx.height, "scaling" => ctx.scaling,
        "layers" => layers,
        "transforms" => Dict(string(id) => _transform_dict(t) for (id, t) in ctx.transforms),
    )
    (tip_style === nothing || isempty(tip_style)) || (m["tipStyle"] = tip_style)
    return m
end

struct HoloWidget
    b64::String
    manifest::Dict{String, Any}
    display_css::Int
end

# Backend choice follows which package extension is loaded, never sniffed from Makie's global
# `current_backend()` state. `explicit` is the caller's `backend=` override.
function _resolve_backend(explicit; max_width)
    cairo_ext = Base.get_extension(@__MODULE__, :HoloCairoMakieExt)
    wgl_ext = Base.get_extension(@__MODULE__, :HoloWGLMakieExt)
    explicit !== nothing && return explicit
    # Both loaded: prefer Cairo so a preloaded WGLMakie doesn't block the default static path.
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
    holo(fig, interactables; backend=nothing, max_width=700, selected=nothing,
         tooltip_bg=nothing, tooltip_color=nothing, tooltip_accent=nothing, tooltip_font=nothing,
         tooltip_font_size=nothing, tooltip_radius=nothing, tooltip_caret=true) -> HoloWidget
    holo(fig, interactable; kwargs...)   # single-interactable convenience

Render `fig` and overlay JS hit-testing for the declared `interactables`. Use as a Pluto
`@bind` source; the bond value is `nothing` until a click, then an [`InteractionEvent`](@ref)
(or, for a `ROIInteractable` built with `selects`, a `Vector{InteractionEvent}`).

# Arguments
- `interactables` — a `Vector{AbstractInteractable}` (or a single one, via the second method).
- `backend` — `nothing` (default) picks the one backend implied by whichever of `CairoMakie` /
  `WGLMakie` is loaded (`CairoBackend` / `WebGLBackend`); pass one explicitly to be unambiguous
  or to override its own keywords (e.g. `WebGLBackend(; px_per_unit = 3.0)`). Raises
  `ArgumentError` if neither is loaded; if both are, `backend=` wins and an implicit call
  defaults to Cairo.
- `max_width` — the display width to target (Pluto's column, in px); render resolution is
  *derived* from it, not a fixed DPI (`CairoBackend` renders at ~2× this width). Default `700`.
- `selected` — a `layer_id => indices` map (0-based, matching `InteractionEvent.index`) that
  pre-highlights elements on mount. Supported kinds: `:circles`/`:rects`/`:polygons` (wash) and
  `:segments`/`:polyline` (ring); any other kind or an out-of-range index raises
  `ArgumentError`. Feed a bond value back into it (e.g. `Dict(ev.layer => [ev.index])`) to keep
  clicked elements highlighted, flicker-free, across re-renders.
- `tooltip_bg`, `tooltip_color`, `tooltip_accent` — tooltip card colors (a CSS string or any
  Makie-convertible color). `tooltip_font` — a font-family `String`. `tooltip_font_size`,
  `tooltip_radius` — a `Real`, rendered as `"<value>px"`. `tooltip_caret` — `Bool`, whether to
  draw the pointer caret (default `true`). Each defaults to `nothing` (the built-in style);
  see the Tooltips page of the documentation for the full styling system (including the
  `--holo-tip-*` CSS escape hatch).

`Axis3` is supported on both backends; continuous pixel→data readout
(`AxisInteractable`/`ThresholdInteractable`/`ROIInteractable`) fails loud (`ArgumentError`) on
a 3D axis, since a screen pixel there is a ray, not a data point.

Restores the figure's background color on return; the only mutation `holo` makes to `fig` is
forcing it opaque during render (Makie `Figure`s can't be `deepcopy`'d to snapshot/restore).

# Examples
```julia
using Holo, CairoMakie
fig = Figure(); ax = Axis(fig[1, 1])
pts = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0)]
scatter!(ax, first.(pts), last.(pts))
@bind sel holo(fig, [PointInteractable(ax, pts; payloads = ["a", "b", "c"])])
```
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
        _finalize!(fig)        # finalize once; render + context share it
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
    # Finalize layout before auto-extraction: introspection reads post-layout axis state
    # (e.g. `ax.finallimits[]`), which `holo(fig, ints)` only finalizes afterward.
    _finalize!(fig)
    ints = auto_interactables(fig)
    isempty(ints) && @warn "holo(fig): no introspectable plots found — overlaying nothing (static image only)"
    return holo(fig, ints; kwargs...)
end

function Base.show(io::IO, m::MIME"text/html", w::HoloWidget)
    # Inject unconditionally: wrapping the esbuild IIFE in `if (!window.Holo) {…}` makes it
    # install `{}` instead of `{mount}` (a JS block-scope/strict-mode quirk).
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

APD.Bonds.initial_value(::HoloWidget) = nothing
function APD.Bonds.transform_value(::HoloWidget, js)
    js === nothing && return nothing
    if haskey(js, "items")   # a selector's declared multi output — always a vector
        return InteractionEvent[
            InteractionEvent(Symbol(it["layer"]), Int(it["index"]), get(it, "payload", nothing))
                for it in js["items"]
        ]
    end
    return InteractionEvent(Symbol(js["layer"]), Int(js["index"]), get(js, "payload", nothing))
end
