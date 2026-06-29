# Phase 0 stress sweep — push 10× past payload_envelope.jl to find where base64/manifest hit
# MB-scale and where render time cliffs. Same dep-free msgpack sizer + seed, so these numbers are
# reproducible too. The live round-trip numbers in docs/perf-findings.md ("Full click round-trip"
# and the round-trip column of the stress table) are NOT produced here — they need a headless
# Pluto + browser and are one-off measurements; this script covers only the Julia-side payload/
# render terms (the rows labelled reproducible in that doc).
#
# Run: julia --project=. bench/stress.jl

using Holo, CairoMakie, Printf, Random
Random.seed!(0)

# msgpack size sizer — identical rules to bench/payload_envelope.jl (geometry is Float32 → 5 B).
_str(n) = (n < 32 ? 1 : n < 256 ? 2 : n < 65536 ? 3 : 5) + n
_int(n) = (-32 <= n < 128 ? 1 : abs(n) < 128 ? 2 : abs(n) < 32768 ? 3 : abs(n) < 2^31 ? 5 : 9)
_hdr(n) = n < 16 ? 1 : n < 65536 ? 3 : 5
mp(x::AbstractString) = _str(ncodeunits(x))
mp(x::Symbol) = _str(ncodeunits(String(x)))
mp(::Nothing) = 1
mp(x::Bool) = 1
mp(x::Integer) = _int(Int(x))
mp(x::Float32) = 5
mp(x::AbstractFloat) = 9
mp(x::AbstractDict) = _hdr(length(x)) + sum(k -> mp(k) + mp(x[k]), keys(x); init = 0)
mp(x::NamedTuple) = _hdr(length(x)) + sum(p -> _str(ncodeunits(String(p[1]))) + mp(p[2]), pairs(x); init = 0)
mp(x::Union{AbstractVector, Tuple}) = _hdr(length(x)) + sum(mp, x; init = 0)
mp(x) = _hdr(length(x)) + 5 * length(x)

sz(bytes) = bytes >= 1_048_576 ? @sprintf("%6.2f MB", bytes / 1_048_576) : @sprintf("%6.0f KB", bytes / 1024)
b64bytes(w) = (length(w.b64) * 3) ÷ 4
nhits(L) = (g = L["geometry"]; g isa AbstractDict ? get(g, "ncols", 0) * get(g, "nrows", 0) : length(get(L, "payloads", [])))

function stress(label, mkfig, mkint = fig -> nothing)
    fig = mkfig()
    ints = mkint(fig)
    w = ints === nothing ? holo(fig) : holo(fig, ints)
    t = @elapsed(ints === nothing ? holo(mkfig()) : holo(mkfig(), mkint(mkfig())))   # warmed by `w`
    nelem = sum(nhits, w.manifest["layers"]; init = 0)
    @printf(
        "  %-32s  png=%s  manifest=%s  render=%6.0f ms  elems/cells=%8d\n",
        label, sz(b64bytes(w)), sz(mp(w.manifest)), t * 1000, nelem
    )
    return w
end

println("\n=== STRESS A. scatter element count to the cliff ===")
for n in (50_000, 100_000, 200_000)
    stress("scatter $n", () -> (f = Figure(size = (600, 400)); a = Axis(f[1, 1]); scatter!(a, rand(n), rand(n); markersize = 4); f))
end

println("\n=== STRESS B. heatmap cells — manifest carries the full value matrix ===")
for d in (300, 500, 1000)
    stress("heatmap $(d)×$(d) ($(d * d) cells)", () -> (f = Figure(size = (600, 400)); a = Axis(f[1, 1]); heatmap!(a, 1:d, 1:d, rand(d, d)); f))
end

println("\n=== STRESS C. canvas pixel area (big figure × big display width, sparse content) ===")
for (w_, h_, mw) in ((1600, 1000, 1400), (2400, 1500, 2000), (3200, 2000, 3000))
    stress(
        "fig $(w_)×$(h_) @max_width=$mw",
        () -> (f = Figure(size = (w_, h_)); a = Axis(f[1, 1]); scatter!(a, rand(2000), rand(2000)); f)
    )
end

println("\n=== STRESS D. worst case: 50k elements EACH with a 200-byte payload (bounds M2.3) ===")
let n = 50_000
    pl = [Dict("html" => "x"^200) for _ in 1:n]
    P = [Point2f(rand(), rand()) for _ in 1:n]
    stress(
        "scatter $n + 200B payload/elem",
        () -> (f = Figure(size = (600, 400)); a = Axis(f[1, 1]); scatter!(a, P); f),
        f -> PointInteractable(f.content[1], P; id = :s, payloads = pl)
    )
end

println("\n=== STRESS E. animation projection at stress scale = frames × per-frame PNG ===")
let
    w = holo((f = Figure(size = (1200, 800)); a = Axis(f[1, 1]); scatter!(a, rand(5000), rand(5000); markersize = 6); f))
    per = b64bytes(w)
    @printf("  per-frame (1200×800, 5k scatter) = %s\n", sz(per))
    for nf in (60, 300, 1000)
        @printf("  %-32s  total=%s\n", "$nf-frame scrub", sz(per * nf))
    end
end
println()
