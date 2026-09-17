# API Reference

Full docstrings for every exported name, grouped by area. Usage guidance and worked
examples live on the other pages; this page is the reference.

## Entry point

```@docs
Masque
masque
auto_interactables
InteractionEvent
```

## Interactable constructors

```@docs
PointInteractable
SegmentInteractable
RectInteractable
PolygonInteractable
AxisInteractable
ColorbarInteractable
TextInteractable
ThresholdInteractable
ROIInteractable
ViewInteractable
RegionInteractable
FunctionInteractable
```

## Tooltip macro & type

```@docs
Markup
@masque_str
```

See [Tooltips](@ref) for usage and [`architecture.md` §10](https://github.com/jowch/Masque.jl/blob/main/docs/dev/architecture.md)
for the wire format.

## Custom-interaction interface

The pieces [Custom interactions](@ref) build on:

```@docs
AbstractInteractable
AbstractSelector
HitLayer
InteractionContext
AxisTransform
data_to_image_px
hitlayers
```

## Backend abstraction

```@docs
AbstractBackend
```

`CairoBackend` and `WebGLBackend` are the two concrete backends, but they're defined inside
Masque's package extensions (`ext/MasqueCairoMakieExt.jl`, `ext/MasqueWGLMakieExt.jl`) rather than
in `Masque` itself — they only exist once `CairoMakie`/`WGLMakie` is loaded, so Documenter
can't resolve `@docs` for them without loading both weak dependencies into the docs build
just to document two structs. They're documented in prose instead: see [Backends](@ref) for
what each does, and `masque`'s docstring above for the `backend=` keyword both accept.
