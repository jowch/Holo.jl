# Regenerate the committed parity golden manifests for ONE backend:
#
#   julia test/fixtures/parity/generate.jl cairo
#   julia test/fixtures/parity/generate.jl webgl
#
# Self-contained temp env (the repo root env carries neither rendering backend —
# same dance as test/e2e). Run BOTH commands when regenerating; commit the diffs.
#
# REGENERATION DISCIPLINE: goldens are regenerated on every wire-format change —
# the same rule as the perf-findings bench re-run (docs/perf-findings.md) — and the
# golden diff is reviewed in the PR. A live-manifest-vs-stale-golden gap is exactly
# the drift the within-backend testsets exist to flag.

import Pkg
backend = get(ARGS, 1, "")
backend in ("cairo", "webgl") || error("usage: julia generate.jl cairo|webgl")

repo = normpath(joinpath(@__DIR__, "..", "..", ".."))
Pkg.activate(; temp = true)
Pkg.develop(path = repo)
Pkg.add(backend == "cairo" ? ["CairoMakie", "JSON3", "Makie"] : ["WGLMakie", "JSON3", "Makie"])

using Holo, JSON3
import Makie
backend == "cairo" ? @eval(using CairoMakie) : @eval(using WGLMakie)

include(joinpath(repo, "test", "parity_corpus.jl"))

ext = Base.get_extension(Holo, backend == "cairo" ? :HoloCairoMakieExt : :HoloWGLMakieExt)
bk = backend == "cairo" ? ext.CairoBackend() : ext.WebGLBackend()

for (name, build) in _parity_corpus()
    fig, ints = build()
    ppu = Holo._ppu(bk, fig)
    ppu == 2.0 || error("corpus figure `$name` must quotient ppu to 2.0, got $ppu — keep figures ≤ 700 px wide")
    ctx = Holo.context(bk, fig, ppu)
    m = Holo.build_manifest(ints, ctx)
    path = joinpath(@__DIR__, "$name.$backend.json")
    open(io -> JSON3.pretty(io, m), path, "w")
    println("wrote ", path)
end
