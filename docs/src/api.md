# API

```jldoctest
julia> using Holo

julia> typeof(InteractionEvent(:scatter, 0, "a"))
InteractionEvent
```

## `holo`

```julia
holo(fig, interactables; backend = nothing, max_width = 700, selected = nothing) -> HoloWidget
holo(fig, interactable;  …)   # single-interactable convenience
holo(fig; …)                  # zero-config: auto-extract interactables from the plots
```

Renders `fig` and overlays hit-testing for the declared interactables. Use as a Pluto
`@bind` source; the bond value is `nothing` until a click, then an [`InteractionEvent`](@ref).
`holo` does not corrupt your figure (it saves/restores the background and runs the same
finalize step Makie performs at display time).

- **`backend`** — left as `nothing` (the default), `holo` picks the one backend implied by
  whichever of `CairoMakie` / `WGLMakie` is loaded (`CairoBackend` / `WebGLBackend`); pass one
  explicitly to be unambiguous or to override `max_width`. `CairoBackend(; max_width = 700, vector
  = false)` is the default 2D path; `WebGLBackend(; px_per_unit = 2.0, max_width = 700)` is the
  browser-GPU path (see [Backends](@ref)).
  `max_width` is the display width to target (Pluto's column); render resolution is *derived*
  from it (~2× the display width for `CairoBackend` — retina-crisp, not wasteful — never a fixed
  DPI). Loading neither backend raises an `ArgumentError`. If both are loaded, `backend=`
  wins and implicit `holo` defaults to Cairo.
- **`selected`** — a `layer_id => indices` map that pre-highlights elements on mount. See
  [Selection](@ref).

## `InteractionEvent`

The bond value after a click:

```julia
struct InteractionEvent
    layer::Symbol   # the interactable's `id`
    index::Int      # 0-based element index within the layer
    payload::Any    # the data you attached — see note
end
```

> **Payloads round-trip as a `Dict`** (via JSON), not the original `NamedTuple`. A payload
> `(; label = "a")` comes back as `Dict("label" => "a")`, so index it as
> `ev.payload["label"]`. `AxisInteractable` yields `Dict("x" => …, "y" => …)`.

Constructors and plot-object overloads are tabulated under [Interactables](@ref).
Custom geometry: [Custom interactions](@ref).
