using Holo
using Holo: hitlayers, validate, HitLayer, build_manifest, HoloWidget
import Holo as IP
using CairoMakie
import Makie
using Test

# finalize + context the way holo does internally
function ctx_for(fig; max_width = 700)
    bk = CairoBackend(; max_width)
    Makie.update_state_before_display!(fig)
    ppu = IP._ppu(bk, fig)
    return bk, ppu, IP.context(bk, fig, ppu)
end

function drawn_near(img, cx, cy; tol = 8)
    ih, iw = size(img)
    notwhite(c) = !(Float64(Makie.red(c)) > 0.95 && Float64(Makie.green(c)) > 0.95 && Float64(Makie.blue(c)) > 0.95)
    x, y = round(Int, cx), round(Int, cy)
    for dy in -tol:tol, dx in -tol:tol
        xx, yy = x + dx, y + dy
        (1 <= xx <= iw && 1 <= yy <= ih) || continue
        notwhite(img[yy, xx]) && return true
    end
    return false
end

@testset "Holo" begin
    pts = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0)]
    fig = Figure(size = (600, 400)); ax = Axis(fig[1, 1])
    scatter!(ax, first.(pts), last.(pts); color = :red, markersize = 16)
    bk, ppu, ctx = ctx_for(fig)

    @testset "DPI from layout fact" begin
        @test ppu == 2.0                              # 600 ≤ 700 column → render at 2×
        @test ctx.scaling == 2.0
        # a figure wider than the column renders at ~2× the column, not 2× itself
        fw = Figure(size = (1400, 400)); Axis(fw[1, 1])
        _, ppw, _ = ctx_for(fw)
        @test ppw == 2 * 700 / 1400                   # = 1.0  → output 1400 px = 2× column
    end

    @testset "context / transforms" begin
        t = ctx.transforms[:ax1]
        @test t.xscale == :identity && t.yscale == :identity
        @test t.viewport[3] > 0 && t.viewport[4] > 0
        @test t.xcats === nothing
    end

    @testset "categorical axis ships a category map" begin
        fc = Figure(); axc = Axis(fc[1, 1]; dim1_conversion = Makie.CategoricalConversion())
        scatter!(axc, ["a", "b", "c"], [1.0, 2.0, 3.0])
        _, _, ctxc = ctx_for(fc)
        @test ctxc.transforms[:ax1].xcats == ["a", "b", "c"]
    end

    @testset "PointInteractable lands on markers" begin
        pin = PointInteractable(ax, pts; id = :scatter)
        @test validate(pin, ctx) === nothing
        L = only(hitlayers(pin, ctx))
        @test L.kind === :circles && length(L.geometry) == 9
        img = Makie.colorbuffer(fig; px_per_unit = ppu)
        for k in 0:2
            @test drawn_near(img, L.geometry[3k + 1], L.geometry[3k + 2])
        end
    end

    @testset "validate is per-capability" begin
        fl = Figure(); axl = Axis(fl[1, 1]; xscale = sqrt)   # sqrt: not JS-invertible
        scatter!(axl, [1.0, 2.0, 3.0], [1.0, 2.0, 3.0])
        _, _, ctxl = ctx_for(fl)
        @test validate(PointInteractable(axl, pts), ctxl) === nothing    # element type: no gate
        @test validate(AxisInteractable(axl), ctxl) isa String          # axis readout: gated, fails loud
        fg = Figure(); axg = Axis(fg[1, 1]; yscale = log10); scatter!(axg, [1.0, 2.0], [1.0, 10.0])
        _, _, ctxg = ctx_for(fg)
        @test validate(AxisInteractable(axg), ctxg) === nothing          # log is invertible
    end

    @testset "RectInteractable grid is compact" begin
        fh = Figure(); axh = Axis(fh[1, 1]); z = rand(20, 30); heatmap!(axh, 1:20, 1:30, z)
        _, _, ctxh = ctx_for(fh)
        L = only(hitlayers(RectInteractable(axh; grid = (0.5:1:20.5, 0.5:1:30.5, z)), ctxh))
        @test L.kind === :grid
        @test L.geometry["ncols"] == 20 && L.geometry["nrows"] == 30
        @test length(L.geometry["xedges"]) == 21 && length(L.geometry["values"]) == 600
    end

    @testset "fail loud on unsupported axis types" begin
        for mk in (Makie.PolarAxis, Axis3, LScene)
            fu = Figure(); mk(fu[1, 1])
            err = (@test_throws ArgumentError ctx_for(fu)).value
            @test occursin("supports 2D `Makie.Axis` only", err.msg)
        end
    end

    @testset "Polygon geometry projects per ring" begin
        rings = [[(1.0, 1.0), (2.0, 4.0), (3.0, 1.0)], [(1.5, 2.0), (2.5, 2.0), (2.0, 3.0)]]
        L = only(hitlayers(PolygonInteractable(ax, rings; id = :poly), ctx))
        @test L.kind === :polygons && L.id === :poly
        @test length(L.geometry) == 2                       # two rings
        @test all(r -> length(r) == 6, L.geometry)          # 3 pts × (x,y) each
        @test [p.index for p in L.payloads] == [0, 1]       # default per-ring payloads
    end

    @testset "Segment + Axis + custom" begin
        @test only(hitlayers(SegmentInteractable(ax, pts; mode = :polyline), ctx)).kind === :polyline
        @test only(hitlayers(AxisInteractable(ax), ctx)).geometry === nothing
        ri = RegionInteractable(
            ax; regions = [(:circle, (1.0, 1.0), 10), (:rect, (2.0, 4.0), 1.0, 2.0)],
            payloads = ["a", "b"], tooltip = pl -> "tip:" * pl
        )
        @test Set(L.kind for L in hitlayers(ri, ctx)) == Set([:circles, :rects])
        @test IP.tooltip(ri, 1, "a") == "tip:a"
        fi = FunctionInteractable(c -> [HitLayer(:f, :circles, Float32[10, 10, 5], Any[(; v = 1)], :ax1, (:click,))])
        @test only(hitlayers(fi, ctx)).id === :f
    end

    @testset "build_manifest + widget + bond" begin
        m = build_manifest([PointInteractable(ax, pts; id = :scatter), AxisInteractable(ax)], ctx)
        @test [L["kind"] for L in m["layers"]] == ["circles", "axis"]
        @test haskey(m["transforms"], "ax1")

        # selection round-trip: pre-highlight indices ride the manifest keyed by layer id
        @test !haskey(m["layers"][1], "selected")                       # absent when unselected
        ms = build_manifest([PointInteractable(ax, pts; id = :scatter)], ctx; selected = Dict(:scatter => [0, 2]))
        @test ms["layers"][1]["selected"] == [0, 2]
        @test !haskey(
            build_manifest(
                [PointInteractable(ax, pts; id = :scatter)], ctx;
                selected = Dict(:scatter => Int[])
            )["layers"][1], "selected"
        )   # empty omitted
        @test holo(fig, PointInteractable(ax, pts; id = :scatter); selected = Dict(:scatter => [1])).manifest["layers"][1]["selected"] == [1]

        w = holo(fig, PointInteractable(ax, pts; id = :scatter))
        @test w isa HoloWidget
        @test w.manifest["layers"][1]["kind"] == "circles"
        @test !isempty(w.b64)
        @test w.display_css == 600

        @test IP.APD.Bonds.initial_value(w) === nothing
        @test IP.APD.Bonds.transform_value(w, nothing) === nothing
        ev = IP.APD.Bonds.transform_value(w, Dict("layer" => "scatter", "index" => 2, "payload" => Dict("i" => 2)))
        @test ev isa InteractionEvent && ev.layer === :scatter && ev.index == 2
    end

    @testset "M2.1 plot-introspection constructors" begin
        # An introspected interactable must produce the SAME hitlayers as the explicit one a
        # user would hand-write — introspection is sugar over M1, not a parallel path.
        geom(int, c) = (L = only(hitlayers(int, c)); (L.kind, L.geometry, length(L.payloads)))

        @testset "scatter -> Point" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            p = scatter!(a, [1.0, 2.0, 3.0], [1.0, 4.0, 9.0]; markersize = 20)
            _, _, c = ctx_for(f)
            # markersize=20 (diameter, :pixel) -> radius 10
            @test geom(PointInteractable(a, p), c) == geom(PointInteractable(a, p.converted[][1]; radius = 10), c)
            @test only(hitlayers(PointInteractable(a, p), c)).id === :scatter
            # geometry lands on a rendered marker
            g = only(hitlayers(PointInteractable(a, p), c)).geometry
            img = Makie.colorbuffer(f; px_per_unit = 2.0)
            @test drawn_near(img, g[1], g[2])
        end

        @testset "lines -> Segment(:polyline), linesegments -> (:pairs)" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            pl = lines!(a, [0.0, 1.0, 2.0, 3.0], [0.0, 2.0, 1.0, 3.0])
            ps = linesegments!(a, [Point2f(0, 0), Point2f(1, 1), Point2f(2, 0), Point2f(3, 1)])
            _, _, c = ctx_for(f)
            @test geom(SegmentInteractable(a, pl), c) == geom(SegmentInteractable(a, pl.converted[][1]; mode = :polyline), c)
            @test only(hitlayers(SegmentInteractable(a, pl), c)).kind === :polyline
            @test only(hitlayers(SegmentInteractable(a, ps), c)).kind === :segments
        end

        @testset "heatmap/image -> Rect(:grid), incl. EndPoints expansion" begin
            z = [Float64((i + j) % 5) for i in 1:4, j in 1:3]
            # explicit coords: Makie hands back full edge vectors
            f1 = Figure(size = (500, 350)); a1 = Axis(f1[1, 1]); p1 = heatmap!(a1, 1:4, 1:3, z)
            _, _, c1 = ctx_for(f1)
            @test geom(RectInteractable(a1, p1), c1) ==
                geom(RectInteractable(a1; grid = (collect(0.5:1:4.5), collect(0.5:1:3.5), z)), c1)
            # coordinate-free: converted gives EndPoints (length 2) -> we expand to n+1 edges
            f2 = Figure(size = (500, 350)); a2 = Axis(f2[1, 1]); p2 = heatmap!(a2, z)
            _, _, c2 = ctx_for(f2)
            @test geom(RectInteractable(a2, p2), c2) ==
                geom(RectInteractable(a2; grid = (collect(0.5:1:4.5), collect(0.5:1:3.5), z)), c2)
        end

        @testset "barplot -> Rect(:list), dodge/stack via child rects" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            p = barplot!(a, [1, 2, 3], [3.0, 5.0, 2.0])
            _, _, c = ctx_for(f)
            @test geom(RectInteractable(a, p), c) ==
                geom(RectInteractable(a; rects = [(1.0, 1.5, 0.8, 3.0), (2.0, 2.5, 0.8, 5.0), (3.0, 1.0, 0.8, 2.0)]), c)
            # dodge: 4 distinct laid-out rects pulled from the child Poly (solver already applied)
            fd = Figure(size = (500, 350)); ad = Axis(fd[1, 1])
            pd = barplot!(ad, [1, 1, 2, 2], [3.0, 1.0, 5.0, 2.0]; dodge = [1, 2, 1, 2])
            _, _, cd = ctx_for(fd)
            @test length(only(hitlayers(RectInteractable(ad, pd), cd)).payloads) == 4
        end

        @testset "poly -> Polygon (single ring and vector of rings)" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            single = poly!(a, Point2f[(0, 0), (1, 0), (1, 1), (0, 1)])
            rings = [Point2f[(0, 0), (1, 0), (0.5, 1)], Point2f[(2, 0), (3, 0), (2.5, 1)]]
            multi = poly!(a, rings)
            _, _, c = ctx_for(f)
            @test geom(PolygonInteractable(a, single), c) ==
                geom(PolygonInteractable(a, [[(0.0, 0), (1, 0), (1, 1), (0, 1)]]), c)
            @test length(only(hitlayers(PolygonInteractable(a, multi), c)).payloads) == 2
        end

        @testset "introspected interactable flows through holo unchanged" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            p = scatter!(a, [1.0, 2.0], [1.0, 2.0]; markersize = 18)
            w = holo(f, PointInteractable(a, p))
            @test w.manifest["layers"][1]["kind"] == "circles"
            @test w.manifest["layers"][1]["id"] == "scatter"
        end
    end

    @testset "M2.2 holo(fig) auto-extraction" begin
        @testset "walks every axis, maps each known plot, unique ids" begin
            f = Figure(size = (700, 350))
            a1 = Axis(f[1, 1])
            scatter!(a1, [1.0, 2.0], [1.0, 2.0])
            lines!(a1, [0.0, 1.0, 2.0], [0.0, 1.0, 0.5])
            heatmap!(a1, 1:3, 1:3, rand(3, 3))
            barplot!(a1, [1, 2], [3.0, 4.0])
            poly!(a1, Point2f[(0, 0), (1, 0), (0.5, 1)])
            a2 = Axis(f[1, 2])
            scatter!(a2, [5.0], [5.0])             # second scatter -> :scatter_2

            ints = auto_interactables(f)
            @test length(ints) == 6
            _, _, c = ctx_for(f)
            ids = [only(hitlayers(i, c)).id for i in ints]
            @test ids == [:scatter, :lines, :cells, :bars, :poly, :scatter_2]
            @test length(unique(ids)) == 6      # no collisions across axes
            # a2's scatter resolves to a2's transform (its own axis), not a1's
            @test only(hitlayers(ints[6], c)).axis != only(hitlayers(ints[1], c)).axis
        end

        @testset "skips unsupported plot types with a warning" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            scatter!(a, [1.0], [1.0])
            contour!(a, 1:5, 1:5, rand(5, 5))     # unsupported -> skip + warn
            ints = @test_logs (:warn,) match_mode = :any auto_interactables(f)
            @test length(ints) == 1
            @test only(ints) isa PointInteractable
        end

        @testset "holo(fig) overlays the auto-extracted set" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            scatter!(a, [1.0, 2.0], [1.0, 2.0]; markersize = 18)
            heatmap!(a, 1:3, 1:3, rand(3, 3))
            w = holo(f)
            @test [L["id"] for L in w.manifest["layers"]] == ["scatter", "cells"]
            @test [L["kind"] for L in w.manifest["layers"]] == ["circles", "grid"]
        end

        @testset "no introspectable plots -> warn, render image only" begin
            f = Figure(size = (400, 300)); a = Axis(f[1, 1])
            contour!(a, 1:5, 1:5, rand(5, 5))
            w = @test_logs (:warn,) match_mode = :any holo(f)
            @test isempty(w.manifest["layers"])
            @test !isempty(w.b64)                  # static image still produced
        end
    end
end
