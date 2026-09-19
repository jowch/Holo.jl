using Test, Masque, CairoMakie, Makie
include(joinpath(@__DIR__, "..", "testutils.jl"))

@testset "Backend" begin
    @testset "DPI from layout fact" begin
        (; ppu, ctx) = default_fixture()
        @test ppu == 2.0                              # 600 ≤ 700 column → render at 2×
        @test ctx.scaling == 2.0
        # a figure wider than the column renders at ~2× the column, not 2× itself
        fw = Figure(size = (1400, 400)); Axis(fw[1, 1])
        _, ppw, _ = ctx_for(fw)
        @test ppw == 2 * 700 / 1400                   # = 1.0  → output 1400 px = 2× column
    end

    @testset "context / transforms" begin
        (; ctx) = default_fixture()
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
        (; fig, ax, pts, ppu, ctx) = default_fixture()
        pin = PointInteractable(ax, pts; id = :scatter)
        @test validate(pin, ctx) === nothing
        L = only(hitlayers(pin, ctx))
        @test L.kind === :circles && length(L.geometry) == 9
        img = Makie.colorbuffer(fig; px_per_unit = ppu)
        for k in 0:2
            @test drawn_near(img, L.geometry[3k + 1], L.geometry[3k + 2])
        end
    end

    @testset "log-scale axes: element geometry lands on markers" begin
        # The 2-arg Makie.project(scene, p) expects TRANSFORMED coords — it does NOT apply the
        # scene's transform_func (verified empirically, Makie 0.24.12). The project closure must
        # apply the axis transform first; feeding raw data mis-places every element hit-region on
        # any non-identity-scale axis (regression: 0/5 on-marker on a log axis). Red markers +
        # red-pixel assert so gridlines/decorations can't false-pass drawn_near's notwhite check.
        fl = Figure(size = (600, 400))
        axl = Axis(fl[1, 1]; yscale = log10)
        lpts = [(1.0, 0.1), (2.0, 10.0), (3.0, 1000.0)]
        scatter!(axl, first.(lpts), last.(lpts); color = :red, markersize = 14)
        axb = Axis(fl[1, 2]; xscale = log10, yscale = log10)
        bpts = [(0.1, 0.5), (1.0, 5.0), (10.0, 50.0)]
        scatter!(axb, first.(bpts), last.(bpts); color = :red, markersize = 14)
        _, ppul, ctxl = ctx_for(fl)
        img = Makie.colorbuffer(fl; px_per_unit = ppul)
        isred(c) = Float64(Makie.red(c)) > 0.6 && Float64(Makie.green(c)) < 0.4 && Float64(Makie.blue(c)) < 0.4
        function red_near(cx, cy; tol = 6)
            ih, iw = size(img)
            x, y = round(Int, cx), round(Int, cy)
            for dy in -tol:tol, dx in -tol:tol
                xx, yy = x + dx, y + dy
                (1 <= xx <= iw && 1 <= yy <= ih) || continue
                isred(img[yy, xx]) && return true
            end
            return false
        end
        for (axk, pp) in ((axl, lpts), (axb, bpts))
            L = only(hitlayers(PointInteractable(axk, pp), ctxl))
            for k in 0:2
                @test red_near(L.geometry[3k + 1], L.geometry[3k + 2])
            end
        end
        # out-of-domain log input degrades to non-finite geometry (apply_transform throws
        # DomainError; the closure NaN-guards it) — never a crash, never a finite wrong pixel
        Lo = only(hitlayers(PointInteractable(axl, [(1.0, -5.0)]), ctxl))
        @test !isfinite(Lo.geometry[1]) && !isfinite(Lo.geometry[2])
        # log10(0.0) = -Inf does NOT throw — same non-finite degrade via plain propagation
        Lz = only(hitlayers(PointInteractable(axl, [(1.0, 0.0)]), ctxl))
        @test !isfinite(Lz.geometry[2])
    end

    @testset "log-scale axes: Float64-precision transform + grid edges" begin
        # transform runs in Float64 (input precision): x=1e39 overflows Float32 to Inf
        # (losing the marker) but is an ordinary log-axis value in Float64 (log10 → 39)
        fh = Figure(size = (600, 400))
        axh = Axis(fh[1, 1]; xscale = log10)
        hpts = [(1.0e10, 1.0), (1.0e39, 2.0)]
        scatter!(axh, first.(hpts), last.(hpts); color = :red, markersize = 14)
        # grid on a log axis: the per-edge companion-coordinate projection path. Centers
        # chosen so Makie's LINEAR edge expansion stays positive (centers [1,10,100] would
        # give a -3.5 edge → Makie itself throws log10(-3.5) in its boundingbox pass).
        axg = Axis(fh[1, 2]; yscale = log10)
        hm = heatmap!(axg, [1.0, 2.0, 3.0], [10.0, 20.0, 30.0], rand(3, 3))
        _, ppuh, ctxh = ctx_for(fh)
        img = Makie.colorbuffer(fh; px_per_unit = ppuh)
        isred(c) = Float64(Makie.red(c)) > 0.6 && Float64(Makie.green(c)) < 0.4 && Float64(Makie.blue(c)) < 0.4
        function red_near(cx, cy; tol = 6)
            ih, iw = size(img)
            x, y = round(Int, cx), round(Int, cy)
            for dy in -tol:tol, dx in -tol:tol
                xx, yy = x + dx, y + dy
                (1 <= xx <= iw && 1 <= yy <= ih) || continue
                isred(img[yy, xx]) && return true
            end
            return false
        end
        L = only(hitlayers(PointInteractable(axh, [hpts[1]]), ctxh))
        @test red_near(L.geometry[1], L.geometry[2])
        # The closure transforms in Float64: 1e39 — Inf32 if cast to Float32 first — projects
        # to a finite pixel on its rendered marker via the direct projection contract.
        # (PointInteractable STORAGE is Point2f, so the struct-mediated path keeps a
        # floatmax(Float32) ceiling; the closure no longer adds its own. Storage widening
        # is WS-3D scope, where those fields are already being touched.)
        q = data_to_image_px(ctxh, axh, (1.0e39, 2.0))
        @test all(isfinite, q)
        @test red_near(q[1], q[2])
        # grid edges: finite, monotonic in image px (y flips: data ↑ → image y ↓), inside viewport
        Lg = only(hitlayers(RectInteractable(axg, hm), ctxh))
        ye = Lg.geometry["yedges"]
        vp = ctxh.transforms[:ax2].viewport
        @test all(isfinite, ye) && issorted(ye; rev = true)
        @test all(vp[2] - 1 <= y <= vp[2] + vp[4] + 1 for y in ye)
    end

    @testset "geometry quantized to integer pixels" begin
        # finite per-element geometry ships as Int (1–3 B/coord in MsgPack vs Float32's 5) — docs/dev/architecture.md §9.
        # Containers are Real[] (so non-finite coords can pass through), so assert the *values*, not eltype.
        (; ax, pts, ctx) = default_fixture()
        allint(g) = all(x -> !isfinite(x) || x isa Integer, g)   # finite coords are Int
        L = only(hitlayers(PointInteractable(ax, pts), ctx))
        @test allint(L.geometry)
        q = data_to_image_px(ctx, ax, pts[1])
        @test L.geometry[1] == round(Int, q[1]) && L.geometry[2] == round(Int, q[2])  # within ≤0.5px of the projection
        @test allint(only(hitlayers(SegmentInteractable(ax, pts), ctx)).geometry)
        @test allint(only(hitlayers(RectInteractable(ax; rects = [(2.0, 5.0, 1.0, 2.0)]), ctx)).geometry)
        @test allint(only(hitlayers(PolygonInteractable(ax, [[(1.0, 1.0), (2.0, 4.0), (3.0, 1.0)]]), ctx)).geometry[1])
        # grid edges are quantized too — the sub-pixel cap math reads these Int edges
        gridL = only(hitlayers(RectInteractable(ax; grid = (0.5:1:3.5, 0.5:1:3.5, rand(3, 3))), ctx))
        @test allint(gridL.geometry["xedges"]) && allint(gridL.geometry["yedges"])
        # AxisTransform stays Float64 — the drag path inverts pixel→data through it (must not quantize)
        @test ctx.transforms[:ax1].viewport[3] isa Float64
    end

    @testset "non-finite projection degrades, never crashes" begin
        # element layers are un-gated on scale (docs/dev/architecture.md §3); a log out-of-domain point projects to
        # NaN/±Inf. `_q` must pass it through (round(Int, NaN) throws) so masque degrades, not crashes.
        (; ax, ctx) = default_fixture()
        finite_int(g) = all(x -> !isfinite(x) || x isa Integer, g)
        flog = Figure(); axlog = Axis(flog[1, 1]; xscale = log10)
        scatter!(axlog, [1.0, 10.0], [1.0, 10.0])
        _, _, clog = ctx_for(flog)
        L = only(hitlayers(PointInteractable(axlog, [(-5.0, 1.0), (1.0, 1.0)]), clog))  # x=-5 out of log domain
        @test length(L.geometry) == 6      # reaching here = no InexactError crash (the regression)
        @test finite_int(L.geometry)       # the in-domain point still quantizes to Int
        # :polyline NaN-gap sentinel (types.ts) survives quantization — stays NaN, doesn't crash/round
        seg = only(hitlayers(SegmentInteractable(ax, [(1.0, 1.0), (NaN, NaN), (3.0, 3.0)]), ctx))
        @test any(isnan, seg.geometry) && finite_int(seg.geometry)
    end

    @testset "validate is per-capability" begin
        pts = DEFAULT_PTS
        fl = Figure(); axl = Axis(fl[1, 1]; xscale = sqrt)   # sqrt: not JS-invertible
        scatter!(axl, [1.0, 2.0, 3.0], [1.0, 2.0, 3.0])
        _, _, ctxl = ctx_for(fl)
        @test validate(PointInteractable(axl, pts), ctxl) === nothing    # element type: no gate
        @test validate(AxisInteractable(axl), ctxl) isa String          # axis readout: gated, fails loud
        fg = Figure(); axg = Axis(fg[1, 1]; yscale = log10); scatter!(axg, [1.0, 2.0], [1.0, 10.0])
        _, _, ctxg = ctx_for(fg)
        @test validate(AxisInteractable(axg), ctxg) === nothing          # log is invertible
    end

    @testset "fail loud on unsupported axis types" begin
        # PolarAxis is supported since this PR; LScene remains deferred (roadmap).
        fu = Figure(); LScene(fu[1, 1])
        err = (@test_throws ArgumentError ctx_for(fu)).value
        @test occursin("supports `Makie.Axis`, `Makie.Axis3`, and `Makie.PolarAxis`", err.msg)
        @test occursin("WGLMakie", err.msg)       # steers to the backend that renders LScene today
        @test occursin("scoping guard", err.msg)  # framing: Masque scoping, not a CairoMakie capability limit
        @test occursin("LScene", err.msg)
    end
end

@testset "AxisTransform valueaxis field + serialization" begin
    using Masque: AxisTransform, _transform_dict
    # a normal axis transform defaults valueaxis = nothing → serializes to nothing
    t = AxisTransform(
        :ax1, (0.0, 1.0), (0.0, 2.0), :identity, :identity,
        (0.0, 0.0, 10.0, 20.0), false, false, nothing, nothing, nothing, false, false
    )
    @test t.valueaxis === nothing
    d = _transform_dict(t)
    @test haskey(d, "valueaxis")
    @test d["valueaxis"] === nothing
    @test d["is3d"] === false
    @test d["ispolar"] === false
    # a colorbar-style transform tags the value axis
    tc = AxisTransform(
        :cb1, (0.0, 1.0), (0.0, 2.0), :identity, :log10,
        (0.0, 0.0, 10.0, 20.0), false, false, nothing, nothing, :y, false, false
    )
    @test _transform_dict(tc)["valueaxis"] == "y"
end

@testset "Colorbar transform in context" begin
    using Masque: axis_id, build_manifest
    fig = Figure()
    ax = Axis(fig[1, 1])
    hm = heatmap!(ax, rand(10, 10))
    cb = Colorbar(fig[1, 2], hm)
    Makie.update_state_before_display!(fig)
    _, _, ctx = ctx_for(fig)                          # helper: render + build context
    tid = axis_id(ctx, cb)
    @test haskey(ctx.transforms, tid)
    t = ctx.transforms[tid]
    @test t.valueaxis === :y                          # vertical colorbar → value on y
    @test t.ylims == (Float64(cb.limits[][1]), Float64(cb.limits[][2]))
    @test t.yscale === :identity                      # default heatmap colorbar is identity
    # the colorbar viewport (image px) sits to the right of the axis viewport and has the bar's aspect
    axt = ctx.transforms[axis_id(ctx, ax)]
    @test t.viewport[1] > axt.viewport[1]             # colorbar is right of the axis
    @test t.viewport[3] < t.viewport[4]               # a vertical bar: width < height
    # the transform survives serialization into the JS-facing manifest
    m = build_manifest([], ctx)
    @test haskey(m["transforms"], string(tid))
    @test m["transforms"][string(tid)]["valueaxis"] == "y"

    # horizontal colorbar → value runs along x
    figh = Figure()
    axh = Axis(figh[1, 1])
    hmh = heatmap!(axh, rand(10, 10))
    cbh = Colorbar(figh[2, 1], hmh; vertical = false)
    Makie.update_state_before_display!(figh)
    _, _, ctxh = ctx_for(figh)
    th = ctxh.transforms[axis_id(ctxh, cbh)]
    @test th.valueaxis === :x
    @test th.xlims == (Float64(cbh.limits[][1]), Float64(cbh.limits[][2]))
    @test th.xscale === :identity
    @test th.viewport[3] > th.viewport[4]             # a horizontal bar: width > height
end

@testset "ColorbarInteractable" begin
    using Masque: ColorbarInteractable, hitlayers, validate
    fig = Figure(); ax = Axis(fig[1, 1]); hm = heatmap!(ax, rand(10, 10))
    cb = Colorbar(fig[1, 2], hm)
    Makie.update_state_before_display!(fig)
    _, _, ctx = ctx_for(fig)
    ci = ColorbarInteractable(cb; id = :colorbar)
    @test validate(ci, ctx) === nothing                     # identity scale is invertible
    ls = hitlayers(ci, ctx)
    @test length(ls) == 1
    L = ls[1]
    @test L.kind === :axis
    @test L.id === :colorbar
    @test L.geometry isa AbstractVector && length(L.geometry) == 4   # bbox rect [x,y,w,h] (bounded)
    @test L.axis == Masque.axis_id(ctx, cb)                   # references the colorbar transform
    @test isempty(L.payloads)                               # value computed client-side

    # non-invertible scale fails loud (colorscale on the heatmap propagates to cb.scale[])
    fig2 = Figure(); ax2 = Axis(fig2[1, 1])
    hm2 = heatmap!(ax2, rand(10, 10); colorscale = Makie.pseudolog10)
    cb2 = Colorbar(fig2[1, 2], hm2)
    Makie.update_state_before_display!(fig2)
    _, _, ctx2 = ctx_for(fig2)
    ci2 = ColorbarInteractable(cb2; id = :colorbar)
    @test validate(ci2, ctx2) isa String                    # rejected with a message
end

@testset "masque(fig) auto-detects Colorbar" begin
    using Masque: auto_interactables, ColorbarInteractable
    fig = Figure(); ax = Axis(fig[1, 1]); hm = heatmap!(ax, rand(10, 10))
    Colorbar(fig[1, 2], hm)
    Makie.update_state_before_display!(fig)
    ints = auto_interactables(fig)
    cbs = filter(i -> i isa ColorbarInteractable, ints)
    @test length(cbs) == 1
    @test cbs[1].id === :colorbar
    # end-to-end: the emitted layer round-trips through the context
    _, _, ctx = ctx_for(fig)
    L = only(hitlayers(cbs[1], ctx))
    @test L.kind === :axis && length(L.geometry) == 4
    # two colorbars → two ColorbarInteractables with distinct ids
    fig2 = Figure()
    ax2 = Axis(fig2[1, 1])
    hm2a = heatmap!(ax2, rand(10, 10))
    ax2b = Axis(fig2[2, 1])
    hm2b = heatmap!(ax2b, rand(5, 5))
    Colorbar(fig2[1, 2], hm2a)
    Colorbar(fig2[2, 2], hm2b)
    Makie.update_state_before_display!(fig2)
    cbs2 = filter(i -> i isa ColorbarInteractable, auto_interactables(fig2))
    @test length(cbs2) == 2
    @test Set(c.id for c in cbs2) == Set([:colorbar, :colorbar_2])
end
