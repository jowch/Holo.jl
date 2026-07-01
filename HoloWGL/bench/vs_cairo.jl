# Cross-backend head-to-head: :webgl (this package) vs :cairo (Holo core) on the SAME seeded
# figures — the artifact behind HoloWGL/docs/backend-comparison.md. Reports, per figure:
#   - WIRE: Cairo PNG+manifest (per render) vs WebGL scene (per render) + the once-per-notebook bundle
#   - SERVER COST per update: Cairo render+encode+PNG ms vs WebGL serialize ms. WebGL's number
#     EXCLUDES the GPU draw *by design* — it's offloaded to the client; that offload is the win,
#     not a measurement gap. So a low WebGL ms at 100k points is the headline, not an omission.
#   - CROSSOVER N: renders after which cumulative WebGL (bundle + N·scene) < cumulative Cairo
#     (N·PNG+manifest, re-shipped every render). Cairo has no bundle but re-rasterizes each time.
#
# Two Julia envs can't coexist (CairoMakie vs WGLMakie active in one process), so the Cairo half
# runs in a root-env subprocess. PREREQ: both envs instantiated (root `Pkg.instantiate()` and
# `julia --project=HoloWGL -e 'using Pkg; Pkg.instantiate()'`). Numbers reconcile with the two
# perf-findings.md envelopes and root bench/stress.jl — re-run all three on any wire-format change.
#
#   julia --project=HoloWGL HoloWGL/bench/vs_cairo.jl
#
# NOTE: capability facts (pan/zoom/rotate = client-local on WebGL, impossible on Cairo's static PNG)
# are architectural, not benched — they live in backend-comparison.md's matrix. This bench covers
# the measurable payload/latency terms only.

using HoloWGL, Printf, Random
Random.seed!(0)   # mirror the Cairo subprocess seed so both sides build the SAME figures reproducibly
# (matters at small N: an unseeded rand() shifts tick-label glyph content → the scene size drifts).

# Comparison figure set as data so both envs build identical figures. kind ∈ line|scatter|heat|helix.
const CASES = [
    ("line 10", :line, 10),
    ("scatter 1k", :scatter, 1_000),
    ("scatter 10k", :scatter, 10_000),
    ("scatter 100k", :scatter, 100_000),
    ("heatmap 200²", :heat, 200),
    ("heatmap 500²", :heat, 500),
    ("helix3d 300", :helix, 300),
]

# Identical figure construction in both envs (Makie API is backend-agnostic). Duplicated verbatim
# in the Cairo subprocess heredoc below — keep the two copies in sync.
function buildfig(kind, n)
    f = Figure(size = (600, 400))
    if kind === :line
        ax = Axis(f[1, 1]); lines!(ax, 1:n, rand(n))
    elseif kind === :scatter
        ax = Axis(f[1, 1]); scatter!(ax, rand(n), rand(n); markersize = 6)
    elseif kind === :heat
        ax = Axis(f[1, 1]); heatmap!(ax, 1:n, 1:n, rand(n, n))
    elseif kind === :helix
        ts = range(0, 6π, n); ax = Axis3(f[1, 1]); lines!(ax, cos.(ts), sin.(ts), ts ./ 6)
    end
    return f
end

# --- WebGL side (live, this env) ---
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
function webgl_measure(kind, n)
    ser() = (f = buildfig(kind, n); Makie.update_state_before_display!(f); HoloWGL.scene_payload(f))
    scene = ser()
    scene_B = length(wire_blob!(UInt8[], scene))
    ser()  # warm
    ms = minimum(@elapsed(ser()) for _ in 1:3) * 1000
    return (scene_B, ms)
end

# --- Cairo side (root-env subprocess; parses tab-separated `label\tpng_B\tmanifest_B\tserver_ms`) ---
function cairo_measure_all()
    rootproj = abspath(joinpath(@__DIR__, "..", ".."))
    driver = tempname() * ".jl"
    write(
        driver, """
            using Holo, CairoMakie, Random
            Random.seed!(0)
            _str(n)=(n<32 ? 1 : n<256 ? 2 : n<65536 ? 3 : 5)+n
            _int(n)=(-32<=n<128 ? 1 : abs(n)<128 ? 2 : abs(n)<32768 ? 3 : abs(n)<2^31 ? 5 : 9)
            _hdr(n)=n<16 ? 1 : n<65536 ? 3 : 5
            mp(x::AbstractString)=_str(ncodeunits(x)); mp(x::Symbol)=_str(ncodeunits(String(x)))
            mp(::Nothing)=1; mp(x::Bool)=1; mp(x::Integer)=_int(Int(x)); mp(x::Float32)=5; mp(x::AbstractFloat)=9
            mp(x::AbstractDict)=_hdr(length(x))+sum(k->mp(k)+mp(x[k]),keys(x);init=0)
            mp(x::NamedTuple)=_hdr(length(x))+sum(p->_str(ncodeunits(String(p[1])))+mp(p[2]),pairs(x);init=0)
            mp(x::Union{AbstractVector,Tuple})=_hdr(length(x))+sum(mp,x;init=0)
            mp(x)=_hdr(length(x))+5*length(x)
            b64(w)=(length(w.b64)*3)÷4
            function buildfig(kind,n)
                f=Figure(size=(600,400))
                if kind===:line; ax=Axis(f[1,1]); lines!(ax,1:n,rand(n))
                elseif kind===:scatter; ax=Axis(f[1,1]); scatter!(ax,rand(n),rand(n);markersize=6)
                elseif kind===:heat; ax=Axis(f[1,1]); heatmap!(ax,1:n,1:n,rand(n,n))
                elseif kind===:helix; ts=range(0,6π,n); ax=Axis3(f[1,1]); lines!(ax,cos.(ts),sin.(ts),ts./6); end
                return f
            end
            cases=$(repr(CASES))
            for (label,kind,n) in cases
                try
                    mk()=buildfig(Symbol(kind),n)
                    w=holo(mk()); holo(mk())
                    ms=minimum(@elapsed(holo(mk())) for _ in 1:3)*1000
                    println("CAIRO\\t",label,"\\t",b64(w),"\\t",mp(w.manifest),"\\t",round(Int,ms))
                catch e
                    println("CAIRO\\t",label,"\\tUNSUPPORTED\\t0\\t0")
                end
            end
        """
    )
    out = try
        read(`julia --project=$rootproj $driver`, String)
    catch e
        @warn "Cairo subprocess failed (is the root env instantiated?)" exception = e
        ""
    finally
        rm(driver; force = true)
    end
    d = Dict{String, Any}()
    for ln in split(out, '\n')
        parts = split(ln, '\t')
        length(parts) == 5 && parts[1] == "CAIRO" || continue
        d[parts[2]] = parts[3] == "UNSUPPORTED" ? nothing :
            (png_B = parse(Int, parts[3]), manifest_B = parse(Int, parts[4]), ms = parse(Int, parts[5]))
    end
    return d
end

kb(b) = round(b / 1024; digits = 0)
bundle_B = filesize(HoloWGL.wglmakie_bundle_path())

println("WGLMakie bundle (once per notebook, M2): ", round(bundle_B / 1.0e6; digits = 2), " MB\n")
println("figure        | Cairo png+man/render | Cairo ms | WebGL scene/render | WebGL ms | crossover N")
println(repeat("-", 96))
cairo = cairo_measure_all()
isempty(cairo) && @warn "No Cairo rows parsed — the root-env subprocess produced nothing (is the " *
    "root env instantiated? `julia --project=. -e 'using Pkg; Pkg.instantiate()'`). Cairo columns below " *
    "read UNSUPPORTED but that reflects a subprocess failure, not a real capability gap."
for (label, kind, n) in CASES
    sc_B, w_ms = webgl_measure(kind, n)
    c = get(cairo, label, nothing)
    if c === nothing
        @printf(
            "%-13s | %20s | %8s | %14.0f KB | %6.0f | %s\n",
            label, "UNSUPPORTED (Axis3)", "n/a", kb(sc_B), w_ms, "WebGL-only"
        )
    else
        cper = c.png_B + c.manifest_B
        n_cross = cper > sc_B ? @sprintf("%.1f", bundle_B / (cper - sc_B)) : "never"
        @printf(
            "%-13s | %14.0f KB (%.0f+%.0f) | %6.0f | %14.0f KB | %6.0f | %s\n",
            label, kb(cper), kb(c.png_B), kb(c.manifest_B), c.ms, kb(sc_B), w_ms, n_cross
        )
    end
end
println("\ncrossover N = renders after which bundle + N·scene < N·(png+manifest); Cairo re-ships every render.")
