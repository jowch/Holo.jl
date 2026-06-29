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

**`CairoBackend` is the only v1 implementation** — PNG (`mount = :img`) by default, SVG
(`mount = :svg`) optionally for sparse plots. `render` = `colorbuffer` → PNG → bytes. `context` calls
`Makie.update_state_before_display!(fig)` (mandatory, validated) then builds the projection closure
and reads each axis's transform.

**Don't corrupt the user's figure.** Makie `Figure`s can't be `deepcopy`'d (they hold module refs),
so instead the one mutation we introduce — forcing an opaque background — is **saved and restored**
(try/finally). `update_state_before_display!` is also run, but that's exactly the step Makie performs
at display/save time, so it's benign, not corruption. See also the DPI/sizing policy in `frontend-delivery.md`
(render at `2 × (max_width or 700px column)`, opaque background, package-owned wide mode).

The seam is deliberately static-only and stays that way: it still admits a future GLMakie-static
backend (GPU offscreen → PNG, same contract) or a pure-image backend. A browser-side *live*
rendering model (WGLMakie) is **out of scope** — research (Q0) found it server-centric, reload-fragile,
and at odds with the static/durable output this project exists to provide. It is not a deferred target;
it is a different product.

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
tooltip(::AbstractInteractable, idx::Int, payload)::Union{Nothing,String} = nothing
hoverstyle(::AbstractInteractable, idx::Int)::NamedTuple = (; stroke="#ff3b30", width=3)
```

**`validate` is per-capability, not a global scale gate** (fixes a latent silent-coordinate bug).
Element interactables (Point/Segment/Rect/Polygon) are projected **in Julia** via `Makie.project`,
so they impose **no axis-scale restriction** — they work on any scale Makie can project (linear, log,
symlog, …). Only `AxisInteractable` relies on **client-side** pixel→data inversion, so *it alone*
restricts to scales the JS `invert` implements (identity, log10/log, + categorical via the shipped
category map). A blanket `_OK_SCALES` gate would be both too strict (rejecting element types that work)
and too loose (passing `AxisInteractable` on a scale the JS inverts wrong). Default `validate` stays
permissive; `AxisInteractable.validate` is the one that gates.

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
| `:axis` | `nothing` | always-hit; invert via AxisTransform | `-1` (continuous) |

This is a **closed set of six geometry kinds** (`:circles/:polyline/:segments/:rects/:grid/:polygons`)
plus the `:axis` continuous channel. The survey confirmed every retained Makie surface projects to one
of them; nothing in v1+v2 needs a seventh. (`bbox` — rotated text/markers — is a v2 addition expressed
as a degenerate polygon, reusing the polygon JS test.)

### Built-in interactables (v1)

Five types, one per hit primitive, parameterized where surfaces differ only in indexing:

| Type | kind(s) | Makie surfaces (v1) | payload |
|---|---|---|---|
| `PointInteractable` | `:circles` | Scatter, Stem, Spy, ScatterLines·pts | `(; index, x, y)` |
| `SegmentInteractable` | `:polyline` \| `:segments` | Lines, Stairs, ScatterLines·lines (polyline); LineSegments, Errorbars, Rangebars, HLines, VLines (pairs) | `(; segment_index, p0, p1)` |
| `RectInteractable` | `:rects` \| `:grid` | BarPlot, Hist, BoxPlot (list); Heatmap, Image (grid) | grid `(; i, j, value)`; list `(; index, …)` |
| `PolygonInteractable` | `:polygons` | Poly, Band, Pie | `(; index)` |
| `AxisInteractable` | `:axis` | the Axis area itself (linear + log) | `(; x, y)` inverted client-side |

`SegmentInteractable` carries `mode ∈ {:polyline,:pairs}`; `RectInteractable` carries
`layout ∈ {:grid,:list}`. Same JS test, different Julia extractor.

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
    tooltip  = pl -> string(pl),
    events   = (:click, :hover))
```

**Tier B — closure against live context.** For geometry computed from `ctx` (Makie's
`register_interaction!(f, …)` analog). Still emits `HitLayer`s.

```julia
FunctionInteractable(ax, f; id, events=(:click,:hover))   # f(ctx)::Vector{HitLayer}
```

**Tier C — full struct.** Implement `hitlayers` (+ optional `validate`/`tooltip`/`hoverstyle`). A user
struct is *indistinguishable* from a built-in — same manifest path, same overlay, same `@bind`. Example:

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
Holo.tooltip(c::CityInteractable, idx, pl) = pl.name
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

**Single-select in v1.** The bond carries **one** event per click, not an accumulating set.
The value is shaped so a `Vector{InteractionEvent}` is a forward-compatible extension (multi-select /
box-select) without breaking the single-event contract — but v1 ships single.

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
- **Tier 2 (round-trip):** `:click` events → `@bind`. Faithful plot redraw from arbitrary new state is
  the irreducible-latency wall and is out of scope (that's WGLMakie's domain, not this package's).

**Named tensions (accepted, not bugs):**
1. `AxisInteractable` is the one type that returns no region geometry — it rides the `:axis` channel.
   Worth the seam: it collapses whole-axis readout (and v2 Density) into the transform we already ship.
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

**v2:** plot-object introspection constructors; multi-select / box-select (`Vector{InteractionEvent}`);
ABLines/Arc, spans, Colorbar/Legend, contourf/violin/voronoi (computational-geometry extraction),
text bboxes (font metrics), animation frames, SVG-overlay annotations, spatial hit-test acceleration.

**Never (without a new backend class):** 3D (Surface, MeshScatter, Arrows3D), PolarAxis/Axis3,
high-frequency live redraw. These are WGLMakie's domain.

## 8. Payload scaling & robustness to large inputs

Measured in the Phase 0 spike (`perf-findings.md` is the single source of every number here; cite it,
don't restate). A rendered cell ships **two** payloads — the JS→Julia click return is negligible:

| Term | Carried by | Bounded by |
|---|---|---|
| **base64 PNG** | HTML `<img>` | the **display** (DPI/`max_width` policy → output px), *not* source resolution |
| **manifest** | `published_to_js` (MsgPack) | **unbounded by display** — O(#hit-elements) + O(source-cells) for grids |

**The manifest is the scaling wall** — not the PNG, not render, not hit-test CPU. A realistic single
plot is **50–400 KB total and render-bound** (~65 ms round-trip). High-N scatter / large grids reach
multi-MB and flip to **payload-bound** (~290 ms serialize+transfer at a 4.78 MB manifest; ~553 ms total
for a 1000² heatmap). Nothing crashes — it degrades into the half-second range — but tens of MB would lag
the Pluto editor.

**Robustness to large inputs (assume a user *will* do this) — committed fix.** We ship a tool to
Pluto/Makie users, so assume someone overlays `holo` on a 2000²–4000² `heatmap!`/`image!` *because they
can*. The PNG is safe (display-bounded), but the `:grid` `values[]` matrix is **source-bounded**, so that
routine input ships tens of MB of redundant numbers on top of the PNG that already shows them — and the
user's matrix already lives in their Julia session. Today `values[]` ships unconditionally (it powers the
no-round-trip `(i,j)=value` hover).

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
is decoupled and can ship independently.

## 9. Wire encoding & precision

`published_to_js` serializes the manifest as **generic MsgPack** maps/arrays (the `Dict{String,Any}` /
`Any[]` root defeats the TypedArray binary fast-path even though leaf geometry is `Vector{Float32}`). The
encoding levers were **de-speculated by a measurement experiment** (`bench/encoding_experiment.jl` →
`perf-findings.md`), which changed the verdict from my first design guess:

- **Scalar precision — int-pixel quantization (the win).** Geometry is `Float32` *pixel* coordinates,
  overkill for ~1px hit-testing. Rounding coords to `Int` measured **58% off the geometry term** (5.00 →
  2.10 B/coord; 732 → 307 KB at 50k circles) — and it needs **no structural change**: MsgPack already
  encodes small ints in 1–3 bytes, the frontend reads numbers either way, and ≤0.5px rounding is inside the
  hit-test tolerance. **A committed item** (roadmap M5/Phase-4), not deferred. `Float16` is *not* the way
  down: MsgPack has no float16 (it promotes to float32 → no saving) and is lossy above 2048px.
- **Container structure — typed-array fast-path (rejected by the experiment).** Lifting geometry to a
  top-level typed numeric vector to engage the binary fast-path measured only **~5% beyond int-quantization**
  (2.00 vs 2.10 B/coord) — because compact ints already sit near the 2-byte binary floor. The structural
  manifest-shape change is **not worth 5%**; dropped. (It would only pay off if we kept *floats*, 5→4 B,
  which int-quantization already beats.)
- **The precision split (a real constraint).** Per-element **geometry** is quantizable to pixels, but the
  **`AxisTransform` lims/viewport must stay `Float64`**: the M4 drag path inverts pixel→data through them and
  the error amplifies — and at O(1)/axis the precision costs nothing. Only per-element geometry is quantized.

The other manifest term — heatmap/image `values[]` (§8) — is bounded not by encoding but by *not shipping
it*: capping/dropping it measured **499×** smaller (4.78 MB → 9.8 KB at 1000²). That, plus int-pixel coords,
is the committed manifest-payload work; reach for them before a quadtree (§7).
