using Test
using HoloWGL
using WGLMakie
import Makie

# Smoke tests for the serialization bridge (no browser). The browser render is covered by
# the spikes; these guard the Julia-side encoder + the version-coupled serialize_scene path.

@testset "scene_payload encoding" begin
    fig = Figure(; size = (400, 300))
    ax = Axis(fig[1, 1])
    lines!(ax, 1:10, (1:10) .^ 2)
    scatter!(ax, 1:10, (1:10) .^ 2)
    Makie.update_state_before_display!(fig)

    payload = HoloWGL.scene_payload(fig)

    @test payload isa Dict{String, Any}
    @test haskey(payload, "plots") || haskey(payload, "children")

    # STRICT: mirror published_to_js — only Dict, Base.Array, and scalars. A StaticArray/Vec
    # is NOT a Base.Array, so a leftover Vec falls through to `false` (it slips past JSON3 but
    # published_to_js rejects it — the real-Pluto bug this guards against).
    function ok(x)
        if x isa AbstractDict
            return all(ok, values(x))
        elseif x isa Base.Array
            return all(ok, x)
        else
            return x isa Union{Real, AbstractString, Bool, Nothing}
        end
    end
    @test ok(payload)

    # observables were tagged, not left live
    found_obs = Ref(false); found_buf = Ref(false)
    walk(x) = x isa Dict ? (
            haskey(x, "__obs__") && (found_obs[] = true);
            haskey(x, "__t__") && (found_buf[] = true); foreach(walk, values(x))
        ) :
        x isa AbstractVector ? foreach(walk, x) : nothing
    walk(payload)
    @test found_obs[]   # {__obs__}
    @test found_buf[]   # {__t__}
end

@testset "Axis3 serializes (what CairoBackend rejects)" begin
    fig = Figure(; size = (400, 300))
    ax = Axis3(fig[1, 1])
    lines!(ax, cos.(0:0.1:6), sin.(0:0.1:6), 0:0.1:6)
    Makie.update_state_before_display!(fig)
    @test HoloWGL.scene_payload(fig) isa Dict{String, Any}
end

@testset "holo_webgl widget" begin
    import HoloWGL: _widget_html
    using HypertextLiteral: JavaScript
    import JSON3
    fig = Figure(; size = (400, 300))
    ax = Axis(fig[1, 1])
    scatter!(ax, 1:5, rand(5))
    w = holo_webgl(fig, [])                      # empty interactables -> still a valid base widget
    @test w isa HoloWGL.WebGLWidget
    @test w.scene isa Dict{String, Any}
    @test (w.width, w.height) == (400, 300)

    # self-contained HTML (inline JSON instead of published_to_js) — the integration points
    html = sprint(
        show, MIME"text/html"(),
        _widget_html(
            w;
            scene_expr = JavaScript(JSON3.write(w.scene)),
            manifest_expr = JavaScript(JSON3.write(w.manifest)),
            bundle_js = JavaScript(JSON3.write("/*bundle*/")),
            shim_js = JavaScript(JSON3.write("/*shim*/")),
        ),
    )
    @test occursin("canvas", html)
    @test occursin("mountWebGL", html)
    @test occursin("createObjectURL", html)      # blob delivery (no server / no file://)
    @test occursin("window.Holo.mount", html)    # Holo's overlay reused verbatim
end

@testset "context populates per-axis transforms (axis-keyed interactable)" begin
    fig = Figure(; size = (400, 300))
    ax = Axis(fig[1, 1])
    lines!(ax, 1:5, (1:5) .^ 2)
    Makie.update_state_before_display!(fig)

    ctx = HoloWGL.Holo.context(WebGLBackend(), fig, 2.0)
    @test ctx.transforms isa Dict{Symbol, HoloWGL.Holo.AxisTransform}   # not Dict{Symbol,Any}
    @test haskey(ctx.transforms, :ax1)                                  # was empty -> KeyError

    # an axis-keyed interactable must build its manifest without KeyError now
    thr = HoloWGL.Holo.ThresholdInteractable(ax; value = 10.0)
    w = holo_webgl(fig, [thr])
    @test w isa HoloWGL.WebGLWidget
    @test !isempty(w.manifest["transforms"])
end

@testset "scene_payload leaves no screen attached" begin
    fig = Figure(; size = (300, 200)); ax = Axis(fig[1, 1]); lines!(ax, 1:4, 1:4)
    Makie.update_state_before_display!(fig)
    n0 = length(fig.scene.current_screens)
    HoloWGL.scene_payload(fig)
    @test length(fig.scene.current_screens) == n0   # the serialization screen is cleaned up
end

@testset "backend wiring" begin
    b = WebGLBackend()
    @test b isa HoloWGL.Holo.AbstractBackend
    @test HoloWGL.Holo.mount(b) === :webgl
    @test isfile(HoloWGL.SHIM_JS)
    @test isfile(HoloWGL.wglmakie_bundle_path())   # the version-matched renderer is on disk
end

@testset "version-coupling guard (WGLMakie/Bonito internals)" begin
    # HoloWGL rides UNSTABLE WGLMakie/Bonito internals: the session-free `serialize_scene`, the
    # `Screen` + `NoConnection` atlas-population dance (HoloWGL.jl:81), and the JS bundle's
    # `setup_scene_init` export the shim calls (assets/holo-webgl.js:55). A WGLMakie bump can move
    # any of these and break the widget IN THE BROWSER with no Julia error — the other testsets
    # would still pass. Each check below names one coupling point so a bump fails loudly *here*,
    # cueing "re-verify the wire format" (roadmap M1) instead of a confusing downstream symptom.

    # Julia internals the scene_payload() chain reaches by name:
    @test isdefined(HoloWGL.Bonito, :NoConnection)   # session-free serialize (no live Pluto)
    @test isdefined(WGLMakie, :ScreenConfig)
    @test isdefined(WGLMakie, :serialize_scene)
    @test isdefined(WGLMakie, :Screen)
    @test isdefined(Makie, :merge_screen_config)
    @test isdefined(Makie, :push_screen!)
    @test isdefined(Makie, :delete_screen!)
    @test :session in fieldnames(WGLMakie.Screen)    # screen.session = NoConnection session

    # The serialized wire SHAPE the JS deserializer + tier-2 animation depend on:
    fig = Figure(; size = (300, 200)); ax = Axis(fig[1, 1]); scatter!(ax, 1:6, (1:6) ./ 6)
    Makie.update_state_before_display!(fig)
    payload = HoloWGL.scene_payload(fig)
    @test haskey(payload, "plots") || haskey(payload, "children")   # scene nesting

    # every plot keeps a uuid -> WGL.find_plots([uuid]) can address it for tier-2 data animation
    uuids = String[]
    walk(x) = x isa AbstractDict ?
        (haskey(x, "uuid") && push!(uuids, string(x["uuid"])); foreach(walk, values(x))) :
        x isa AbstractVector ? foreach(walk, x) : nothing
    walk(payload)
    @test !isempty(uuids)

    # The vendored JS bundle still EXPORTS the symbols the shim calls (assets/holo-webgl.js):
    bundle = read(HoloWGL.wglmakie_bundle_path(), String)
    @test occursin("setup_scene_init", bundle)   # WGL.setup_scene_init(...) — mount entry point
    @test occursin("find_plots", bundle)          # WGL.find_plots([uuid]) — tier-2 data animation
end
