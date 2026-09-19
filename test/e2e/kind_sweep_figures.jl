# Shared figures for the agent kind-sweep notebooks (Cairo / WGL).
# Each widget is one interactable kind (interaction + visual). `selected=` is baked only
# on supported kinds (`circles`, `rects`, `polygons`, `segments`, `polyline`). `circle` marks a
# kind whose highlight is a circle, so the driver checks r == geometry r (no halo offset).
# Grid / threshold / roi / view are hover-click or drag only. `scatter_dark` is a dark
# Makie figure so the split-blend recipe (dodge fill both figures, multiply/screen edge stroke
# on light/dark) is live-checked on dark axes too; `scatter` and `scatter_dark` are built from
# the scatter plot object (not raw points) so `colors` resolves and the tooltip-accent check has
# something to derive from.
#
# `selectedIndex`/`tip` are the BAKED-selected element (where `selected` isn't `nothing`) — used
# for the persisted-wash / selected-survives-unhover checks. `hoverIndex`/`hoverTip` are a
# DIFFERENT element for the standard hover-recipe check: hovering an already-selected mark draws
# no highlight (see CLAUDE.md), so a kind with a baked selection needs its own, distinct hover
# target to exercise the normal recipe at all. Where nothing is baked, `hoverIndex`/`hoverTip`
# just repeat `selectedIndex`/`tip`. `tintIndex` (only set where it must differ) is the element
# the screenshot-based tint-applied check hovers — for `heatmap` this steers off `selectedIndex`'s
# cell (viridis' darkest, where a dodge brightening is hardest to measure) onto a brighter one.

kind_sweep_meta() = [
    Dict(
        "key" => "scatter", "layerId" => "scatter", "layerKind" => "circles",
        "selected" => "wash", "circle" => true, "selectedIndex" => 1, "clickIndex" => 0,
        "tip" => "beta", "hoverIndex" => 0, "hoverTip" => "alpha", "mode" => "element",
    ),
    Dict(
        "key" => "lines", "layerId" => "lines", "layerKind" => "polyline",
        "selected" => "ring", "circle" => false, "selectedIndex" => 1, "clickIndex" => 0,
        "tip" => "seg-b", "hoverIndex" => 0, "hoverTip" => "seg-a", "mode" => "element",
    ),
    Dict(
        "key" => "segments", "layerId" => "segments", "layerKind" => "segments",
        "selected" => "ring", "circle" => false, "selectedIndex" => 0, "clickIndex" => 1,
        "tip" => "pair-a", "hoverIndex" => 1, "hoverTip" => "pair-b", "mode" => "element",
    ),
    Dict(
        "key" => "heatmap", "layerId" => "cells", "layerKind" => "grid",
        "selected" => nothing, "circle" => false, "selectedIndex" => 0, "clickIndex" => 0,
        "tip" => "0,0", "hoverIndex" => 0, "hoverTip" => "0,0", "tintIndex" => 11,
        "mode" => "element",
    ),
    Dict(
        "key" => "image", "layerId" => "cells", "layerKind" => "grid",
        "selected" => nothing, "circle" => false, "selectedIndex" => 0, "clickIndex" => 0,
        "tip" => "0,0", "hoverIndex" => 0, "hoverTip" => "0,0", "mode" => "element",
    ),
    Dict(
        "key" => "barplot", "layerId" => "bars", "layerKind" => "rects",
        "selected" => "wash", "circle" => false, "selectedIndex" => 1, "clickIndex" => 0,
        "tip" => "value", "hoverIndex" => 0, "hoverTip" => "value", "mode" => "element",
    ),
    Dict(
        "key" => "poly", "layerId" => "poly", "layerKind" => "polygons",
        "selected" => "wash", "circle" => false, "selectedIndex" => 0, "clickIndex" => 1,
        "tip" => "ring1", "hoverIndex" => 1, "hoverTip" => "ring2", "mode" => "element",
    ),
    Dict(
        "key" => "polar", "layerId" => "polar", "layerKind" => "circles",
        "selected" => "wash", "circle" => true, "selectedIndex" => 1, "clickIndex" => 0,
        "tip" => "north", "hoverIndex" => 0, "hoverTip" => "east", "mode" => "element",
    ),
    Dict(
        "key" => "scatter_dark", "layerId" => "scatter_dark", "layerKind" => "circles",
        "selected" => "wash", "circle" => true, "selectedIndex" => 1, "clickIndex" => 0,
        "tip" => "beta", "hoverIndex" => 0, "hoverTip" => "alpha", "mode" => "element",
    ),
    Dict(
        "key" => "arrows3d", "layerId" => "arrows3d", "layerKind" => "segments",
        "selected" => "ring", "circle" => false, "selectedIndex" => 0, "clickIndex" => 1,
        "tip" => "index", "hoverIndex" => 1, "hoverTip" => "index", "mode" => "element",
    ),
    Dict(
        "key" => "hlines", "layerId" => "hlines", "layerKind" => "segments",
        "selected" => "ring", "circle" => false, "selectedIndex" => 0, "clickIndex" => 1,
        "tip" => "segment_index", "hoverIndex" => 1, "hoverTip" => "segment_index",
        "mode" => "element",
    ),
    Dict(
        "key" => "threshold", "layerId" => "threshold", "layerKind" => "threshold",
        "selected" => nothing, "circle" => false, "selectedIndex" => 0, "clickIndex" => 0,
        "tip" => "", "hoverIndex" => 0, "hoverTip" => "", "mode" => "drag",
    ),
    Dict(
        "key" => "roi", "layerId" => "roi", "layerKind" => "roi",
        "selected" => nothing, "circle" => false, "selectedIndex" => 0, "clickIndex" => 0,
        "tip" => "", "hoverIndex" => 0, "hoverTip" => "", "mode" => "drag",
    ),
    Dict(
        "key" => "view", "layerId" => "view", "layerKind" => "view",
        "selected" => nothing, "circle" => false, "selectedIndex" => 0, "clickIndex" => 0,
        "tip" => "", "hoverIndex" => 0, "hoverTip" => "", "mode" => "drag",
    ),
]

function build_kind_sweep()
    scatter = let
        pts = [(1.0, 1.0), (2.0, 2.0), (3.0, 1.2)]
        fig = Figure(size = (480, 260))
        ax = Axis(fig[1, 1]; title = "scatter")
        # Built from the plot object (not raw pts) so PointInteractable resolves `colors` from
        # `color=` — the mark-colour-derivation check needs a resolvable mark colour.
        sc = scatter!(ax, first.(pts), last.(pts); color = :gray, markersize = 22)
        masque(
            fig,
            PointInteractable(
                ax, sc; id = :scatter,
                payloads = [(; label = "alpha"), (; label = "beta"), (; label = "gamma")],
            );
            selected = Dict(:scatter => [1]),
        )
    end

    lines = let
        verts = [(0.0, 0.0), (1.0, 1.5), (2.0, 0.4), (3.0, 1.8)]
        fig = Figure(size = (480, 260))
        ax = Axis(fig[1, 1]; title = "lines")
        lines!(ax, first.(verts), last.(verts); color = :gray, linewidth = 4)
        masque(
            fig,
            SegmentInteractable(
                ax, verts; id = :lines, mode = :polyline,
                payloads = [(; label = "seg-a"), (; label = "seg-b"), (; label = "seg-c")],
            );
            selected = Dict(:lines => [1]),
        )
    end

    segments = let
        fig = Figure(size = (480, 260))
        ax = Axis(fig[1, 1]; title = "linesegments", limits = (0, 5, 0, 4))
        linesegments!(ax, [1.0, 2.0, 3.0, 4.0], [1.0, 3.0, 2.0, 0.6]; color = :gray, linewidth = 4)
        masque(
            fig,
            SegmentInteractable(
                ax, [(1.0, 1.0), (2.0, 3.0), (3.0, 2.0), (4.0, 0.6)];
                id = :segments, mode = :pairs,
                payloads = [(; label = "pair-a"), (; label = "pair-b")],
            );
            selected = Dict(:segments => [0]),
        )
    end

    heatmap = let
        z = [Float64(i + 3j) for i in 1:4, j in 1:3]
        fig = Figure(size = (480, 260))
        ax = Axis(fig[1, 1]; title = "heatmap")
        heatmap!(ax, 1:4, 1:3, z)
        masque(fig)
    end

    image = let
        z = [Float64(i + j) for i in 1:4, j in 1:3]
        fig = Figure(size = (480, 260))
        ax = Axis(fig[1, 1]; title = "image")
        image!(ax, (0.5, 4.5), (0.5, 3.5), z)
        masque(fig)
    end

    barplot = let
        fig = Figure(size = (480, 260))
        ax = Axis(fig[1, 1]; title = "barplot")
        barplot!(ax, 1:3, [2.0, 3.5, 1.5]; color = :gray)
        masque(fig; selected = Dict(:bars => [1]))
    end

    poly = let
        rings = [
            [(0.5, 0.5), (2.0, 0.7), (1.5, 2.0), (0.6, 1.8)],
            [(2.8, 0.8), (4.2, 1.0), (4.0, 2.4), (2.9, 2.2)],
        ]
        fig = Figure(size = (480, 260))
        ax = Axis(fig[1, 1]; title = "poly", limits = (0, 4.8, 0, 3.0))
        poly!(ax, Point2f.(rings[1]); color = (:orchid, 0.55), strokewidth = 2)
        poly!(ax, Point2f.(rings[2]); color = (:goldenrod, 0.55), strokewidth = 2)
        masque(
            fig,
            PolygonInteractable(
                ax, rings; id = :poly,
                payloads = [(; shape = "ring1"), (; shape = "ring2")],
            );
            selected = Dict(:poly => [0]),
        )
    end

    polar = let
        pts = Point2f[(0.0, 1.0), (π / 2, 2.0), (π, 1.5), (3π / 2, 2.5)]
        fig = Figure(size = (480, 320))
        ax = PolarAxis(fig[1, 1])
        scatter!(ax, pts; color = :gray, markersize = 22)
        masque(
            fig,
            PointInteractable(
                ax, pts; id = :polar,
                payloads = [(; label = "east"), (; label = "north"), (; label = "west"), (; label = "south")],
            );
            selected = Dict(:polar => [1]),
        )
    end

    scatter_dark = let
        pts = [(1.0, 1.0), (2.0, 2.0), (3.0, 1.2)]
        fig = Figure(size = (480, 260); backgroundcolor = :gray12)
        ax = Axis(
            fig[1, 1];
            title = "scatter-dark",
            backgroundcolor = :gray20,
            xtickcolor = :gray80,
            ytickcolor = :gray80,
            titlecolor = :gray90,
        )
        sc = scatter!(ax, first.(pts), last.(pts); color = :gray, markersize = 22)
        masque(
            fig,
            PointInteractable(
                ax, sc; id = :scatter_dark,
                payloads = [(; label = "alpha"), (; label = "beta"), (; label = "gamma")],
            );
            selected = Dict(:scatter_dark => [1]),
        )
    end

    arrows3d = let
        fig = Figure(size = (480, 320))
        ax = Axis3(fig[1, 1]; azimuth = 0.4, elevation = 0.5, title = "arrows3d")
        apts = Makie.Point3f[(1, 1, 1), (3, 2, 1), (2, 4, 3)]
        adirs = Makie.Vec3f[(1, 0, 0), (0, 1, 0.5), (-0.5, 0, 1)]
        arrows3d!(ax, apts, adirs; color = :gray)
        masque(fig; selected = Dict(:arrows3d => [0]))
    end

    hlines = let
        fig = Figure(size = (480, 260))
        ax = Axis(fig[1, 1]; title = "hlines", limits = (0, 5, 0, 5))
        scatter!(ax, [1.0, 4.0], [1.0, 4.0]; markersize = 8, color = :gray)
        hlines!(ax, [1.5, 3.5]; color = :gray, linewidth = 3)
        vlines!(ax, [2.5]; color = :gray, linewidth = 3)
        masque(fig; selected = Dict(:hlines => [0]))
    end

    threshold = let
        fig = Figure(size = (480, 260))
        ax = Axis(fig[1, 1]; title = "threshold", limits = (0, 10, 0, 10))
        scatter!(ax, [2.0, 8.0], [2.0, 8.0]; markersize = 10, color = :gray)
        masque(fig, ThresholdInteractable(ax; orientation = :horizontal, value = 4.0, id = :threshold))
    end

    roi = let
        pts = [(1.0, 1.0), (3.0, 3.0), (5.0, 5.0), (7.0, 7.0), (9.0, 9.0)]
        fig = Figure(size = (480, 260))
        ax = Axis(fig[1, 1]; title = "roi", limits = (0, 10, 0, 10))
        scatter!(ax, first.(pts), last.(pts); markersize = 14, color = :gray)
        masque(
            fig,
            [
                PointInteractable(ax, pts; id = :pts),
                ROIInteractable(ax; bounds = (2.0, 6.0, 2.0, 6.0), selects = :pts, id = :roi),
            ],
        )
    end

    view = let
        pts = [(1.0, 1.0), (7.0, 1.0), (1.0, 7.0), (7.0, 7.0)]
        fig = Figure(size = (480, 260))
        ax = Axis(fig[1, 1]; title = "view-pan", limits = (0, 8, 0, 8))
        scatter!(ax, first.(pts), last.(pts); markersize = 14, color = :gray)
        masque(fig, [PointInteractable(ax, pts; id = :pts), ViewInteractable(ax; id = :view)])
    end

    return (;
        scatter, lines, segments, heatmap, image, barplot, poly,
        polar, scatter_dark, arrows3d, hlines, threshold, roi, view,
    )
end
