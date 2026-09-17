using Test, Masque, CairoMakie, Makie
include(joinpath(@__DIR__, "..", "testutils.jl"))

# `colors` round-trip through HitLayer/manifest, and PointInteractable(ax, p::Scatter)'s
# resolution from `p`'s own colour — the only plot-object constructor that currently derives it
# (see HitLayer's docstring; other kinds simply omit `colors`, no accent).
@testset "colors: per-layer tooltip accent" begin
    (; ax, pts, ctx) = default_fixture()

    @testset "absent by default (bare-points constructor)" begin
        pin = PointInteractable(ax, pts; id = :uncolored)
        L = only(hitlayers(pin, ctx))
        @test L.colors === nothing
        m = build_manifest([pin], ctx)
        @test !haskey(only(m["layers"]), "colors")
    end

    @testset "explicit colors= on the bare-points constructor round-trips" begin
        pin = PointInteractable(ax, pts; id = :explicit, colors = "rgb(1,2,3)")
        @test only(hitlayers(pin, ctx)).colors == "rgb(1,2,3)"
        @test only(build_manifest([pin], ctx)["layers"])["colors"] == "rgb(1,2,3)"
    end

    @testset "HitLayer's 6-arg and 7-arg constructors still work (colors defaults to nothing)" begin
        L6 = HitLayer(:x, :circles, Real[0, 0, 1], Any[], :ax1, (:click, :hover))
        @test L6.colors === nothing
        L7 = HitLayer(:x, :circles, Real[0, 0, 1], Any[], :ax1, (:click, :hover), "Scatter")
        @test L7.label == "Scatter" && L7.colors === nothing
    end

    @testset "Scatter: uniform colour resolves to a single CSS string" begin
        f = Figure(size = (300, 300)); a = Axis(f[1, 1])
        p = scatter!(a, [1.0, 2.0], [1.0, 2.0]; color = :red)
        _, _, c = ctx_for(f)
        L = only(hitlayers(PointInteractable(a, p), c))
        @test L.colors == "rgb(255,0,0)"
        @test only(build_manifest([PointInteractable(a, p)], c)["layers"])["colors"] == "rgb(255,0,0)"
    end

    @testset "Scatter: no explicit color= still resolves (Makie's own default colour)" begin
        f = Figure(size = (300, 300)); a = Axis(f[1, 1])
        p = scatter!(a, [1.0], [1.0])
        _, _, c = ctx_for(f)
        @test only(hitlayers(PointInteractable(a, p), c)).colors isa String
    end

    @testset "Scatter: explicit per-point colours ship as a deduped palette + index" begin
        f = Figure(size = (300, 300)); a = Axis(f[1, 1])
        p = scatter!(a, [1.0, 2.0, 3.0], [1.0, 1.0, 1.0]; color = [:red, :blue, :red])
        _, _, c = ctx_for(f)
        colors = only(hitlayers(PointInteractable(a, p), c)).colors
        @test colors.palette == ["rgb(255,0,0)", "rgb(0,0,255)"]
        @test colors.index == [0, 1, 0]
        d = only(build_manifest([PointInteractable(a, p)], c)["layers"])["colors"]
        @test d["palette"] == colors.palette && d["index"] == colors.index
    end

    @testset "Scatter: numeric (colormap-driven) colour ships as palette + index" begin
        f = Figure(size = (300, 300)); a = Axis(f[1, 1])
        p = scatter!(a, [1.0, 2.0, 3.0], [3.0, 2.0, 1.0]; color = [1.0, 2.0, 3.0], colormap = :viridis)
        _, _, c = ctx_for(f)
        colors = only(hitlayers(PointInteractable(a, p), c)).colors
        @test length(colors.index) == 3
        @test all(0 .<= colors.index .< length(colors.palette))
        @test all(s -> startswith(s, "rgb"), colors.palette)
        # monotonic in the source values (1.0 < 2.0 < 3.0 -> non-decreasing palette index)
        @test colors.index[1] <= colors.index[2] <= colors.index[3]
        @test colors.index[1] < colors.index[3]
    end

    @testset "Scatter: a scalar numeric colour resolves through the colormap, not as a raw colorant" begin
        f = Figure(size = (300, 300)); a = Axis(f[1, 1])
        p = scatter!(a, [1.0, 2.0], [1.0, 2.0]; color = 2, colormap = :viridis)
        _, _, c = ctx_for(f)
        colors = only(hitlayers(PointInteractable(a, p), c)).colors
        @test colors isa AbstractString
        @test !occursin("510", colors)             # not _css_color(2.0f0)'s out-of-range misread
        @test startswith(colors, "rgb(")
        # every point gets the identical resolved colour — ships as one uniform string, not
        # palette+index (whose index needs one entry per point)
        d = only(build_manifest([PointInteractable(a, p)], c)["layers"])["colors"]
        @test d == colors
    end

    @testset "Scatter: the colormap palette includes both ramp endpoints" begin
        f = Figure(size = (300, 300)); a = Axis(f[1, 1])
        p = scatter!(a, [1.0, 2.0], [1.0, 2.0]; color = [0.0, 1.0], colormap = :viridis)
        _, _, c = ctx_for(f)
        colors = only(hitlayers(PointInteractable(a, p), c)).colors
        cmap = Makie.to_colormap(:viridis)
        @test colors.palette[1] == Masque._css_color(cmap[1])
        @test colors.palette[end] == Masque._css_color(cmap[end])
    end

    @testset "colors= rejects malformed shapes on the bare-points constructor" begin
        @test_throws ArgumentError PointInteractable(ax, pts; colors = :red)               # not a String
        @test_throws ArgumentError PointInteractable(ax, pts; colors = (["c"], [0, 0, 0])) # plain Tuple, not (; palette, index)
        # index too short for 3 points
        @test_throws ArgumentError PointInteractable(ax, pts; colors = (; palette = ["rgb(1,2,3)"], index = [0]))
        # index value out of range for a 1-entry palette
        @test_throws ArgumentError PointInteractable(
            ax, pts; colors = (; palette = ["rgb(1,2,3)"], index = [0, 0, 5])
        )
        # valid shape still works
        ok = PointInteractable(ax, pts; colors = (; palette = ["rgb(1,2,3)", "rgb(4,5,6)"], index = [0, 1, 0]))
        @test ok isa PointInteractable
    end

    @testset "Scatter: NaN/Inf in a numeric colour vector doesn't crash" begin
        f = Figure(size = (300, 300)); a = Axis(f[1, 1])
        p = scatter!(a, [1.0, 2.0, 3.0], [1.0, 1.0, 1.0]; color = [1.0, NaN, 3.0], colormap = :viridis)
        _, _, c = ctx_for(f)
        colors = only(hitlayers(PointInteractable(a, p), c)).colors
        @test colors isa NamedTuple
        @test length(colors.index) == 3
        @test all(0 .<= colors.index .< length(colors.palette))

        p2 = scatter!(a, [1.0, 2.0], [2.0, 2.0]; color = [Inf, 1.0], colormap = :viridis)
        colors2 = only(hitlayers(PointInteractable(a, p2), c)).colors
        @test colors2 isa NamedTuple
        @test all(0 .<= colors2.index .< length(colors2.palette))

        # every value NaN → no finite colorrange to derive a palette from → omit, not a crash
        p3 = scatter!(a, [1.0], [3.0]; color = [NaN], colormap = :viridis, colorrange = (NaN, NaN))
        @test only(hitlayers(PointInteractable(a, p3), c)).colors === nothing
    end

    @testset "non-Scatter plot-object constructors don't derive colors" begin
        f = Figure(size = (300, 300)); a = Axis(f[1, 1])
        p = lines!(a, [1.0, 2.0, 3.0], [1.0, 2.0, 3.0]; color = :blue)
        _, _, c = ctx_for(f)
        @test only(hitlayers(SegmentInteractable(a, p), c)).colors === nothing
    end
end
