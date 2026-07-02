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

# ---- cross-backend parity invariant: pure golden-data comparison, no Makie backend ----
# The two committed goldens per corpus figure must agree structurally. This is the test
# that catches a one-sided context() divergence (the Colorbar-misbind class) whatever its
# downstream symptom — order-tolerant, so it survives Dict-iteration changes across Julia
# versions. JSON3 comes from the test extras; skip loudly on a bare root env.
if Base.find_package("JSON3") === nothing
    @warn "SKIPPING cross-backend parity invariant testset — JSON3 not in this env; run via Pkg.test()"
else
    @eval using JSON3
    @testset "cross-backend parity invariant (golden fixtures)" begin
        dir = joinpath(@__DIR__, "fixtures", "parity")
        names = sort(unique(first.(split.(filter(endswith(".json"), readdir(dir)), '.'))))
        @test !isempty(names)
        for name in names
            ca = JSON3.read(read(joinpath(dir, "$name.cairo.json"), String))
            wg = JSON3.read(read(joinpath(dir, "$name.webgl.json"), String))
            @testset "$name" begin
                # matched-ppu quotient → identical canvas geometry
                @test ca[:width] == wg[:width] && ca[:height] == wg[:height] && ca[:scaling] == wg[:scaling]
                # layers: same multiset of (id, kind, axis) — the misbind class fails HERE
                lkey(L) = (L[:id], L[:kind], L[:axis])
                @test sort(lkey.(ca[:layers])) == sort(lkey.(wg[:layers]))
                wmap = Dict(lkey(L) => L for L in wg[:layers])
                for L in ca[:layers]
                    haskey(wmap, lkey(L)) || continue   # multiset mismatch already reported above
                    W = wmap[lkey(L)]
                    @test L[:geometry] == W[:geometry]
                    @test length(L[:payloads]) == length(W[:payloads])
                    pkeys(p) = p isa AbstractDict ? Set(keys(p)) : typeof(p)
                    @test pkeys.(L[:payloads]) == pkeys.(W[:payloads])
                    for f in (:events, :template, :selects, :tooltip, :style)
                        @test get(L, f, nothing) == get(W, f, nothing)
                    end
                end
                # transforms: same ids, same per-id declarative shape
                @test Set(keys(ca[:transforms])) == Set(keys(wg[:transforms]))
                for k in keys(ca[:transforms])
                    haskey(wg[:transforms], k) || continue
                    tc, tw = ca[:transforms][k], wg[:transforms][k]
                    for f in (:valueaxis, :xscale, :yscale, :xlims, :ylims, :viewport, :xreversed, :yreversed, :xcats, :ycats)
                        @test get(tc, f, nothing) == get(tw, f, nothing)
                    end
                end
            end
        end
        # colorbar oracle: the colorbar layer must key a transform whose valueaxis is
        # non-null on BOTH backends — a misbind to :ax1 (null valueaxis) fails here even
        # though nothing crashes (the silent-wrong-readout class is exactly this).
        @testset "colorbar valueaxis oracle" begin
            for b in ("cairo", "webgl")
                m = JSON3.read(read(joinpath(dir, "colorbar.$b.json"), String))
                L = only(filter(l -> l[:id] == "colorbar", m[:layers]))
                @test get(m[:transforms][Symbol(L[:axis])], :valueaxis, nothing) !== nothing
            end
        end
    end
end
