# Struct-field reads throw FieldError on Julia >= 1.12, ErrorException on 1.10/1.11; plot
# attribute access (a Dict lookup) throws KeyError when the attribute is gone, any version.
const _MAKIE_SHAPE_ERRORS = @static if isdefined(Base, :FieldError)
    Union{MethodError, UndefVarError, ErrorException, KeyError, FieldError}
else
    Union{MethodError, UndefVarError, ErrorException, KeyError}
end

# Narrower union for accessors that run arbitrary downstream code (user callbacks, other
# plots' recipes): excludes ErrorException so a real `error(...)` from that code isn't
# re-headlined as a Makie compat break.
const _MAKIE_DOWNSTREAM_ERRORS = @static if isdefined(Base, :FieldError)
    Union{MethodError, UndefVarError, KeyError, FieldError}
else
    Union{MethodError, UndefVarError, KeyError}
end

_makie_compat_error(name, expected) = error(
    "Masque: Makie internal `$(name)` changed shape under Makie v$(pkgversion(Makie)) — " *
        "expected $(expected); please open an issue"
)

# Wraps `p.converted[]`; no public replacement ships in Makie 0.24.
function _converted(p)
    try
        return p.converted[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("converted", "a plot to expose `.converted[]`")
    end
end

# Wraps `.plots`, a plot/Scene's child-plot list; no public child-plot API exists.
function _child_plots(p)
    plots = try
        p.plots
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("plots", "a plot or Scene to expose `.plots`")
    end
    plots isa AbstractVector || return _makie_compat_error("plots", "`.plots` to be a Vector of child plots")
    return plots
end

# Wraps `ax.finallimits[]`, the axis's post-layout data limits; no public equivalent.
function _finallimits(ax)
    fl = try
        ax.finallimits[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("finallimits", "an Axis to expose `.finallimits[]`")
    end
    # Axis3.finallimits is a Rect3d, not a Rect2; accept any-dimension Rect.
    fl isa Makie.Rect || return _makie_compat_error("finallimits", "`.finallimits[]` to be a `Rect`")
    return fl
end

# Wraps `scene.viewport[]`, the pixel rectangle a scene occupies; no public equivalent.
function _scene_viewport(scene_or_ax)
    vp = try
        scene = scene_or_ax isa Makie.Scene ? scene_or_ax : scene_or_ax.scene
        scene.viewport[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("viewport", "a Scene (or an object with one) to expose `.viewport[]`")
    end
    vp isa Makie.Rect2 || return _makie_compat_error("viewport", "`.viewport[]` to be a `Rect2`")
    return vp
end

# Wraps `p.computed_levels[]`, Contourf's true level edges; no public way to recover them.
function _computed_levels(p)
    lv = try
        p.computed_levels[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("computed_levels", "a Contourf to expose `.computed_levels[]`")
    end
    lv isa AbstractVector || return _makie_compat_error("computed_levels", "`.computed_levels[]` to be a Vector")
    return lv
end

# Wraps `cb.layoutobservables.computedbbox[]`; Colorbar has no public bbox accessor.
function _colorbar_bbox(cb)
    bb = try
        cb.layoutobservables.computedbbox[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("computedbbox", "a Colorbar to expose `.layoutobservables.computedbbox[]`")
    end
    bb isa Makie.Rect2 || return _makie_compat_error("computedbbox", "`.computedbbox[]` to be a `Rect2`")
    return bb
end

# Wraps `Makie.string_boundingboxes`, unexported but docstring'd; the only way to get Text's boxes.
function _string_bboxes(p)
    boxes = try
        Makie.string_boundingboxes(p)
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("string_boundingboxes", "`Makie.string_boundingboxes(text_plot)` to return a Vector of boxes")
    end
    boxes isa AbstractVector || return _makie_compat_error("string_boundingboxes", "`string_boundingboxes` to return a Vector")
    return boxes
end

# Wraps `Makie.transform_func(scene)`, the scene's data-transform closure; no public accessor exists.
function _transform_func(scene)
    try
        return Makie.transform_func(scene)
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("transform_func", "`Makie.transform_func(scene)` to return the scene's transform closure")
    end
end

# Wraps `Makie.apply_transform`, semi-public with no better alternative; DomainError is not a
# shape error and is never rewrapped here — callers degrade it to a non-finite point.
function _apply_transform(f, pt)
    try
        return Makie.apply_transform(f, pt)
    catch e
        e isa DomainError && rethrow()
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("apply_transform", "`Makie.apply_transform(f, pt)` to accept a transform closure and a point")
    end
end

# Wraps `Makie.project`, the low-level data(transformed)->pixel projector; no public wrapper exists.
function _project_px(scene, pt)
    q = try
        Makie.project(scene, pt)
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("project", "`Makie.project(scene, pt)` to return a projected point")
    end
    q isa Makie.VecTypes || return _makie_compat_error("project", "`Makie.project` to return a point-like value")
    return q
end

# Wraps `Makie.update_state_before_display!`, the finalize step Makie runs at display/save time.
# Runs user observable callbacks, so it uses the DOWNSTREAM union: a real error from user code
# must propagate as-is, not get re-headlined as a Makie compat break.
function _finalize!(fig)
    try
        Makie.update_state_before_display!(fig)
    catch e
        e isa _MAKIE_DOWNSTREAM_ERRORS || rethrow()
        return _makie_compat_error("update_state_before_display!", "`Makie.update_state_before_display!(fig)` to finalize layout")
    end
    return nothing
end

# Wraps `p.scaled_color[]`, ComputePipeline's colour value(s) after `colorscale` is applied but
# before the colormap lookup — same domain as `_scaled_colorrange`. Only called for a plot whose
# `color[]` is already known numeric (Masque.jl's own check), so a KeyError here means Scatter
# stopped exposing this node, a real compat break; no public accessor exists.
function _scaled_color(p)
    v = try
        p.scaled_color[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("scaled_color", "a plot to expose `.scaled_color[]`")
    end
    return v
end

# Wraps `p.scaled_colorrange[]`, the resolved (possibly auto-computed) colour range in the same
# scaled domain as `_scaled_color`; no public accessor exists.
function _scaled_colorrange(p)
    v = try
        p.scaled_colorrange[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("scaled_colorrange", "a plot to expose `.scaled_colorrange[]`")
    end
    return v
end

# Wraps `p.raw_colormap[]`, the plot's colormap resolved to a dense `Vector{RGBAf}` sample; no
# public accessor for the *resolved* form exists (`p.colormap[]` is the unresolved Symbol/spec).
function _raw_colormap(p)
    v = try
        p.raw_colormap[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("raw_colormap", "a plot to expose `.raw_colormap[]`")
    end
    return v
end

# Wraps `leg.layoutobservables.computedbbox[]`; same private path as `_colorbar_bbox`, just a
# different Block type — kept separate so the error message names the right one.
function _legend_bbox(leg)
    bb = try
        leg.layoutobservables.computedbbox[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("computedbbox", "a Legend to expose `.layoutobservables.computedbbox[]`")
    end
    bb isa Makie.Rect2 || return _makie_compat_error("computedbbox", "a Legend's `.computedbbox[]` to be a `Rect2`")
    return bb
end

# Recursive GridLayoutBase walk collecting each entry row's pixel bbox: per entry, Makie lays
# out a patch Box (1 col), a Label (1 col), a shade Box (2 cols) and a halfshade Box (2 cols,
# identical bbox) — the 2-col shade Box's bbox is the row Makie's own click-to-toggle hits.
# Grouped (titled) legends nest each group's entries in their own GridLayout; ungrouped legends
# lay entries directly in `leg.grid` — recursing (rather than assuming one fixed depth) covers
# both without a special case. Multi-bank legends (`nbanks > 1`) place each bank's entries in
# its own column pair (bank 2's shade spans cols 3:4, bank 3's 5:6, …), so the span check is
# WIDTH (`length(...) == 2`), not a fixed `(1:2)` — the patch Box and every Label always span
# exactly 1 column (in both vertical and horizontal orientation), so this stays unambiguous.
function _walk_legend_grid!(boxes, seen, grid)
    for gc in grid.content
        c = gc.content
        if c isa Makie.GridLayout
            _walk_legend_grid!(boxes, seen, c)
        elseif c isa Makie.Box && length(gc.span.cols) == 2
            bb = c.layoutobservables.computedbbox[]
            key = (Float64(bb.origin[1]), Float64(bb.origin[2]), Float64(bb.widths[1]), Float64(bb.widths[2]))
            key in seen && continue
            push!(seen, key)
            push!(boxes, bb)
        end
    end
    return boxes
end

# One deduped bbox per legend entry, in entry order (top-to-bottom, matching `entrygroups[]`
# flattened). No public per-entry bbox accessor exists; this is what Makie's own click-to-hide
# hit-test walks.
function _legend_entry_boxes(leg)
    try
        boxes = Any[]
        seen = Set{NTuple{4, Float64}}()
        _walk_legend_grid!(boxes, seen, leg.grid)
        return boxes
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error(
            "grid",
            "a Legend's `.grid` to expose per-entry 2-column `Box`es via GridLayoutBase's `.content`/`.span`"
        )
    end
end

# Wraps `leg.entrygroups[]` into a flat, entry-ordered Vector of `(; group, label, plots,
# elements)` — everything a `LegendInteractable` needs to resolve `targets` and accent colour,
# available BEFORE render (unlike `_legend_entries` below, entrygroups/labels/elements don't
# depend on layout). `group` is the entrygroup's title (`nothing` for an ungrouped/default
# legend). `plots` is the union (order preserving) of `Makie.get_plots(el)` over every element
# of the entry — empty for a custom `LegendElement` built without `plots=`.
function _legend_entries_meta(leg)
    entrygroups = try
        leg.entrygroups[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("entrygroups", "a Legend to expose `.entrygroups[]`")
    end
    entrygroups isa AbstractVector || return _makie_compat_error("entrygroups", "`.entrygroups[]` to be a Vector")

    out = NamedTuple[]
    for (title, entries) in entrygroups
        group = title === nothing ? nothing : String(title)
        for e in entries
            # `String(lbl)` itself must run OUTSIDE the compat try/catch: `_MAKIE_SHAPE_ERRORS`
            # includes MethodError, so a non-`AbstractString` label (e.g. `Makie.rich(...)`,
            # a `Makie.RichText`) would otherwise be misreported as a Makie compat break rather
            # than converted via `string(...)` like any other label value.
            lbl = try
                e.label[]
            catch err
                err isa _MAKIE_SHAPE_ERRORS || rethrow()
                return _makie_compat_error("label", "a LegendEntry to expose `.label[]`")
            end
            label = lbl isa AbstractString ? String(lbl) : string(lbl)
            elements = try
                e.elements
            catch err
                err isa _MAKIE_SHAPE_ERRORS || rethrow()
                return _makie_compat_error("elements", "a LegendEntry to expose `.elements`")
            end
            plots = try
                ps = Any[]
                for el in elements
                    append!(ps, Makie.get_plots(el))
                end
                ps
            catch err
                err isa _MAKIE_SHAPE_ERRORS || rethrow()
                return _makie_compat_error("get_plots", "`Makie.get_plots(element)` to return a Vector of plots")
            end
            push!(out, (; group, label, plots, elements))
        end
    end
    return out
end

# `_legend_entries_meta(leg)` plus each entry's pixel bbox (only valid after render — see
# `_legend_entry_boxes`) — the shape `hitlayers(::LegendInteractable, ctx)` builds one `:rects`
# element from.
function _legend_entries(leg)
    meta = _legend_entries_meta(leg)
    boxes = _legend_entry_boxes(leg)
    length(boxes) == length(meta) || return _makie_compat_error(
        "grid",
        "the number of 2-column entry `Box`es ($(length(boxes))) to match the number of legend entries " *
            "($(length(meta))) under Makie v$(pkgversion(Makie))"
    )
    return [merge(m, (; bbox = boxes[k])) for (k, m) in enumerate(meta)]
end
