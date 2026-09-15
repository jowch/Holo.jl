# `label` keyword round-trip (PR: keyboard/ARIA overlay). One constructor is enough per the
# design doc — PointInteractable exercises the field, HitLayer's outer 6-arg constructor, and
# `_layer_dict`'s manifest emission all at once.
using Holo
using Holo: hitlayers, build_manifest, HitLayer
using CairoMakie
import Makie
using Test

@testset "label: per-layer screen-reader prefix" begin
    fig = Figure(size = (600, 400)); ax = Axis(fig[1, 1])
    pts = [(1.0, 1.0), (2.0, 4.0)]
    scatter!(ax, first.(pts), last.(pts))
    bk, _, ctx = ctx_for(fig)

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
