# General-registry readiness for the 0.1.0 freeze (after drag-to-pan, not sliders-only).
# File-level gates — no backend, no figure — so they run in every GROUP.
# Parsed without the TOML stdlib: Pkg.test's sandbox does not load undeclared stdlibs.
using Test

const ROOT = joinpath(@__DIR__, "..")

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

@testset "General registry readiness" begin
    proj_path = joinpath(ROOT, "Project.toml")
    ident = _toml_section(proj_path, nothing)
    deps = _toml_section(proj_path, "deps")
    weakdeps = _toml_section(proj_path, "weakdeps")
    compat = _toml_section(proj_path, "compat")
    changelog = read(joinpath(ROOT, "CHANGELOG.md"), String)
    readme = read(joinpath(ROOT, "README.md"), String)
    proj_text = read(proj_path, String)

    @testset "Project.toml identity" begin
        @test ident["name"] == "Holo"
        @test ident["uuid"] == "82b01fb5-7eeb-4559-83ea-8d75f85d4328"
        @test ident["version"] == "0.1.0"
        @test occursin("authors", proj_text)
    end

    @testset "compat covers deps, weakdeps, and julia" begin
        @test haskey(compat, "julia")
        for dep in keys(deps)
            @test haskey(compat, dep)
        end
        for dep in keys(weakdeps)
            @test haskey(compat, dep)
        end
    end

    @testset "CHANGELOG frozen at 0.1.0 after drag-to-pan" begin
        @test occursin(r"^## \[0\.1\.0\]"m, changelog)
        @test occursin("ViewInteractable", changelog)
        @test occursin(r"drag-to-pan", changelog)
        @test !occursin("not yet released or registered", changelog)
    end

    @testset "README install path is the registered name" begin
        @test occursin("add Holo", readme)
        @test !occursin("Holo isn't registered yet", readme)
    end

    @testset "LICENSE and TagBot are present" begin
        @test isfile(joinpath(ROOT, "LICENSE"))
        tagbot = joinpath(ROOT, ".github", "workflows", "TagBot.yml")
        @test isfile(tagbot)
        body = read(tagbot, String)
        @test occursin("JuliaTagBot", body)
        @test occursin("JuliaRegistries/TagBot", body)
    end

    @testset "name is free in General" begin
        # CLAUDE.md: grep '^name = "X"$' against Registry.toml. The depot here ships the
        # compressed General.toml; either form is enough to catch a clash.
        candidates = [
            joinpath(homedir(), ".julia", "registries", "General", "Registry.toml"),
            joinpath(homedir(), ".julia", "registries", "General.toml"),
        ]
        hit = false
        for path in candidates
            isfile(path) || continue
            hit |= occursin(r"(?m)^name = \"Holo\"$", read(path, String))
        end
        @test !hit
    end
end
