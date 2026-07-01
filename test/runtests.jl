using Test

# Holo has two backend extensions (CairoMakie, WGLMakie) that are mutually exclusive by
# design (holo() rejects a session with both loaded). Each suite below needs a specific,
# non-overlapping set of packages loaded, so they run as separate GROUPs rather than one
# file — see the plan/spec for why. Default GROUP is "Core" (today's behavior unchanged).
const GROUP = get(ENV, "GROUP", "Core")

if GROUP == "Core"
    include("core_tests.jl")
elseif GROUP == "NoBackend"
    include("no_backend_tests.jl")
elseif GROUP == "WebGL"
    include("webgl_ext_tests.jl")
else
    error("Unknown GROUP=$GROUP — expected \"Core\", \"NoBackend\", or \"WebGL\"")
end

@testset "AxisTransform valueaxis field + serialization" begin
    using Holo: AxisTransform, _transform_dict
    # a normal axis transform defaults valueaxis = nothing → serializes to nothing
    t = AxisTransform(
        :ax1, (0.0, 1.0), (0.0, 2.0), :identity, :identity,
        (0.0, 0.0, 10.0, 20.0), false, false, nothing, nothing, nothing
    )
    @test t.valueaxis === nothing
    d = _transform_dict(t)
    @test haskey(d, "valueaxis")
    @test d["valueaxis"] === nothing
    # a colorbar-style transform tags the value axis
    tc = AxisTransform(
        :cb1, (0.0, 1.0), (0.0, 2.0), :identity, :log10,
        (0.0, 0.0, 10.0, 20.0), false, false, nothing, nothing, :y
    )
    @test _transform_dict(tc)["valueaxis"] == "y"
end

@testset "Colorbar transform in context" begin
    using Holo: context, CairoBackend, axis_id, build_manifest
    fig = Figure()
    ax = Axis(fig[1, 1])
    hm = heatmap!(ax, rand(10, 10))
    cb = Colorbar(fig[1, 2], hm)
    Makie.update_state_before_display!(fig)
    _, _, ctx = ctx_for(fig)                          # helper: render + build context
    tid = axis_id(ctx, cb)
    @test haskey(ctx.transforms, tid)
    t = ctx.transforms[tid]
    @test t.valueaxis === :y                          # vertical colorbar → value on y
    @test t.ylims == (Float64(cb.limits[][1]), Float64(cb.limits[][2]))
    @test t.yscale === :identity                      # default heatmap colorbar is identity
    # the colorbar viewport (image px) sits to the right of the axis viewport and has the bar's aspect
    axt = ctx.transforms[axis_id(ctx, ax)]
    @test t.viewport[1] > axt.viewport[1]             # colorbar is right of the axis
    @test t.viewport[3] < t.viewport[4]               # a vertical bar: width < height
    # the transform survives serialization into the JS-facing manifest
    m = build_manifest([], ctx)
    @test haskey(m["transforms"], string(tid))
    @test m["transforms"][string(tid)]["valueaxis"] == "y"

    # horizontal colorbar → value runs along x
    figh = Figure()
    axh = Axis(figh[1, 1])
    hmh = heatmap!(axh, rand(10, 10))
    cbh = Colorbar(figh[2, 1], hmh; vertical = false)
    Makie.update_state_before_display!(figh)
    _, _, ctxh = ctx_for(figh)
    th = ctxh.transforms[axis_id(ctxh, cbh)]
    @test th.valueaxis === :x
    @test th.xlims == (Float64(cbh.limits[][1]), Float64(cbh.limits[][2]))
    @test th.xscale === :identity
    @test th.viewport[3] > th.viewport[4]             # a horizontal bar: width > height
end

@testset "ColorbarInteractable" begin
    using Holo: ColorbarInteractable, hitlayers, validate
    fig = Figure(); ax = Axis(fig[1, 1]); hm = heatmap!(ax, rand(10, 10))
    cb = Colorbar(fig[1, 2], hm)
    Makie.update_state_before_display!(fig)
    _, _, ctx = ctx_for(fig)
    ci = ColorbarInteractable(cb; id = :colorbar)
    @test validate(ci, ctx) === nothing                     # identity scale is invertible
    ls = hitlayers(ci, ctx)
    @test length(ls) == 1
    L = ls[1]
    @test L.kind === :axis
    @test L.id === :colorbar
    @test L.geometry isa AbstractVector && length(L.geometry) == 4   # bbox rect [x,y,w,h] (bounded)
    @test L.axis == Holo.axis_id(ctx, cb)                   # references the colorbar transform
    @test isempty(L.payloads)                               # value computed client-side

    # non-invertible scale fails loud (colorscale on the heatmap propagates to cb.scale[])
    fig2 = Figure(); ax2 = Axis(fig2[1, 1])
    hm2 = heatmap!(ax2, rand(10, 10); colorscale = Makie.pseudolog10)
    cb2 = Colorbar(fig2[1, 2], hm2)
    Makie.update_state_before_display!(fig2)
    _, _, ctx2 = ctx_for(fig2)
    ci2 = ColorbarInteractable(cb2; id = :colorbar)
    @test validate(ci2, ctx2) isa String                    # rejected with a message
end

@testset "holo(fig) auto-detects Colorbar" begin
    using Holo: auto_interactables, ColorbarInteractable
    fig = Figure(); ax = Axis(fig[1, 1]); hm = heatmap!(ax, rand(10, 10))
    Colorbar(fig[1, 2], hm)
    Makie.update_state_before_display!(fig)
    ints = auto_interactables(fig)
    cbs = filter(i -> i isa ColorbarInteractable, ints)
    @test length(cbs) == 1
    @test cbs[1].id === :colorbar
    # end-to-end: the emitted layer round-trips through the context
    _, _, ctx = ctx_for(fig)
    L = only(hitlayers(cbs[1], ctx))
    @test L.kind === :axis && length(L.geometry) == 4
    # two colorbars → two ColorbarInteractables with distinct ids
    fig2 = Figure()
    ax2 = Axis(fig2[1, 1])
    hm2a = heatmap!(ax2, rand(10, 10))
    ax2b = Axis(fig2[2, 1])
    hm2b = heatmap!(ax2b, rand(5, 5))
    Colorbar(fig2[1, 2], hm2a)
    Colorbar(fig2[2, 2], hm2b)
    Makie.update_state_before_display!(fig2)
    cbs2 = filter(i -> i isa ColorbarInteractable, auto_interactables(fig2))
    @test length(cbs2) == 2
    @test Set(c.id for c in cbs2) == Set([:colorbar, :colorbar_2])
end
