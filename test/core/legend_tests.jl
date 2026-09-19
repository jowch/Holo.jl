using Test, Masque, CairoMakie, Makie
include(joinpath(@__DIR__, "..", "testutils.jl"))

@testset "LegendInteractable" begin
    using Masque: LegendInteractable, hitlayers, validate, build_manifest, axis_id, auto_interactables

    @testset "auto legend: lines + scatter" begin
        fig = Figure(size = (600, 400)); ax = Axis(fig[1, 1])
        lines!(ax, 1:10, (1:10) .^ 2; label = "quad")
        lines!(ax, 1:10, 10 .* (1:10); label = "lin")
        scatter!(ax, 1:10, rand(10) .* 50; label = "pts")
        leg = axislegend(ax; position = :lt)
        Makie.update_state_before_display!(fig)

        ints = auto_interactables(fig)
        lis = filter(i -> i isa LegendInteractable, ints)
        @test length(lis) == 1
        li = only(lis)
        @test li.id === :legend
        @test li.targets == [[:lines], [:lines_2], [:scatter]]

        _, _, ctx = ctx_for(fig)
        L = only(hitlayers(li, ctx))
        @test L.kind === :rects
        @test L.axis == axis_id(ctx, leg)
        @test [p.label for p in L.payloads] == ["quad", "lin", "pts"]
        @test all(p.group === nothing for p in L.payloads)
        @test [p.targets for p in L.payloads] == [["lines"], ["lines_2"], ["scatter"]]
        @test L.links == [[:lines], [:lines_2], [:scatter]]

        # one rect per entry, each inside the legend's own viewport and inside the image
        n = length(L.geometry) ÷ 4
        @test n == 3
        vp = ctx.transforms[axis_id(ctx, leg)].viewport
        for k in 0:(n - 1)
            cx, cy, w, h = L.geometry[(4k + 1):(4k + 4)]
            @test vp[1] - 1 <= cx - w / 2 && cx + w / 2 <= vp[1] + vp[3] + 1
            @test vp[2] - 1 <= cy - h / 2 && cy + h / 2 <= vp[2] + vp[4] + 1
            @test 0 <= cx <= ctx.width && 0 <= cy <= ctx.height
        end

        # geometry lands on the rendered legend (not blank background)
        img = Makie.colorbuffer(fig; px_per_unit = ctx.scaling)
        for k in 0:(n - 1)
            cx, cy = L.geometry[4k + 1], L.geometry[4k + 2]
            @test drawn_near(img, cx, cy; tol = 10)
        end

        # full manifest: links round-trip as strings, no warnings for a fully-resolvable legend
        m = @test_logs build_manifest(ints, ctx)
        legd = only(filter(d -> d["id"] == "legend", m["layers"]))
        @test legd["kind"] == "rects"
        @test legd["links"] == [["lines"], ["lines_2"], ["scatter"]]
        @test legd["label"] == "Legend"
        @test haskey(legd, "template")   # default tooltip = masque"$(label)"

    end

    @testset "legend hit-tests before plot geometry (B1: precedence sort)" begin
        fig = Figure(size = (600, 400)); ax = Axis(fig[1, 1])
        hm = heatmap!(ax, rand(4, 4))
        # data range stays inside the heatmap's own (0.5:4.5) so it doesn't shrink the
        # heatmap's own pixel footprint down to a corner of the axis — the legend at `:lt`
        # must land ON the heatmap, not merely inside the (larger) axis.
        l1 = lines!(ax, 1:4, Float64.(1:4); label = "line")
        leg = axislegend(ax; position = :lt)
        Makie.update_state_before_display!(fig)
        _, _, ctx = ctx_for(fig)

        grid_int = Masque.RectInteractable(ax, hm; id = :cells)
        seg_int = Masque.SegmentInteractable(ax, l1; id = :lines)
        li = LegendInteractable(leg; targets = Dict("line" => :lines))
        view_int = Masque.ViewInteractable(ax)

        m = build_manifest([grid_int, seg_int, li, view_int], ctx)
        ids = [d["id"] for d in m["layers"]]
        legend_idx = findfirst(==("legend"), ids)
        grid_idx = findfirst(==("cells"), ids)
        view_idx = findfirst(==("view"), ids)
        @test legend_idx < grid_idx
        @test view_idx == length(ids)   # ViewInteractable still sorts last

        # Legend entry 0's rect centre genuinely lands inside the grid layer's pixel extent —
        # otherwise this test would pass trivially without the sort actually mattering.
        legd = m["layers"][legend_idx]
        cx, cy = legd["geometry"][1], legd["geometry"][2]
        gridd = m["layers"][grid_idx]
        xlo, xhi = extrema(gridd["geometry"]["xedges"])
        ylo, yhi = extrema(gridd["geometry"]["yedges"])
        @test xlo <= cx <= xhi
        @test ylo <= cy <= yhi
    end

    @testset "B2: compound recipes auto-link to both their layers" begin
        fig = Figure(); ax = Axis(fig[1, 1])
        sl = scatterlines!(ax, 1:3, Float64.(1:3); label = "sl")
        st = stem!(ax, 1:3, Float64.(1:3); label = "st")
        ln = lines!(ax, 1:3, Float64.(1:3) .+ 1; label = "l")
        axislegend(ax)
        Makie.update_state_before_display!(fig)

        ints = @test_logs auto_interactables(fig)   # no warnings — every plot is supported
        non_legend = filter(i -> !(i isa LegendInteractable), ints)
        li = only(filter(i -> i isa LegendInteractable, ints))

        # Derive expected ids from the constructed interactables themselves (not hardcoded),
        # grouped by which source plot (sl/st/ln) built them.
        sl_ids = [i.id for i in non_legend if i.id in (:scatterlines, :scatterlines_line)]
        st_ids = [i.id for i in non_legend if i.id in (:stem, :stem_stems)]
        ln_ids = [i.id for i in non_legend if i.id == :lines]
        @test li.targets == [sl_ids, st_ids, ln_ids]
        # linking a compound entry to BOTH its layers is correct, not over-linking
        @test length(li.targets[1]) == 2
        @test length(li.targets[2]) == 2
        # every linked id is a real layer id, not just internally-consistent grouping
        @test Set(Iterators.flatten(li.targets)) ⊆ Set(i.id for i in non_legend)
    end

    @testset "merge=true: one entry, two linked layers" begin
        fig = Figure(); ax = Axis(fig[1, 1])
        lines!(ax, 1:3; label = "x")
        scatter!(ax, 1:3; label = "x")
        axislegend(ax; merge = true)
        Makie.update_state_before_display!(fig)
        ints = auto_interactables(fig)
        li = only(filter(i -> i isa LegendInteractable, ints))
        @test length(li.targets) == 1
        @test Set(li.targets[1]) == Set([:lines, :scatter])
    end

    @testset "custom LineElement legend: empty links, no warning" begin
        fig = Figure(); ax = Axis(fig[1, 1]); lines!(ax, 1:3)
        els = [LineElement(color = :red), MarkerElement(color = :blue, marker = :circle)]
        Legend(fig[1, 2], els, ["a", "b"])
        Makie.update_state_before_display!(fig)
        ints = auto_interactables(fig)
        li = only(filter(i -> i isa LegendInteractable, ints))
        @test li.targets == [Symbol[], Symbol[]]
        _, _, ctx = ctx_for(fig)
        m = @test_logs build_manifest(ints, ctx)   # no warnings: nothing to resolve, nothing to drop
        legd = only(filter(d -> d["id"] == "legend", m["layers"]))
        # N3: every entry's links are empty -> `"links"` is omitted entirely, not `[[],[]]`
        @test !haskey(legd, "links")
        @test all(p.targets == String[] for p in legd["payloads"])
    end

    @testset "explicit targets: Dict and Vector" begin
        fig = Figure(); ax = Axis(fig[1, 1])
        lines!(ax, 1:3; label = "a")
        scatter!(ax, 1:3; label = "b")
        leg = axislegend(ax)
        Makie.update_state_before_display!(fig)

        li_dict = LegendInteractable(leg; targets = Dict("a" => :lines, "b" => [:scatter]))
        @test li_dict.targets == [[:lines], [:scatter]]

        li_vec = LegendInteractable(leg; targets = [:lines, nothing])
        @test li_vec.targets == [[:lines], Symbol[]]

        @test_throws ArgumentError LegendInteractable(leg; targets = Dict("nope" => :lines))
        @test_throws ArgumentError LegendInteractable(leg; targets = [:lines])                    # too short
        @test_throws ArgumentError LegendInteractable(leg; targets = [:lines, :scatter, :extra])  # too long
    end

    @testset "N1: String targets accepted, non-Symbol/String rejected loud" begin
        fig = Figure(); ax = Axis(fig[1, 1])
        lines!(ax, 1:3; label = "a")
        scatter!(ax, 1:3; label = "b")
        leg = axislegend(ax)
        Makie.update_state_before_display!(fig)

        # a single String, and a Vector containing Strings, both as a Dict value and a Vector entry
        li_dict = LegendInteractable(leg; targets = Dict("a" => "lines", "b" => ["scatter"]))
        @test li_dict.targets == [[:lines], [:scatter]]

        li_vec = LegendInteractable(leg; targets = ["lines", ["scatter"]])
        @test li_vec.targets == [[:lines], [:scatter]]

        # a bare String used to be silently char-iterated by `collect(Symbol, ...)` — must
        # instead fail loud with an actionable ArgumentError.
        @test_throws ArgumentError LegendInteractable(leg; targets = Dict("a" => 1))
        @test_throws ArgumentError LegendInteractable(leg; targets = [1, :scatter])
        @test_throws ArgumentError LegendInteractable(leg; targets = [[1], :scatter])
    end

    @testset "links to a non-selectable kind: explicit errors, auto warns" begin
        fig = Figure(); ax = Axis(fig[1, 1])
        l1 = lines!(ax, 1:3; label = "a")
        hm = heatmap!(ax, rand(3, 3))
        leg = axislegend(ax)
        Makie.update_state_before_display!(fig)
        _, _, ctx = ctx_for(fig)
        line_int = Masque.SegmentInteractable(ax, l1)   # :polyline, id :lines
        rect_int = Masque.RectInteractable(ax, hm)      # :grid, id :cells

        # explicit target naming the :grid layer -> ArgumentError from build_manifest
        li_bad = LegendInteractable(leg; targets = Dict("a" => :cells))
        @test_throws ArgumentError build_manifest([line_int, rect_int, li_bad], ctx)

        # unknown layer id -> ArgumentError
        li_unknown = LegendInteractable(leg; targets = Dict("a" => :nope))
        @test_throws ArgumentError build_manifest([line_int, rect_int, li_unknown], ctx)

        # auto (plotmap) path: entry "a"'s plot (l1) resolving to BOTH a selectable and an
        # unselectable-kind id -> the bad one is warned-and-dropped, not a build_manifest error.
        li_lenient = LegendInteractable(leg; plotmap = IdDict{Any, Vector{Symbol}}(l1 => [:lines, :cells]))
        @test li_lenient.lenient
        @test li_lenient.targets == [[:lines, :cells]]
        m = @test_logs (:warn, r"cannot be highlighted"i) build_manifest([line_int, rect_int, li_lenient], ctx)
        legd = only(filter(d -> d["id"] == "legend", m["layers"]))
        @test legd["links"] == [["lines"]]
        # the tooltip payload's own `targets` list stays in sync with what was actually kept
        @test only(legd["payloads"]).targets == ["lines"]
    end

    @testset "multi-bank legend (nbanks=2)" begin
        fig = Figure(size = (700, 400)); ax = Axis(fig[1, 1])
        for i in 1:6
            lines!(ax, 1:3, Float64.(i:(i + 2)); label = "L$i")
        end
        leg = axislegend(ax; nbanks = 2, position = :rt)
        Makie.update_state_before_display!(fig)
        li = only(filter(i -> i isa LegendInteractable, auto_interactables(fig)))
        @test li.targets == [[Symbol(:lines, k == 1 ? "" : "_$k")] for k in 1:6]

        _, _, ctx = ctx_for(fig)
        L = only(hitlayers(li, ctx))
        n = length(L.geometry) ÷ 4
        @test n == 6
        vp = ctx.transforms[axis_id(ctx, leg)].viewport
        centers = Set{Tuple{Real, Real}}()
        for k in 0:(n - 1)
            cx, cy, w, h = L.geometry[(4k + 1):(4k + 4)]
            push!(centers, (cx, cy))
            @test vp[1] - 1 <= cx - w / 2 && cx + w / 2 <= vp[1] + vp[3] + 1
            @test vp[2] - 1 <= cy - h / 2 && cy + h / 2 <= vp[2] + vp[4] + 1
        end
        @test length(centers) == 6   # 6 distinct rects — a fixed-(1:2)-column bug would collapse bank 2 onto bank 1
        @test [p.label for p in L.payloads] == ["L$i" for i in 1:6]
    end

    @testset "horizontal orientation legend" begin
        fig = Figure(size = (700, 200)); ax = Axis(fig[1, 1])
        for i in 1:3
            lines!(ax, 1:3, Float64.(i:(i + 2)); label = "H$i")
        end
        leg = axislegend(ax; orientation = :horizontal)
        Makie.update_state_before_display!(fig)
        li = only(filter(i -> i isa LegendInteractable, auto_interactables(fig)))
        @test li.targets == [[:lines], [:lines_2], [:lines_3]]

        _, _, ctx = ctx_for(fig)
        L = only(hitlayers(li, ctx))
        @test length(L.geometry) ÷ 4 == 3
        @test [p.label for p in L.payloads] == ["H1", "H2", "H3"]
    end

    @testset "tooltip: default label template, false suppresses" begin
        fig = Figure(); ax = Axis(fig[1, 1])
        l1 = lines!(ax, 1:3; label = "a")
        leg = axislegend(ax)
        Makie.update_state_before_display!(fig)
        _, _, ctx = ctx_for(fig)
        line_int = Masque.SegmentInteractable(ax, l1)

        m = build_manifest([line_int, LegendInteractable(leg)], ctx)
        legd = only(filter(d -> d["id"] == "legend", m["layers"]))
        @test haskey(legd, "template")

        m2 = build_manifest([line_int, LegendInteractable(leg; tooltip = false)], ctx)
        legd2 = only(filter(d -> d["id"] == "legend", m2["layers"]))
        @test legd2["tooltip"] == false
        @test_throws ArgumentError LegendInteractable(leg; tooltip = true)
    end

    @testset "misuse: a Legend handed to axis-shaped interactables fails loud" begin
        fig = Figure(); ax = Axis(fig[1, 1]); lines!(ax, 1:3; label = "a")
        leg = axislegend(ax)
        Makie.update_state_before_display!(fig)
        _, _, ctx = ctx_for(fig)
        @test validate(Masque.AxisInteractable(leg), ctx) isa String
        @test validate(Masque.ViewInteractable(leg), ctx) isa String
        @test validate(Masque.ThresholdInteractable(leg; value = 1.0), ctx) isa String
        @test validate(Masque.ROIInteractable(leg; bounds = (0.0, 1.0, 0.0, 1.0)), ctx) isa String
    end

    @testset "B5: grouped/titled legend" begin
        fig = Figure(); ax = Axis(fig[1, 1])
        l1 = lines!(ax, 1:3, Float64.(1:3); label = "a")
        l2 = lines!(ax, 1:3, Float64.(3:-1:1); label = "b")
        Legend(fig[1, 2], [[l1], [l2]], [["a"], ["b"]], ["G1", "G2"])
        Makie.update_state_before_display!(fig)

        ints = auto_interactables(fig)
        li = only(filter(i -> i isa LegendInteractable, ints))
        @test length(li.targets) == 2
        @test li.targets == [[:lines], [:lines_2]]

        _, _, ctx = ctx_for(fig)
        L = only(hitlayers(li, ctx))
        @test length(L.payloads) == 2
        @test [p.group for p in L.payloads] == ["G1", "G2"]
        @test [p.label for p in L.payloads] == ["a", "b"]

        n = length(L.geometry) ÷ 4
        @test n == 2
        c1 = (L.geometry[1], L.geometry[2])
        c2 = (L.geometry[5], L.geometry[6])
        @test c1 != c2   # two rects with distinct centres

        leg = only(filter(c -> c isa Makie.Legend, fig.content))
        vp = ctx.transforms[axis_id(ctx, leg)].viewport
        for (cx, cy) in (c1, c2)
            @test vp[1] <= cx <= vp[1] + vp[3]
            @test vp[2] <= cy <= vp[2] + vp[4]
        end

        # image coords are y-down, so top-to-bottom entry order means the first rect's centre
        # y is SMALLER than the second's.
        @test c1[2] < c2[2]
    end

    @testset "two legends" begin
        fig = Figure()
        ax1 = Axis(fig[1, 1]); lines!(ax1, 1:3; label = "a"); axislegend(ax1)
        ax2 = Axis(fig[2, 1]); lines!(ax2, 1:3; label = "b"); axislegend(ax2)
        Makie.update_state_before_display!(fig)
        ints = auto_interactables(fig)
        lis = filter(i -> i isa LegendInteractable, ints)
        @test length(lis) == 2
        @test Set(l.id for l in lis) == Set([:legend, :legend_2])
    end
    @testset "tooltip accent: each entry's drawn colour, not the element's unused defaults" begin
        fig = Figure(); ax = Axis(fig[1, 1])
        lines!(ax, 1:3; color = :blue, label = "l")
        scatter!(ax, 1:3; color = :red, label = "s")
        poly!(ax, Point2f[(0, 0), (1, 0), (1, 1)]; color = :green, label = "p")
        leg = axislegend(ax)
        Makie.update_state_before_display!(fig)
        li = only(filter(i -> i isa LegendInteractable, auto_interactables(fig)))
        _, _, ctx = ctx_for(fig)
        L = only(hitlayers(li, ctx))
        @test L.colors !== nothing
        pal, idx = L.colors.palette, L.colors.index
        @test [pal[i + 1] for i in idx] == ["rgb(0,0,255)", "rgb(255,0,0)", "rgb(0,128,0)"]
    end

    @testset "N4: a non-AbstractString label (RichText) doesn't misreport as a Makie compat break" begin
        fig = Figure(); ax = Axis(fig[1, 1])
        # Makie.rich(...) returns a Makie.RichText, which is NOT an AbstractString (unlike
        # LaTeXString, which IS one and so can't exercise this path) — String(::RichText)
        # throws MethodError, which _MAKIE_SHAPE_ERRORS would otherwise catch and misreport.
        @test !(Makie.rich("bold ") isa AbstractString)
        lines!(ax, 1:3; label = Makie.rich("bold "))
        leg = axislegend(ax)
        Makie.update_state_before_display!(fig)
        meta = Masque._legend_entries_meta(leg)
        @test only(meta).label == "bold "
    end
end
