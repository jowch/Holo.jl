using Test
using Holo
using WGLMakie
import Makie

const _WGLExt = Base.get_extension(Holo, :HoloWGLMakieExt)

# Smoke tests for the serialization bridge (no browser). The browser render is covered by
# the spikes; these guard the Julia-side encoder + the version-coupled serialize_scene path.

@testset "scene_payload encoding" begin
    fig = Figure(; size = (400, 300))
    ax = Axis(fig[1, 1])
    lines!(ax, 1:10, (1:10) .^ 2)
    scatter!(ax, 1:10, (1:10) .^ 2)
    Makie.update_state_before_display!(fig)

    payload = _WGLExt.scene_payload(fig)

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
    @test _WGLExt.scene_payload(fig) isa Dict{String, Any}
end

@testset "holo(fig) widget (WGLMakie loaded)" begin
    import HypertextLiteral: JavaScript
    import JSON3
    fig = Figure(; size = (400, 300))
    ax = Axis(fig[1, 1])
    scatter!(ax, 1:5, rand(5))
    w = holo(fig, Holo.AbstractInteractable[]; backend = _WGLExt.WebGLBackend())
    @test w isa _WGLExt.WebGLWidget
    @test w.scene isa Dict{String, Any}
    @test (w.width, w.height) == (400, 300)

    # scene must be JSON3-safe (Makie can emit NaN in transformed-position buffers; _plain scrubs them)
    @test JSON3.write(w.scene) isa String

    # self-contained HTML (inline JSON instead of published_to_js) — the integration points
    html = sprint(
        show, MIME"text/html"(),
        _WGLExt._widget_html(
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
    @test occursin("window.__HoloWGL", html)     # M2: bundle/shim blob URLs cached once per notebook
    @test occursin("window.Holo.mount", html)    # Holo's overlay reused verbatim
end

@testset "PolarAxis scene is JSON3-safe (pagepolar e2e)" begin
    import JSON3
    fig = Figure(; size = (400, 300))
    ax = PolarAxis(fig[1, 1])
    scatter!(ax, Point2f[(0.0, 1.0), (π / 2, 2.0)]; markersize = 14, color = :red)
    w = holo(fig; backend = _WGLExt.WebGLBackend())
    @test w.manifest["transforms"]["ax1"]["ispolar"] === true
    @test JSON3.write(w.scene) isa String
    @test JSON3.write(w.manifest) isa String
end

@testset "context populates per-axis transforms (axis-keyed interactable)" begin
    fig = Figure(; size = (400, 300))
    ax = Axis(fig[1, 1])
    lines!(ax, 1:5, (1:5) .^ 2)
    Makie.update_state_before_display!(fig)

    ctx = Holo.context(_WGLExt.WebGLBackend(), fig, 2.0)
    @test ctx.transforms isa Dict{Symbol, Holo.AxisTransform}   # not Dict{Symbol,Any}
    @test haskey(ctx.transforms, :ax1)                           # was empty -> KeyError

    # an axis-keyed interactable must build its manifest without KeyError now
    thr = Holo.ThresholdInteractable(ax; value = 10.0)
    w = holo(fig, [thr]; backend = _WGLExt.WebGLBackend())
    @test w isa _WGLExt.WebGLWidget
    @test !isempty(w.manifest["transforms"])
end

@testset "scene_payload leaves no screen attached" begin
    fig = Figure(; size = (300, 200)); ax = Axis(fig[1, 1]); lines!(ax, 1:4, 1:4)
    Makie.update_state_before_display!(fig)
    n0 = length(fig.scene.current_screens)
    _WGLExt.scene_payload(fig)
    @test length(fig.scene.current_screens) == n0   # the serialization screen is cleaned up
end

@testset "backend wiring" begin
    b = _WGLExt.WebGLBackend()
    @test b isa Holo.AbstractBackend
    @test isfile(_WGLExt.SHIM_JS)
    @test isfile(_WGLExt._wgl_bundle_path())   # the version-matched renderer is on disk
end

@testset "version-coupling guard (WGLMakie/Bonito internals)" begin
    # This extension rides UNSTABLE WGLMakie/Bonito internals: the session-free
    # `serialize_scene`, the `Screen` + `NoConnection` atlas-population dance, and the JS
    # bundle's `setup_scene_init` export the shim calls (assets/holo-webgl.js). A WGLMakie
    # bump can move any of these and break the widget IN THE BROWSER with no Julia error —
    # the other testsets would still pass. Each check below names one coupling point so a
    # bump fails loudly *here*, cueing "re-verify the wire format" instead of a confusing
    # downstream symptom. Exercises the WGL-only compat block (`_wgl_bundle_path`,
    # `_headless_screen`, `_serialize_scene` in ext/HoloWGLMakieExt.jl), not just `isdefined`.

    @test isdefined(_WGLExt.Bonito, :NoConnection)   # session-free serialize (no live Pluto)
    @test isdefined(WGLMakie, :ScreenConfig)
    @test isdefined(WGLMakie, :serialize_scene)
    @test isdefined(WGLMakie, :Screen)
    @test isdefined(Makie, :merge_screen_config)
    @test isdefined(Makie, :push_screen!)
    @test isdefined(Makie, :delete_screen!)
    @test :session in fieldnames(WGLMakie.Screen)    # screen.session = NoConnection session

    fig = Figure(; size = (300, 200)); ax = Axis(fig[1, 1]); scatter!(ax, 1:6, (1:6) ./ 6)
    Makie.update_state_before_display!(fig)

    # _headless_screen(f, scene): f sees a live, session-attached screen; detached after.
    n0 = length(fig.scene.current_screens)
    sess_seen = _WGLExt._headless_screen(fig.scene) do screen
        screen isa WGLMakie.Screen && screen.session !== nothing
    end
    @test sess_seen === true
    @test length(fig.scene.current_screens) == n0

    # _serialize_scene(scene) directly (not just via scene_payload's _plain wrapper).
    raw = _WGLExt._headless_screen(fig.scene) do screen
        _WGLExt._serialize_scene(fig.scene)
    end
    @test haskey(raw, :plots) || haskey(raw, "plots") || haskey(raw, :children) || haskey(raw, "children")

    payload = _WGLExt.scene_payload(fig)
    @test haskey(payload, "plots") || haskey(payload, "children")   # scene nesting

    uuids = String[]
    walk(x) = x isa AbstractDict ?
        (haskey(x, "uuid") && push!(uuids, string(x["uuid"])); foreach(walk, values(x))) :
        x isa AbstractVector ? foreach(walk, x) : nothing
    walk(payload)
    @test !isempty(uuids)

    bundle = read(_WGLExt._wgl_bundle_path(), String)
    @test occursin("setup_scene_init", bundle)
    @test occursin("find_plots", bundle)
end

@testset "shim-completeness canary (Bonito/Connection symbols the bundle references)" begin
    # The bundle calls window.Bonito.<x> and window.Bonito.Connection.<x> globals with no
    # compile-time check against our shim (frontend/src/wgl-shim.ts) — a WGLMakie bump that
    # references a new one silently produces a browser TypeError (this guarded against
    # `send_warning`, added after `on_shader_error` started calling it). This asserts the
    # shim is a SUPERSET of what the installed bundle references, not equal to it — the shim
    # also provides members like `lock_loading` that the bundle doesn't call directly.
    # `Bonito.X` and `Connection.X` are two different namespaces (the shim object vs.
    # `ConnStub`), so each is matched against only its own region of wgl-shim.ts — a flat
    # symbol-name match would let e.g. a future `Bonito.on(...)` false-pass against
    # `ConnStub`'s `on()` method.
    bundle = read(_WGLExt._wgl_bundle_path(), String)

    shim_path = joinpath(pkgdir(Holo), "frontend", "src", "wgl-shim.ts")
    @test isfile(shim_path)
    shim_src = read(shim_path, String)
    # strip `//` line comments first, so a comment merely *mentioning* a symbol name (e.g.
    # this testset's own docstring) can't be mistaken for the shim providing it.
    stripped = join((replace(l, r"//.*$" => "") for l in split(shim_src, '\n')), '\n')

    # Scope both regions to inside makeBonitoShim() specifically — `obs()` (above it in this
    # file) also has a `return { ... }` object literal, and a file-wide match would grab
    # that one instead (verified: it did, until this was scoped).
    shim_fn = match(r"export function makeBonitoShim\(\) \{(.*?)\n\}\n"s, stripped)
    @test !isnothing(shim_fn)   # loud if wgl-shim.ts is restructured, not a silent no-op
    shim_body = shim_fn.captures[1]
    conn_region = match(r"class ConnStub \{(.*?)\n    \}"s, shim_body)
    obj_region = match(r"return \{(.*?)\n    \}"s, shim_body)
    @test !isnothing(conn_region)
    @test !isnothing(obj_region)

    members(s) = Set(m.captures[1] for m in eachmatch(r"^\s*(?:static\s+)?([A-Za-z_]\w*)\s*[:=(]"m, s))
    provided_conn = members(conn_region.captures[1])
    provided_obj = members(obj_region.captures[1])

    referenced_obj = Set(m.captures[1] for m in eachmatch(r"Bonito\.([A-Za-z_]+)", bundle))
    referenced_conn = Set(m.captures[1] for m in eachmatch(r"Connection\.([A-Za-z_]+)", bundle))
    @test !isempty(referenced_obj)   # a regex/region miss must not silently pass the canary
    @test !isempty(referenced_conn)

    missing_obj = setdiff(referenced_obj, provided_obj)
    missing_conn = setdiff(referenced_conn, provided_conn)
    @test missing_obj == Set{String}()    # `Evaluated:` on failure names exactly what's missing
    @test missing_conn == Set{String}()
end

@testset "WGL accessors rewrap a moved internal" begin
    # Negative path for the WGL-only compat block, mirroring test/makie_compat_tests.jl's
    # "accessors rewrap a moved internal" — a shape break must produce the Holo message,
    # not a raw MethodError/FieldError.
    @test_throws r"^Holo: WGLMakie/Bonito internal `serialize_scene`" _WGLExt._serialize_scene(nothing)
    @test_throws r"^Holo: WGLMakie/Bonito internal `headless screen construction`" _WGLExt._headless_screen(identity, nothing)
end

@testset "@bind round-trip contract (click payload -> InteractionEvent)" begin
    import JSON3
    import AbstractPlutoDingetjes as APD
    IE = Holo.InteractionEvent

    fig = Figure(; size = (400, 300)); ax = Axis(fig[1, 1])
    scatter!(ax, 1:5, (1:5) .^ 2)
    w = holo(fig; backend = _WGLExt.WebGLBackend())   # auto-extract -> one :scatter circles layer
    layer = only(w.manifest["layers"])
    @test layer["id"] == "scatter"

    k = 2
    wire = JSON3.read(JSON3.write(layer["payloads"][k + 1]))   # payloads are 0-based; +1 for Julia
    js = Dict{String, Any}("layer" => layer["id"], "index" => k, "payload" => wire)

    ev = APD.Bonds.transform_value(w, js)
    @test ev isa IE
    @test ev.layer === :scatter
    @test ev.index == k
    @test ev.payload == wire

    @test APD.Bonds.initial_value(w) === nothing
    @test APD.Bonds.transform_value(w, nothing) === nothing

    multi = Dict{String, Any}("items" => [js, Dict{String, Any}("layer" => "scatter", "index" => 0)])
    evs = APD.Bonds.transform_value(w, multi)
    @test evs isa Vector{IE}
    @test length(evs) == 2 && evs[1].index == k && evs[2].index == 0
end

# MUST run last in this file: this loads CairoMakie on top of the already-loaded WGLMakie.
# After that, implicit holo() defaults to Cairo (sysimage-safe) — nothing after this
# testset may rely on the WGLMakie-only auto-resolution path.
# ---- cross-backend parity harness: within-backend golden drift (:webgl half) ----
# (JSON3 is already a hard dep of this GROUP — no guard needed; see core_tests.jl's
# guarded twin for the regeneration discipline.) Runs BEFORE the both-loaded testset
# below loads CairoMakie: goldens come from a WGLMakie-only env, so the live
# manifests should be built in one too.
include("parity_corpus.jl")
@testset "parity goldens (:webgl drift)" begin
    dir = joinpath(@__DIR__, "fixtures", "parity")
    for (name, build) in _parity_corpus()
        fig, ints = build()
        bk = _WGLExt.WebGLBackend()
        ctx = Holo.context(bk, fig, Holo._ppu(bk, fig))
        live = JSON3.read(JSON3.write(Holo.build_manifest(ints, ctx)))
        golden = JSON3.read(read(joinpath(dir, "$name.webgl.json"), String))
        @test live == golden
    end
end

@testset "holo(fig) with both backends loaded defaults to Cairo" begin
    using CairoMakie
    cairo_ext = Base.get_extension(Holo, :HoloCairoMakieExt)
    fig = Figure(; size = (300, 200)); ax = Axis(fig[1, 1]); scatter!(ax, 1:5, rand(5))

    implicit = holo(fig)
    @test implicit isa Holo.HoloWidget

    cairo = holo(fig; backend = cairo_ext.CairoBackend())
    @test cairo isa Holo.HoloWidget

    wgl = holo(fig; backend = _WGLExt.WebGLBackend())
    @test wgl isa _WGLExt.WebGLWidget
end
