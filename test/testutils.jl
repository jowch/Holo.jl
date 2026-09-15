# Shared fixtures for test/core/*.jl. Included (not a module) so every file that pulls
# it in gets these names at its own top level — each core/*.jl file does
# `using Test, Holo, CairoMakie, Makie` then `include(joinpath(@__DIR__, "..", "testutils.jl"))`
# so it can also run standalone via `julia --project=. test/core/<file>.jl`.
#
# core_tests.jl chains all of test/core/*.jl's includes of this file into one process for
# the Core group, so the whole body is guarded to run once per session — plain redefinition
# would otherwise be harmless but noisy (a `WARNING: Method definition ... overwritten`
# per file).
if !@isdefined(HOLO_TESTUTILS_LOADED)
    const HOLO_TESTUTILS_LOADED = true

    using Holo: hitlayers, validate, events, HitLayer, build_manifest, HoloWidget
    import Holo as IP

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

    # The canonical fixture the original core_tests.jl built once, inside the outer
    # `@testset "Holo" begin ... end` (pts/fig/ax/bk/ppu/ctx), and many nested testsets read
    # by bare name. `@testset` wraps its body in a `let`, so those names were locals of the
    # OUTER testset's `let` — a nested `@testset`'s own `let` assigning `fig = Figure(...)`
    # reassigns that already-existing enclosing local rather than shadowing it (Julia's `let`
    # closes over a name that already exists in an enclosing scope), so later testsets
    # silently inherited whatever a previous, possibly unrelated testset last left behind
    # (see PR "Split core_tests.jl by concern with per-testset fixtures" for the audit) —
    # every testset moved out of that single-file chain now calls this instead of relying on
    # leftover state from a sibling testset.
    const DEFAULT_PTS = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0)]

    function default_fixture(; max_width = 700)
        pts = DEFAULT_PTS
        fig = Figure(size = (600, 400))
        ax = Axis(fig[1, 1])
        scatter!(ax, first.(pts), last.(pts); color = :red, markersize = 16)
        bk, ppu, ctx = ctx_for(fig; max_width)
        return (; fig, ax, pts, bk, ppu, ctx)
    end
end
