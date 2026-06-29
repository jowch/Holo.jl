# Phase 0 perf spike — measure the payload envelope that bounds every payload-heavy roadmap
# item after it (richer tooltips, animation frames, SVG, multi-select). Re-runnable so the
# numbers can't rot as those features land. Findings live in docs/perf-findings.md.
#
# Run: julia --project=. bench/payload_envelope.jl
#
# Two payload terms (see src/render.jl `show`):
#   - base64 PNG  → embedded in the HTML <img src>; the "large base64 → editor lag" driver.
#   - manifest    → shipped via published_to_js (MsgPack on the wire) each render.
# The click return value (JS→Julia) is tiny (layer/index/payload) and not swept here.

using Holo, CairoMakie, Printf, Random
Random.seed!(0)   # deterministic geometry/PNG so the committed numbers are exactly reproducible
# (render-ms still varies run-to-run — it's wall-clock timing, not a size).

# ponytail: a msgpack *size* counter, not a msgpack library — models Pluto's published_to_js
# wire format (MsgPack) without adding MsgPack.jl to the package deps. We only need the byte
# count, and the spec's sizing rules are a few lines. Upgrade to MsgPack.jl if exact bytes
# ever matter. Encodings: https://github.com/msgpack/msgpack/blob/master/spec.md
_str(n) = (n < 32 ? 1 : n < 256 ? 2 : n < 65536 ? 3 : 5) + n
_int(n) = (-32 <= n < 128 ? 1 : abs(n) < 128 ? 2 : abs(n) < 32768 ? 3 : abs(n) < 2^31 ? 5 : 9)
_hdr(n) = n < 16 ? 1 : n < 65536 ? 3 : 5
mp(x::AbstractString) = _str(ncodeunits(x))
mp(x::Symbol) = _str(ncodeunits(String(x)))
mp(::Nothing) = 1
mp(x::Bool) = 1
mp(x::Integer) = _int(Int(x))
mp(x::Float32) = 5                              # msgpack float32 (HitLayer.geometry is Float32[])
mp(x::AbstractFloat) = 9                              # float64 (axis transform lims/viewport)
mp(x::AbstractDict) = _hdr(length(x)) + sum(k -> mp(k) + mp(x[k]), keys(x); init = 0)
mp(x::NamedTuple) = _hdr(length(x)) + sum(p -> _str(ncodeunits(String(p[1]))) + mp(p[2]), pairs(x); init = 0)
mp(x::Union{AbstractVector, Tuple}) = _hdr(length(x)) + sum(mp, x; init = 0)
mp(x) = _hdr(length(x)) + 5 * length(x)               # Point2f & friends → array of Float32 (not hit by these cases)

kb(bytes) = round(bytes / 1024; digits = 1)
b64bytes(w) = (length(w.b64) * 3) ÷ 4                  # base64 chars → decoded bytes

# hit-element count: payload entries for list layers, ncols×nrows cells for :grid (heatmap)
# layers — whose cells live in `geometry`, not `payloads`, so payload-count alone reads 0.
function nhits(L)
    g = L["geometry"]
    return g isa AbstractDict ? get(g, "ncols", 0) * get(g, "nrows", 0) : length(get(L, "payloads", []))
end

function row(label, w)
    nlayers = length(w.manifest["layers"])
    nelem = sum(nhits, w.manifest["layers"]; init = 0)
    return @printf(
        "  %-34s  png=%8s KB   manifest=%8s KB   layers=%2d  elems/cells=%7d\n",
        label, kb(b64bytes(w)), kb(mp(w.manifest)), nlayers, nelem
    )
end

println("\n=== A. base64 PNG vs plot density (default width, px_per_unit) ===")
let
    f = Figure(size = (600, 400)); ax = Axis(f[1, 1]); lines!(ax, 1:10, rand(10))
    row("line, 10 pts", holo(f))
end
for n in (100, 1_000, 10_000)
    f = Figure(size = (600, 400)); ax = Axis(f[1, 1])
    scatter!(ax, rand(n), rand(n); markersize = 6)
    row("scatter, $n pts", holo(f))
end
for d in (50, 200)
    f = Figure(size = (600, 400)); ax = Axis(f[1, 1])
    heatmap!(ax, 1:d, 1:d, rand(d, d))
    row("heatmap, $(d)×$(d)", holo(f))
end

println("\n=== B. manifest vs payload richness (scatter, N=1000) — bounds M2.3 tooltips ===")
let
    pts = [Point2f(rand(), rand()) for _ in 1:1000]
    f = Figure(size = (600, 400)); ax = Axis(f[1, 1]); scatter!(ax, pts)
    for len in (0, 50, 200)
        pl = [Dict("html" => "x"^len) for _ in 1:1000]
        w = holo(f, PointInteractable(ax, pts; id = :s, payloads = pl))
        row("payload html len=$len/elem", w)
    end
end

println("\n=== C. px_per_unit (display width) sweep — scatter 1000 ===")
for maxw in (300, 700)
    f = Figure(size = (600, 400)); ax = Axis(f[1, 1])
    scatter!(ax, rand(1000), rand(1000); markersize = 6)
    row("max_width=$maxw", holo(f; backend = CairoBackend(max_width = maxw)))
end

println("\n=== D. projected animation cost (Tier-1) = frames × per-frame PNG ===")
let
    f = Figure(size = (600, 400)); ax = Axis(f[1, 1]); scatter!(ax, rand(1000), rand(1000); markersize = 6)
    per = b64bytes(holo(f))   # same config as section A's scatter-1000 → comparable per-frame size
    for nf in (30, 120)
        @printf(
            "  %-34s  total≈%8s KB  (%d frames × %s KB)\n",
            "$nf-frame scrub", kb(per * nf), nf, kb(per)
        )
    end
end
println("\n=== E. render latency — Julia half of the click→re-render round-trip (warmed) ===")
# The click message (JS→Julia) is tiny + Pluto auto-throttles stale events; the felt latency is
# dominated by Julia re-rendering the figure and re-emitting the payload. Browser paint +
# websocket transfer ride on top (needs live Pluto to measure; this is the floor).
let
    cases = (
        ("scatter 1000", () -> (f = Figure(size = (600, 400)); ax = Axis(f[1, 1]); scatter!(ax, rand(1000), rand(1000)); f)),
        ("scatter 10000", () -> (f = Figure(size = (600, 400)); ax = Axis(f[1, 1]); scatter!(ax, rand(10000), rand(10000)); f)),
        ("heatmap 200×200", () -> (f = Figure(size = (600, 400)); ax = Axis(f[1, 1]); heatmap!(ax, 1:200, 1:200, rand(200, 200)); f)),
    )
    for (label, mk) in cases
        f = mk(); holo(f)                                  # warm up render path for this fig shape
        t = minimum(@elapsed(holo(mk())) for _ in 1:3)     # fresh fig each run; take the best of 3
        @printf("  %-34s  render+encode ≈ %6.0f ms\n", label, t * 1000)
    end
end
println()
