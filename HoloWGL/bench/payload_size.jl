# Re-runnable size bench for the :webgl wire format. The `:webgl` payload is a NEW format
# (scene_payload + the vendored WGLMakie bundle) separate from Holo core's PNG+manifest
# envelope (docs/perf-findings.md) — so per the profiling standing practice it gets its own
# committed bench here. Re-run and update HoloWGL/docs/roadmap.md when the wire format changes.
#
#   julia --project=HoloWGL HoloWGL/bench/payload_size.jl
#
# WIRE vs JSON proxy: Pluto's published_to_js does NOT ship the scene as JSON text. Its MsgPack
# encodes every typed numeric Vector (Float32/Int32/UInt32/UInt8 — exactly what `_plain` emits) as
# a BINARY extension (sizeof·length bytes), so the real per-cell wire is the binary typed-array
# total — ~4–5× smaller than `JSON3.write` (floats-as-text). We report that binary total as the wire
# figure (the dominant term; structural map/string overhead adds a little) and keep the JSON size as
# a labeled upper-bound proxy. (M2 measured that gzip-of-binary would cut another ~3× but needs a JS
# msgpack decoder, and the atlas glyph-tiles repeat across scenes — both deferred: see roadmap.md M2.)
#
# Measured 2026-06-30 (WGLMakie 0.13.12), recorded in docs/roadmap.md:
#   bundle 1.09 MB (once per notebook, M2) · scene WIRE (binary, per cell): 2D lines 0.07 MB ·
#   2D scatter+text 0.10 MB · 3D helix 0.14 MB  (JSON proxy upper bound: 0.33 / 0.44 / 0.56 MB)

using HoloWGL
import JSON3

println(
    "WGLMakie bundle (shipped once per notebook, M2): ",
    round(filesize(HoloWGL.wglmakie_bundle_path()) / 1.0e6; digits = 2), " MB"
)

# Sum the binary bytes of every typed numeric Vector in the payload — what Pluto's MsgPack actually
# puts on the wire (vs JSON3's float-text). Dominant term; structural overhead is small.
function wire_bytes(x)
    if x isa AbstractDict
        return sum(wire_bytes(v) for v in values(x); init = 0)
    elseif x isa AbstractVector && eltype(x) <: Number
        return length(x) * sizeof(eltype(x))
    elseif x isa AbstractVector
        return sum(wire_bytes(v) for v in x; init = 0)
    else
        return 0
    end
end

function sizes_mb(fig)
    Makie.update_state_before_display!(fig)
    scene = HoloWGL.scene_payload(fig)
    return (wire_bytes(scene) / 1.0e6, length(JSON3.write(scene)) / 1.0e6)
end

cases = [
    "2D lines (200 pts)" => () -> (f = Figure(; size = (600, 450)); ax = Axis(f[1, 1]); lines!(ax, range(0, 4π, 200), sin.(range(0, 4π, 200))); f),
    "2D scatter+text (40)" => () -> (f = Figure(; size = (600, 450)); ax = Axis(f[1, 1]; title = "t"); xs = range(0, 4π, 40); scatter!(ax, xs, sin.(xs)); f),
    "3D helix (300 pts)" => () -> (f = Figure(; size = (600, 450)); ax = Axis3(f[1, 1]); ts = range(0, 6π, 300); lines!(ax, cos.(ts), sin.(ts), ts ./ 6); f),
]
println("scene payload, per cell — WIRE (binary, what Pluto ships) vs JSON proxy (upper bound):")
for (name, mk) in cases
    w, j = sizes_mb(mk())
    println("  ", rpad(name, 24), "wire ", round(w; digits = 2), " MB   (JSON proxy ", round(j; digits = 2), " MB)")
end
