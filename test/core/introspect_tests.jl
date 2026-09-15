using Test, Holo, CairoMakie, Makie
include(joinpath(@__DIR__, "..", "testutils.jl"))

@testset "Introspection" begin
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

        @testset "scatter radius fails loud on non-:pixel markerspace" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            p = scatter!(a, [1.0, 2.0], [1.0, 2.0]; markersize = 0.3, markerspace = :data)
            @test_throws ErrorException PointInteractable(a, p)        # can't derive radius
            @test PointInteractable(a, p; radius = 8) isa PointInteractable  # explicit radius is fine
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
            # image! shares the method body but advertises its own row -> exercise it
            f3 = Figure(size = (500, 350)); a3 = Axis(f3[1, 1]); p3 = image!(a3, rand(4, 3))
            _, _, c3 = ctx_for(f3)
            @test only(hitlayers(RectInteractable(a3, p3), c3)).kind === :grid
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

        @testset "BarPlot shared bar payloads" begin
            using Holo: RectInteractable
            fig = Figure(); ax = Axis(fig[1, 1])
            barplot!(ax, [1, 2, 3], [3.0, 1.0, 2.0])
            Makie.update_state_before_display!(fig)
            ri = RectInteractable(ax, ax.scene.plots[1]; id = :bars)
            pls = ri.payloads
            @test length(pls) == 3
            @test pls[1] == (; low = 0.0, high = 3.0, value = 3.0)   # bar 1: from-zero, height 3
            @test pls[2] == (; low = 0.0, high = 1.0, value = 1.0)
            @test pls[3] == (; low = 0.0, high = 2.0, value = 2.0)
            @test !haskey(pairs(pls[1]), :index)                     # no redundant index
            @test pls[1].value isa Float64                           # semantic values are Float64

            # horizontal bars (direction = :x): the value runs along x
            figh = Figure(); axh = Axis(figh[1, 1])
            barplot!(axh, [1, 2], [3.0, 5.0]; direction = :x)
            Makie.update_state_before_display!(figh)
            plh = RectInteractable(axh, axh.scene.plots[1]; id = :bars).payloads
            @test plh[1] == (; low = 0.0, high = 3.0, value = 3.0)
            @test plh[2] == (; low = 0.0, high = 5.0, value = 5.0)
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

        @testset "holo auto-detects text!" begin
            f = Figure(); ax = Axis(f[1, 1]); scatter!(ax, 1:3, 1:3)
            text!(ax, [1.5], [2.0]; text = ["Hi"])
            Makie.update_state_before_display!(f)
            ints = auto_interactables(f)
            @test count(i -> i isa TextInteractable, ints) == 1
        end
        @testset "holo auto-detects annotation!" begin
            f = Figure(); ax = Axis(f[1, 1]); scatter!(ax, 1:3, 1:3)
            annotation!(ax, [1.5], [2.0]; text = ["note"])
            Makie.update_state_before_display!(f)
            ints = auto_interactables(f)
            ti = only(filter(i -> i isa TextInteractable, ints))
            @test ti.payloads[1].text == "note"
            # x,y come from the Text descendant's positions[] — the DATA-space anchor
            @test ti.payloads[1].x == 1.5 && ti.payloads[1].y == 2.0
        end
        @testset "holo skips non-data-space text" begin
            f = Figure(); ax = Axis(f[1, 1]); scatter!(ax, 1:3, 1:3)
            text!(ax, [10.0], [10.0]; text = ["px"], space = :pixel)
            Makie.update_state_before_display!(f)
            ints = auto_interactables(f)
            @test count(i -> i isa TextInteractable, ints) == 0
        end
        @testset "rotated text still yields one box" begin
            f = Figure(size = (600, 400)); ax = Axis(f[1, 1])
            t = text!(ax, [1.0], [1.0]; text = ["Tilt"], rotation = 0.6)
            _, _, ctx = ctx_for(f)
            g = only(hitlayers(TextInteractable(ax, t), ctx)).geometry
            @test length(g) == 4 && g[3] > 0 && g[4] > 0   # one box, positive w, h
        end
    end

    @testset "M3 cheap-wins introspection" begin
        geom(int, c) = (L = only(hitlayers(int, c)); (L.kind, L.geometry, length(L.payloads)))

        @testset "stairs -> Segment(:polyline) from the expanded staircase" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            p = stairs!(a, [0.0, 1.0, 2.0, 3.0], [0.0, 2.0, 1.0, 3.0])
            _, _, c = ctx_for(f)
            # uses the child Lines' 7-point staircase, NOT the 4 input points
            steps = [(0.0, 0.0), (0.0, 2.0), (1.0, 2.0), (1.0, 1.0), (2.0, 1.0), (2.0, 3.0), (3.0, 3.0)]
            @test geom(SegmentInteractable(a, p), c) ==
                geom(SegmentInteractable(a, steps; mode = :polyline), c)
            L = only(hitlayers(SegmentInteractable(a, p), c))
            @test L.kind === :polyline && L.id === :stairs && length(L.payloads) == 6
            img = Makie.colorbuffer(f; px_per_unit = 2.0)
            @test drawn_near(img, L.geometry[3], L.geometry[4])   # a corner of the staircase
        end

        @testset "errorbars/rangebars -> Segment(:pairs)" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            pe = errorbars!(a, [1.0, 2.0, 3.0], [1.0, 2.0, 1.5], [0.2, 0.3, 0.1])
            pr = rangebars!(a, [1.0, 2.0], [0.5, 1.0], [1.5, 2.0])
            _, _, c = ctx_for(f)
            # one disjoint pair per bar, spanning low->high about the value
            ebars = [(1.0, 0.8), (1.0, 1.2), (2.0, 1.7), (2.0, 2.3), (3.0, 1.4), (3.0, 1.6)]
            @test geom(SegmentInteractable(a, pe), c) ==
                geom(SegmentInteractable(a, ebars; mode = :pairs), c)
            Le = only(hitlayers(SegmentInteractable(a, pe), c))
            @test Le.kind === :segments && Le.id === :errorbars && length(Le.payloads) == 3
            rbars = [(1.0, 0.5), (1.0, 1.5), (2.0, 1.0), (2.0, 2.0)]
            @test geom(SegmentInteractable(a, pr), c) ==
                geom(SegmentInteractable(a, rbars; mode = :pairs), c)
            @test only(hitlayers(SegmentInteractable(a, pr), c)).id === :rangebars
            # endpoint lands on a rendered bar (convention: assert pixel-landing, not just geom)
            Lg = only(hitlayers(SegmentInteractable(a, pe), c)).geometry
            img = Makie.colorbuffer(f; px_per_unit = 2.0)
            @test drawn_near(img, Lg[1], Lg[2])
        end

        @testset "errorbars/rangebars direction=:x (horizontal)" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            # error runs along x, position along y
            pe = errorbars!(a, [1.0, 2.0], [3.0, 4.0], [0.2, 0.3]; direction = :x)
            pr = rangebars!(a, [1.0, 2.0], [0.5, 1.0], [1.5, 2.0]; direction = :x)
            _, _, c = ctx_for(f)
            ebars = [(0.8, 3.0), (1.2, 3.0), (1.7, 4.0), (2.3, 4.0)]
            @test geom(SegmentInteractable(a, pe), c) ==
                geom(SegmentInteractable(a, ebars; mode = :pairs), c)
            rbars = [(0.5, 1.0), (1.5, 1.0), (1.0, 2.0), (2.0, 2.0)]
            @test geom(SegmentInteractable(a, pr), c) ==
                geom(SegmentInteractable(a, rbars; mode = :pairs), c)
        end

        @testset "hlines/vlines -> Segment(:pairs) spanning finallimits" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1]); scatter!(a, [0.0, 5.0], [0.0, 5.0])
            ph = hlines!(a, [1.0, 3.0]); pv = vlines!(a, [2.0, 4.0])
            _, _, c = ctx_for(f)
            fl = a.finallimits[]; x0 = fl.origin[1]; x1 = x0 + fl.widths[1]
            y0 = fl.origin[2]; y1 = y0 + fl.widths[2]
            hexp = [(x0, 1.0), (x1, 1.0), (x0, 3.0), (x1, 3.0)]
            @test geom(SegmentInteractable(a, ph), c) ==
                geom(SegmentInteractable(a, hexp; mode = :pairs), c)
            vexp = [(2.0, y0), (2.0, y1), (4.0, y0), (4.0, y1)]
            @test geom(SegmentInteractable(a, pv), c) ==
                geom(SegmentInteractable(a, vexp; mode = :pairs), c)
            @test only(hitlayers(SegmentInteractable(a, ph), c)).id === :hlines
            @test only(hitlayers(SegmentInteractable(a, pv), c)).id === :vlines
            # the first hline's midpoint (between its two span endpoints) lands on the drawn line
            g = only(hitlayers(SegmentInteractable(a, ph), c)).geometry
            img = Makie.colorbuffer(f; px_per_unit = 2.0)
            @test drawn_near(img, (g[1] + g[3]) / 2, (g[2] + g[4]) / 2)
        end

        @testset "hlines/vlines: interactable built before finalize resolves against finalized limits" begin
            # Regression: holo(fig, interactables) only finalizes AFTER the caller already built
            # `interactables` (unlike holo(fig), which finalizes first). A SegmentInteractable built
            # from an HLines/VLines plot object before any finalize call must still span the
            # FINALIZED viewport at hitlayers time, not whatever finallimits happened to hold at
            # construction.
            f = Figure(size = (500, 350)); a = Axis(f[1, 1]); scatter!(a, [0.0, 5.0], [0.0, 5.0])
            ph = hlines!(a, [1.0, 3.0])
            seg = SegmentInteractable(a, ph)   # constructed BEFORE any finalize call
            xlims!(a, -20, 20)                 # widen limits after construction
            w = holo(f, [seg])                 # finalizes internally, after seg was already built
            ref = holo(f)                      # holo(fig): finalizes first, then auto-extracts (ground truth)
            seg_layer = only(filter(l -> l["id"] == "hlines", w.manifest["layers"]))
            ref_layer = only(filter(l -> l["id"] == "hlines", ref.manifest["layers"]))
            @test seg_layer["geometry"] == ref_layer["geometry"]
            fl = a.finallimits[]
            @test fl.origin[1] ≈ -20 atol = 0.5
            @test fl.origin[1] + fl.widths[1] ≈ 20 atol = 0.5

            # VLines mirror: spans the full Y-range (ishoriz=false in `_span_pairs`), so widen ylims.
            fv = Figure(size = (500, 350)); av = Axis(fv[1, 1]); scatter!(av, [0.0, 5.0], [0.0, 5.0])
            pv = vlines!(av, [1.0, 3.0])
            segv = SegmentInteractable(av, pv)   # constructed BEFORE any finalize call
            ylims!(av, -20, 20)                  # widen limits after construction
            wv = holo(fv, [segv])
            refv = holo(fv)
            segv_layer = only(filter(l -> l["id"] == "vlines", wv.manifest["layers"]))
            refv_layer = only(filter(l -> l["id"] == "vlines", refv.manifest["layers"]))
            @test segv_layer["geometry"] == refv_layer["geometry"]
            flv = av.finallimits[]
            @test flv.origin[2] ≈ -20 atol = 0.5
            @test flv.origin[2] + flv.widths[2] ≈ 20 atol = 0.5
        end

        @testset "hspan/vspan: interactable built before finalize resolves against finalized limits" begin
            # Same finalize-order regression as hlines/vlines, but for RectInteractable's `resolve`
            # path (`_rect_with_resolve`, wired at the HSpan/VSpan constructors in introspect.jl).
            # Every existing HSpan/VSpan test goes through holo(fig), which finalizes first, so
            # none of them would catch hitlayers falling back to stale `data`.

            # HSpan fills the full X-range (`_span_rects(ax, p, :x)`), so widen xlims.
            f = Figure(size = (500, 350)); a = Axis(f[1, 1]); scatter!(a, [0.0, 5.0], [0.0, 5.0])
            ph = hspan!(a, [1.0], [3.0])
            rect = RectInteractable(a, ph)       # constructed BEFORE any finalize call
            xlims!(a, -20, 20)                   # widen limits after construction
            w = holo(f, [rect])
            ref = holo(f)
            rect_layer = only(filter(l -> l["id"] == "hspan", w.manifest["layers"]))
            ref_layer = only(filter(l -> l["id"] == "hspan", ref.manifest["layers"]))
            @test rect_layer["geometry"] == ref_layer["geometry"]
            fl = a.finallimits[]
            @test fl.origin[1] ≈ -20 atol = 0.5
            @test fl.origin[1] + fl.widths[1] ≈ 20 atol = 0.5

            # VSpan fills the full Y-range (`_span_rects(ax, p, :y)`), so widen ylims.
            fv = Figure(size = (500, 350)); av = Axis(fv[1, 1]); scatter!(av, [0.0, 5.0], [0.0, 5.0])
            pv = vspan!(av, [1.0], [3.0])
            rectv = RectInteractable(av, pv)     # constructed BEFORE any finalize call
            ylims!(av, -20, 20)                  # widen limits after construction
            wv = holo(fv, [rectv])
            refv = holo(fv)
            rectv_layer = only(filter(l -> l["id"] == "vspan", wv.manifest["layers"]))
            refv_layer = only(filter(l -> l["id"] == "vspan", refv.manifest["layers"]))
            @test rectv_layer["geometry"] == refv_layer["geometry"]
            flv = av.finallimits[]
            @test flv.origin[2] ≈ -20 atol = 0.5
            @test flv.origin[2] + flv.widths[2] ≈ 20 atol = 0.5
        end

        @testset "empty data -> empty layer (no pairs)" begin
            # Build the empty Errorbars from a typed Vec4f[] (the post-conversion type Makie
            # expects). Empty *untyped* vectors (Float64[], Float64[], Float64[]) fail Makie's
            # convert_arguments before Julia 1.12 — the empty broadcast infers Vector{Any},
            # which the converter rejects (upstream, not a Holo bug). The pre-typed form passes
            # straight through on all supported versions. Verified on Julia 1.10 and 1.12.
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            p = errorbars!(a, Vec4f[]); _, _, c = ctx_for(f)
            L = only(hitlayers(SegmentInteractable(a, p), c))
            @test isempty(L.geometry) && isempty(L.payloads)
        end

        @testset "spy -> Rect(:list) of unit cells at the nonzeros" begin
            M = zeros(5, 5); M[1, 2] = 3.0; M[3, 4] = 1.0; M[5, 1] = 2.0
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            p = spy!(a, M); _, _, c = ctx_for(f)
            L = only(hitlayers(RectInteractable(a, p), c))
            @test L.kind === :rects && L.id === :spy
            @test length(L.payloads) == 3                  # one rect per nonzero
            img = Makie.colorbuffer(f; px_per_unit = 2.0)
            @test drawn_near(img, L.geometry[1], L.geometry[2])   # first cell center drawn
        end

        @testset "stem -> Point + Segment(:pairs) (composite, two layers)" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            stem!(a, [1.0, 2.0, 3.0], [3.0, 1.0, 2.0]); _, _, c = ctx_for(f)
            ints = auto_interactables(f)
            @test length(ints) == 2
            kinds = [only(hitlayers(i, c)).kind for i in ints]
            ids = [only(hitlayers(i, c)).id for i in ints]
            @test kinds == [:circles, :segments]
            @test ids == [:stem, :stem_stems]
        end

        @testset "scatterlines -> Point + Segment(:polyline) (composite)" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            scatterlines!(a, [1.0, 2.0, 3.0], [1.0, 4.0, 9.0]; markersize = 16); _, _, c = ctx_for(f)
            ints = auto_interactables(f)
            @test length(ints) == 2
            @test [only(hitlayers(i, c)).kind for i in ints] == [:circles, :polyline]
            @test [only(hitlayers(i, c)).id for i in ints] == [:scatterlines, :scatterlines_line]
        end

        @testset "holo(fig) auto-extracts the cheap-win surfaces" begin
            f = Figure(size = (500, 350)); a = Axis(f[1, 1])
            stairs!(a, [0.0, 1.0, 2.0], [0.0, 1.0, 0.5])
            hlines!(a, [2.0])
            w = holo(f)
            @test [L["id"] for L in w.manifest["layers"]] == ["stairs", "hlines"]
            @test [L["kind"] for L in w.manifest["layers"]] == ["polyline", "segments"]
        end
    end

    @testset "Hist + Waterfall extraction" begin
        using Holo: RectInteractable, auto_interactables
        # Hist: counts + bin edges
        fig = Figure(); ax = Axis(fig[1, 1])
        data = [0.5, 0.6, 1.5, 1.6, 1.7, 2.5]
        hist!(ax, data; bins = 3)
        Makie.update_state_before_display!(fig)
        hp = ax.scene.plots[1]
        ri = RectInteractable(ax, hp; id = :hist)
        @test length(ri.payloads) == 3
        @test sum(p.value for p in ri.payloads) == length(data)        # values sum to N (default normalization=:none)
        @test all(p.low < p.high for p in ri.payloads)                 # bin edges ordered
        @test !haskey(pairs(ri.payloads[1]), :index)
        @test !haskey(pairs(ri.payloads[1]), :count)                   # field is :value, not :count
        # auto path picks it up as :hist
        ints = auto_interactables(fig)
        @test any(i -> i isa RectInteractable, ints)

        # Waterfall: signed delta — value must reflect direction (Fix 2)
        fig2 = Figure(); ax2 = Axis(fig2[1, 1])
        waterfall!(ax2, [1, 2, 3], [2.0, -1.0, 3.0])
        Makie.update_state_before_display!(fig2)
        ri2 = RectInteractable(ax2, ax2.scene.plots[1]; id = :waterfall)
        @test length(ri2.payloads) == 3
        @test haskey(pairs(ri2.payloads[1]), :value)                   # shared bar schema
        @test ri2.payloads[1].value == 2.0                             # up-step: positive
        @test ri2.payloads[2].value == -1.0                            # down-step: negative (signed delta)
        @test ri2.payloads[3].value == 3.0                             # up-step: positive
        # |value| ≈ bar height (low..high span)
        @test abs(ri2.payloads[2].value) ≈ ri2.payloads[2].high - ri2.payloads[2].low
    end

    @testset "CrossBar extraction" begin
        using Holo: RectInteractable, auto_interactables
        fig = Figure(); ax = Axis(fig[1, 1])
        crossbar!(ax, [1, 2], [5.0, 6.0], [3.0, 4.0], [7.0, 8.0])
        Makie.update_state_before_display!(fig)
        p = ax.scene.plots[1]
        ri = RectInteractable(ax, p; id = :crossbar)
        @test length(ri.payloads) == 2
        @test ri.payloads[1] == (; midpoint = 5.0, low = 3.0, high = 7.0)
        @test ri.payloads[2] == (; midpoint = 6.0, low = 4.0, high = 8.0)
        @test !haskey(pairs(ri.payloads[1]), :index)
        # auto path: _plotbase returns :crossbar, _construct returns RectInteractable
        _, _, c = ctx_for(fig)
        ints = auto_interactables(fig)
        @test length(ints) == 1 && ints[1] isa RectInteractable
        @test only(hitlayers(ints[1], c)).id === :crossbar
    end

    @testset "Band extraction" begin
        using Holo: PolygonInteractable, auto_interactables
        fig = Figure(); ax = Axis(fig[1, 1])
        band!(ax, 1:5, [0.0, 0.1, 0.2, 0.1, 0.0], [1.0, 1.2, 1.4, 1.2, 1.0])
        Makie.update_state_before_display!(fig)
        p = ax.scene.plots[1]
        pi = PolygonInteractable(ax, p; id = :band)
        @test length(pi.rings) == 1                       # one filled region → one ring
        @test length(pi.rings[1]) == 10                   # 5 lower + 5 upper, stitched
        @test pi.payloads[1] == (; index = 0)             # default; no semantic per-element value
        # auto path picks it up as :band, exactly one layer (no stray :poly from the child)
        ints = auto_interactables(fig)
        @test length(ints) == 1
        @test ints[1] isa PolygonInteractable
        _, _, c = ctx_for(fig)
        @test only(hitlayers(ints[1], c)).id === :band
    end

    @testset "Density extraction" begin
        using Holo: PolygonInteractable, auto_interactables
        fig = Figure(); ax = Axis(fig[1, 1])
        density!(ax, randn(300))
        Makie.update_state_before_display!(fig)
        p = ax.scene.plots[1]
        pi = PolygonInteractable(ax, p; id = :density)
        @test length(pi.rings) == 1                       # the KDE fill is one region
        @test length(pi.rings[1]) > 50                    # dense outline (Makie's KDE band)
        @test pi.payloads[1] == (; index = 0)
        ints = auto_interactables(fig)
        @test length(ints) == 1 && ints[1] isa PolygonInteractable
    end

    @testset "Violin extraction" begin
        using Holo: PolygonInteractable, auto_interactables
        fig = Figure(); ax = Axis(fig[1, 1])
        violin!(ax, repeat([1, 2, 3], inner = 80), randn(240))
        Makie.update_state_before_display!(fig)
        p = ax.scene.plots[1]
        pi = PolygonInteractable(ax, p; id = :violin)
        @test length(pi.rings) == 3                        # one ring per violin
        @test length(pi.payloads) == 3
        @test [pl.x for pl in pi.payloads] == [1.0, 2.0, 3.0]   # exact clean categories from converted (no Float32 noise)
        @test all(pl.x isa Float64 for pl in pi.payloads)
        @test !haskey(pairs(pi.payloads[1]), :index)
        ints = auto_interactables(fig)
        @test length(ints) == 1 && ints[1] isa PolygonInteractable
    end

    @testset "Voronoiplot extraction" begin
        using Holo: PolygonInteractable, auto_interactables
        fig = Figure(); ax = Axis(fig[1, 1])
        voronoiplot!(ax, [0.1, 0.4, 0.7, 0.3, 0.9, 0.5, 0.2, 0.8], [0.2, 0.6, 0.1, 0.9, 0.4, 0.5, 0.8, 0.3])
        Makie.update_state_before_display!(fig)
        p = ax.scene.plots[1]
        pi = PolygonInteractable(ax, p; id = :voronoiplot)
        @test length(pi.rings) == 8                        # one cell per generator site
        @test pi.payloads == Any[(; index = k - 1) for k in 1:8]   # cell order ≠ site order → index only
        ints = auto_interactables(fig)
        @test length(ints) == 1 && ints[1] isa PolygonInteractable
    end

    @testset "Contourf extraction" begin
        using Holo: PolygonInteractable, auto_interactables
        fig = Figure(); ax = Axis(fig[1, 1])
        z = [sin(i / 3) * cos(j / 3) for i in 1:20, j in 1:20]
        contourf!(ax, 1:20, 1:20, z; levels = 6)
        Makie.update_state_before_display!(fig)
        p = ax.scene.plots[1]
        pi = PolygonInteractable(ax, p; id = :contourf)
        @test length(pi.rings) == length(pi.payloads)            # one element per filled level-piece
        @test length(pi.rings) > 1
        @test all(haskey(pairs(pl), :low) && haskey(pairs(pl), :high) for pl in pi.payloads)
        @test all(pl.low isa Float64 && pl.high isa Float64 for pl in pi.payloads)
        @test all(pl.low < pl.high for pl in pi.payloads)        # band interval ordered
        @test !haskey(pairs(pi.payloads[1]), :index)
        ints = auto_interactables(fig)
        @test length(ints) == 1 && ints[1] isa PolygonInteractable

        # explicit levels → intervals are the true bands [edge_k, edge_{k+1}] (caught the midpoint-vs-edge bug)
        fige = Figure(); axe = Axis(fige[1, 1])
        ze = [sin(i / 3) * cos(j / 3) for i in 1:20, j in 1:20]
        contourf!(axe, 1:20, 1:20, ze; levels = [0.0, 0.4, 0.8])
        Makie.update_state_before_display!(fige)
        pie = PolygonInteractable(axe, axe.scene.plots[1]; id = :contourf)
        intervals = sort(unique([(round(pl.low, digits = 6), round(pl.high, digits = 6)) for pl in pie.payloads]))
        @test intervals == [(0.0, 0.4), (0.4, 0.8)]

        # constant (zero-range) data → one fill, a correctly zero-width band, no crash
        figc = Figure(); axc = Axis(figc[1, 1])
        contourf!(axc, 1:10, 1:10, fill(1.0, 10, 10); levels = 6)
        Makie.update_state_before_display!(figc)
        pic = PolygonInteractable(axc, axc.scene.plots[1]; id = :contourf)
        @test !isempty(pic.payloads)
        @test all(pl.low <= pl.high for pl in pic.payloads)
    end

    @testset "BoxPlot extraction" begin
        using Holo: RectInteractable, PolygonInteractable, auto_interactables
        import Statistics
        cats = repeat([1, 2], inner = 120)
        vals = [randn(120) .- 1; randn(120) .+ 2]

        # notch off → RectInteractable; stats payload matches Statistics.quantile exactly
        fig = Figure(); ax = Axis(fig[1, 1])
        boxplot!(ax, cats, vals); Makie.update_state_before_display!(fig)
        bi = Holo._boxplot_interactable(ax, ax.scene.plots[1]; id = :boxplot)
        @test bi isa RectInteractable
        @test length(bi.payloads) == 2
        @test all(pl.q1 isa Float64 && pl.median isa Float64 && pl.q3 isa Float64 for pl in bi.payloads)
        @test all(pl.q1 < pl.median < pl.q3 for pl in bi.payloads)
        for g in (1, 2)
            q = Statistics.quantile(vals[cats .== g], [0.25, 0.5, 0.75])
            @test bi.payloads[g].q1 ≈ q[1]
            @test bi.payloads[g].median ≈ q[2]
            @test bi.payloads[g].q3 ≈ q[3]
        end
        @test !haskey(pairs(bi.payloads[1]), :index)
        @test any(i -> i isa RectInteractable, auto_interactables(fig))

        # notch on → PolygonInteractable; same stats payload
        fig2 = Figure(); ax2 = Axis(fig2[1, 1])
        boxplot!(ax2, cats, vals; show_notch = true); Makie.update_state_before_display!(fig2)
        bi2 = Holo._boxplot_interactable(ax2, ax2.scene.plots[1]; id = :boxplot)
        @test bi2 isa PolygonInteractable
        @test length(bi2.payloads) == 2
        @test all(haskey(pairs(pl), :median) for pl in bi2.payloads)

        # fail-loud when the stats node is absent (pass a leaf child that has a 1-tuple converted, not the 4-tuple stats node)
        @test_throws ErrorException Holo._boxplot_stats_node(ax.scene.plots[1].plots[1])
    end

    @testset "holo(fig) auto-extracts spans bounded to viewport" begin
        # End-to-end guard: calling holo(fig) (the AUTO path, no manual update_state_before_display!)
        # on a 2-axis figure with a vspan must succeed and produce a layer whose pixel rect is
        # bounded within the owning axis's viewport.
        # Note: the viewport clamp masks finallimits-staleness, so this test guards the full
        # pipeline end-to-end but cannot isolate the update_state_before_display! ordering
        # line specifically — that's expected.
        fig = Figure(size = (700, 400))
        ax1 = Axis(fig[1, 1]); scatter!(ax1, [1.0, 2.0, 3.0], [1.0, 2.0, 3.0])
        ax2 = Axis(fig[1, 2])
        vspan!(ax2, [1.0], [2.0])
        # AUTO path: holo(fig) calls update_state_before_display! internally
        w = holo(fig)
        vspan_layer = only(filter(L -> L["id"] == "vspan", w.manifest["layers"]))
        ax_id = vspan_layer["axis"]                          # e.g. "ax2"
        vp = w.manifest["transforms"][ax_id]["viewport"]    # [vp_x, vp_y, vp_w, vp_h] in image-px
        vp_x, vp_y, vp_w, vp_h = vp[1], vp[2], vp[3], vp[4]
        geom = vspan_layer["geometry"]                       # flat [cx, cy, w, h] for the one span
        cx_px, cy_px, w_px, h_px = geom[1], geom[2], geom[3], geom[4]
        @test isfinite(cx_px) && isfinite(cy_px)            # layer is present and projected
        @test w_px > 0 && h_px > 0                          # has nonzero size
        @test cx_px - w_px / 2 >= vp_x                     # left edge within viewport
        @test cx_px + w_px / 2 <= vp_x + vp_w             # right edge within viewport
    end
end
