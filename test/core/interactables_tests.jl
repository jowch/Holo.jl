using Test, Holo, CairoMakie, Makie
include(joinpath(@__DIR__, "..", "testutils.jl"))

@testset "Interactables" begin
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

    @testset "RectInteractable grid rejects non-monotonic edges and non-finite projections" begin
        (; ax) = default_fixture()
        # non-monotonic edges: caught at construction, before any projection happens
        @test_throws ArgumentError RectInteractable(ax; grid = ([0.0, 2.0, 1.0, 3.0], [0.0, 1.0, 2.0], rand(3, 2)))
        @test_throws ArgumentError RectInteractable(ax; grid = ([0.0, 1.0, 2.0], [0.0, 2.0, 1.0], rand(2, 2)))
        e = try
            RectInteractable(ax; grid = ([0.0, 2.0, 1.0, 3.0], [0.0, 1.0, 2.0], rand(3, 2)))
            nothing
        catch err
            err
        end
        @test e isa ArgumentError && occursin("monotonic", sprint(showerror, e))

        # a log-scale axis edge that DomainErrors under the projection transform (same mechanism
        # as the "out-of-domain log input degrades to non-finite geometry" PointInteractable case
        # elsewhere in this file) must fail loud at hitlayers time instead of shipping a NaN edge.
        # No heatmap/scatter is plotted on this axis, so this can't be Makie's own auto-limit
        # boundingbox throwing first — the negative edge only ever reaches our own projection.
        fn = Figure(size = (600, 400)); axn = Axis(fn[1, 1]; yscale = log10)
        _, _, ctxn = ctx_for(fn)
        badgrid = RectInteractable(axn; grid = ([0.0, 1.0, 2.0], [-1.0, 1.0, 10.0], rand(2, 2)))
        eg = try
            hitlayers(badgrid, ctxn)
            nothing
        catch err
            err
        end
        @test eg isa ArgumentError && occursin("non-finite", sprint(showerror, eg))
    end

    @testset "SegmentInteractable tol ships in the manifest, scaled" begin
        tfig = Figure(); axt = Axis(tfig[1, 1])
        _, _, ctxt = ctx_for(tfig)
        # default tol (6 logical px), both modes
        d_poly = only(build_manifest([SegmentInteractable(axt, [(1.0, 1.0), (2.0, 2.0)])], ctxt)["layers"])
        @test d_poly["tol"] == round(Int, 6 * ctxt.scaling)
        d_pairs = only(build_manifest([SegmentInteractable(axt, [(1.0, 1.0), (2.0, 2.0)]; mode = :pairs)], ctxt)["layers"])
        @test d_pairs["tol"] == round(Int, 6 * ctxt.scaling)
        # custom tol scales the same way
        d_custom = only(build_manifest([SegmentInteractable(axt, [(1.0, 1.0), (2.0, 2.0)]; tol = 20)], ctxt)["layers"])
        @test d_custom["tol"] == round(Int, 20 * ctxt.scaling)
        # other kinds are untouched — no "tol" key, manifest byte-identical to before this feature
        d_pt = only(build_manifest([PointInteractable(axt, [(1.0, 1.0)])], ctxt)["layers"])
        @test !haskey(d_pt, "tol")
        d_rect = only(build_manifest([RectInteractable(axt; rects = [(1.0, 1.0, 1.0, 1.0)])], ctxt)["layers"])
        @test !haskey(d_rect, "tol")
        # Holo.hit_tol interface: nothing by default, i.tol for SegmentInteractable
        @test Holo.hit_tol(PointInteractable(axt, [(1.0, 1.0)])) === nothing
        @test Holo.hit_tol(SegmentInteractable(axt, [(1.0, 1.0), (2.0, 2.0)]; tol = 12)) == 12
    end

    @testset "Polygon geometry projects per ring" begin
        (; ax, ctx) = default_fixture()
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

    @testset "TextInteractable: scalar text! normalizes to a length-1 vector" begin
        f = Figure(size = (600, 400)); ax = Axis(f[1, 1]); scatter!(ax, 1:3, 1:3)
        t = text!(ax, 1.0, 1.0; text = "single")   # Makie normalizes: p.text[] == ["single"]
        _, _, ctx = ctx_for(f)
        ti = TextInteractable(ax, t)
        @test ti.payloads == [(; text = "single", index = 0, x = 1.0, y = 1.0)]
        L = only(hitlayers(ti, ctx))
        @test L.kind === :rects && length(L.geometry) == 4   # one box × (cx,cy,w,h)
    end

    @testset "TextInteractable: one box per string (count invariant)" begin
        # Locks the `length(boxes) == length(payloads)` assumption `hitlayers` guards on: an empty
        # string still emits a (degenerate) box, and a multi-line string is ONE box, not one per line
        # — so both drift-guards stay satisfied if a future Makie ever splits strings into per-run boxes.
        f = Figure(size = (600, 400)); ax = Axis(f[1, 1])
        t = text!(ax, [1.0, 2.0], [1.0, 2.0]; text = ["", "multi\nline"])
        _, _, ctx = ctx_for(f)
        ti = TextInteractable(ax, t)
        @test length(ti.payloads) == 2
        @test length(only(hitlayers(ti, ctx)).geometry) == 8   # 2 strings × (cx,cy,w,h) — one box each
    end

    @testset "Segment + Axis + custom" begin
        # Originally read the file's shared bare `ax`/`ctx` — by execution order in the old
        # monolith that was actually the TextInteractable testset's leftover text-only figure
        # (each nested `@testset`'s `let` reassigns the enclosing testset's already-existing
        # local rather than shadowing it), not the canonical scatter fixture this testset's
        # name and its `pts` usage clearly intend. Assertions here are kind/type-only, so the
        # swap is behavior-preserving; using `default_fixture()` fixes the underlying staleness.
        (; ax, ctx, pts) = default_fixture()
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

    @testset "build_manifest + widget + bond" begin
        # Self-contained: the file's shared fig/ax/ctx get clobbered by earlier testsets
        # (soft-scope `ax = Axis(...)` / `_, _, ctx = ctx_for(f)` assignments), leaving a
        # desynced ax/ctx pair here. axis_id's old :ax1 fallback silently absorbed that;
        # it now fails loudly, so this testset builds its own consistent trio.
        bfig = Figure(size = (600, 400)); bax = Axis(bfig[1, 1])
        pts = DEFAULT_PTS
        scatter!(bax, first.(pts), last.(pts))
        _, _, bctx = ctx_for(bfig)
        m = build_manifest([PointInteractable(bax, pts; id = :scatter), AxisInteractable(bax)], bctx)
        @test [L["kind"] for L in m["layers"]] == ["circles", "axis"]
        @test haskey(m["transforms"], "ax1")

        # inspector ink (first polish PR): hoverstyle default + shipped layer.style
        @test Holo.hoverstyle(PointInteractable(bax, pts; id = :scatter)).stroke == "#3A6F7C"
        @test Holo.hoverstyle(PointInteractable(bax, pts; id = :scatter)).width == 2
        @test m["layers"][1]["style"]["stroke"] == "#3A6F7C"

        # selection round-trip: pre-highlight indices ride the manifest keyed by layer id
        @test !haskey(m["layers"][1], "selected")                       # absent when unselected
        ms = build_manifest([PointInteractable(bax, pts; id = :scatter)], bctx; selected = Dict(:scatter => [0, 2]))
        @test ms["layers"][1]["selected"] == [0, 2]
        @test !haskey(
            build_manifest(
                [PointInteractable(bax, pts; id = :scatter)], bctx;
                selected = Dict(:scatter => Int[])
            )["layers"][1], "selected"
        )   # empty omitted
        @test holo(bfig, PointInteractable(bax, pts; id = :scatter); selected = Dict(:scatter => [1])).manifest["layers"][1]["selected"] == [1]

        # selected= fail-loud (issue #39): still-unsupported kinds (grid/axis/…) and OOB
        # indices throw at build_manifest. Open kinds (segments/polyline) now accept
        # selected= so the overlay can draw the selected-ring recipe.
        @testset "selected= fails loud on unsupported kinds and OOB indices" begin
            segs = SegmentInteractable(bax, [(1.0, 1.0), (2.0, 2.0), (3.0, 3.0), (4.0, 4.0)]; mode = :pairs, id = :segs)
            ms_seg = build_manifest([segs], bctx; selected = Dict(:segs => [0]))
            @test ms_seg["layers"][1]["selected"] == [0]
            @test ms_seg["layers"][1]["kind"] == "segments"

            grid_i = RectInteractable(bax; grid = (0.5:1:3.5, 0.5:1:3.5, rand(3, 3)), id = :heat)
            @test_throws ArgumentError build_manifest([grid_i], bctx; selected = Dict(:heat => [0]))
            err_grid = try
                build_manifest([grid_i], bctx; selected = Dict(:heat => [0])); nothing
            catch e
                e
            end
            @test err_grid isa ArgumentError
            @test occursin(r"selected"i, sprint(showerror, err_grid))
            @test occursin("grid", sprint(showerror, err_grid))

            # 3 pts → valid indices 0:2; index 5 and -1 must fail
            @test_throws ArgumentError build_manifest(
                [PointInteractable(bax, pts; id = :scatter)], bctx; selected = Dict(:scatter => [5])
            )
            @test_throws ArgumentError build_manifest(
                [PointInteractable(bax, pts; id = :scatter)], bctx; selected = Dict(:scatter => [-1])
            )
            err_oob = try
                build_manifest(
                    [PointInteractable(bax, pts; id = :scatter)], bctx; selected = Dict(:scatter => [5])
                ); nothing
            catch e
                e
            end
            @test err_oob isa ArgumentError
            @test occursin(r"selected"i, sprint(showerror, err_oob))
            @test occursin(r"5|out of range|elements"i, sprint(showerror, err_oob))

            # supported kinds still accept in-range indices (rects list + polygons + polyline)
            rects = RectInteractable(bax; rects = [(1.0, 1.0, 0.5, 0.5), (2.0, 2.0, 0.5, 0.5)], id = :boxes)
            mr = build_manifest([rects], bctx; selected = Dict(:boxes => [1]))
            @test mr["layers"][1]["selected"] == [1]
            polys = PolygonInteractable(bax, [[(0.0, 0.0), (1.0, 0.0), (0.5, 1.0)]]; id = :poly)
            mp = build_manifest([polys], bctx; selected = Dict(:poly => [0]))
            @test mp["layers"][1]["selected"] == [0]
            poly = SegmentInteractable(bax, [(1.0, 1.0), (2.0, 2.0), (3.0, 1.5)]; mode = :polyline, id = :line)
            ml = build_manifest([poly], bctx; selected = Dict(:line => [1]))
            @test ml["layers"][1]["selected"] == [1]
            @test ml["layers"][1]["kind"] == "polyline"
        end

        w = holo(bfig, PointInteractable(bax, pts; id = :scatter))
        @test w isa HoloWidget
        @test w.manifest["layers"][1]["kind"] == "circles"
        @test !isempty(w.b64)
        @test w.display_css == 600

        @test IP.APD.Bonds.initial_value(w) === nothing
        @test IP.APD.Bonds.transform_value(w, nothing) === nothing
        ev = IP.APD.Bonds.transform_value(w, Dict("layer" => "scatter", "index" => 2, "payload" => Dict("i" => 2)))
        @test ev isa InteractionEvent && ev.layer === :scatter && ev.index == 2
    end

    @testset "axis_id fails loud on unregistered blocks" begin
        # The old :ax1 fallback silently rebound any unregistered fig.content block to the
        # main axis (the Colorbar-misbind class). Pin the fail-loud replacement: an
        # interactable keyed to an axis from a DIFFERENT figure must error at manifest
        # build, as ArgumentError, naming the problem — a regression back to a silent
        # default (or a bare KeyError) fails here.
        ffig = Figure(size = (600, 400)); Axis(ffig[1, 1])
        _, _, fctx = ctx_for(ffig)
        other = Figure(size = (600, 400)); oax = Axis(other[1, 1])
        @test_throws ArgumentError build_manifest([PointInteractable(oax, [(1.0, 1.0)])], fctx)
        err = try
            build_manifest([PointInteractable(oax, [(1.0, 1.0)])], fctx)
            nothing
        catch e
            e
        end
        @test err isa ArgumentError && occursin("not registered", err.msg)
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

    @testset "construction-time validation: mode / grid shape / tooltip=true" begin
        using Holo: SegmentInteractable, RectInteractable, PointInteractable
        fig = Figure(); ax = Axis(fig[1, 1])
        pts = [Point2f(0, 0), Point2f(1, 1)]
        @test_throws ArgumentError SegmentInteractable(ax, pts; mode = :segments)
        @test SegmentInteractable(ax, pts; mode = :pairs) isa SegmentInteractable
        @test SegmentInteractable(ax, pts; mode = :polyline) isa SegmentInteractable

        # grid `values` must be (length(xedges)-1, length(yedges)-1)
        xe = 0.0:1.0:3.0; ye = 0.0:1.0:2.0   # 3x2 cells expected
        good = zeros(3, 2)
        @test RectInteractable(ax; grid = (xe, ye, good)) isa RectInteractable
        bad = zeros(2, 3)   # transposed — wrong shape
        @test_throws ArgumentError RectInteractable(ax; grid = (xe, ye, bad))
        # non-Matrix `values` (e.g. a vector, or nothing) must raise the same friendly
        # ArgumentError, not a bare MethodError from `size(nothing)` deep inside the check.
        @test_throws ArgumentError RectInteractable(ax; grid = (xe, ye, nothing))
        @test_throws ArgumentError RectInteractable(ax; grid = (xe, ye, [1.0, 2.0, 3.0]))

        # exactly one of rects/grid — both, and neither, are construction-time errors
        @test_throws ArgumentError RectInteractable(ax)
        @test_throws ArgumentError RectInteractable(ax; rects = [(0.0, 0.0, 1.0, 1.0)], grid = (xe, ye, good))

        # tol must be finite and positive — a raw round(Int, ...) InexactError/silent
        # unhittable layer otherwise (same "raw downstream error" class this PR closes for
        # RectInteractable's rects/grid)
        @test_throws ArgumentError SegmentInteractable(ax, pts; tol = Inf)
        @test_throws ArgumentError SegmentInteractable(ax, pts; tol = NaN)
        @test_throws ArgumentError SegmentInteractable(ax, pts; tol = 0)
        @test_throws ArgumentError SegmentInteractable(ax, pts; tol = -1)
        @test SegmentInteractable(ax, pts; tol = 0.5) isa SegmentInteractable
        # HLines/VLines route through `_segment_with_resolve`, not the keyword constructor
        # above — regression coverage for that separate entry point skipping the check.
        hl = hlines!(ax, [0.5])
        @test_throws ArgumentError SegmentInteractable(ax, hl; tol = Inf)
        @test_throws ArgumentError SegmentInteractable(ax, hl; tol = NaN)
        @test_throws ArgumentError SegmentInteractable(ax, hl; tol = 0)
        @test SegmentInteractable(ax, hl; tol = 3) isa SegmentInteractable
        vl = vlines!(ax, [0.5])
        @test_throws ArgumentError SegmentInteractable(ax, vl; tol = -1)

        # tooltip = true fails at construction, not at manifest build — every constructor that
        # accepts `tooltip` shares the `_check_tooltip` helper; pin the contract on all of them.
        @test_throws ArgumentError PointInteractable(ax, [(0.0, 0.0)]; tooltip = true)
        @test_throws ArgumentError SegmentInteractable(ax, pts; tooltip = true)
        @test_throws ArgumentError RectInteractable(ax; rects = [(0.0, 0.0, 1.0, 1.0)], tooltip = true)
        tp = text!(ax, [0.0], [0.0]; text = ["a"])
        @test_throws ArgumentError TextInteractable(ax, tp; tooltip = true)
        ring = [Point2f(0, 0), Point2f(1, 0), Point2f(1, 1)]
        @test_throws ArgumentError PolygonInteractable(ax, [ring]; tooltip = true)
        @test_throws ArgumentError RegionInteractable(
            ax; regions = [(:circle, (1.0, 1.0), 0.5)], payloads = [(; n = "a")], tooltip = true
        )
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
end
