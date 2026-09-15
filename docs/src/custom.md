# Custom interactions

For geometry the built-ins don't cover — no JavaScript required. Two tiers, from
"declare shapes" to "full control."

## [`RegionInteractable`](@ref) — declarative mixed regions

Mixed-kind regions in data space, grouped into one layer per kind. Each region is one of:

```julia
(:circle,  (cx, cy), r)            # r in data units
(:rect,    (cx, cy), w, h)         # w, h in data units
(:polygon, [(x, y), ...])          # a ring of points
```

Worked example — three arbitrary shapes with a label each, hoverable and clickable:

```julia
begin
    using Holo, CairoMakie

    fig = Figure()
    ax = Axis(fig[1, 1])
    image!(ax, rand(100, 100))   # some backdrop the regions sit over

    regions = [
        (:circle, (20.0, 20.0), 8.0),
        (:rect, (60.0, 60.0), 15.0, 10.0),
        (:polygon, [(30.0, 70.0), (40.0, 90.0), (20.0, 90.0)]),
    ]
    payloads = [(; name = "cell A"), (; name = "cell B"), (; name = "cell C")]
end
```

```julia
@bind ev holo(fig, RegionInteractable(ax; regions, payloads, id = :cells))
```

`payloads` must match `regions` 1:1. `tooltip` takes the same three forms as any other
interactable (`nothing` / `holo"..."` / `false`) — see [Tooltips](@ref). Because
`RegionInteractable` groups by kind, its manifest layers are `:cells_c` (circles), `:cells_r`
(rects), `:cells_p` (polygons) — key `selected=` on those, not on `:cells` itself.

## [`FunctionInteractable`](@ref) — full control

The escape hatch for a geometry kind none of the above express: `f(ctx) -> Vector{HitLayer}`.
You do the projection yourself with [`data_to_image_px`](@ref) and emit one or more
[`HitLayer`](@ref)s.

Worked example — a triangular hit region (not one of the built-in kinds), reusing the
`:polygon` wire kind `RegionInteractable` would otherwise produce:

```julia
begin
    using Holo, CairoMakie

    fig = Figure()
    ax = Axis(fig[1, 1])
    lines!(ax, [0, 10, 5, 0], [0, 0, 8, 0])   # a triangle drawn by hand

    function triangle_layer(ctx)
        pts = [(0.0, 0.0), (10.0, 0.0), (5.0, 8.0)]
        ring = Float64[]   # :polygons geometry is one flat [x1,y1,x2,y2,...] vector per ring
        for p in pts
            q = data_to_image_px(ctx, ax, p)
            push!(ring, q[1], q[2])
        end
        HitLayer[
            HitLayer(:triangle, :polygons, [ring], [(; label = "the triangle")],
                Holo.axis_id(ctx, ax), (:click, :hover)),
        ]
    end
end
```

```julia
@bind ev holo(fig, FunctionInteractable(triangle_layer))
```

`f` receives the [`InteractionContext`](@ref) for the whole figure (the same one built-in
interactables use), so it can key geometry to any `Axis` in `fig` via `Holo.axis_id(ctx, ax)`
(not exported — qualify it). Use this tier when the shape genuinely isn't a
circle/rect/polygon/polyline — for anything expressible as one of those,
[`RegionInteractable`](@ref) is less code.
