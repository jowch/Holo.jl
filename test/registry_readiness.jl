# General-registry readiness for the 0.1.0 freeze.
# File-level gates — no backend, no figure — so they run in every GROUP.
# Parsed without the TOML stdlib: Pkg.test's sandbox does not load undeclared stdlibs.
using Test

const ROOT = joinpath(@__DIR__, "..")
const HOLO_NAME = "Holo"
const HOLO_UUID = "82b01fb5-7eeb-4559-83ea-8d75f85d4328"
const TAGBOT_SHA = "cded32665b34ca0496d3ac10a67d08ddfc726963" # v1.25.11

# Packed General.toml pointer (typical depot / CI). Not a package index.
const GENERAL_POINTER = """
git-tree-sha1 = "6058d8637879e70d30b0431d70b51c9e5de802c3"
uuid = "23338594-aafe-5451-b93e-139f81909106"
path = "General.tar.gz"
"""

# Current General package rows are inline tables. Nearby holography names are
# not a clash; `Holo` itself must be an exact `{ name = "Holo"` match.
const GENERAL_SNIPPET = """
name = "General"
uuid = "23338594-aafe-5451-b93e-139f81909106"

[packages]
2a7007e0-cd7f-40de-83d0-bb76b7a3c669 = { name = "HoloProcessing", path = "H/HoloProcessing" }
91df39b6-5e55-447c-8840-2e09be0f70fd = { name = "DigitalHolography", path = "D/DigitalHolography" }
"""

const GENERAL_CLASH = """
name = "General"

[packages]
82b01fb5-7eeb-4559-83ea-8d75f85d4328 = { name = "Holo", path = "H/Holo" }
"""

# Round-1 false pass: line-anchored `^name = "Holo"$` never matches inline tables
# and treats a missing/pointer index as "free".
const _STALE_NAME_RE = r"(?m)^name = \"Holo\"$"

function _toml_section(path, name)
    vals = Dict{String, String}()
    insec = name === nothing
    for raw in eachline(path)
        s = strip(raw)
        (isempty(s) || startswith(s, "#")) && continue
        if startswith(s, "[")
            insec = s == "[$name]"
            continue
        end
        insec || continue
        m = match(r"^([A-Za-z0-9_]+) = \"(.*)\"$", s)
        m === nothing && continue
        vals[m.captures[1]] = m.captures[2]
    end
    return vals
end

function _is_package_index(text::AbstractString)
    return occursin(r"(?m)^\[packages\]\s*$", text) && occursin("{ name = \"", text)
end

function _package_named(text::AbstractString, name::AbstractString)
    return occursin("{ name = \"$name\"", text)
end

function _uuid_registered(text::AbstractString, uuid::AbstractString)
    return occursin(Regex("^" * uuid * "\\s*=", "m"), text)
end

function _extract_registry_toml(tarball::AbstractString)
    isfile(tarball) || return nothing
    io = IOBuffer()
    try
        run(pipeline(`tar -xOf $tarball Registry.toml`; stdout = io))
    catch
        return nothing
    end
    text = String(take!(io))
    return isempty(strip(text)) ? nothing : text
end

# Pkg.test / Julia 1.x CI often resolve via the package server and never
# unpack General. Search every depot, then fetch upstream Registry.toml.
const _GENERAL_REGISTRY_TOML_URL =
    "https://raw.githubusercontent.com/JuliaRegistries/General/master/Registry.toml"

function _registry_roots()
    roots = String[]
    for depot in DEPOT_PATH
        isempty(depot) && continue
        push!(roots, joinpath(depot, "registries"))
    end
    push!(roots, joinpath(homedir(), ".julia", "registries"))
    return unique(roots)
end

function _fetch_upstream_registry_toml()
    io = IOBuffer()
    try
        run(pipeline(`curl -fsSL $_GENERAL_REGISTRY_TOML_URL`; stdout = io))
    catch
        return nothing
    end
    text = String(take!(io))
    return _is_package_index(text) ? text : nothing
end

function _local_general_registry_index()
    for regs in _registry_roots()
        unpacked = joinpath(regs, "General", "Registry.toml")
        isfile(unpacked) && return read(unpacked, String)
        extracted = _extract_registry_toml(joinpath(regs, "General.tar.gz"))
        extracted === nothing || return extracted
    end
    return nothing
end

function _general_registry_index()
    local_idx = _local_general_registry_index()
    local_idx === nothing || return local_idx
    return _fetch_upstream_registry_toml()
end

@testset "General registry readiness" begin
    @testset "packed General index is a real gate" begin
        @test !_is_package_index(GENERAL_POINTER)
        @test !_is_package_index("name = \"General\"\n")
        @test _is_package_index(GENERAL_SNIPPET)
        @test _is_package_index(GENERAL_CLASH)

        # Stale recipe (CLAUDE.md / round-1 test) is silent on both forms.
        @test !occursin(_STALE_NAME_RE, GENERAL_POINTER)
        @test !occursin(_STALE_NAME_RE, GENERAL_SNIPPET)
        @test !occursin(_STALE_NAME_RE, GENERAL_CLASH)

        @test !_package_named(GENERAL_SNIPPET, HOLO_NAME)
        @test _package_named(GENERAL_SNIPPET, "HoloProcessing")
        @test _package_named(GENERAL_CLASH, HOLO_NAME)
        @test !_uuid_registered(GENERAL_SNIPPET, HOLO_UUID)
        @test _uuid_registered(GENERAL_CLASH, HOLO_UUID)
    end

    @testset "name and UUID are free in depot General" begin
        @test !isempty(_registry_roots())
        fetched = _fetch_upstream_registry_toml()
        @test fetched !== nothing
        @test _is_package_index(fetched)
        @test _package_named(fetched, "HoloProcessing")
        @test !_package_named(fetched, HOLO_NAME)

        index = _general_registry_index()
        @test index !== nothing
        if index !== nothing
            @test _is_package_index(index)
            # Nearby name must be visible — otherwise we are not reading packages.
            @test _package_named(index, "HoloProcessing")
            @test !_package_named(index, HOLO_NAME)
            @test !_uuid_registered(index, HOLO_UUID)
        end
    end

    @testset "Project.toml identity" begin
        proj_path = joinpath(ROOT, "Project.toml")
        ident = _toml_section(proj_path, nothing)
        proj_text = read(proj_path, String)
        @test ident["name"] == HOLO_NAME
        @test ident["uuid"] == HOLO_UUID
        @test ident["version"] == "0.1.0"
        @test occursin("authors", proj_text)
    end

    @testset "compat covers deps, weakdeps, and julia" begin
        proj_path = joinpath(ROOT, "Project.toml")
        deps = _toml_section(proj_path, "deps")
        weakdeps = _toml_section(proj_path, "weakdeps")
        compat = _toml_section(proj_path, "compat")
        @test haskey(compat, "julia")
        for dep in keys(deps)
            @test haskey(compat, dep)
        end
        for dep in keys(weakdeps)
            @test haskey(compat, dep)
        end
    end

    @testset "CHANGELOG frozen at 0.1.0" begin
        changelog = read(joinpath(ROOT, "CHANGELOG.md"), String)
        @test occursin(r"^## \[Unreleased\]\s*$"m, changelog)
        @test occursin(r"^## \[0\.1\.0\] - \d{4}-\d{2}-\d{2}\s*$"m, changelog)
        @test occursin("ViewInteractable", changelog)
        @test occursin(r"drag-to-pan", changelog)
        @test occursin("[Unreleased]: https://github.com/jowch/Holo.jl/compare/v0.1.0...HEAD", changelog)
        @test occursin("[0.1.0]: https://github.com/jowch/Holo.jl/releases/tag/v0.1.0", changelog)
        @test !occursin("not yet released or registered", changelog)
    end

    @testset "README install path is the registered name" begin
        readme = read(joinpath(ROOT, "README.md"), String)
        @test occursin("add Holo", readme)
        @test !occursin("Holo isn't registered yet", readme)
    end

    @testset "LICENSE and TagBot are present" begin
        @test isfile(joinpath(ROOT, "LICENSE"))
        tagbot = joinpath(ROOT, ".github", "workflows", "TagBot.yml")
        @test isfile(tagbot)
        if isfile(tagbot)
            body = read(tagbot, String)
            @test occursin("github.actor == 'JuliaTagBot'", body)
            @test occursin("JuliaRegistries/TagBot@$TAGBOT_SHA", body)
            @test occursin("token: \${{ secrets.GITHUB_TOKEN }}", body)
            @test occursin("ssh: \${{ secrets.DOCUMENTER_KEY }}", body)
            @test !occursin(r"(?m)^permissions:", body)
        end
    end

    @testset "releasing.md is the post-merge human path" begin
        path = joinpath(ROOT, "docs", "releasing.md")
        @test isfile(path)
        if isfile(path)
            releasing = read(path, String)
            @test occursin("@JuliaRegistrator register", releasing)
            @test occursin("commit's GitHub page", releasing)
            @test occursin("Read and write", releasing)
            @test occursin("DOCUMENTER_KEY", releasing)
            @test occursin("workflow", releasing)
            @test occursin("HoloProcessing", releasing)
            @test occursin("Do not comment `@JuliaRegistrator register` on a pull request", releasing)
        end
    end
end
