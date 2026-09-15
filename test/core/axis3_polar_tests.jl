using Test, Holo, CairoMakie, Makie
include(joinpath(@__DIR__, "..", "testutils.jl"))

@testset "Axis3 / PolarAxis" begin
    @testset "PolarAxis: context + projection + payloads + gates" begin
        # Discrete hits project through the shared closure (Makie.Polar in transform_func).
        # Continuous θ/r readout is deferred — ispolar transforms + validate gates.
        fp = Figure(; size = (600, 450))
        axp = PolarAxis(fp[1, 1])
        # (θ, r) data coords — four cardinal points so the projection hinge is unambiguous
        ptsp = [
            Point2f(0.0, 1.0), Point2f(π / 2, 2.0),
            Point2f(π, 1.5), Point2f(3π / 2, 2.5),
        ]
        scatter!(axp, ptsp; color = :red, markersize = 14)
        lines!(axp, range(0, 2π; length = 64), fill(1.2, 64))
        _, ppup, ctxp = ctx_for(fp)

        tp = ctxp.transforms[IP.axis_id(ctxp, axp)]
        @test tp.ispolar
        @test !tp.is3d
        @test tp.viewport[3] > 0 && tp.viewport[4] > 0
        @test IP._transform_dict(tp)["ispolar"] === true

        # projected :circles land on the rendered markers (red-pixel hinge, same as Axis3/log)
        isred(c) = Float64(Makie.red(c)) > 0.6 && Float64(Makie.green(c)) < 0.4 && Float64(Makie.blue(c)) < 0.4
        function red_near_in(img, cx, cy; tol = 8)
            ih, iw = size(img)
            x, y = round(Int, cx), round(Int, cy)
            for dy in -tol:tol, dx in -tol:tol
                xx, yy = x + dx, y + dy
                (1 <= xx <= iw && 1 <= yy <= ih) || continue
                isred(img[yy, xx]) && return true
            end
            return false
        end
        imgp = Makie.colorbuffer(fp; px_per_unit = ppup)
        Lp = only(hitlayers(PointInteractable(axp, ptsp; radius = 7), ctxp))
        @test Lp.kind === :circles && length(Lp.geometry) == 12
        for k in 0:3
            @test red_near_in(imgp, Lp.geometry[3k + 1], Lp.geometry[3k + 2])
        end

        # continuous consumers fail loud on ispolar (polar transform not yet in JS)
        for bad in (
                AxisInteractable(axp),
                ThresholdInteractable(axp; orientation = :horizontal, value = 1.0),
                ROIInteractable(axp; bounds = (0.0, 1.0, 0.5, 1.5)),
            )
            msg = validate(bad, ctxp)
            @test msg !== nothing && occursin("PolarAxis", msg)
            @test_throws ArgumentError build_manifest([bad], ctxp)
        end

        # auto-extract: Scatter + Lines ride; heatmap-on-polar warn-and-skips
        fpi = Figure(; size = (600, 450))
        axpi = PolarAxis(fpi[1, 1])
        scatter!(axpi, [0.0, π / 2], [1.0, 2.0]; markersize = 10)
        lines!(axpi, [0.0, π], [1.0, 1.5])
        Makie.update_state_before_display!(fpi)
        ints = auto_interactables(fpi)
        @test any(i -> i isa PointInteractable, ints)
        @test any(i -> i isa SegmentInteractable, ints)
        _, _, ctxpi = ctx_for(fpi)
        mp = build_manifest(ints, ctxpi)
        @test mp["transforms"]["ax1"]["ispolar"] === true
        @test length(mp["layers"]) == 2

        fpg = Figure(; size = (600, 450))
        axpg = PolarAxis(fpg[1, 1])
        # heatmap on PolarAxis is a supported Makie recipe but not a polar-valid Holo extraction
        heatmap!(axpg, 0:0.5:π, 1:3, rand(7, 3))
        scatter!(axpg, [0.0], [1.0]; markersize = 10)
        Makie.update_state_before_display!(fpg)
        gints = @test_logs (:warn, r"on PolarAxis"i) auto_interactables(fpg)
        @test length(gints) == 1
        @test only(gints) isa PointInteractable
    end

    @testset "Axis3: context + projection + payloads + gates (WS-3D core)" begin
        f3 = Figure(; size = (600, 450))
        ax3 = Axis3(f3[1, 1]; azimuth = 0.4, elevation = 0.5)
        pts3 = Makie.Point3f[(1, 2, 3), (4, 5, 6), (7, 8, 2)]
        scatter!(ax3, pts3; color = :red, markersize = 14)
        _, ppu3, ctx3 = ctx_for(f3)

        # registered with an is3d transform: degenerate lims, real pixel viewport
        t3 = ctx3.transforms[IP.axis_id(ctx3, ax3)]
        @test t3.is3d
        @test t3.viewport[3] > 0 && t3.viewport[4] > 0
        @test IP._transform_dict(t3)["is3d"] === true

        # projected :circles land on the rendered markers — the projection hinge as a unit
        # test (red-pixel assert, same idiom as the log-scale testsets), static then rotated
        isred(c) = Float64(Makie.red(c)) > 0.6 && Float64(Makie.green(c)) < 0.4 && Float64(Makie.blue(c)) < 0.4
        function red_near_in(img, cx, cy; tol = 6)
            ih, iw = size(img)
            x, y = round(Int, cx), round(Int, cy)
            for dy in -tol:tol, dx in -tol:tol
                xx, yy = x + dx, y + dy
                (1 <= xx <= iw && 1 <= yy <= ih) || continue
                isred(img[yy, xx]) && return true
            end
            return false
        end
        img3 = Makie.colorbuffer(f3; px_per_unit = ppu3)
        L3 = only(hitlayers(PointInteractable(ax3, pts3; radius = 7), ctx3))
        @test L3.kind === :circles && length(L3.geometry) == 9
        for k in 0:2
            @test red_near_in(img3, L3.geometry[3k + 1], L3.geometry[3k + 2])
        end

        # rotation via azimuth/elevation re-render: fresh context re-projects onto the new view
        ax3.azimuth[] = 1.1; ax3.elevation[] = 0.2
        _, ppu3b, ctx3b = ctx_for(f3)
        img3b = Makie.colorbuffer(f3; px_per_unit = ppu3b)
        L3b = only(hitlayers(PointInteractable(ax3, pts3; radius = 7), ctx3b))
        @test any(L3b.geometry[i] != L3.geometry[i] for i in 1:9)   # the view actually moved
        for k in 0:2
            @test red_near_in(img3b, L3b.geometry[3k + 1], L3b.geometry[3k + 2])
        end

        # 3-coord default payloads carry z; 2-coord payloads keep the exact 2D shape
        @test PointInteractable(ax3, pts3).payloads[1] == (; index = 0, x = 1.0, y = 2.0, z = 3.0)
        @test PointInteractable(ax3, [(1.0, 2.0)]).payloads[1] == (; index = 0, x = 1.0, y = 2.0)

        # continuous pixel→data consumers fail loud on is3d (a screen pixel is a ray)
        for bad in (
                AxisInteractable(ax3),
                ThresholdInteractable(ax3; orientation = :horizontal, value = 1.0),
                ROIInteractable(ax3; bounds = (1.0, 2.0, 1.0, 2.0)),
            )
            msg = validate(bad, ctx3)
            @test msg !== nothing && occursin("Axis3", msg)
            @test_throws ArgumentError build_manifest([bad], ctx3)
        end

        # introspection: Scatter/Lines on Axis3 ride the widened constructors for free
        f3i = Figure(; size = (600, 450))
        ax3i = Axis3(f3i[1, 1])
        scatter!(ax3i, Makie.Point3f[(1, 2, 3), (4, 5, 6)]; markersize = 10)
        lines!(ax3i, Makie.Point3f[(0, 0, 0), (2, 2, 2), (4, 0, 1)])
        Makie.update_state_before_display!(f3i)
        ints = auto_interactables(f3i)
        @test any(i -> i isa PointInteractable, ints)
        @test any(i -> i isa SegmentInteractable, ints)
        _, _, ctx3i = ctx_for(f3i)
        m3 = build_manifest(ints, ctx3i)
        @test m3["transforms"]["ax1"]["is3d"] === true
        @test length(m3["layers"]) == 2
        pl3 = only(filter(l -> l["kind"] == "circles", m3["layers"]))["payloads"][1]
        @test pl3 == (; index = 0, x = 1.0, y = 2.0, z = 3.0)   # introspected scatter payload carries z

        # Axis3 introspection gate: a recipe whose extraction is only 2D-valid (heatmap's grid
        # edges are projected per-axis — separably, which a 3D camera breaks) must warn-and-skip,
        # never construct silently-misaligned geometry.
        f3g = Figure(; size = (600, 450))
        ax3g = Axis3(f3g[1, 1])
        heatmap!(ax3g, 1:3, 1:3, [Float64(i + j) for i in 1:3, j in 1:3])
        scatter!(ax3g, Makie.Point3f[(1, 2, 3)]; markersize = 10)
        Makie.update_state_before_display!(f3g)
        gints = @test_logs (:warn, r"on Axis3"i) auto_interactables(f3g)
        @test length(gints) == 1
        @test only(gints) isa PointInteractable
    end

    @testset "Axis3 per-type extraction: MeshScatter + Wireframe + Arrows3D" begin
        isredc(c) = Float64(Makie.red(c)) > 0.6 && Float64(Makie.green(c)) < 0.4 && Float64(Makie.blue(c)) < 0.4
        isbluec(c) = Float64(Makie.blue(c)) > 0.4 && Float64(Makie.red(c)) < 0.5 && Float64(Makie.green(c)) < 0.5
        function color_near(pred, img, cx, cy; tol = 5)
            ih, iw = size(img)
            x, y = round(Int, cx), round(Int, cy)
            for dy in -tol:tol, dx in -tol:tol
                xx, yy = x + dx, y + dy
                (1 <= xx <= iw && 1 <= yy <= ih) || continue
                pred(img[yy, xx]) && return true
            end
            return false
        end

        # MeshScatter: data-space markersize → per-element, depth-dependent pixel radii
        fm = Figure(; size = (600, 450))
        axm = Axis3(fm[1, 1]; azimuth = 0.4, elevation = 0.5)
        mpts = Makie.Point3f[(1, 2, 3), (4, 5, 6), (7, 8, 2)]
        msp = meshscatter!(axm, mpts; markersize = 0.6, color = :red)
        Makie.update_state_before_display!(fm)
        mints = @test_logs auto_interactables(fm)       # no logs: meshscatter must NOT re-gate
        mi = only(mints)
        @test mi isa PointInteractable
        @test mi.radius3d !== nothing && length(mi.radius3d) == 3
        @test mi.payloads[1] == (; index = 0, x = 1.0, y = 2.0, z = 3.0)
        _, ppum, ctxm = ctx_for(fm)
        imgm = Makie.colorbuffer(fm; px_per_unit = ppum)
        Lm = only(hitlayers(mi, ctxm))
        @test Lm.kind === :circles && length(Lm.geometry) == 9
        for k in 0:2
            @test color_near(isredc, imgm, Lm.geometry[3k + 1], Lm.geometry[3k + 2])
            # computed radius, not the 9px-logical default (which would be 9×2=18 image px):
            # a 0.6-data-radius sphere at this camera projects to ~40 image px
            @test 25 < Lm.geometry[3k + 3] < 60
        end
        # edge sanity: a pixel just inside the reported radius (rightward) is still marker-red
        @test color_near(isredc, imgm, Lm.geometry[1] + 0.8 * Lm.geometry[3], Lm.geometry[2]; tol = 3)

        # radius= override disables radius3d derivation (fixed pixel radius, like Scatter)
        mio = PointInteractable(axm, msp; radius = 5)
        @test mio.radius3d === nothing
        Lo = only(hitlayers(mio, ctxm))
        @test Lo.geometry[3] == round(Int, 5 * ctxm.scaling)

        # PER-ELEMENT radii (the headline behavior): three different markersizes must yield
        # radii in that proportion — a regression that reuses one element's extents (or any
        # single shared radius) collapses the ratios to 1:1:1 and fails here. Also covers
        # _meshscatter_extents' per-element vector branch.
        fv = Figure(; size = (600, 450))
        axv = Axis3(fv[1, 1]; azimuth = 0.4, elevation = 0.5)
        meshscatter!(axv, mpts; markersize = [0.2, 0.5, 0.9], color = :red)
        Makie.update_state_before_display!(fv)
        vi = only(@test_logs auto_interactables(fv))
        @test vi.radius3d == [Makie.Vec3f(0.2, 0.2, 0.2), Makie.Vec3f(0.5, 0.5, 0.5), Makie.Vec3f(0.9, 0.9, 0.9)]
        _, _, ctxv = ctx_for(fv)
        Lv = only(hitlayers(vi, ctxv))
        rv = [Lv.geometry[3k + 3] for k in 0:2]
        @test 2.0 < rv[2] / rv[1] < 3.0        # ≈ 0.5/0.2 = 2.5
        @test 3.6 < rv[3] / rv[1] < 5.4        # ≈ 0.9/0.2 = 4.5

        # DEPTH-dependence: under real perspective, equal extents at different depths project
        # to different radii — a camera-independent precomputed radius collapses them to equal.
        fp = Figure(; size = (600, 450))
        axp = Axis3(fp[1, 1]; azimuth = 0.4, elevation = 0.5, perspectiveness = 1.0)
        meshscatter!(axp, Makie.Point3f[(1, 1, 1), (9, 9, 9)]; markersize = 0.6, color = :red)
        Makie.update_state_before_display!(fp)
        pi3 = only(@test_logs auto_interactables(fp))
        _, _, ctxp = ctx_for(fp)
        Lp = only(hitlayers(pi3, ctxp))
        rp = [Lp.geometry[3k + 3] for k in 0:1]
        @test abs(rp[1] / rp[2] - 1) > 0.1     # near/far radii differ (>10%)

        # radius3d validation fails loud on length mismatch
        @test_throws ArgumentError PointInteractable(axm, mpts; radius3d = [Makie.Vec3f(1, 1, 1)])

        # Wireframe: rendered edges from the child LineSegments (data space), :pairs mode
        fw = Figure(; size = (600, 450))
        axw = Axis3(fw[1, 1]; azimuth = 0.4, elevation = 0.5)
        wxs = 1:5
        wzs = [sin(x) * cos(y) + 3 for x in wxs, y in wxs]
        wireframe!(axw, wxs, wxs, wzs; color = :blue)
        Makie.update_state_before_display!(fw)
        wints = auto_interactables(fw)
        wi = only(wints)
        @test wi isa SegmentInteractable && wi.mode === :pairs
        @test iseven(length(wi.vertices)) && length(wi.vertices) >= 80   # grid edges + triangulation diagonals
        _, ppuw, ctxw = ctx_for(fw)
        imgw = Makie.colorbuffer(fw; px_per_unit = ppuw)
        Lw = only(hitlayers(wi, ctxw))
        @test Lw.kind === :segments
        nseg = length(wi.vertices) ÷ 2
        for k in 0:7:(nseg - 1)   # sample every 7th segment's midpoint on the rendered wire
            mx = (Lw.geometry[4k + 1] + Lw.geometry[4k + 3]) / 2
            my = (Lw.geometry[4k + 2] + Lw.geometry[4k + 4]) / 2
            @test color_near(isbluec, imgw, mx, my; tol = 3)
        end

        # Arrows3D: SegmentInteractable(:pairs) from processed startpoints→endpoints (DATA
        # space). Raw pos→pos+dir is wrong under lengthscale/align (spike 2026-07-02 + 2026-09-11):
        # Makie autoscales into a normalized child MeshScatter space; startpoints/endpoints are
        # the post-align/lengthscale ends that the shaft+tip children span. Child quaternion ×
        # markersize.z reconstructs the same span in that child space — we read the data-space
        # ends so Holo's project closure (which applies float32convert) lands on drawn pixels.
        fa = Figure(; size = (600, 450))
        axa = Axis3(fa[1, 1]; azimuth = 0.4, elevation = 0.5)
        apts = Makie.Point3f[(1, 1, 1), (3, 2, 1), (2, 4, 3)]
        adirs = Makie.Vec3f[(1, 0, 0), (0, 1, 0.5), (-0.5, 0, 1)]
        arrows3d!(axa, apts, adirs; color = :red)
        Makie.update_state_before_display!(fa)
        aints = @test_logs auto_interactables(fa)       # no logs: arrows3d must NOT re-gate
        ai = only(aints)
        @test ai isa SegmentInteractable && ai.mode === :pairs
        @test length(ai.vertices) == 6                  # 3 arrows × (start, end)
        @test ai.payloads[1] == (; index = 0, x = 1.0, y = 1.0, z = 1.0, u = 1.0, v = 0.0, w = 0.0)
        _, ppua, ctxa = ctx_for(fa)
        imga = Makie.colorbuffer(fa; px_per_unit = ppua)
        La = only(hitlayers(ai, ctxa))
        @test La.kind === :segments && length(La.geometry) == 12
        for k in 0:2
            mx = (La.geometry[4k + 1] + La.geometry[4k + 3]) / 2
            my = (La.geometry[4k + 2] + La.geometry[4k + 4]) / 2
            @test color_near(isredc, imga, mx, my; tol = 3)
        end

        # lengthscale ≠ 1: raw pos→pos+dir overshoots the drawn arrow; processed ends must hit
        fls = Figure(; size = (600, 450))
        axls = Axis3(fls[1, 1]; azimuth = 0.4, elevation = 0.5)
        arrows3d!(axls, apts, Makie.Vec3f[(2, 0, 0), (0, 2, 1), (-1, 0, 2)]; lengthscale = 0.5f0, color = :red)
        Makie.update_state_before_display!(fls)
        li = only(@test_logs auto_interactables(fls))
        _, ppuls, ctxls = ctx_for(fls)
        imgls = Makie.colorbuffer(fls; px_per_unit = ppuls)
        Lls = only(hitlayers(li, ctxls))
        for k in 0:2
            mx = (Lls.geometry[4k + 1] + Lls.geometry[4k + 3]) / 2
            my = (Lls.geometry[4k + 2] + Lls.geometry[4k + 4]) / 2
            @test color_near(isredc, imgls, mx, my; tol = 3)
        end
        # regression: a midpoint of raw pos→pos+dir (ignoring lengthscale) must NOT be required
        # to hit — at least one overshoots past the tip (proves we didn't use the raw recipe)
        raw_miss = false
        for k in 1:3
            raw_end = apts[k] .+ Makie.Vec3f[(2, 0, 0), (0, 2, 1), (-1, 0, 2)][k]
            q = data_to_image_px(ctxls, axls, (apts[k] .+ raw_end) ./ 2)
            # sample near the far end of the raw segment (t=0.9) — past the scaled tip
            qfar = data_to_image_px(ctxls, axls, apts[k] .+ 0.9 .* (raw_end .- apts[k]))
            raw_miss |= !color_near(isredc, imgls, qfar[1], qfar[2]; tol = 3)
        end
        @test raw_miss

        # anisotropic Axis3 limits: equal data-norm dirs get unequal world lengths; data-space
        # start→end still projects onto the drawn shafts (the child-space trap)
        fan = Figure(; size = (600, 450))
        axan = Axis3(fan[1, 1]; azimuth = 0.4, elevation = 0.5)
        limits!(axan, 0, 10, 0, 2, 0, 2)
        arrows3d!(
            axan,
            Makie.Point3f[(2, 1, 1), (5, 0.5, 0.5), (2, 1, 0.5)],
            Makie.Vec3f[(2, 0, 0), (0, 1, 0), (0, 0, 1)];
            color = :red,
        )
        Makie.update_state_before_display!(fan)
        ani = only(@test_logs auto_interactables(fan))
        _, ppuan, ctxan = ctx_for(fan)
        imgan = Makie.colorbuffer(fan; px_per_unit = ppuan)
        Lan = only(hitlayers(ani, ctxan))
        for k in 0:2
            mx = (Lan.geometry[4k + 1] + Lan.geometry[4k + 3]) / 2
            my = (Lan.geometry[4k + 2] + Lan.geometry[4k + 4]) / 2
            @test color_near(isredc, imgan, mx, my; tol = 4)
        end
    end
end
