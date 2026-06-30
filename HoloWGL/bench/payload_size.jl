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
# total, ~4–5× smaller than `JSON3.write` (floats-as-text). We report the binary total as the wire
# figure (the dominant term; structural map/string overhead adds a little) and keep the JSON size as
# a labeled upper-bound proxy.
#
# The two `gzip` columns measure M2's deferred compression levers reproducibly (via system gzip -9,
# no Julia dep): gzip-of-binary is the ~3× ceiling (but needs a JS msgpack decoder to use), and
# gzip-of-JSON is the cheap browser path (DecompressionStream → JSON.parse) — only ~25% off the
# current wire since it starts from float-text. Both deferred — see docs/roadmap.md M2.
#
# Measured 2026-06-30 (WGLMakie 0.13.12), recorded in docs/roadmap.md:
#   bundle 1.09 MB (once per notebook, M2) · scene WIRE (binary, per cell): 2D lines 0.07 · 2D
#   scatter+text 0.10 · 3D helix 0.14 MB  (gzip-of-binary 0.02/0.03/0.05 · JSON proxy 0.33/0.44/0.56)

using HoloWGL
import JSON3

println(
    "WGLMakie bundle (shipped once per notebook, M2): ",
    round(filesize(HoloWGL.wglmakie_bundle_path()) / 1.0e6; digits = 2), " MB"
)

# Concatenate the binary bytes of every typed numeric Vector in the payload — what Pluto's MsgPack
# actually puts on the wire (vs JSON3's float-text). Dominant term; structural overhead is small.
function wire_blob!(buf, x)
    if x isa AbstractDict
        for v in values(x)
            wire_blob!(buf, v)
        end
    elseif x isa AbstractVector && eltype(x) <: Number
        append!(buf, reinterpret(UInt8, Vector(x)))
    elseif x isa AbstractVector
        for v in x
            wire_blob!(buf, v)
        end
    end
    return buf
end

# system gzip -9 (no Julia dep); returns compressed length in bytes, or nothing if gzip is absent.
function gzip_len(bytes)
    Sys.which("gzip") === nothing && return nothing
    path = tempname()
    try
        write(path, bytes)
        return length(read(pipeline(`gzip -9 -c $path`)))
    finally
        rm(path; force = true)
    end
end

mb(x) = x === nothing ? "n/a" : string(round(x / 1.0e6; digits = 2))

cases = [
    "2D lines (200 pts)" => () -> (f = Figure(; size = (600, 450)); ax = Axis(f[1, 1]); lines!(ax, range(0, 4π, 200), sin.(range(0, 4π, 200))); f),
    "2D scatter+text (40)" => () -> (f = Figure(; size = (600, 450)); ax = Axis(f[1, 1]; title = "t"); xs = range(0, 4π, 40); scatter!(ax, xs, sin.(xs)); f),
    "3D helix (300 pts)" => () -> (f = Figure(; size = (600, 450)); ax = Axis3(f[1, 1]); ts = range(0, 6π, 300); lines!(ax, cos.(ts), sin.(ts), ts ./ 6); f),
]
println("scene payload, per cell — WIRE (binary, what Pluto ships) + gzip levers · JSON proxy (upper bound):")
for (name, mk) in cases
    fig = mk()
    Makie.update_state_before_display!(fig)
    scene = HoloWGL.scene_payload(fig)
    blob = wire_blob!(UInt8[], scene)
    jsonstr = JSON3.write(scene)
    println(
        "  ", rpad(name, 24),
        "wire ", mb(length(blob)), " MB",
        "  (gzip-bin ", mb(gzip_len(blob)),
        " · gzip-json ", mb(gzip_len(Vector{UInt8}(jsonstr))),
        " · JSON proxy ", mb(length(jsonstr)), ")"
    )
end
