using Holo
using Makie   # bare Makie: Figure/Axis/scatter! don't need a rendering backend to construct
using Test

@testset "holo(fig) with no backend extension loaded" begin
    fig = Figure(; size = (300, 200))
    ax = Axis(fig[1, 1])
    scatter!(ax, 1:5, rand(5))

    err = try
        holo(fig)
        nothing
    catch e
        e
    end
    @test err isa ArgumentError
    @test occursin("CairoMakie", err.msg)
    @test occursin("WGLMakie", err.msg)
end
