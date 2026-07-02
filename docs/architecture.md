# Holo.jl — Architecture

> The coherent design. `design.md` holds the original decisions + spike validation;
> `research-findings.md` and `survey-makie-surfaces.md` hold the evidence this rests on.
> This document is the contract: the two interfaces (`AbstractBackend`,
> `AbstractInteractable`), the geometry primitives between them, and how custom
> interactions use the same infra as the built-ins.

## 1. The whole picture in one diagram

```
 user's Makie figure + declared interactables
                 │
   ┌─────────────▼──────────────┐
   │ AbstractBackend            │  render(fig)      → RenderResult (image bytes + dims + scaling)
   │   (CairoBackend for v1)    │  context(fig)     → InteractionContext (projection + axis transforms)
   └─────────────┬──────────────┘
                 │ ctx
   ┌─────────────▼──────────────┐
   │ AbstractInteractable[]      │  hitlayers(i, ctx) → Vector{HitLayer}   (compact, image-px geometry)
   │   Point/Segment/Rect/...    │  validate / events / tooltip / hoverstyle
   └─────────────┬──────────────┘
                 │ layers + axis transforms + image
   ┌─────────────▼──────────────┐
   │ holo           │  assembles ONE manifest, emits the @bind widget
   └─────────────┬──────────────┘
                 │ HTML (image + transparent overlay + JS)
   ┌─────────────▼──────────────┐
   │ JS overlay (stateless view) │  hit-test by kind • hover=local • click=@bind round-trip
   └────────────────────────────┘
```

Two contracts cross between layers, and only two: **`InteractionContext`** (backend → interactable)
and **`HitLayer`** (interactable → manifest/JS). Everything else is private to a layer.

## 2. The backend seam — `AbstractBackend`

The backend owns exactly two operations: *produce the displayable artifact*, and *project
data→pixels* for that artifact. Everything CairoMakie-specific lives behind it; nothing
upstream of it knows what rendered the image.

```julia
abstract type AbstractBackend end

render(::AbstractBackend, fig)::RenderResult         # finalize layout + produce artifact
context(::AbstractBackend, fig)::InteractionContext  # projection + per-axis transforms
mount(::AbstractBackend)::Symbol                     # :img (raster) | :svg (vector)

struct RenderResult
    mime    :: String                                 # "image/png" | "image/svg+xml"
    payload :: Union{Vector{UInt8}, String}           # bytes (raster) | text (svg)
    width   :: Int                                    # output image px
    height  :: Int
    scaling :: Float64                                # device_scaling_factor (px_per_unit for PNG)
end
```

**`CairoBackend` was the only v1 implementation.** (Update: a second, co-equal implementation,
`WebGLBackend` — the `:webgl` backend, in `ext/HoloWGLMakieExt.jl` — was added later; see the
note at the end of this section.) `CairoBackend` is PNG (`mount = :img`) by default, SVG
(`mount = :svg`) optionally for sparse plots. `render` = `colorbuffer` → PNG → bytes. `context` calls
`Makie.update_state_before_display!(fig)` (mandatory, validated) then builds the projection closure
and reads each axis's transform.

**Don't corrupt the user's figure.** Makie `Figure`s can't be `deepcopy`'d (they hold module refs),
so instead the one mutation we introduce — forcing an opaque background — is **saved and restored**
(try/finally). `update_state_before_display!` is also run, but that's exactly the step Makie performs
at display/save time, so it's benign, not corruption. See also the DPI/sizing policy in `frontend-delivery.md`
(render at `2 × (max_width or 700px column)`, opaque background, package-owned wide mode).

The seam was originally scoped static-only: v1's research (Q0) found a browser-side *live*
WGLMakie rendering model server-centric and reload-fragile, at odds with the static/durable
output this project set out to provide, and framed it as a different product rather than a
deferred target. **Update:** the seam turned out to admit a live implementation cleanly after
all — `WebGLBackend` implements the same `AbstractBackend` contract (`render`/`context`/`mount`)
against a browser-GPU `<canvas>` instead of a PNG, shipped as the `HoloWGLMakieExt` weak-dep
extension. The two backends are now co-equal peers, one loaded per session (`_resolve_backend`
in `src/render.jl`); see `docs/backend-comparison.md` for the cost/regime tradeoff (the interaction
feature set is identical on both — parity is CI-enforced by the golden-manifest harness). The seam
still also admits a future GLMakie-static backend (GPU offscreen → PNG, same contract) or a
pure-image backend.

### `InteractionContext` — the backend → interactable bridge

The context is **backend-produced** so projection is not hard-wired to `Makie.project`. It carries a
projection closure (backend's implementation of data→image-px) plus the per-axis transforms (which are
*also* serialized to JS for continuous inversion).

```julia
struct InteractionContext
    project    :: Function                        # (ax, point::Point2) -> Point2f in image px
    transforms :: Dict{Symbol, AxisTransform}     # one per axis; keyed by an axis id
    width      :: Int
    height     :: Int
    scaling    :: Float64
end

# the ONE coordinate primitive interactables call — never re-derive projection
data_to_image_px(ctx::InteractionContext, ax, p) = ctx.project(ax, p)

struct AxisTransform
    id        :: Symbol
    xlims     :: Tuple{Float64,Float64}
    ylims     :: Tuple{Float64,Float64}
    xscale    :: Symbol                            # :identity | :log10 | :log | :symlog10 | :pseudolog10
    yscale    :: Symbol
    viewport  :: NTuple{4,Float64}                 # (x, y, w, h) in image px, top-left origin
    xreversed :: Bool
    yreversed :: Bool
    xcats     :: Union{Nothing, Vector{String}}    # categorical tick map (v1)
    ycats     :: Union{Nothing, Vector{String}}
    valueaxis :: Union{Nothing, Symbol}            # nothing = 2-D {x,y} readout; :x/:y = 1-D colorbar readout
end
```

For CairoMakie the projection closure is the validated spike math:
`q = Makie.project(ax.scene, p); ((q+origin)·scaling) with y-flipped to image coords`.
The `AxisTransform` is the *same information* expressed declaratively, so JS can invert pixels→data
for `AxisInteractable` and for live hover-coordinate readout (the drag/Tier-0 enabler).

**Categorical axes are v1.** When an axis uses a categorical conversion, `xcats`/`ycats` carry the
ordered tick labels so JS maps a pixel to the right category (and tooltips/readout show the category,
not the integer index). Without this, bars/boxplots on categorical axes would report wrong coordinates —
so it's shipped, not stubbed.

**Colorbar `AxisTransform` and the figure-block walk (M3).** Colorbar blocks live in `fig.content`,
not in any `Axis` scene, so `context()` runs a second walk over `fig.content` after collecting axes —
picking up every `Makie.Colorbar` and registering it under a `Symbol("cb", k)` id. Each colorbar gets
its own `AxisTransform`: the value scale (`limits[]`, `scale[]`) is mapped to the long axis (`ylims` for
vertical, `xlims` for horizontal), and `valueaxis` is set to `:y` or `:x` accordingly. The viewport is
the colorbar's laid-out pixel bbox (`computedbbox[]`), converted with the same ×scaling + y-flip used for
axes. JS reads `valueaxis` to invert the cursor pixel to a scalar payload `(; value)` — the same
`invertAxis` path `AxisInteractable` uses for its 2-D `{x,y}` readout, projected along one axis only.

## 3. The interactable seam — `AbstractInteractable`

Every interactable — built-in or user-authored — implements one contract. The framework never
special-cases built-ins; `PointInteractable` is simply the first public implementation.

```julia
abstract type AbstractInteractable end

# REQUIRED: compact, image-px hit geometry. Usually one layer; composites (ScatterLines) return more.
hitlayers(i::AbstractInteractable, ctx::InteractionContext)::Vector{HitLayer}

# OPTIONAL (defaulted):
validate(::AbstractInteractable, ::InteractionContext)::Union{Nothing,String} = nothing   # fail loud
events(::AbstractInteractable)::Tuple = (:click, :hover)   # which events the overlay wires
# tooltip content is per-LAYER, set via the `tooltip` kwarg on each interactable
# constructor (nothing → auto-table, Markup → template, false → suppress).
# The per-element `tooltip(interactable, idx, payload)` dispatch is retired (M2.3).
# See docs/tooltips.md.
hoverstyle(::AbstractInteractable, idx::Int)::NamedTuple = (; stroke="#ff3b30", width=3)
```

**`validate` is per-capability, not a global scale gate** (fixes a latent silent-coordinate bug).
Element interactables (Point/Segment/Rect/Polygon) are projected **in Julia** via `Makie.project`,
so they impose **no axis-scale restriction** — they work on any scale Makie can project (linear, log,
symlog, …). Only `AxisInteractable` and `ColorbarInteractable` rely on **client-side** pixel→data
inversion, so they alone restrict to scales the JS `invert` implements (identity, log10/log, +
categorical via the shipped category map). A blanket `_OK_SCALES` gate would be both too strict
(rejecting element types that work) and too loose (passing `AxisInteractable` on a scale the JS
inverts wrong). Default `validate` stays permissive; `AxisInteractable.validate` and
`ColorbarInteractable.validate` are the ones that gate.

### `HitLayer` — the serialized unit (per interactable, per kind)

The unit is a **layer**, not a single element, because two v1 surfaces need compact *geometry*
that a flat per-element list can't give: a 1000×1000 **heatmap grid** (ship edges, not 10⁶ rects) and
a **polyline** (ship vertices once, hit-test segments in JS). A layer is one geometry *kind* plus the
data to resolve a hit to an element index and its payload.

> **Caveat (the grid is compact in geometry, not in payload).** The grid *geometry* is O(edges),
> but to power the client-side `(i,j)=value` readout the layer also ships the full **source-resolution**
> `values[]` matrix — O(source-cells), the dominant grid term. So a routine 2000²–4000² `heatmap!`/`image!`
> ships tens of MB of values on top of a display-bounded PNG (4.78 MB measured at 1000²). This is the
> day-one-reachable face of "the manifest is the scaling wall" (§8). The committed fix ships `values[]`
> only when cells are targetable (≥~1 px on the known display) — sub-pixel grids drop it (§8).

```julia
struct HitLayer
    id       :: Symbol            # stable key for this layer (links to events/style)
    kind     :: Symbol            # :circles | :polyline | :segments | :rects | :grid | :polygons | :axis
    geometry :: Any               # compact, image-px; layout keyed by `kind` (see below)
    payloads :: Vector{Any}       # element index -> JSON-serializable payload (the linkage key)
    axis     :: Symbol            # which AxisTransform applies (for data-coord tooltips / inversion)
    events   :: Tuple             # copied from the interactable
end
```

Geometry layout by `kind` (all coords image-px, top-left origin):

| kind | geometry | JS hit-test | element index |
|---|---|---|---|
| `:circles` | `Float32[cx,cy,r, …]` | distance ≤ r | triple index |
| `:polyline` | `Float32[x,y, …]` (NaN = gap) | nearest segment, dist ≤ tol | segment i = (v[i],v[i+1]) |
| `:segments` | `Float32[x0,y0,x1,y1, …]` | nearest of disjoint pairs | pair index |
| `:rects` | `Float32[cx,cy,w,h, …]` | point-in-rect | quad index |
| `:grid` | `(xedges, yedges, ncols, nrows, values[])` image-px | binary-search bin → (i,j) | `j*ncols+i` (O(1) hit-test; manifest **O(source-cells)** via `values[]`, see §8) |
| `:polygons` | `Vector{Vector{Float32}}` rings | even-odd point-in-polygon | ring index |
| `:axis` | `nothing` (unbounded, `AxisInteractable`) or `Real[x,y,w,h]` bbox (bounded, `ColorbarInteractable`) | absent geometry = always-hit; bbox present = point-in-bbox; invert pixel via `AxisTransform` | `-1` (continuous); `valueaxis ≠ nothing` → 1-D `(; value)` |

This is a **closed set of six geometry kinds** (`:circles/:polyline/:segments/:rects/:grid/:polygons`)
plus the `:axis` continuous channel. The survey confirmed every retained Makie surface projects to one
of them; nothing in v1+v2 needs a seventh. (Text labels — the surface once speculated to need a new
`bbox`/degenerate-polygon primitive — turned out not to: `TextInteractable` rides plain `:rects`, with
a rotated label's box simply expanded to stay axis-aligned; see §3. That premise is retired for text.)

### Built-in interactables (v1 + M3 + Phase 2 text labels)

Five v1 types plus `ColorbarInteractable` (M3) and `TextInteractable` (Phase 2 text labels), one
per hit primitive (`:axis` shared by two; `TextInteractable` reuses `:rects`, no new primitive):

| Type | kind(s) | Makie surfaces | payload |
|---|---|---|---|
| `PointInteractable` | `:circles` | Scatter, Stem, Spy, ScatterLines·pts | `(; index, x, y)` |
| `SegmentInteractable` | `:polyline` \| `:segments` | Lines, Stairs, ScatterLines·lines (polyline); LineSegments, Errorbars, Rangebars, HLines, VLines (pairs) | `(; segment_index, p0, p1)` |
| `RectInteractable` | `:rects` \| `:grid` | BarPlot, Hist, Waterfall, CrossBar, HSpan, VSpan (list); Heatmap, Image (grid) | grid `(; i, j, value)`; BarPlot/Waterfall `(; low, high, value)`; Hist `(; value, low, high)`; CrossBar `(; midpoint, low, high)`; HSpan/VSpan `(; low, high)` |
| `PolygonInteractable` | `:polygons` | Poly, Band, Pie, Density, Contourf, Violin, Voronoiplot | Band/Density/Voronoiplot `(; index)`; Contourf `(; low, high)`; Violin `(; x)` |
| `AxisInteractable` | `:axis` (unbounded) | the Axis area itself (linear + log) | `(; x, y)` inverted client-side |
| `ColorbarInteractable` *(M3)* | `:axis` (bounded bbox) | Colorbar — auto-extracted from `fig.content` | `(; value)` inverted client-side via `AxisTransform.valueaxis` |
| `TextInteractable` *(Phase 2 text labels)* | `:rects` | Text, Annotation (via `_descendant(p, Makie.Text)`) — data-space only | `(; text, index, x, y)` |

`SegmentInteractable` carries `mode ∈ {:polyline,:pairs}`; `RectInteractable` carries
`layout ∈ {:grid,:list}`. Same JS test, different Julia extractor.

**Text labels as click-to-pick buttons.** `TextInteractable` geometry comes from Makie's own
`Makie.string_boundingboxes(p)` — scene-local pixel space, y-up, bottom-left origin — converted
*directly* to image px (the same ×scaling + y-flip as `project`, but no `project` call: the boxes
are already pixel-space, not data-space, so there is nothing to project). A rotated label still
yields exactly one `:rects` box, expanded to stay axis-aligned (a looser hit target, not a new
geometry kind). The payload's `text`/`index` are the string and its 0-based per-label index;
`x`/`y` are the DATA-space anchor (`positions`), not the pixel box — consistent with `PointInteractable`'s
`(; index, x, y)` shape. `holo(fig)` auto-detects `text!` directly and `annotation!` by reaching
through to its child `Makie.Text` plot (`_descendant`); only **data-space** text is auto-detected
(`space === :data`) — pixel/relative-space text (decorative overlays) is skipped with a warning, not
silently dropped. `TextLabel` (a `Makie.Block`, not a plot) is **not** covered — it needs the
figure-block walk `ColorbarInteractable` uses, not the plot-scene walk — and remains deferred (see
`roadmap.md`).

**Bar payload schema (Phase 2a).** All `:rects`-list bar/span surfaces (BarPlot, Waterfall,
Hist, CrossBar, HSpan, VSpan) use a shared semantic payload — `InteractionEvent.index` carries the element index, so payloads contain only
domain values (no redundant `index` field). **Span viewport-clamp:** HSpan/VSpan hit-rects are
clipped to the owning axis's pixel viewport so a span cannot bleed into a neighboring axis in a
multi-axis figure. **Uniform payload-length validation:** `SegmentInteractable`,
`RectInteractable`, and `PolygonInteractable` all call `_check_payloads` at construction;
a `payloads=` vector of the wrong length throws `ArgumentError` immediately (fail-loud, same
guarantee as `PointInteractable` / `RegionInteractable`).

**Polygon payload schema (Phase 2b).** The six auto-extracted polygon surfaces each carry a
surface-specific semantic payload. Band, Density, and Voronoiplot use `(; index)` — the element
index is already carried by `InteractionEvent.index`, so the payload holds only the domain key.
Contourf carries `(; low, high)` — the data-value bounds of the filled contour level, read from
Makie's computed level range. Violin carries `(; x)` — the category position. BoxPlot's box body
is auto-extracted as `:rects` (un-notched) / `:polygons` (notched) with `(; q1, median, q3)`
drawn from Makie's computed-stats node. **Principle:** hit geometry comes from rendered shapes
(the actual plotted polygons or rects after Makie lays them out); payload values come from
Makie's computed values (not the raw input data).

**Declaration is the contract; plot-introspection is v2 sugar.** v1 constructors take explicit
data-space geometry (`PointInteractable(ax, points; payloads)`), which the survey confirmed is the
robust path — extracting geometry from live `Scatter`/`Heatmap`/`BarPlot` objects is the genuinely
hard part (markersize units, endpoint half-steps, dodge/stack math) and is deferred. A future
`PointInteractable(scatterplot)` will produce the *same* struct, not a different code path.

**Composites emit multiple layers.** `ScatterLines` → one `:circles` layer + one `:polyline` layer,
hit-tested points-first (within marker radius) then segment. This is the model for any composite recipe.

## 4. Custom interactions — same infra, three ergonomic tiers

The convergent lesson from Bokeh / Plotly / Vega-Lite / Observable Plot: **linkage is payload-based,
and the user should never write JavaScript.** A user's custom interaction must produce `HitLayer`s like
everything else. Three tiers, increasing power, zero escape hatches:

**Tier A — declarative regions (the 80% case, no struct).** State *what* is interactable in data space
+ payloads; the framework owns *how it reacts*. This is the Vega-Lite "interaction is just another
mark" analog.

```julia
RegionInteractable(ax;
    regions  = [(:circle, Point2f(x,y), r), (:rect, p, w, h), (:polygon, ring)],
    payloads = [pl1, pl2, pl3],          # parallel; one per region (the linkage key)
    tooltip  = holo"$(label)",           # Markup template; nothing → auto-table, false → suppress
    events   = (:click, :hover))
```

**Tier B — closure against live context.** For geometry computed from `ctx` (Makie's
`register_interaction!(f, …)` analog). Still emits `HitLayer`s.

```julia
FunctionInteractable(ax, f; id, events=(:click,:hover))   # f(ctx)::Vector{HitLayer}
```

**Tier C — full struct.** Implement `hitlayers` (+ optional `validate`/`hoverstyle`). A user
struct is *indistinguishable* from a built-in — same manifest path, same overlay, same `@bind`. Tooltip
content comes from the per-layer `Holo.tooltip_spec(interactable)` seam (built-in interactables expose it
as a `tooltip=` constructor kwarg; a custom struct overrides `Holo.tooltip_spec`). The `tooltip_*` kwargs
on `holo()` are styling only. See `docs/tooltips.md`. Example:

```julia
struct CityInteractable <: AbstractInteractable
    positions::Vector{Point2f}; names::Vector{String}; radius::Float32
end
function Holo.hitlayers(c::CityInteractable, ctx)
    coords = Float32[]; for p in c.positions
        q = data_to_image_px(ctx, c.ax, p); append!(coords, (q[1], q[2], c.radius*ctx.scaling))
    end
    [HitLayer(:cities, :circles, coords, [(; name=n) for n in c.names], :main, (:click,:hover))]
end
# tooltip content: add a `tooltip` field to CityInteractable and override
# `Holo.tooltip_spec(c::CityInteractable) = c.tooltip` — see docs/tooltips.md
```

**Linkage = shared payloads through Pluto reactivity.** Two interactables writing the same payload field
into the same `@bind` variable *are* linked brushing — the Pluto reactive graph is our
`ColumnDataSource`. No central mutable selection store is introduced; that's the whole point of the
no-server architecture.

## 5. The bond value

`@bind sel holo(fig, interactables)`:
- `sel === nothing` until the first deliberate click (clicks outside all layers are a no-op — by design).
- On click: `sel = (; layer, index, payload)` (a `Dict` Julia-side). For `AxisInteractable`,
  `index = -1` and `payload = (; x, y)` inverted from the axis transform in JS.
- Hover **never** sets `sel` — it is overlay-local. Only `events` containing `:click` round-trip.

A typed `InteractionEvent` wrapper over the dict is shipped via
`AbstractPlutoDingetjes.Bonds.transform_value`; the raw NamedTuple/Dict is the underlying value.

**M4 selector contract — Design D.** The bond value depends on whether the interactable is a
selector (a `ROIInteractable` with `selects=:layer_id` set) or not:

- **Click interactables and bounds-only `ROIInteractable`** (no `selects` kwarg) return a single
  `InteractionEvent` (or `nothing` before the first interaction) — the v1 single-event contract is
  unchanged. This is a deliberate Design-D decision: the union `single | Vector` is resolved by the
  presence or absence of `selects`, not by a per-event flag.
- **Selector ROIs** (`ROIInteractable(…; selects=:layer_id)`) implement
  `AbstractSelector <: AbstractInteractable` and return `Vector{InteractionEvent}`:
  - **Points (`:circles`) target** → N point events, one per element whose geometry falls
    within the dragged box.
  - **Grid target** (`:grid` kind) → a 1-element vector holding a **region descriptor**
    `(; i0, i1, j0, j1, xmin, xmax, ymin, ymax)` — 0-based inclusive cell indices plus
    data-space bounds — for server-side aggregate statistics. The browser never needs `values[]`
    for box-selection.
  - **Empty box** → `InteractionEvent[]` (never `nothing`).

**`AbstractSelector`** is the selector sub-interface (`selects(sel)::Symbol` returning the target
layer id; `compatible_kinds(sel)` returning accepted geometry kinds). At manifest-build,
`compatible_kinds` is validated against the target layer's `kind` — an incompatible pairing is a
loud `ArgumentError`. The only new manifest field is `selects` (a string id) on the selector
layer; `targetKind`/`arity` fields were designed but dropped as redundant — the JS reads the
target kind from the looked-up layer, and `transform_value` detects the `{ items: [...] }` JS
return envelope shape to produce the vector (versus the flat `{layer,index,payload}` dict for
single events).

**Selected-state lives in the manifest, not a `previous=` kwarg.** Because the overlay is wiped on
every re-render, a *persistent* "this element is selected" highlight must be re-derived each render.
The mechanism: the bond value flows back into Julia, Julia marks selected indices as a field **on the
manifest** for the next render, and JS draws them highlighted on mount. There is no `previous=selection`
argument (the earlier sketch is dropped) — selection is reconstructed from the bond, carried in the
manifest, and the round-trip stays flicker-free because the *image* doesn't change, only an overlay
flag does.

## 6. How it composes — the three interaction tiers

This architecture supports exactly the three tiers from the latency analysis, and the interface maps to
them cleanly:

- **Tier 0 (overlay, 60 fps, no Julia):** hover, live coordinate readout, and dragging *overlay*
  geometry. Enabled by shipping `AxisTransform` to JS. `events(i)` with only `:hover` keeps it local.
- **Tier 1 (precomputed):** `hitlayers(i, ctx)` *is* this tier — Julia computes regions once after
  `update_state_before_display!`. Animation = a precomputed frame sequence (a future `frames` slot on
  the manifest; the format is designed not to preclude it). **It is the one payload-unbounded feature**
  (total = frames × per-frame PNG): ~5.5 MB (187 KB × 30) to ~22 MB (× 120) for a typical plot, 100s of MB
  at scale. The `frames` slot must shrink per-frame cost (downscale / fewer frames) before it ships — §8.
- **Tier 2 (round-trip):** `:click` events → `@bind`. Discrete server re-render from new state is in
  scope on **both** backends — it is the substrate of the planned view-manipulation arc (`@bind`
  re-render of 2D `limits` / 3D `azimuth`/`elevation`, backend-symmetric). What differs is **cost**:
  `:webgl` re-serializes (~flat) while `:cairo` re-rasterizes (scales with the scene) — see
  `backend-comparison.md`. *Per-frame* faithful redraw (smooth-drag-as-a-guarantee) is a shared
  latency wall on both, not a `:cairo`-only exclusion.

**Named tensions (accepted, not bugs):**
1. `AxisInteractable` returns no region geometry — it rides the `:axis` channel as an unbounded
   catch-all. `ColorbarInteractable` (M3) also uses `:axis` but ships a bbox so the hit region is
   bounded to the colorbar's pixel extent. Worth the shared channel: both collapse into the
   `AxisTransform` already shipped, with no new JS primitive.
2. No z-order/`Consume` model for overlapping custom regions — JS is first-match-wins in manifest
   order (deterministic; resolves the only v1 collision, ScatterLines points-over-segments). We adopt
   Makie's `events` *vocabulary* now for forward-compat, not its propagation machinery. YAGNI until
   users actually stack overlapping custom regions.

## 7. v1 scope

**In:** CairoBackend (PNG; SVG for sparse plots); `PointInteractable`, `SegmentInteractable`,
`RectInteractable` (list + grid), `PolygonInteractable`, `AxisInteractable`; `RegionInteractable` +
`FunctionInteractable`; explicit-geometry constructors; linear + log axes for `AxisInteractable`
(element types: any Makie-projectable scale); **categorical axes** (category map shipped to JS);
**multiple axes / subplots** in one figure with payload-based linked selection; **single-select**;
typed `InteractionEvent` (`transform_value`); **opaque-bg save/restore** (no figure mutation). Hover tooltips +
JS highlight; click → `@bind`. **Hit-testing is naive O(n) per pointer move** with a documented
ceiling (~few-thousand elements/segments); past that, `log()` a notice — no silent degradation. Spatial
acceleration (bucketing/quadtree) is added only if someone hits the wall — but note (§8) the wall that
bites *first* is manifest **payload size** (serialize + transfer), not hit-test CPU, so the
higher-leverage lever is wire encoding (§9), not a quadtree. Spatial acceleration stays YAGNI until a
profile shows JS hit-test *specifically* is the bottleneck.

**M4 (shipped):** `ThresholdInteractable` (draggable threshold line, Tier 0); `ROIInteractable`
(draggable + resizable box, Tier 0 bounds + M4 box-select); `AbstractSelector` /
`selects`-ROI — `Vector{InteractionEvent}` bond, Design-D contract (§5); gallery recipes
(box-select scatter, image ROI per-channel stats).

**Phase 2a (shipped):** Hist, Waterfall, CrossBar, HSpan, VSpan — all extracted as `:rects`; shared bar payload schema (semantic, no `index`); span viewport-clamp; uniform `_check_payloads` validation on Segment/Rect/Polygon interactables.

**Phase 2b (shipped):** Band, Density, Contourf, Violin, Voronoiplot — extracted as `:polygons`; surface-specific payloads (Band/Density/Voronoiplot `(; index)`, Contourf `(; low, high)`, Violin `(; x)`). BoxPlot box-body auto-extracted as `:rects` (un-notched) / `:polygons` (notched) with `(; q1, median, q3)`. Tricontourf deferred; BoxPlot whiskers/outliers decorative (box-body-only).

**M3 Colorbar (shipped):** `ColorbarInteractable` — hover/click value readout for any `Colorbar` block, auto-extracted by `holo(fig)` via a figure-block walk over `fig.content`. Rides the `:axis` channel with a bounded bbox geometry; `AxisTransform.valueaxis` tags the value axis so JS inverts the cursor pixel to a scalar `(; value)`. Legend remains deferred (a linking capability, its own arc).

**Phase 2 text labels (shipped):** `TextInteractable` — `text!` and `annotation!` labels as
click-to-pick buttons, auto-extracted by `holo(fig)` for data-space text. Rides `:rects`; geometry
from `Makie.string_boundingboxes` (no font-metric measurement needed — the originally-speculated
`bbox` primitive was never built). `TextLabel` (a `Block`, needs the figure-block walk rather than
the plot-scene walk) remains deferred.

**v2:** plot-object introspection constructors; ABLines/Arc, Legend,
`TextLabel` (Block) support, animation frames, SVG-overlay annotations, spatial hit-test acceleration.

**Backend scope — corrected (2026-07-02).** The earlier framing here ("3D … is the `:webgl`
backend's domain") was wrong about *why*: CairoMakie renders **static 3D natively** — the current
`Axis3`/`PolarAxis`/`LScene` rejection is Holo's own scoping guard, slated to lift for `Axis3`
(build-time `Makie.project` on a static `Axis3` camera is spike-verified exact — 0.0 px, static
*and* after an `azimuth`/`elevation` change). 3D/`Axis3` is **parity scope in progress**: static
overlays on both backends, rotation via `@bind` re-render; the `:webgl` half awaits its own
canvas-alignment spike. The **Holo-wide** non-goals (every backend, by design) are the
**client-side GPU camera** — a JS-driven camera the kernel never hears about, which would desync
the Julia-projected overlay and can only ever exist on one backend — and **GPU-pick occlusion**.
3D-mesh hit-testing (`Surface`, `MeshScatter`) is deferred on both alike (a hit-test-complexity
gap, not a backend-capability gap). High-frequency live redraw is the shared cost wall above,
not a per-backend exclusion. See `docs/backend-comparison.md` and `docs/roadmap.md`.

## 8. Payload scaling & robustness to large inputs

Measured in the Phase 0 spike (`perf-findings.md` is the single source of every number here; cite it,
don't restate). A rendered cell ships **two** payloads — the JS→Julia click return is negligible:

| Term | Carried by | Bounded by |
|---|---|---|
| **base64 PNG** | HTML `<img>` | the **display** (DPI/`max_width` policy → output px), *not* source resolution |
| **manifest** | `published_to_js` (MsgPack) | **unbounded by display** — O(#hit-elements) + O(source-cells) for grids |

**The manifest is the scaling wall** — not the PNG, not render, not hit-test CPU. A realistic single
plot is **50–400 KB total and render-bound** (~65 ms round-trip). High element counts reach multi-MB and
flip to **payload-bound** (~553 ms total measured at a 4.78 MB manifest). Since the `values[]` cap (§8)
keeps even a 1 M-cell heatmap render-bound, the case that reaches this regime by default is now **high-N
scatter** (200k pts → 7.72 MB manifest). Nothing crashes — it degrades into the half-second range — but
tens of MB would lag the Pluto editor.

**M2.3 (tooltip wire format):** shipping per-element tooltip strings as a retired `tooltips[]` array
would have added O(N × string-bytes) — the dominant inflation term at high element counts (see
`perf-findings.md` §"Scope bounds for downstream phases" for the measured upper bounds). M2.3 avoids
this: tooltip content ships as two O(1)-per-layer fields — `template` (pre-parsed segments, present when
`tooltip` is a `Markup`) and a top-level `tipStyle` dict — leaving the per-element envelope unchanged.
See `docs/tooltips.md` for the wire shape and authoring API.

**Robustness to large inputs (assume a user *will* do this) — implemented.** We ship a tool to
Pluto/Makie users, so assume someone overlays `holo` on a 2000²–4000² `heatmap!`/`image!` *because they
can*. The PNG is safe (display-bounded), but the `:grid` `values[]` matrix is **source-bounded**, so that
routine input ships tens of MB of redundant numbers on top of the PNG that already shows them — and the
user's matrix already lives in their Julia session. `values[]` exists only to power the no-round-trip
`(i,j)=value` hover, so it is dropped when the hover can't target a cell:

**The cap criterion: compute the cell's *expected on-screen* size on the fly, and drop `values[]` when it's
sub-pixel.** A Pluto output cell is only so wide — the display is **bounded by the column** (`max_width`,
700 px default), so the on-screen size is known at manifest-build. Everything needed is already in hand:
`display_css = min(scene_width, max_width)` (the column-bounded display width), the axis viewport in image
px (we project the edges anyway), and the output image width. So
`cell_screen_px = (viewport_image_px / ncols) × (display_css / image_width)`. Under today's DPI policy the
PNG is rendered at 2× the display width (`px_per_unit = 2·min(scene, max_width)/scene`), so that ratio is
0.5 and it reduces to `cell_image_px / 2` — but compute the ratio rather than hardcode ÷2, so it tracks the
policy / wide-mode `max_width`. **Ship `values[]` only when `min(cell_screen_px) ≥ τ`** (τ ≈ 1–2 px); below
that the user *cannot* put the cursor over an individual cell, so the per-cell value is useless and is
dropped. This is an *expected* size (it assumes the default column; the overlay still hit-tests against the
true runtime scale via `getBoundingClientRect`, so the estimate only gates ship/drop). Self-tuning: for a
600-wide figure a 50² heatmap is ~12 px/cell (keep), 200² is ~3 px (keep), **1000² is ~0.6 px (drop)**,
2000²–4000² are 0.3–0.15 px (drop) — and it **subsumes the special `Image` case** (images are source-res >
display-res → sub-pixel → auto-dropped), so no separate rule is needed. When dropped, the payload falls back
to `{i,j}` (the click still localizes the region) and a one-time `@warn` fires (fail-loud). Measured size
benefit: 499× smaller at 1000² (`perf-findings.md`). M2.3 owns the `{i,j,value}` payload shape, but the cap
is decoupled and ships independently. *Implemented:* `src/interactables.jl` (`GRID_VALUES_MIN_SCREEN_PX`,
the `:grid` hitlayer) gated on `InteractionContext.display_scale` (= `display_css / image_width`, set in
`context()`); the overlay tolerates an absent `values[]` (hover shows `(i,j)` only).

## 9. Wire encoding & precision

`published_to_js` serializes the manifest as **generic MsgPack** maps/arrays (the `Dict{String,Any}` /
`Any[]` root defeats the TypedArray binary fast-path even though leaf vectors are numeric). The
encoding levers were **de-speculated by a measurement experiment** (`bench/encoding_experiment.jl` →
`perf-findings.md`), which changed the verdict from my first design guess:

- **Scalar precision — int-pixel quantization (the win, implemented).** Geometry was `Float32` *pixel*
  coordinates, overkill for ~1px hit-testing. Rounding coords to `Int` measured **58% off the geometry
  term** (5.00 → 2.10 B/coord; 732 → 307 KB at 50k circles) — and it needs **no structural change**:
  MsgPack already encodes small ints in 1–3 bytes, the frontend reads numbers either way, and ≤0.5px
  rounding is inside the hit-test tolerance. *Implemented:* `src/interactables.jl` builds per-element
  geometry vectors as `Int` via `_q(x) = round(Int, x)` (circles/segments/rects/polygons/regions + grid
  edges); on a whole realistic manifest the saving is ~17 % (geometry is one term among the payload's
  Float64 `x`/`y`). `Float16` is *not* the way down: MsgPack has no float16 (it promotes to float32 → no
  saving) and is lossy above 2048px.
- **Container structure — typed-array fast-path (rejected by the experiment).** Lifting geometry to a
  top-level typed numeric vector to engage the binary fast-path measured only **~5% beyond int-quantization**
  (2.00 vs 2.10 B/coord) — because compact ints already sit near the 2-byte binary floor. The structural
  manifest-shape change is **not worth 5%**; dropped. (It would only pay off if we kept *floats*, 5→4 B,
  which int-quantization already beats.)
- **The precision split (a real constraint).** Per-element **geometry** is quantizable to pixels, but the
  **`AxisTransform` lims/viewport must stay `Float64`**: the M4 drag path inverts pixel→data through them and
  the error amplifies — and at O(1)/axis the precision costs nothing. Only per-element geometry is quantized.

The other manifest term — heatmap/image `values[]` (§8) — is bounded not by encoding but by *not shipping
it*: capping/dropping it measured **499×** smaller (4.78 MB → 9.8 KB at 1000²). Both are now shipped (the
cap in PR #8, int-pixel coords here); they were the committed manifest-payload work — reach for them before
a quadtree (§7).
