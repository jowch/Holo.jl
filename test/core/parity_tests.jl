using Test, Masque, CairoMakie, Makie
include(joinpath(@__DIR__, "..", "testutils.jl"))

# ---- cross-backend parity harness: within-backend golden drift (:cairo half) ----
# JSON3 comes from the test extras (Pkg.test / CI); a bare `julia --project=.` root env
# may lack it — skip LOUDLY rather than break the direct-run dev loop.
if Base.find_package("JSON3") === nothing
    @warn "SKIPPING parity-golden drift testset — JSON3 not in this env; run via Pkg.test()"
else
    @eval using JSON3
    include(joinpath(@__DIR__, "..", "parity_corpus.jl"))
    @testset "parity goldens (:cairo drift)" begin
        # Each corpus manifest, built live, must equal its committed golden
        # (test/fixtures/parity/<name>.cairo.json). A mismatch means the wire format
        # changed: regenerate via test/fixtures/parity/generate.jl (BOTH backends) and
        # review the golden diff in the PR — same discipline as the perf-findings re-run.
        dir = joinpath(@__DIR__, "..", "fixtures", "parity")
        for (name, build) in _parity_corpus()
            fig, ints = build()
            bk = _CairoExt.CairoBackend()
            ctx = IP.context(bk, fig, IP._ppu(bk, fig))
            live = JSON3.read(JSON3.write(build_manifest(ints, ctx)))   # canonicalize via JSON round-trip
            golden = JSON3.read(read(joinpath(dir, "$name.cairo.json"), String))
            @test live == golden
        end
    end
end
