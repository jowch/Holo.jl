# Build ~/.julia/sysimages/holo-makie.so from this project.
# Invoked with JULIA_NOSYSIMAGE=1 so a prior image never wraps the compiler.
# CairoMakie + Holo only — do not bake WGLMakie (a dual-backend image makes implicit
# holo() pick Cairo after the resolver harden, but WGL live-verify still wants stock Julia).
using Pkg
using SHA: sha256

const PROJECT = @__DIR__
const HOLO_ROOT = joinpath(PROJECT, "..", "..")
Pkg.activate(PROJECT)

# Holo from the checkout (not the registry — Holo is unregistered). Other deps via names.
Pkg.develop(; path = HOLO_ROOT)
proj = Pkg.project()
have = Set(string.(keys(proj.dependencies)))
needed = ["Makie", "CairoMakie", "Pluto", "PackageCompiler"]
missing = [p for p in needed if !(p in have)]
isempty(missing) || Pkg.add(missing)
Pkg.instantiate()

using PackageCompiler

const SYSIMAGE = get(
    ENV,
    "HOLO_JULIA_SYSIMAGE",
    joinpath(homedir(), ".julia", "sysimages", "holo-makie.so"),
)
const STAMP = SYSIMAGE * ".stamp"
const WORKLOAD = joinpath(PROJECT, "precompile_workload.jl")

mkpath(dirname(SYSIMAGE))

# Hash Holo sources too: the image bakes :Holo, so a checkout edit must invalidate the stamp.
function _holo_src_bytes(root)
    paths = String[]
    for sub in ("src", "ext")
        for (dir, _, files) in walkdir(joinpath(root, sub))
            for f in files
                endswith(f, ".jl") && push!(paths, joinpath(dir, f))
            end
        end
    end
    push!(paths, joinpath(root, "Project.toml"))
    sort!(paths)
    io = IOBuffer()
    for p in paths
        write(io, read(p))
    end
    return String(take!(io))
end

manifest = joinpath(PROJECT, "Manifest.toml")
isfile(manifest) || error("Manifest.toml missing after instantiate: $manifest")
stamp = bytes2hex(sha256(String(read(manifest)) * String(read(WORKLOAD)) * _holo_src_bytes(HOLO_ROOT)))

if isfile(SYSIMAGE) && isfile(STAMP) && read(STAMP, String) == stamp
    @info "Holo Makie sysimage up to date" SYSIMAGE
else
    @info "Building Holo Makie sysimage (Makie + CairoMakie + Holo + Pluto; no WGLMakie)" SYSIMAGE
    isfile(SYSIMAGE) && rm(SYSIMAGE)
    PackageCompiler.create_sysimage(
        [:Makie, :CairoMakie, :Holo, :Pluto];
        sysimage_path = SYSIMAGE,
        project = PROJECT,
        precompile_execution_file = WORKLOAD,
    )
    write(STAMP, stamp)
    @info "Sysimage ready" SYSIMAGE filesize(SYSIMAGE)
end
