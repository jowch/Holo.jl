# Every non-public Makie internal Holo relies on is called through exactly one of the
# accessors below — a Makie bump that moves one of these surfaces as ONE clear error here,
# not a scattered wrong-pixel or MethodError somewhere downstream. See test/makie_compat_tests.jl
# (the canary) and CLAUDE.md's Makie-robustness note.

const _MAKIE_SHAPE_ERRORS = Union{MethodError, UndefVarError, ErrorException}

_makie_compat_error(name, expected) = error(
    "Holo: Makie internal `$(name)` changed shape under Makie v$(pkgversion(Makie)) — " *
        "expected $(expected); please open an issue"
)

# `converted[]` is a plot's post-conversion argument tuple (dodge/stack/width/etc. already
# applied) — Makie keeps it "for backwards compatibility" but ships no public replacement in 0.24.
function _converted(p)
    try
        return p.converted[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("converted", "a plot to expose `.converted[]`")
    end
end

# `.plots` is a plot's (or a Scene's) child-plot list — how Holo reads recipe-drawn geometry
# (e.g. BarPlot's laid-out rects, a Text's rendered glyphs); no public child-plot API exists.
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

# `ax.finallimits[]` is the axis's post-layout data limits — needed post-`_finalize!` for
# geometry that spans the full axis (HLines/VLines/HSpan/VSpan); no public equivalent.
function _finallimits(ax)
    fl = try
        ax.finallimits[]
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("finallimits", "an Axis to expose `.finallimits[]`")
    end
    fl isa Makie.Rect2 || return _makie_compat_error("finallimits", "`.finallimits[]` to be a `Rect2`")
    return fl
end

# `scene.viewport[]` is the pixel rectangle a scene occupies in the figure — the geometric
# basis for every image-px coordinate Holo emits; no public equivalent.
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

# `p.computed_levels[]` is Contourf's true (post-marching-squares) level edges — the child
# Poly's `color` only gives band midpoints, so there's no public way to recover the edges.
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

# `cb.layoutobservables.computedbbox[]` is a Colorbar's laid-out pixel bbox — the only way to
# get its on-screen geometry (Colorbar has no public bbox accessor).
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

# `Makie.string_boundingboxes` is unexported but docstring'd — the only way to get Text's
# per-string cached pixel boxes (needed for click-to-pick hit rects).
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

# `Makie.transform_func(scene)` returns the scene's data-transform closure (e.g. log10 on a
# log axis) — no public accessor exists; needed to feed `_apply_transform` before projecting.
function _transform_func(scene)
    try
        return Makie.transform_func(scene)
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("transform_func", "`Makie.transform_func(scene)` to return the scene's transform closure")
    end
end

# `Makie.apply_transform(f, pt)` applies that closure to a point — semi-public, no better
# alternative; DomainError (out-of-domain, e.g. log10 of a negative) is a caller-handled
# degrade-to-non-finite case, not a shape change, so it is never rewrapped here.
function _apply_transform(f, pt)
    try
        return Makie.apply_transform(f, pt)
    catch e
        e isa DomainError && rethrow()
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("apply_transform", "`Makie.apply_transform(f, pt)` to accept a transform closure and a point")
    end
end

# `Makie.project(scene, pt)` is the low-level data(transformed)->pixel projector every
# coordinate Holo emits goes through; no public wrapper exists at this level.
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

# `Makie.update_state_before_display!(fig)` is the finalize step Makie itself runs at
# display/save time — semi-public, no better alternative for finalizing layout before hitlayers.
function _finalize!(fig)
    try
        Makie.update_state_before_display!(fig)
    catch e
        e isa _MAKIE_SHAPE_ERRORS || rethrow()
        return _makie_compat_error("update_state_before_display!", "`Makie.update_state_before_display!(fig)` to finalize layout")
    end
    return nothing
end
