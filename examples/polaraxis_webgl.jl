### A Pluto.jl notebook ###
# v0.20.27

using Markdown
using InteractiveUtils

# This Pluto notebook uses @bind for interactivity. When running this notebook outside of Pluto, the following 'mock version' of @bind gives bound variables a default value (instead of an error).
macro bind(def, element)
    #! format: off
    return quote
        local iv = try Base.loaded_modules[Base.PkgId(Base.UUID("6e696c72-6542-2067-7265-42206c756150"), "AbstractPlutoDingetjes")].Bonds.initial_value catch; b -> missing; end
        local el = $(esc(element))
        global $(esc(def)) = Core.applicable(Base.get, el) ? Base.get(el) : iv(el)
        el
    end
    #! format: on
end

# ╔═╡ a1000000-0000-0000-0000-000000000001
# Self-contained env: develop local Masque + WGLMakie (selects :webgl backend).
begin
    import Pkg
    Pkg.activate(; temp = true)
    Pkg.develop(path = joinpath(@__DIR__, ".."))
    Pkg.add(["WGLMakie", "JSON3"])
    Pkg.instantiate()
    using Masque
    using WGLMakie
    import JSON3
end

# ╔═╡ a1000000-0000-0000-0000-000000000010
md"""
# PolarAxis discrete hits — `:webgl` live-verify

Scatter on `PolarAxis` with Masque overlay. Hover for tooltip; click for `@bind` event.
Continuous θ/r readout is deferred (`ispolar`); this notebook checks **discrete** hits only.
"""

# ╔═╡ a1000000-0000-0000-0000-000000000020
begin
    fig = Figure(; size = (480, 400))
    ax = PolarAxis(fig[1, 1])
    pts = Point2f[(0.0, 1.0), (π / 2, 2.0), (π, 1.5), (3π / 2, 2.5)]
    scatter!(ax, pts; color = :dodgerblue, markersize = 22)
    w = masque(fig)
end

# ╔═╡ a1000000-0000-0000-0000-000000000021
@bind polar_ev w

# ╔═╡ a1000000-0000-0000-0000-000000000022
polar_ev

# ╔═╡ a1000000-0000-0000-0000-000000000030
# Live layer geometry for the Playwright driver (image px).
HTML(
    "<span id=\"coords_polar\" style=\"display:none\">" *
        JSON3.write(w.manifest["layers"]) * "</span>" *
        "<span id=\"transforms_polar\" style=\"display:none\">" *
        JSON3.write(w.manifest["transforms"]) * "</span>",
)

# ╔═╡ Cell order:
# ╠═a1000000-0000-0000-0000-000000000001
# ╠═a1000000-0000-0000-0000-000000000010
# ╠═a1000000-0000-0000-0000-000000000020
# ╠═a1000000-0000-0000-0000-000000000021
# ╠═a1000000-0000-0000-0000-000000000022
# ╠═a1000000-0000-0000-0000-000000000030
