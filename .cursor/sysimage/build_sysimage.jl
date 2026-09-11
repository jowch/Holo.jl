# Build ~/.julia/sysimages/holo-makie.so from this project.
# Invoked with JULIA_NOSYSIMAGE=1 so a prior image never wraps the compiler.
using Pkg
using SHA: sha256

const PROJECT = @__DIR__
Pkg.activate(PROJECT)

# Resolve deps via registry names (avoid hand-copied UUIDs drifting).
needed = ["Makie", "CairoMakie", "WGLMakie", "Pluto", "PackageCompiler"]
proj = Pkg.project()
have = Set(string.(keys(proj.dependencies)))
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

manifest = joinpath(PROJECT, "Manifest.toml")
isfile(manifest) || error("Manifest.toml missing after instantiate: $manifest")
stamp = bytes2hex(sha256(String(read(manifest)) * String(read(WORKLOAD))))

if isfile(SYSIMAGE) && isfile(STAMP) && read(STAMP, String) == stamp
    @info "Holo Makie sysimage up to date" SYSIMAGE
else
    @info "Building Holo Makie sysimage (Makie + CairoMakie + WGLMakie + Pluto)" SYSIMAGE
    isfile(SYSIMAGE) && rm(SYSIMAGE)
    PackageCompiler.create_sysimage(
        [:Makie, :CairoMakie, :WGLMakie, :Pluto];
        sysimage_path = SYSIMAGE,
        project = PROJECT,
        precompile_execution_file = WORKLOAD,
    )
    write(STAMP, stamp)
    @info "Sysimage ready" SYSIMAGE filesize(SYSIMAGE)
end
