# Canary for src/makie_compat.jl (and the WGL-only compat block in
# ext/MasqueWGLMakieExt.jl, exercised separately in test/webgl_ext_tests.jl's "version-coupling
# guard"). Runs FIRST in the Core group so a Makie internal that changed shape fails loudly
# here, at the accessor, rather than as a scattered downstream MethodError/wrong-pixel bug.
# Asserts the actual return TYPE/SHAPE each accessor's caller relies on, not just `isdefined`.

@testset "makie_compat: accessors hold their shape (Makie v$(pkgversion(Makie)))" begin
    fig = Figure(; size = (600, 400))
    ax = Axis(fig[1, 1])
    sc = scatter!(ax, [1.0, 2.0, 3.0], [1.0, 4.0, 9.0])
    ln = lines!(ax, [1.0, 2.0, 3.0], [1.0, 2.0, 3.0])
    hm = heatmap!(ax, 1:4, 1:5, [Float64(i + 3j) for i in 1:4, j in 1:5])
    hl = hlines!(ax, [2.0])
    cf = contourf!(ax, 1:4, 1:5, [Float64(i + 3j) for i in 1:4, j in 1:5])
    tx = text!(ax, [1.0, 2.0], [1.0, 2.0]; text = ["a", "bb"])
    cb = Colorbar(fig[1, 2], hm)
    ax3 = Axis3(fig[2, 1:2])
    sc3 = scatter!(ax3, Makie.Point3f[(1, 2, 3), (4, 5, 6)])
    scc = scatter!(ax, [1.0, 2.0, 3.0], [3.0, 2.0, 1.0]; color = [1.0, 2.0, 3.0], colormap = :viridis)

    Masque._finalize!(fig)   # exercises _finalize!; everything below needs a finalized layout

    @testset "_converted" begin
        @test Masque._converted(sc) isa Tuple
        @test Masque._converted(ln) isa Tuple
        @test Masque._converted(hm) isa Tuple
        @test Masque._converted(sc3) isa Tuple
    end

    @testset "_child_plots" begin
        top = Masque._child_plots(ax.scene)
        @test top isa AbstractVector
        @test sc in top && ln in top && hm in top

        # a compound recipe (Contourf) always has at least one drawn child (the filled Poly)
        cf_children = Masque._child_plots(cf)
        @test cf_children isa AbstractVector
        @test !isempty(cf_children)

        # a leaf plot (Scatter draws no children of its own) has an empty, not missing, list
        @test isempty(Masque._child_plots(sc))
    end

    @testset "_finallimits" begin
        fl = Masque._finallimits(ax)
        @test fl isa Makie.Rect2
        @test all(isfinite, fl.origin) && all(>=(0), fl.widths)
    end

    @testset "_scene_viewport" begin
        vp = Masque._scene_viewport(ax)
        @test vp isa Makie.Rect2
        @test vp.widths[1] > 0 && vp.widths[2] > 0
        # accepts a bare Scene too, not just an Axis
        @test Masque._scene_viewport(ax.scene) == vp
    end

    @testset "_computed_levels" begin
        edges = Masque._computed_levels(cf)
        @test edges isa AbstractVector
        @test length(edges) >= 2
        @test all(x -> x isa Real, edges)
    end

    @testset "_colorbar_bbox" begin
        bb = Masque._colorbar_bbox(cb)
        @test bb isa Makie.Rect2
        @test bb.widths[1] > 0 && bb.widths[2] > 0
    end

    @testset "_string_bboxes" begin
        boxes = Masque._string_bboxes(tx)
        @test boxes isa AbstractVector
        @test length(boxes) == 2   # one per string ("a", "bb")
    end

    @testset "_transform_func + _apply_transform + _project_px (the projection chain)" begin
        tf = Masque._transform_func(ax.scene)
        pt = Makie.Point3(1.0, 2.0, 0.0)
        tp = Masque._apply_transform(tf, pt)
        @test length(tp) == 3
        @test all(isfinite, tp)
        q = Masque._project_px(ax.scene, tp)
        @test q isa Makie.VecTypes
        @test length(q) >= 2
        @test all(isfinite, q)

        # same chain on Axis3 (3D camera projection)
        tf3 = Masque._transform_func(ax3.scene)
        tp3 = Masque._apply_transform(tf3, Makie.Point3(1.0, 2.0, 3.0))
        q3 = Masque._project_px(ax3.scene, tp3)
        @test q3 isa Makie.VecTypes
    end

    @testset "_scaled_color + _scaled_colorrange + _raw_colormap" begin
        vals = Masque._scaled_color(scc)
        @test vals isa AbstractVector && length(vals) == 3
        lo, hi = Masque._scaled_colorrange(scc)
        @test lo <= minimum(vals) && maximum(vals) <= hi
        cmap = Masque._raw_colormap(scc)
        @test cmap isa AbstractVector{<:Makie.RGBAf} && length(cmap) > 2
    end

    @testset "_finalize! is idempotent" begin
        @test Masque._finalize!(fig) === nothing
        @test fig.scene.viewport[] isa Makie.Rect2   # actually re-ran layout, not a no-op
    end

    # Negative path: a moved/renamed internal must produce the Masque compat message, not a
    # raw MethodError/FieldError/KeyError — this is the behavior the accessors exist to add,
    # and the gap that let a too-narrow _MAKIE_SHAPE_ERRORS ship once already (a Julia 1.12
    # FieldError and a plot-attribute KeyError both escaped unwrapped before that fix).
    @testset "accessors rewrap a moved internal" begin
        @test_throws r"^Masque: Makie internal `converted`" Masque._converted(nothing)
        @test_throws r"^Masque: Makie internal `plots`" Masque._child_plots(nothing)
        @test_throws r"^Masque: Makie internal `finallimits`" Masque._finallimits(nothing)
        @test_throws r"^Masque: Makie internal `viewport`" Masque._scene_viewport(nothing)
        @test_throws r"^Masque: Makie internal `computed_levels`" Masque._computed_levels(sc)   # KeyError path (missing attribute)
        @test_throws r"^Masque: Makie internal `computedbbox`" Masque._colorbar_bbox(nothing)
        @test_throws r"^Masque: Makie internal `string_boundingboxes`" Masque._string_bboxes(nothing)
        @test_throws r"^Masque: Makie internal `transform_func`" Masque._transform_func(nothing)
        @test_throws r"^Masque: Makie internal `project`" Masque._project_px(nothing, Makie.Point3(0.0, 0.0, 0.0))
        @test_throws DomainError Masque._apply_transform(log10, Makie.Point3(-1.0, 1.0, 0.0))   # pass-through preserved
        @test_throws r"^Masque: Makie internal `scaled_color`" Masque._scaled_color(nothing)
        @test_throws r"^Masque: Makie internal `scaled_colorrange`" Masque._scaled_colorrange(nothing)
        @test_throws r"^Masque: Makie internal `raw_colormap`" Masque._raw_colormap(nothing)
    end

    # _finalize! must NOT rewrap an error raised by the user's own observable callback as a
    # Makie compat break — regression test for the _MAKIE_DOWNSTREAM_ERRORS split.
    @testset "_finalize! lets a user callback error through unrewrapped" begin
        fig2 = Figure(; size = (200, 150))
        ax2 = Axis(fig2[1, 1])
        scatter!(ax2, [1.0], [1.0])
        on(ax2.finallimits) do _
            error("USER CALLBACK BOOM")
        end
        @test_throws "USER CALLBACK BOOM" Masque._finalize!(fig2)
    end
end
