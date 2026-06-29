# De-speculating experiment: what does each wire-encoding ACTUALLY save on the manifest?
# Replaces the theoretical "~40%/~60%" byte math with real MsgPack.jl-serialized bytes.
# MsgPack-only (no Makie) so it runs fast. Geometry values use realistic pixel ranges.
import Pkg
Pkg.activate(; temp = true)
Pkg.add(name = "MsgPack", version = "1")
import MsgPack
using Printf
using Random
Random.seed!(0)

bytes(x) = length(MsgPack.pack(x))
kb(b) = @sprintf("%7.1f KB", b / 1024)
mb(b) = b >= 1_048_576 ? @sprintf("%6.2f MB", b / 1_048_576) : kb(b)

# ---- Geometry term: 50k circles = 150k pixel coords (cx,cy in 0..1400, r~8) ----
N = 50_000
function circles_geom()
    g = Float32[]
    for _ in 1:N
        push!(g, rand(Float32) * 1400, rand(Float32) * 900, 8.0f0)
    end
    return g
end
gF32 = circles_geom()                                   # current: Float32
gIntQ = Int.(round.(gF32))                              # quantized to integer pixels
gI16 = Int16.(round.(gF32))                             # quantized + 16-bit

# the manifest nests geometry inside Dict{String,Any}/Any[] (the real structure)
nest_generic(v) = Dict{String, Any}("kind" => "circles", "geometry" => Any[x for x in v])
nest_typed(v) = Dict{String, Any}("kind" => "circles", "geometry" => v)   # leaf stays a typed Vector

println("\n=== GEOMETRY ENCODING (50k circles, 150k coords) — real MsgPack bytes ===")
@printf("  %-42s %s   (%.2f B/coord)\n", "current: Float32, nested in Any[]", mb(bytes(nest_generic(gF32))), bytes(nest_generic(gF32)) / (3N))
@printf("  %-42s %s   (%.2f B/coord)\n", "Float32 as a typed Vector{Float32}", mb(bytes(nest_typed(gF32))), bytes(nest_typed(gF32)) / (3N))
@printf("  %-42s %s   (%.2f B/coord)\n", "int-quantized, nested in Any[]", mb(bytes(nest_generic(gIntQ))), bytes(nest_generic(gIntQ)) / (3N))
@printf("  %-42s %s   (%.2f B/coord)\n", "int-quantized as typed Vector{Int}", mb(bytes(nest_typed(gIntQ))), bytes(nest_typed(gIntQ)) / (3N))
@printf("  %-42s %s   (%.2f B/coord)\n", "Int16 as typed Vector{Int16}", mb(bytes(nest_typed(gI16))), bytes(nest_typed(gI16)) / (3N))
# Pluto's TypedArray fast-path (NOT standard msgpack — it ships a raw binary blob): floor =
@printf("  %-42s %s   (%.2f B/coord)  [Pluto binary floor, needs live confirm]\n", "Int16 raw binary (Pluto TypedArray)", mb(2 * 3N), 2.0)
@printf("  %-42s %s   (%.2f B/coord)  [Pluto binary floor]\n", "Float32 raw binary (Pluto TypedArray)", mb(4 * 3N), 4.0)

# ---- Values[] term: heatmap cap experiment ----
println("\n=== HEATMAP values[] (1000x1000) — cap/drop experiment ===")
vals = Float32[rand(Float32) for _ in 1:1_000_000]
edgesonly = Dict{String, Any}("xedges" => Any[Float32(i) for i in 1:1001], "yedges" => Any[Float32(i) for i in 1:1001], "ncols" => 1000, "nrows" => 1000)
withvals = merge(edgesonly, Dict{String, Any}("values" => Any[v for v in vals]))
@printf("  %-42s %s\n", "grid WITH values[] (current)", mb(bytes(withvals)))
@printf("  %-42s %s\n", "grid WITHOUT values[] (capped → {i,j})", mb(bytes(edgesonly)))
@printf("  %-42s %.0fx smaller\n", "→ drop ratio", bytes(withvals) / bytes(edgesonly))
println()
