# General-registry readiness for the 0.1.0 freeze (after drag-to-pan, not sliders-only).
# These are file-level gates — no backend, no figure — so they run in every GROUP.
using Test
using TOML

const ROOT = joinpath(@__DIR__, "..")

@testset "General registry readiness" begin
    proj = TOML.parsefile(joinpath(ROOT, "Project.toml"))
    changelog = read(joinpath(ROOT, "CHANGELOG.md"), String)
    readme = read(joinpath(ROOT, "README.md"), String)

    @testset "Project.toml identity" begin
        @test proj["name"] == "Holo"
        @test proj["uuid"] == "82b01fb5-7eeb-4559-83ea-8d75f85d4328"
        @test proj["version"] == "0.1.0"
        @test !isempty(get(proj, "authors", String[]))
    end

    @testset "compat covers deps, weakdeps, and julia" begin
        compat = proj["compat"]
        @test haskey(compat, "julia")
        for dep in keys(proj["deps"])
            @test haskey(compat, dep)
        end
        for dep in keys(get(proj, "weakdeps", Dict{String, Any}()))
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
