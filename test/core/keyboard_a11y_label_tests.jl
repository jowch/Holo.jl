using Test, Masque, CairoMakie, Makie
include(joinpath(@__DIR__, "..", "testutils.jl"))

# `label` keyword round-trip. One constructor is enough per the design doc — PointInteractable
# exercises the field, HitLayer's outer 6-arg constructor, and `_layer_dict`'s manifest
# emission all at once.
@testset "label: per-layer screen-reader prefix" begin
    (; ax, pts, ctx) = default_fixture()

    @testset "absent by default" begin
        pin = PointInteractable(ax, pts; id = :unlabeled)
        L = only(hitlayers(pin, ctx))
        @test L.label === nothing
        m = build_manifest([pin], ctx)
        @test !haskey(only(m["layers"]), "label")
    end

    @testset "round-trips when set" begin
        pin = PointInteractable(ax, pts; id = :labeled, label = "Scatter")
        L = only(hitlayers(pin, ctx))
        @test L.label == "Scatter"
        m = build_manifest([pin], ctx)
        @test only(m["layers"])["label"] == "Scatter"
    end

    @testset "HitLayer's 6-arg constructor still works (label defaults to nothing)" begin
        L = HitLayer(:x, :circles, Real[0, 0, 1], Any[], :ax1, (:click, :hover))
        @test L.label === nothing
    end

    @testset "non-String label coerces (e.g. Symbol)" begin
        pin = PointInteractable(ax, pts; id = :symlabel, label = :Scatter)
        @test hitlayers(pin, ctx)[1].label == "Scatter"
    end
end
