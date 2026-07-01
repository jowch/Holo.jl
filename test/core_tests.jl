using Holo
using Holo: hitlayers, validate, events, HitLayer, build_manifest, HoloWidget
import Holo as IP
using CairoMakie
import Makie
using Test

# CairoBackend now lives in the extension (weak CairoMakie dep) — reach it via
# Base.get_extension rather than a bare name, same pattern the extension itself uses.
const _CairoExt = Base.get_extension(Holo, :HoloCairoMakieExt)

# finalize + context the way holo does internally
function ctx_for(fig; max_width = 700)
    bk = _CairoExt.CairoBackend(; max_width)
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

    @testset "geometry quantized to integer pixels" begin
        # finite per-element geometry ships as Int (1–3 B/coord in MsgPack vs Float32's 5) — architecture.md §9.
        # Containers are Real[] (so non-finite coords can pass through), so assert the *values*, not eltype.
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
        # element layers are un-gated on scale (architecture.md §3); a log out-of-domain point projects to
        # NaN/±Inf. `_q` must pass it through (round(Int, NaN) throws) so holo degrades, not crashes.
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

    @testset "RectInteractable grid drops sub-pixel values[]" begin
        # 1000² grid on a ~700px column → ~0.7 px/cell on screen, below the targetability floor:
        # ship edges+dims (hit-testing needs only those), drop the source-resolution values[] matrix.
        fb = Figure(); axb = Axis(fb[1, 1]); zb = rand(Float32, 1000, 1000); heatmap!(axb, zb)
        _, _, ctxb = ctx_for(fb)
        # This is the suite's only sub-pixel grid, so it's the sole trigger of the @warn (maxlog=1 is
        # per-call-site per-process): keep it that way, or the warn is suppressed and this assert sees 0 logs.
        L = (@test_logs (:warn, r"sub-pixel"i) only(hitlayers(RectInteractable(axb; grid = (0.5:1:1000.5, 0.5:1:1000.5, zb)), ctxb)))
        @test L.kind === :grid
        @test L.geometry["ncols"] == 1000 && length(L.geometry["xedges"]) == 1001  # hit-test still works
        @test !haskey(L.geometry, "values")                                        # the unbounded term is gone
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

    @testset "TextInteractable" begin
        f = Figure(size = (600, 400)); ax = Axis(f[1, 1]); scatter!(ax, 1:3, 1:3)
        t = text!(ax, [1.5, 2.5], [2.0, 1.0]; text = ["Hello", "Wörld"], fontsize = 20)
        bk, ppu, ctx = ctx_for(f)          # finalizes (update_state_before_display!) + builds ctx
        ti = TextInteractable(ax, t)
        # payload: (; text, index, x, y) — 0-based index, DATA anchors
        @test ti.payloads[1] == (; text = "Hello", index = 0, x = 1.5, y = 2.0)
        @test ti.payloads[2] == (; text = "Wörld", index = 1, x = 2.5, y = 1.0)
        # hitlayer: one :rects layer, 2 boxes × (cx,cy,w,h) = 8 coords
        L = only(hitlayers(ti, ctx))
        @test L.kind === :rects && length(L.geometry) == 8
        # the box centers land on rendered glyphs (non-white pixels near center)
        img = Makie.colorbuffer(f; px_per_unit = ppu)
        for k in 0:1
            @test drawn_near(img, L.geometry[4k + 1], L.geometry[4k + 2])
        end
        # the projected data anchor lies within its label's box
        for (k, anchor) in enumerate(((1.5, 2.0), (2.5, 1.0)))
            aimg = data_to_image_px(ctx, ax, anchor)
            cx, cy, w, h = L.geometry[(4k - 3):(4k)]
            @test (cx - w / 2 - 1) <= aimg[1] <= (cx + w / 2 + 1)
            @test (cy - h / 2 - 2) <= aimg[2] <= (cy + h / 2 + 2)
        end
    end

    @testset "Segment + Axis + custom" begin
        @test only(hitlayers(SegmentInteractable(ax, pts; mode = :polyline), ctx)).kind === :polyline
        @test only(hitlayers(AxisInteractable(ax), ctx)).geometry === nothing
        ri = RegionInteractable(
            ax; regions = [(:circle, (1.0, 1.0), 10), (:rect, (2.0, 4.0), 1.0, 2.0)],
            payloads = ["a", "b"], tooltip = holo"region"
        )
        @test Set(L.kind for L in hitlayers(ri, ctx)) == Set([:circles, :rects])
        @test IP.tooltip_spec(ri) isa Holo.Markup
        fi = FunctionInteractable(c -> [HitLayer(:f, :circles, Float32[10, 10, 5], Any[(; v = 1)], :ax1, (:click,))])
        @test only(hitlayers(fi, ctx)).id === :f
    end

    @testset "ThresholdInteractable (M4 drag)" begin
        th = ThresholdInteractable(ax; orientation = :horizontal, value = 4.0)
        @test events(th) == (:drag,)
        @test validate(th, ctx) === nothing
        L = only(hitlayers(th, ctx))
        @test L.kind === :threshold
        t = ctx.transforms[L.axis]
        # horizontal: pos = projected pixel-y of data-y; span = viewport x-extent
        @test L.geometry["orientation"] == "h"
        @test L.geometry["pos"] ≈ data_to_image_px(ctx, ax, (t.xlims[1], 4.0))[2]
        @test L.geometry["span"] ≈ [t.viewport[1], t.viewport[1] + t.viewport[3]]
        # vertical projects x; span = viewport y-extent
        Lv = only(hitlayers(ThresholdInteractable(ax; orientation = :vertical, value = 2.0), ctx))
        @test Lv.geometry["orientation"] == "v"
        @test Lv.geometry["pos"] ≈ data_to_image_px(ctx, ax, (2.0, t.ylims[1]))[1]
        @test Lv.geometry["span"] ≈ [t.viewport[2], t.viewport[2] + t.viewport[4]]
        # fail loud: horizontal drag needs an invertible y-scale
        fs = Figure(); axs = Axis(fs[1, 1]; yscale = sqrt); scatter!(axs, [1.0, 2.0], [1.0, 2.0])
        _, _, ctxs = ctx_for(fs)
        @test validate(ThresholdInteractable(axs; orientation = :horizontal, value = 1.0), ctxs) isa String
        @test validate(ThresholdInteractable(axs; orientation = :vertical, value = 1.0), ctxs) === nothing  # x is identity
        @test_throws ArgumentError ThresholdInteractable(ax; orientation = :diagonal, value = 1.0)
        # end-to-end: the :threshold layer serializes through build_manifest (Dict geometry + drag event)
        mt = build_manifest([th], ctx)["layers"][1]
        @test mt["kind"] == "threshold" && mt["events"] == ["drag"]
        @test mt["geometry"]["orientation"] == "h" && haskey(mt["geometry"], "pos") && haskey(mt["geometry"], "span")
        @test isempty(mt["payloads"]) && !haskey(mt, "tooltips")   # computed client-side, no payloads/tooltips
    end

    @testset "ROIInteractable (M4 drag cut 2)" begin
        r = ROIInteractable(ax; bounds = (1.0, 3.0, 2.0, 8.0))
        @test events(r) == (:drag,)
        @test validate(r, ctx) === nothing
        L = only(hitlayers(r, ctx))
        @test L.kind === :roi
        a = data_to_image_px(ctx, ax, (1.0, 2.0)); b = data_to_image_px(ctx, ax, (3.0, 8.0))
        @test L.geometry["x"] ≈ min(a[1], b[1])
        @test L.geometry["y"] ≈ min(a[2], b[2])
        @test L.geometry["w"] ≈ abs(b[1] - a[1])
        @test L.geometry["h"] ≈ abs(b[2] - a[2])
        @test L.geometry["handle"] ≈ 8 * ctx.scaling
        # fail loud: a non-invertible scale on EITHER axis
        fs = Figure(); axs = Axis(fs[1, 1]; yscale = sqrt); scatter!(axs, [1.0, 2.0], [1.0, 2.0])
        _, _, ctxs = ctx_for(fs)
        @test validate(ROIInteractable(axs; bounds = (1.0, 2.0, 1.0, 2.0)), ctxs) isa String
        @test_throws ArgumentError ROIInteractable(ax; bounds = (3.0, 1.0, 2.0, 8.0))   # xmin >= xmax
        @test_throws ArgumentError ROIInteractable(ax; bounds = (1.0, 3.0, 8.0, 2.0))   # ymin >= ymax
        # xscale non-invertible also fails loud
        fxx = Figure(); axx = Axis(fxx[1, 1]; xscale = sqrt); scatter!(axx, [1.0, 2.0], [1.0, 2.0])
        _, _, ctxx = ctx_for(fxx)
        @test validate(ROIInteractable(axx; bounds = (1.0, 2.0, 1.0, 2.0)), ctxx) isa String
        # categorical axes rejected (no numeric bounds)
        fc2 = Figure(); axc2 = Axis(fc2[1, 1]; dim1_conversion = Makie.CategoricalConversion())
        scatter!(axc2, ["a", "b", "c"], [1.0, 2.0, 3.0])
        _, _, ctxc2 = ctx_for(fc2)
        @test validate(ROIInteractable(axc2; bounds = (1.0, 2.0, 1.0, 2.0)), ctxc2) isa String
        # end-to-end: the :roi layer serializes through build_manifest
        mr = build_manifest([r], ctx)["layers"][1]
        @test mr["kind"] == "roi" && mr["events"] == ["drag"]
        @test all(k -> haskey(mr["geometry"], k), ("x", "y", "w", "h", "handle"))
        @test isempty(mr["payloads"]) && !haskey(mr, "tooltips")
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

    @testset "transform_value multi-select envelope" begin
        using Holo: InteractionEvent
        tv = Holo.APD.Bonds.transform_value
        w = Holo.HoloWidget("", Dict{String, Any}(), 100)   # transform_value ignores the widget fields
        @test tv(w, nothing) === nothing
        # single (click / bounds) — unchanged
        single = tv(w, Dict("layer" => "pts", "index" => 3, "payload" => Dict("city" => "NYC")))
        @test single isa InteractionEvent && single.layer === :pts && single.index == 3
        # multi (box-select over points)
        multi = tv(
            w, Dict(
                "items" => [
                    Dict("layer" => "pts", "index" => 1, "payload" => Dict("v" => 10)),
                    Dict("layer" => "pts", "index" => 4, "payload" => Dict("v" => 40)),
                ]
            )
        )
        @test multi isa Vector{InteractionEvent} && length(multi) == 2
        @test multi[1].index == 1 && multi[2].index == 4
        # empty box — empty vector, never nothing
        empty = tv(w, Dict("items" => []))
        @test empty isa Vector{InteractionEvent} && isempty(empty)
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

    @testset "markup parse + validation" begin
        m = holo"<b>$(name)</b> — $(pop:,) people ($(share:.1%))"
        @test m isa Holo.Markup
        @test m.fields == [:name, :pop, :share]
        @test count(s -> s isa Holo.Field, m.segments) == 3
        @test m.segments[2] == Holo.Field(:name, nothing)
        @test any(s -> s isa Holo.Field && s.spec == ",", m.segments)

        # macro-time structural errors
        for bad in ["<b>\$(name</b>", "x = \$5", "<b>\$()</b>", "\$(pop + 1)", "\$(pop:.2z)"]
            @test_throws Holo.TemplateValidationError Holo.parse_template(bad)
        end

        # spec accept / reject
        for ok in [",", ".2f", ",.0f", ".1%", "\$,.2f", ".3s", "+.1e", "~g"]
            @test Holo._valid_spec(ok)
        end
        @test !Holo._valid_spec(".2z")
        # an empty spec after `:` is a typo, not the default — rejected
        @test_throws Holo.TemplateValidationError Holo.parse_template("\$(x:)")

        # showerror renders a caret
        e = try
            Holo.parse_template("\$(pop:.2z)")
        catch err
            err
        end
        @test occursin("^", sprint(showerror, e))
    end

    @testset "markup field check + segments" begin
        m = holo"<b>$(name)</b> — $(pop:,)"
        @test Holo.check_fields(m, (:name, :pop)) === m            # all present → returns m
        @test_throws ArgumentError Holo.check_fields(m, (:name,))  # pop missing
        err = try
            Holo.check_fields(holo"$(nam)", (:name, :pop))
        catch e
            e
        end
        @test occursin("did you mean `name`", sprint(showerror, err))

        seg = Holo.markup_segments(m)
        @test seg[1] == "<b>"
        @test seg[2] == Dict("f" => "name")
        @test any(s -> s == Dict("f" => "pop", "spec" => ","), seg)
    end

    @testset "tooltip_* style kwargs" begin
        @test isempty(Holo.tip_style_dict())                                  # nothing set → empty
        d = Holo.tip_style_dict(; tooltip_bg = :red, tooltip_font_size = 13, tooltip_caret = false)
        @test d["--holo-tip-bg"] == "rgb(255,0,0)"                            # Makie color → CSS
        @test d["--holo-tip-font-size"] == "13px"
        @test d["--holo-tip-caret"] == "none"
        @test Holo.tip_style_dict(; tooltip_bg = "#abc")["--holo-tip-bg"] == "#abc"  # CSS string passthrough
        @test !haskey(Holo.tip_style_dict(; tooltip_bg = :red), "--holo-tip-color")  # unset omitted
    end

    @testset "tooltip_spec on interactables" begin
        pts = [(1.0, 1.0), (2.0, 2.0)]
        @test Holo.tooltip_spec(PointInteractable(ax, pts)) === nothing
        pi = PointInteractable(ax, pts; tooltip = holo"$(x)")
        @test Holo.tooltip_spec(pi) isa Holo.Markup
        @test Holo.tooltip_spec(PointInteractable(ax, pts; tooltip = false)) === false
        ri = RegionInteractable(ax; regions = [(:circle, (1.0, 1.0), 0.5)], payloads = [(; n = "a")], tooltip = holo"$(n)")
        @test Holo.tooltip_spec(ri) isa Holo.Markup
    end

    @testset "manifest tooltip wiring" begin
        pts2 = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0)]
        pi = PointInteractable(ax, pts2; tooltip = holo"x=$(x), y=$(y)")
        man = build_manifest([pi], ctx; tip_style = Holo.tip_style_dict(; tooltip_bg = :red))
        L = man["layers"][1]
        @test haskey(L, "template")
        @test !haskey(L, "tooltips")                       # old per-element array removed
        @test L["template"][1] == "x="
        @test man["tipStyle"]["--holo-tip-bg"] == "rgb(255,0,0)"

        off = build_manifest([PointInteractable(ax, pts2; tooltip = false)], ctx)
        @test off["layers"][1]["tooltip"] === false
        @test !haskey(build_manifest([PointInteractable(ax, pts2)], ctx), "tipStyle")

        # bad field → build-time error
        bad = PointInteractable(ax, pts2; tooltip = holo"$(nope)")
        @test_throws ArgumentError build_manifest([bad], ctx)

        # `tooltip = true` is meaningless (only `false` suppresses) → fail loud
        @test_throws ArgumentError build_manifest([PointInteractable(ax, pts2; tooltip = true)], ctx)
    end

    @testset "AbstractSelector / ROIInteractable selects" begin
        using Holo: selects, compatible_kinds, ROIInteractable, AbstractSelector
        fig = Figure(); ax = Axis(fig[1, 1]); lines!(ax, 1:10, 1:10)
        roi = ROIInteractable(ax; bounds = (2.0, 8.0, 2.0, 8.0))
        @test roi isa AbstractSelector
        @test selects(roi) === nothing
        @test compatible_kinds(roi) == (:circles, :grid)
        roi2 = ROIInteractable(ax; bounds = (2.0, 8.0, 2.0, 8.0), selects = :pts)
        @test selects(roi2) === :pts
    end

    @testset "selects: manifest field + selector validation (M4 Task 3)" begin
        pts_i = PointInteractable(ax, [(1.0, 1.0), (5.0, 5.0)]; id = :pts)
        seg_i = SegmentInteractable(ax, [(1.0, 1.0), (5.0, 5.0)]; id = :segs)
        roi_bare = ROIInteractable(ax; bounds = (2.0, 8.0, 2.0, 8.0))
        roi_linked = ROIInteractable(ax; bounds = (2.0, 8.0, 2.0, 8.0), selects = :pts)

        # ROI without selects: no "selects" key in layer dict
        @test !haskey(build_manifest([roi_bare], ctx)["layers"][1], "selects")

        # ROI with selects = :pts: "selects" => "pts" in layer dict; circles layer gets no "selects"
        layers_sel = build_manifest([pts_i, roi_linked], ctx)["layers"]
        roi_d = filter(l -> l["kind"] == "roi", layers_sel) |> only
        @test roi_d["selects"] == "pts"
        @test !haskey(filter(l -> l["kind"] == "circles", layers_sel) |> only, "selects")

        # Validation: target layer absent → ArgumentError
        @test_throws ArgumentError build_manifest(
            [ROIInteractable(ax; bounds = (2.0, 8.0, 2.0, 8.0), selects = :ghost)], ctx
        )

        # did-you-mean: :pt is within edit-distance 2 of :pts → suggestion appears in error message
        err = try
            build_manifest(
                [pts_i, ROIInteractable(ax; bounds = (2.0, 8.0, 2.0, 8.0), selects = :pt)], ctx
            )
            nothing
        catch e
            e
        end
        @test err isa ArgumentError && occursin("pts", err.msg)

        # Validation: target exists but kind not in compatible_kinds (:polyline ∉ (:circles,:grid)) → error
        @test_throws ArgumentError build_manifest(
            [seg_i, ROIInteractable(ax; bounds = (2.0, 8.0, 2.0, 8.0), selects = :segs)], ctx
        )

        # happy path: valid selects → manifest ROI layer carries "selects"; no error thrown
        m_ok = build_manifest([pts_i, roi_linked], ctx)
        @test filter(l -> l["kind"] == "roi", m_ok["layers"]) |> only |> l -> l["selects"] == "pts"
    end

    @testset "HSpan + VSpan extraction" begin
        using Holo: RectInteractable, auto_interactables
        fig = Figure(); ax = Axis(fig[1, 1]); lines!(ax, 0 .. 10, sin)   # give the axis finite limits
        hspan!(ax, [1.0, 3.0], [2.0, 4.0])
        Makie.update_state_before_display!(fig)
        hp = ax.scene.plots[end]                                  # the HSpan
        ri = RectInteractable(ax, hp; id = :hspan)
        @test length(ri.payloads) == 2
        @test ri.payloads[1] == (; low = 1.0, high = 2.0)
        @test ri.payloads[2] == (; low = 3.0, high = 4.0)

        fig2 = Figure(); ax2 = Axis(fig2[1, 1]); lines!(ax2, 0 .. 10, cos)
        vspan!(ax2, [1.0, 3.0], [2.0, 4.0])
        Makie.update_state_before_display!(fig2)
        ri2 = RectInteractable(ax2, ax2.scene.plots[end]; id = :vspan)
        @test ri2.payloads[1] == (; low = 1.0, high = 2.0)
        @test length(ri2.payloads) == 2
        @test ri2.payloads[2] == (; low = 3.0, high = 4.0)
    end

    @testset "HSpan/VSpan hit-rect bounded to axis limits (anti-bleed)" begin
        # Regression: span hit-rects must clamp the full-axis dimension to ax.finallimits[],
        # not rely on the child Poly's HyperRectangle (which can exceed axis limits in some
        # Makie versions / async Pluto scenarios, causing the rect to bleed into a neighboring
        # axis's viewport at the same pixel column/row).
        using Holo: RectInteractable
        fv = Figure(); axv = Axis(fv[1, 1])
        xlims!(axv, 0, 10); ylims!(axv, 0, 5)
        vspan!(axv, [2.0], [3.0])
        Makie.update_state_before_display!(fv)
        vp = only(filter(p -> p isa Makie.VSpan, axv.scene.plots))
        riv = RectInteractable(axv, vp; id = :vspan)
        # VSpan fills the Y axis: y-extent must equal the axis y-height (5.0), not exceed it.
        # x-extent is the band's own data range [2, 3].
        cx, cy, w, h = riv.data[1]
        @test cx ≈ 2.5          # band x-center  (2+3)/2
        @test cy ≈ 2.5          # axis y-center   (0+5)/2  ← from finallimits
        @test w ≈ 1.0           # band x-width    3-2
        @test h ≈ 5.0           # axis y-height   5-0  ← from finallimits, NOT a larger number

        fh = Figure(); axh = Axis(fh[1, 1])
        xlims!(axh, 0, 10); ylims!(axh, 0, 5)
        hspan!(axh, [1.0], [3.0])
        Makie.update_state_before_display!(fh)
        hp = only(filter(p -> p isa Makie.HSpan, axh.scene.plots))
        rih = RectInteractable(axh, hp; id = :hspan)
        # HSpan fills the X axis: x-extent must equal the axis x-width (10.0), not exceed it.
        # y-extent is the band's own data range [1, 3].
        cx2, cy2, w2, h2 = rih.data[1]
        @test cx2 ≈ 5.0         # axis x-center   (0+10)/2  ← from finallimits
        @test cy2 ≈ 2.0         # band y-center   (1+3)/2
        @test w2 ≈ 10.0         # axis x-width    10-0  ← from finallimits, NOT a larger number
        @test h2 ≈ 2.0          # band y-height   3-1
    end

    @testset "VSpan/HSpan pixel-space rect bounded to owning axis viewport (multi-axis)" begin
        # Regression: in a 2×2 figure the vspan on a4 (bottom-right) must not bleed in
        # PIXEL SPACE into a2 (top-right). The data-space rect is correct (uses finallimits),
        # but integer quantization (_q) can expand h by up to 0.5px beyond the viewport bounds.
        # Fix: viewport-clamp in pixel space before emitting geometry (ceil/floor inward).
        # This test uses the exact 2×2 repro that was live-verified to exhibit the bleed.
        using Holo: RectInteractable, axis_id
        f = Figure(size = (760, 520))
        a2 = Axis(f[1, 2]); waterfall!(a2, 1:4, [3.0, -1.0, 2.0, -0.5])
        a4 = Axis(f[2, 2])
        barplot!(a4, 1:3, [2.0, 3.0, 1.0])
        hspan!(a4, [0.4], [0.8])
        vspan!(a4, [1.6], [2.0])
        _, _, ctx = ctx_for(f)          # calls update_state_before_display! + builds context

        t4 = ctx.transforms[axis_id(ctx, a4)]
        vp_x, vp_y, vp_w, vp_h = t4.viewport   # image-px, top-left origin

        # ── VSpan on a4: the Y-extent fills the full axis ──────────────────────────────
        vspan_plot = only(filter(p -> p isa Makie.VSpan, a4.scene.plots))
        L_vs = only(hitlayers(RectInteractable(a4, vspan_plot; id = :vspan), ctx))
        g = L_vs.geometry   # [cx, cy, w, h] (integer image-px)
        vs_top = g[2] - g[4] / 2     # top edge in image-px (y-axis: small = toward top)
        vs_bot = g[2] + g[4] / 2
        @test vs_top >= vp_y          # vspan top edge must not poke above a4's viewport
        @test vs_bot <= vp_y + vp_h  # vspan bottom edge must not poke below a4's viewport

        # ── HSpan on a4: the X-extent fills the full axis ──────────────────────────────
        hspan_plot = only(filter(p -> p isa Makie.HSpan, a4.scene.plots))
        L_hs = only(hitlayers(RectInteractable(a4, hspan_plot; id = :hspan), ctx))
        gh = L_hs.geometry
        hs_left = gh[1] - gh[3] / 2
        hs_right = gh[1] + gh[3] / 2
        @test hs_left >= vp_x          # hspan left edge must not poke left of a4's viewport
        @test hs_right <= vp_x + vp_w  # hspan right edge must not poke right of a4's viewport
    end

    @testset "payload-length validation (Segment/Rect/Polygon)" begin
        using Holo: SegmentInteractable, RectInteractable, PolygonInteractable
        fig = Figure(); ax = Axis(fig[1, 1])
        # RectInteractable list: 2 rects, wrong + right payload counts
        rects = [(0.0, 0.0, 1.0, 1.0), (2.0, 2.0, 1.0, 1.0)]
        @test_throws ArgumentError RectInteractable(ax; rects, payloads = [(; a = 1)])           # too short
        @test_throws ArgumentError RectInteractable(ax; rects, payloads = [(; a = 1), (; a = 2), (; a = 3)])  # too long
        @test RectInteractable(ax; rects, payloads = [(; a = 1), (; a = 2)]) isa RectInteractable  # exact
        # SegmentInteractable :pairs — 2 vertices = 1 segment
        @test_throws ArgumentError SegmentInteractable(ax, [Point2f(0, 0), Point2f(1, 1)]; mode = :pairs, payloads = [(; a = 1), (; a = 2)])  # too long
        @test_throws ArgumentError SegmentInteractable(ax, [Point2f(0, 0), Point2f(1, 1), Point2f(2, 2), Point2f(3, 3)]; mode = :pairs, payloads = [(; a = 1)])  # too short: 2 segments, 1 payload
        @test SegmentInteractable(ax, [Point2f(0, 0), Point2f(1, 1)]; mode = :pairs, payloads = [(; a = 1)]) isa SegmentInteractable  # exact
        # PolygonInteractable — 1 ring
        ring = [Point2f(0, 0), Point2f(1, 0), Point2f(1, 1)]
        @test_throws ArgumentError PolygonInteractable(ax, [ring]; payloads = [(; a = 1), (; a = 2)])      # too long
        @test_throws ArgumentError PolygonInteractable(ax, [ring, ring]; payloads = [(; a = 1)])          # too short: 2 rings, 1 payload
        @test PolygonInteractable(ax, [ring]; payloads = [(; a = 1)]) isa PolygonInteractable             # exact
    end

    @testset "clamp path is non-finite-safe" begin
        # A RectInteractable with clamp_to_viewport=true whose projected rect is non-finite
        # must NOT throw — it must fall back to the _q path instead of passing NaN/Inf to
        # ceil/floor (which throw). Deterministic repro: a rect whose center is NaN.
        using Holo: RectInteractable
        fig = Figure(size = (500, 350)); ax = Axis(fig[1, 1])
        scatter!(ax, [1.0], [1.0])   # force a layout so viewport is non-empty
        _, _, ctx = ctx_for(fig)
        # Inject a rect with a NaN center directly (clamp_to_viewport=true, so the clamp path
        # would be taken — the fix makes it fall back to _q instead).
        ri = RectInteractable(ax; rects = [(NaN, 0.0, 1.0, 1.0)], clamp_to_viewport = true)
        @test_nowarn hitlayers(ri, ctx)   # must not throw
        L = only(hitlayers(ri, ctx))
        @test !isfinite(L.geometry[1])    # NaN center passes through as Float32(NaN) via _q
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

@testset "AxisTransform valueaxis field + serialization" begin
    using Holo: AxisTransform, _transform_dict
    # a normal axis transform defaults valueaxis = nothing → serializes to nothing
    t = AxisTransform(
        :ax1, (0.0, 1.0), (0.0, 2.0), :identity, :identity,
        (0.0, 0.0, 10.0, 20.0), false, false, nothing, nothing, nothing
    )
    @test t.valueaxis === nothing
    d = _transform_dict(t)
    @test haskey(d, "valueaxis")
    @test d["valueaxis"] === nothing
    # a colorbar-style transform tags the value axis
    tc = AxisTransform(
        :cb1, (0.0, 1.0), (0.0, 2.0), :identity, :log10,
        (0.0, 0.0, 10.0, 20.0), false, false, nothing, nothing, :y
    )
    @test _transform_dict(tc)["valueaxis"] == "y"
end

@testset "Colorbar transform in context" begin
    using Holo: axis_id, build_manifest
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
    using Holo: ColorbarInteractable, hitlayers, validate
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
    @test L.axis == Holo.axis_id(ctx, cb)                   # references the colorbar transform
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

@testset "holo(fig) auto-detects Colorbar" begin
    using Holo: auto_interactables, ColorbarInteractable
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
