# Custom interactions

For geometry the built-ins don't cover — no JavaScript required:

- **`RegionInteractable(ax; regions, payloads, id = :region, tooltip = nothing, events = (:click, :hover))`**
  (Tier A) — declarative mixed regions in data space, grouped into one layer per kind. Each
  region is one of:

  ```julia
  (:circle,  (cx, cy), r)            # r in data units
  (:rect,    (cx, cy), w, h)         # w, h in data units
  (:polygon, [(x, y), …])            # a ring of points
  ```

  `payloads` must match `regions` 1:1. `tooltip` is the same as other interactables
  (`nothing` / `holo"..."` / `false`); see [Tooltips](@ref).

- **`FunctionInteractable(f; events = (:click, :hover))`** (Tier B) — full control:
  `f(ctx) -> Vector{HitLayer}`. Project points with `data_to_image_px(ctx, ax, point)` and
  emit `HitLayer(id, kind, geometry, payloads, axis_id(ctx, ax), events)`. The escape hatch
  for a geometry kind the others don't express.
