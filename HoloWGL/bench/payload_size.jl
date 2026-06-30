# Re-runnable size bench for the :webgl wire format. The `:webgl` payload is a NEW format
# (scene_payload JSON + the vendored WGLMakie bundle) separate from Holo core's PNG+manifest
# envelope (docs/perf-findings.md) — so per the profiling standing practice it gets its own
# committed bench here. Re-run and update HoloWGL/docs/roadmap.md when the wire format changes.
#
#   julia --project=HoloWGL HoloWGL/bench/payload_size.jl
#
# Measured 2026-06-30 (WGLMakie 0.13.12), recorded in docs/roadmap.md:
#   bundle 1.09 MB (once per widget) · 2D lines 0.33 MB · 2D scatter+text 0.44 MB · 3D helix 0.56 MB

using HoloWGL
import JSON3

println(
    "WGLMakie bundle (shipped once per widget): ",
    round(filesize(HoloWGL.wglmakie_bundle_path()) / 1.0e6; digits = 2), " MB"
)

function payload_mb(fig)
    Makie.update_state_before_display!(fig)
    return length(JSON3.write(HoloWGL.scene_payload(fig))) / 1.0e6
end

cases = [
    "2D lines (200 pts)" => () -> (f = Figure(; size = (600, 450)); ax = Axis(f[1, 1]); lines!(ax, range(0, 4π, 200), sin.(range(0, 4π, 200))); f),
    "2D scatter+text (40)" => () -> (f = Figure(; size = (600, 450)); ax = Axis(f[1, 1]; title = "t"); xs = range(0, 4π, 40); scatter!(ax, xs, sin.(xs)); f),
    "3D helix (300 pts)" => () -> (f = Figure(; size = (600, 450)); ax = Axis3(f[1, 1]); ts = range(0, 6π, 300); lines!(ax, cos.(ts), sin.(ts), ts ./ 6); f),
]
println("scene payload (JSON, shipped per cell):")
for (name, mk) in cases
    println("  ", rpad(name, 24), round(payload_mb(mk()); digits = 2), " MB")
end
