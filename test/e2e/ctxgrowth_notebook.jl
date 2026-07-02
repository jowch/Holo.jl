### A Pluto.jl notebook ###
# v0.20.28

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

# ╔═╡ c0000000-0000-0000-0000-000000000001
begin
    import Pkg
    Pkg.activate(; temp = true)
    Pkg.develop(path = normpath(joinpath(@__DIR__, "..", "..")))   # test/e2e -> package root
    Pkg.add(["WGLMakie", "PlutoUI"])
    Pkg.instantiate()
    using Holo
    using WGLMakie
    using PlutoUI
end

# ╔═╡ c0000000-0000-0000-0000-000000000009
# The view param: a plain @bind slider. Each change re-runs the holo cell below — the
# server-authoritative re-render path whose :webgl cost this spike measures.
@bind az PlutoUI.Slider(0.2:0.2:1.4; default = 0.4)

# ╔═╡ c0000000-0000-0000-0000-000000000010
fig = let
    f = Figure(; size = (400, 300))
    ax3 = Axis3(f[1, 1]; azimuth = az, elevation = 0.5)
    scatter!(ax3, Makie.Point3f[(1, 2, 3), (4, 5, 6), (7, 8, 2)]; markersize = 14, color = :red)
    f
end

# ╔═╡ c0000000-0000-0000-0000-000000000011
@bind ev holo(fig)

# ╔═╡ c0000000-0000-0000-0000-000000000012
HTML("<span id=\"bondout\">BOND=$(repr(ev)) az=$(az)</span>")

# ╔═╡ Cell order:
# ╠═c0000000-0000-0000-0000-000000000001
# ╠═c0000000-0000-0000-0000-000000000009
# ╠═c0000000-0000-0000-0000-000000000010
# ╠═c0000000-0000-0000-0000-000000000011
# ╠═c0000000-0000-0000-0000-000000000012
