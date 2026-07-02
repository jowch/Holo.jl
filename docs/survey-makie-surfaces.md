# Makie Surface & Interaction-API Survey

> Raw output of the survey workflow (2026-06-26). The digested design lives in architecture.md.
>
> **Reconciliation note (Phase 2 text labels, 2026-07-01):** this survey's every "Text/Annotation
> need font-metric measurement → a new `bbox` primitive" call turned out wrong — `Makie.string_boundingboxes`
> already returns each string's pixel-space box, so `TextInteractable` shipped on plain `:rects`
> (a rotated label's box just expands to stay axis-aligned). No `bbox` primitive was built; see
> `architecture.md` §3/§4 and `roadmap.md` for what actually shipped. Left the historical survey
> text below as-is (it's this file's stated raw-output contract) and annotated the specific claims
> inline.

## Synthesis

## Default interactable taxonomy

Five concrete `AbstractInteractable` subtypes cover everything we ship. The collapse rule: **one type per hit primitive**, parameterized over "grid vs list" or "open vs closed" where two surfaces differ only in indexing, not in geometry math.

```julia
abstract type AbstractInteractable end

struct PointInteractable   <: AbstractInteractable  # circle hit
struct SegmentInteractable <: AbstractInteractable  # polyline OR independent-pair segments
struct RectInteractable    <: AbstractInteractable  # axis-aligned rect: grid form OR list form
struct PolygonInteractable <: AbstractInteractable  # point-in-polygon, even-odd for holes
struct AxisInteractable    <: AbstractInteractable  # no regions; rides the axis-transform channel
```

`SegmentInteractable` carries a `mode::Symbol ∈ {:polyline, :pairs}` (continuity vs independent pairs). `RectInteractable` carries `layout::Symbol ∈ {:grid, :list}` (a heatmap is a grid with O(1) pixel→(i,j) inversion; a barplot is an explicit rect list). This keeps the JS hit-test identical while the Julia extractor differs.

| Built-in type | Makie plot types covered | Hit primitive | Default payload | Tier |
|---|---|---|---|---|
| **PointInteractable** | Scatter, Stem (endpoints), Spy (nonzeros), ScatterLines (point half) | circle `{cx,cy,r}` | `{index, x, y}` (+ for Spy `{i,j,value}`) | 1 |
| **SegmentInteractable** | Lines, Stairs (`:polyline`); LineSegments, Errorbars, Rangebars, HLines, VLines, ScatterLines line-half, ABLines (`:pairs`) | segment / polyline | `{segment_index, p0, p1}` (+ `value`/`equation`/`bar_index`+`segment_type`) | 1 (HLines/VLines/ABLines: 2) |
| **RectInteractable** | Heatmap, Image (`:grid`); BarPlot, Hist, BoxPlot (`:list`) | rect `{cx,cy,w,h}` | grid `{i,j,value}`; list `{index, x, y, ...}` | 1 (BoxPlot: 2) |
| **PolygonInteractable** | Poly, Band, Pie | polygon (vertex ring) | `{index}` (+ `segment_index` for Band, `value` for Pie) | 1–2 |
| **AxisInteractable** | Axis (2D, linear/log) | continuous (transform) | `{x, y}` (inverted client-side) | 1 (log: still 1) |

**Full surface→type mapping (every surveyed surface assigned):**

- PointInteractable (v1): Scatter, Stem, Spy, ScatterLines·points
- SegmentInteractable (v1): Lines, LineSegments, Stairs, ScatterLines·lines, Errorbars, Rangebars, HLines, VLines
- SegmentInteractable (v2): ABLines (axis-limit dependent), Arc
- RectInteractable (v1): Heatmap, Image, BarPlot, Hist, BoxPlot
- RectInteractable (v2): Waterfall, CrossBar, HSpan, VSpan, Colorbar, Legend
- PolygonInteractable (v1): Poly, Band, Pie
- PolygonInteractable (v2): Contourf, Tricontourf, Voronoiplot, Triplot, Violin
- AxisInteractable (v1): Axis (linear + log/symlog/pseudolog, single or multi)
- **skip (v2+):** MeshScatter, Text, TextLabel, Annotation (rotated-text bbox — **reconciled:** Text
  and Annotation shipped in Phase 2 as `TextInteractable`/`:rects`, *not* a bbox primitive; `TextLabel`
  is the piece still deferred, see the reconciliation note above); Arrows2D/Arrows3D (mesh hulls); Surface (3D mesh); Density (continuous band — fold into Poly-band in v2); RainClouds (composite); Bracket (Bézier); GridLines/Spines/Ticks/LineAxis/Titles/Labels (decorative); PolarAxis, Axis3D (tier 4).

ScatterLines is the one surface that **emits two interactables** from one plot (a `PointInteractable` and a `SegmentInteractable` sharing a payload namespace); precedence is points-first within markersize px, then segment. This is the model for any composite recipe.

## Geometry primitives the HitRegion / manifest must carry

The closed set is exactly six, and it is closed because every retained surface's rendered geometry projects to one of them under a linear (or per-axis-invertible) transform:

1. **circle** `{cx,cy,r}` — markers. r derived from `markersize` × `px_per_unit` (markerspace=:pixel).
2. **segment / polyline** — a vertex list + `mode`. Polyline shares vertices (segment i = v[i],v[i+1], NaN = gap); pairs are disjoint (v[2i],v[2i+1]). One JS distance-to-segment test serves both.
3. **rect** (axis-aligned, data-space) `{cx,cy,w,h}` — bars, heatmap cells. Grid form ships `(x_edges, y_edges)` + matrix dims, not N rects, so the *geometry* is compact with O(1) inversion — but it also ships the full **source-resolution** `values[]` matrix to power the `(i,j)=value` readout, which is O(source-cells): a 1000² heatmap is ~4.78 MB, *not* constant-size (a 2000²–4000² `image!` reaches tens of MB). Committed fix: ship `values[]` only when the cell's *expected on-screen* size (display bounded by the Pluto column) is targetable (≥~1–2 px), else drop → payload `{i,j}` + `@warn`. Subsumes `Image` (sub-pixel → auto-drop). See `architecture.md` §8.
4. **polygon** — vertex ring, even-odd fill rule for holes. Pie wedges, Poly, Band quads.
5. **bbox** (pixel-space, may carry rotation θ) — reserved for v2 rotated text/markers; distinct from rect because it lives in pixel space post-projection and can be rotated. A θ=0 bbox is a rect; a θ≠0 bbox is a degenerate 4-vertex polygon. We keep it nominally separate so the cheap axis-aligned path stays cheap, but the JS test for it = the polygon test. **Reconciled (Phase 2 text labels):** this primitive was never built for text — `TextInteractable` rides plain `:rects` instead, with rotated labels getting an axis-aligned *expanded* box rather than a rotated one. Still hypothetically open for rotated markers, but no consumer has needed it.
6. **axis-transform** — per-axis `{limits, scale, viewport, reversed, float32_offset}` shipped once, enabling continuous data↔pixel inversion in JS for AxisInteractable and for any hover that wants live coordinates. *(Precision note: despite `float32_offset`, the limits/viewport must stay `Float64` — the M4 drag inverts pixel→data through them and error amplifies; geometry is quantizable, this transform channel is not. `architecture.md` §9.)*

**What does not fit, and the disposition:**

- **Continuous surfaces (Axis, Density):** no discrete region exists. Handled by the axis-transform channel (AxisInteractable), not by emitting regions. Density's *band* in v2 becomes a single polygon; its continuous readout is just AxisInteractable.
- **Curves (Arc, Bracket Béziers, contour arcs):** approximated as polylines at render resolution (`resolution`/`vertex_per_deg`), which is exactly how Makie already rasterizes them. No new primitive.
- **3D meshes (Surface, MeshScatter, Arrows3D):** require projected convex hull or screen-space bbox + depth; ~~**skip**~~. If ever needed, the projected silhouette is a polygon — still no new primitive. **Reconciled (2026-07-02, parity reframe):** "not invertible *client-side*" still holds, but "skip" as scheduling is superseded — overlay geometry comes from build-time *server-side* projection (the shared closure, post-#32), so MeshScatter/Arrows3D/wireframe are M-effort inside the committed `roadmap.md` M3 Axis3 parity item; only `Surface` stays deferred (unbounded per-cell payload + occlusion).
- **Rotated/aligned text bboxes (Text, Annotation, …):** ~~need font-metric measurement to get
  bounds; deferred to v2 via the `bbox` primitive (with rotation). The geometry primitive exists;
  the *extractor* is the hard part.~~ **Reconciled (Phase 2 text labels):** wrong on both counts —
  no font-metric measurement was needed (`Makie.string_boundingboxes(p)` already returns each
  string's box) and no `bbox` primitive was built (`TextInteractable` rides plain `:rects`, rotated
  labels get an axis-aligned expanded box). The actual work was wiring the extractor to an existing
  Makie function, not measuring anything. `TextLabel` (a `Block`) remains deferred — different
  reason: it needs the figure-block walk, not font metrics.

No surface in the survey requires a seventh primitive. The set is genuinely closed for the v1+v2 retained universe.

## The AbstractInteractable interface

Every interactable — built-in or user-defined — flows through one contract. The framework never special-cases the built-ins; `PointInteractable` is just the first public implementation.

```julia
# Context the backend hands to every interactable. Backend-supplied so the
# projection primitive is not hard-wired to Makie.project (see Coherence check).
struct InteractionContext
    ax                      # the Makie Axis (or backend equivalent)
    px_per_unit::Float64
    out_h::Int              # rendered image height in px, for the y-flip
end

# The ONE supported coordinate primitive. Exported. A custom author writes the
# same single line PointInteractable does instead of re-deriving projection.
function data_to_image_px(ctx::InteractionContext, p)::Point2f
    q = Makie.project(ctx.ax.scene, p)                 # data → scene px
    o = ctx.ax.scene.viewport[].origin
    x = (q[1] + o[1]) * ctx.px_per_unit
    y = ctx.out_h - (q[2] + o[2]) * ctx.px_per_unit    # flip to image coords
    return Point2f(x, y)
end

# ---- the contract every interactable implements ----

# REQUIRED: produce the manifest regions in image-px. Empty for transform-only.
hitregions(i::AbstractInteractable, ctx::InteractionContext)::Vector{HitRegion}

# REQUIRED implicitly: each HitRegion carries its own payload (the linkage key).
# Payload is data, not a method — set it inside hitregions. A `payload(i, idx)`
# helper is offered for convenience but the source of truth is HitRegion.payload.

# OPTIONAL, defaulted: fail-loud gate. Return a message string to abort, or nothing.
validate(i::AbstractInteractable, ctx::InteractionContext)::Union{Nothing,String} = nothing

# OPTIONAL, defaulted: declarative event vocabulary (Vega-Lite `on`-style).
# The JS overlay wires only these. Default = click round-trips, hover is local.
events(i::AbstractInteractable)::NTuple = (:click, :hover)

# OPTIONAL, defaulted: hover/tooltip + style hook. Pure data, no user JS.
tooltip(i::AbstractInteractable, idx::Int, payload)::Union{Nothing,String} = nothing
hoverstyle(i::AbstractInteractable, idx::Int)::NamedTuple = (; stroke="#000", width=2)
```

`HitRegion` is the single serialized unit:

```julia
struct HitRegion
    kind::Symbol          # :circle | :segment | :rect | :polygon | :bbox
    coords::Vector{Float32}   # image-px; interpretation keyed by `kind`
    #   ^ Float32 pixel coords are overkill for ~1px hit-testing. Committed wire win: round to
    #     integer pixels (measured, no manifest-shape change — architecture.md §9). The typed-vector
    #     binary fast-path was measured NOT worth it; Float16 is wrong (no msgpack float16; lossy >2048px).
    payload               # JSON-serializable; THE linkage/identity primitive
end
```

**A custom interactable, indistinguishable from a default.** A user who has, say, a set of city markers with metadata:

```julia
struct CityInteractable <: AbstractInteractable
    positions::Vector{Point2f}
    names::Vector{String}
    radius::Float32
end

function Holo.hitregions(c::CityInteractable, ctx)
    map(enumerate(c.positions)) do (k, p)
        q = data_to_image_px(ctx, p)
        HitRegion(:circle, Float32[q[1], q[2], c.radius * ctx.px_per_unit],
                  (; index = k - 1, name = c.names[k]))
    end
end

Holo.validate(c::CityInteractable, ctx) =
    ctx.ax.xscale[] === identity ? nothing : "CityInteractable needs a linear x-axis"

Holo.tooltip(c::CityInteractable, idx, pl) = pl.name
```

This passes through the identical `render.jl` manifest path, the identical JS hit-test (dispatched on `kind`), and the identical `@bind` round-trip. The user authored **zero JavaScript** and re-derived **zero projection math**.

## Custom-interaction ergonomics

Two convenience tiers reconcile the comparative findings: a declarative region-list constructor (Vega-Lite/Observable "interaction is just another mark" style) and a closure form (Makie's `register_interaction!(f::Function, …)` quick path). Both produce *real* `AbstractInteractable` values — no escape hatch, no separate code path.

```julia
# Tier A — declarative, no struct, no projection. The 80% case.
# Author hands regions in DATA space + payloads + an optional tooltip mapper.
# Mirrors Vega-Lite "declare WHAT": region geometry + payload predicate.
RegionInteractable(ax;
    regions::Vector,            # e.g. [(:circle, Point2f(x,y), r), (:rect, p, w,h), (:polygon, ring)]
    payloads::Vector,          # parallel; one payload per region (the linkage key)
    tooltip = (pl -> nothing),
    events  = (:click, :hover),
    validate = nothing,
)

# Tier B — closure, for geometry the author wants to compute against live ctx.
# Mirrors Makie's bare-Function interaction. Still emits HitRegions.
FunctionInteractable(ax, f; id, events=(:click,:hover))
#   where f(ctx)::Vector{HitRegion}
```

`RegionInteractable` is the declarative-selection analog: the author states regions + payload predicates, the framework owns the "how it reacts" (hover highlight, click bind). `FunctionInteractable` is the imperative analog for people who think in `pick`-style closures. Crucially, neither admits a user-supplied JS string (the Bokeh `CustomJS` failure mode the design rejects) — the output is always `HitRegion`s, so the manifest/overlay contract is preserved.

**Linkage is payload-based, not geometry-based** — the convergent lesson from Bokeh (`source.selected.indices`), Plotly (`customdata`), and Vega-Lite (named param). Two interactables that write the same payload field into the same `@bind`-backed variable *are* linked brushing; the Pluto reactive graph is our `ColumnDataSource`. No central mutable selection store is introduced.

## v1 default set vs v2

**v1 includes** (rule: linear projection, identity/log/symlog/pseudolog scales, single or stacked Cartesian axes — Tier 1, plus log because client-side inversion is closed-form):

- **PointInteractable:** Scatter, Stem, Spy, ScatterLines·points — markers are the canonical click target; circle test is trivial.
- **SegmentInteractable:** Lines, LineSegments, Stairs, ScatterLines·lines, Errorbars, Rangebars, HLines, VLines — all reduce to data-space vertices projecting linearly; HLines/VLines are tier-2 only because they read `finallimits`, which we already have post-`update_state_before_display!`.
- **RectInteractable:** Heatmap, Image (grid, O(1) inversion; geometry compact but manifest **O(source-cells)** via `values[]` — ~4.78 MB at 1000², a candidate cap target in M2.3, droppable entirely for `Image`), BarPlot, Hist, BoxPlot (rect list).
- **PolygonInteractable:** Poly, Band, Pie — vertices live directly in data space; the tier-2 label on Poly is *extraction* complexity (multiple meshes/holes), not projection, and even-odd point-in-polygon handles it.
- **AxisInteractable:** the whole-axis coordinate readout, linear and log.

**v2 (deferred):** ABLines, Arc (axis-limit/curve), Waterfall, CrossBar, HSpan, VSpan, Colorbar, Legend (rect-list, low demand), Contourf/Tricontourf/Voronoiplot/Triplot/Violin/Density (computational-geometry or KDE extraction, tier 2–3), and ~~all text-bbox surfaces (need font metrics)~~ — **reconciled:** Text and Annotation shipped in Phase 2 (`TextInteractable`/`:rects`, no font metrics needed after all); only `TextLabel` (a `Block`) remains deferred.

**~~Never~~ Not invertible client-side (tier 3–4):** MeshScatter, Arrows3D, Surface, RainClouds, PolarAxis, Axis3D, decorations. PolarAxis is the boundary case — non-Cartesian inversion in JS — and stays out until/unless we ship the transform serializer for it. **Reconciled (2026-07-02, parity reframe):** the invertibility fact stands, but "Never" as scheduling is superseded by server-side (build-time) projection — Axis3D plus MeshScatter/Arrows3D are committed `roadmap.md` M3 scope; `Surface` stays deferred. PolarAxis's blocker is halved: discrete hit geometry is projectable server-side now that the shared closure applies `transform_func` (where the polar map lives), while the *continuous* axis readout still needs the polar transform serialized to JS — its disposition (parity item or Holo-wide non-goal) is an explicit M3 decision item.

Rationale for the cut line: v1 is precisely the set whose hit primitive is one of {circle, segment, rect, polygon} *and* whose data→pixel map is closed-form invertible in JS from the shipped axis-transform. Everything requiring CPU geometry recomputation per frame, font measurement, or 3D projection is v2+.

## Coherence check

**Against the AbstractBackend seam (rendermodel / render / rendercontext / mount):** clean, with one named tension. The interactable contract speaks only `InteractionContext` + `data_to_image_px` + `HitRegion`, all of which are backend-neutral *outputs* (image-px coordinates + tagged geometry + JSON payload). The `mount` step consumes the manifest without knowing how it was produced. **Tension:** `data_to_image_px` currently calls `Makie.project(ax.scene, …)`, which hard-binds the projection to the Makie/CairoMakie backend. Resolution: make `data_to_image_px` a method *on the rendercontext* the backend supplies, so `Makie.project` is CairoMakie's *implementation* of the projection primitive, not the interface. A future pure-image or WGLMakie backend supplies its own. This keeps interactables backend-agnostic and matches how Makie itself hands custom interactions `pick`/`project`.

**Against the three interaction tiers (overlay / precomputed / round-trip):** the mapping is exact for four of five types and exposes one structural asymmetry.

- `hitregions(i, ctx)` *is* the precomputed tier — Julia computes regions once, post-`update_state_before_display!`.
- `events(i)` declares which regions ride the overlay tier (hover, client-side, no round-trip) vs the round-trip tier (deliberate click → `@bind`). Hover never round-trips; click does. This is the declarative knob that keeps the two tiers from leaking into user code.
- **Tension — AxisInteractable does not fit the region model.** It emits zero `HitRegion`s; it rides the *axis-transform channel* (continuous inversion) for overlay hover and round-trips an *inverted coordinate* on click, not a region index. The interface must therefore allow `hitregions` to return `[]` while a separate `transform_channel(i)::Bool` (or a sentinel whole-viewport region) tells the overlay to fall back to continuous inversion. This is the single place where "everything is a HitRegion" bends: one interactable is transform-based rather than region-based. It is worth the seam because it collapses Axis + (v2) Density coordinate readout into one mechanism that the axis-transform was already shipped to support.

**Deferred by design (named gaps, not bugs):** no `Consume`/priority/z-order model for overlapping interactables — JS hit-test is first-match-wins in manifest order, which is deterministic. Add an ordering field to `HitRegion` only when users actually stack overlapping custom regions (Makie has `Consume`+priority; we adopt its enum *names* for `events` now so the vocabulary is forward-compatible, but not the propagation machinery). This is the correct YAGNI line: the manifest order already resolves the only collisions v1 can produce (ScatterLines points-over-segments).