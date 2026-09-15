# Troubleshooting

## Errors from `holo()` / interactable constructors

### "holo(fig) needs a rendering backend loaded"

**Cause:** neither `CairoMakie` nor `WGLMakie` is loaded in the session.
**Fix:** add `using CairoMakie` (static, the default) or `using WGLMakie` (live, animation /
large data / 3D) before calling `holo`.

### "tooltip = true is not meaningful"

**Cause:** an interactable was built with `tooltip = true`.
**Fix:** omit `tooltip` entirely for the auto name/value table (the default), pass
`holo"..."` for a template, or `tooltip = false` to suppress it. `true` isn't one of the
three valid forms — see [Tooltips](@ref).

### "got N payloads for M elements" / "payloads must match points"

**Cause:** `payloads` doesn't have one entry per geometry element. Most constructors report
this as "got N payloads for M elements"; `PointInteractable` has its own check and says
"payloads must match points" instead — same underlying mistake, different wording.
**Fix:** match lengths 1:1, or omit `payloads` to get the auto-generated default.

### "mode must be :polyline or :pairs"

**Cause:** `SegmentInteractable(...; mode = ...)` got something other than the two valid
symbols.
**Fix:** use `:polyline` (connected path, nearest-segment hit) or `:pairs` (disjoint segment
pairs).

### "orientation must be :horizontal or :vertical"

**Cause:** same shape of mistake, for `ThresholdInteractable(...; orientation = ...)`.
**Fix:** use `:horizontal` (constant-y, dragged vertically) or `:vertical`.

### "ROIInteractable: bounds must be (xmin, xmax, ymin, ymax)" / "need xmin < xmax and ymin < ymax"

**Cause:** `bounds` isn't a 4-tuple, or the min/max order is backwards.
**Fix:** pass `bounds = (xmin, xmax, ymin, ymax)` with `xmin < xmax` and `ymin < ymax`.

### "regions/payloads length mismatch" / "unknown region kind"

**Cause:** `RegionInteractable`'s `regions` and `payloads` don't line up 1:1, or a region
tuple's first element isn't `:circle`, `:rect`, or `:polygon`.
**Fix:** check the region tuple shapes against [Custom interactions](@ref).

### A scale-related `ArgumentError` from `AxisInteractable`/`ColorbarInteractable`/`ThresholdInteractable`/`ROIInteractable`/`ViewInteractable`

**Cause:** these interactables invert a pixel back to a data value *in the browser*, which
only works for `identity`, `log10`, or `log` axis scales. Any other Makie scale
(`Makie.pseudolog10`, `Makie.Symlog10`, a custom `ReversibleScale`, …) fails loud at
`holo()` time instead of silently reporting the wrong coordinate. The exact wording differs
per kind — `AxisInteractable`/`ColorbarInteractable` say "... is not invertible client-side";
`ThresholdInteractable`/`ROIInteractable`/`ViewInteractable` say "needs (a) client-side
invertible ... scale(s)".
**Fix:** switch the axis to one of the supported scales, or use an element interactable
(`PointInteractable`, `SegmentInteractable`, …) instead of a continuous-readout one.

### "continuous pixel→data readout is undefined on an Axis3" / "on PolarAxis"

**Cause:** `AxisInteractable`/`ThresholdInteractable`/`ROIInteractable`/orbit
`ViewInteractable` need a 2D pixel→data inverse; a 3D axis has none (a screen pixel is a ray)
and `PolarAxis` continuous θ/r inversion isn't shipped yet.
**Fix:** use element interactables (points/segments/polygons) on 3D or polar axes instead.

### "bounds need continuous axes" / "pan needs continuous numeric axes"

**Cause:** `ROIInteractable`/`ViewInteractable` pan needs numeric axis limits; a categorical
axis has none.
**Fix:** use `AxisInteractable` (reads the category) instead.

### "Holo's CairoMakie backend supports Makie.Axis, Makie.Axis3, and Makie.PolarAxis" (`LScene`)

**Cause:** the figure contains an `LScene` block, which the `:cairo` backend refuses to
render at all rather than silently dropping (this is Holo's own scoping guard, not a
CairoMakie limitation).
**Fix:** restart the session with `using WGLMakie` instead of `CairoMakie` — the `:webgl`
backend renders `LScene` live, just without a hit-testing overlay for it (Holo builds no
overlay for `LScene` on either backend; `:cairo` refuses to render the figure at all rather
than silently drop it).

### `ArgumentError` from `selected = ...`

**Cause:** either the layer id doesn't support pre-highlight (`grid`, `axis`, `threshold`,
`roi`, `view` layers can't be pre-highlighted — only `circles`/`rects`/`polygons`/
`segments`/`polyline` can) or an index is out of range for that layer.
**Fix:** check the layer's kind against the supported list in [Selection](@ref); indices are
0-based and must be `< ` the element count.

### An error mentioning "Makie internals changed?"

**Cause:** an internal-invariant guard tripped — Holo introspects a live Makie plot object's
internal fields, and a Makie/CairoMakie/WGLMakie version bump can move or rename one of
them. This is not user misuse.
**Fix:** file an issue with your Makie/CairoMakie/WGLMakie versions; pin to a known-good
version in the meantime.

## Not errors, but surprising

### Neither backend loaded, or both loaded

Loading neither `CairoMakie` nor `WGLMakie` raises the `ArgumentError` above; loading both is
fine. See [Choosing between them](@ref) on the Backends page for the exact rule.

### "Cyclic references" from Pluto

**Cause:** you fed a widget's own bond value into that same `holo(...)` call's `selected=`
in one cell. Pluto detects the self-reference and refuses to run the cell.
**Fix:** split the click source, the accumulator, and the pre-highlighted display across
separate cells — see [Persisting a selection across re-renders](@ref) in [Selection](@ref).

### Nothing happens when I click

Check, in order: (1) is the bond actually read somewhere (`@bind ev holo(...)` with no cell
reading `ev` looks like nothing happened); (2) did you click empty space — clicks that don't
land on a hit region are a no-op, by design; (3) is the element you clicked actually
interactive — an unsupported plot type in `holo(fig)` is skipped with a `@warn` in the
notebook log, not an error, so it silently isn't clickable.

### Tooltip shows `[object Object]`

**Cause:** the auto-table (or a `$(field)` template) is rendering a payload value that is
itself a nested `Dict`/array, not a scalar — this stringifies to `[object Object]` in
JavaScript.
**Fix:** flatten the field to a scalar (string/number) in Julia before it goes into
`payloads`, or reference a pre-formatted string field with `holo"$(that_field)"` instead of
the raw nested value.

### The overlay is misaligned with the figure

**Cause:** almost always a `px_per_unit`/`max_width` mismatch between what was rendered and
what the user's display shows. Hit-testing itself re-reads the element's actual on-screen
size at runtime, so page zoom or window resizing after the widget mounted is not the cause.
**Fix:** re-run the cell that calls `holo(...)`; if the misalignment persists, check that
`max_width` on `holo`/the explicit backend struct matches the column width you expect.

### Browser console errors to look for

Open the browser devtools console. A serialization error there on `:webgl` usually means the
installed `WGLMakie` version is outside Holo's pinned compat range — see [Backends](@ref)
caveats. Any other console error alongside a widget that otherwise renders is worth reporting
as a bug rather than assuming it's expected.

### WGLMakie canvas is blank

**Cause:** typically a version mismatch between the installed `WGLMakie` and the one Holo's
`:webgl` extension was verified against, or the figure has no supported plot for `holo(fig)`
to introspect (zero-config on an empty `Axis3` renders the canvas but nothing is interactive
— that's expected, not a bug).
**Fix:** check the `WGLMakie` compat bound in `Project.toml`; confirm the figure actually has
a plot call in it before `holo(fig)`.
