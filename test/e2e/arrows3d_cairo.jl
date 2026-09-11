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

# ╔═╡ a0000000-0000-0000-0000-000000000001
begin
    import Pkg
    Pkg.activate(; temp = true)
    Pkg.develop(path = joinpath(@__DIR__, "..", ".."))
    Pkg.add(["CairoMakie", "JSON3"])
    Pkg.instantiate()
    using Holo
    using CairoMakie
    import JSON3
end

# ╔═╡ a0000000-0000-0000-0000-000000000010
begin
    fig = Figure(; size = (600, 450))
    ax = Axis3(fig[1, 1]; azimuth = 0.4, elevation = 0.5, title = "arrows3d cairo")
    apts = Makie.Point3f[(1, 1, 1), (3, 2, 1), (2, 4, 3)]
    adirs = Makie.Vec3f[(1, 0, 0), (0, 1, 0.5), (-0.5, 0, 1)]
    arrows3d!(ax, apts, adirs; color = :red)
    ints = auto_interactables(fig)
    arrow_widget = holo(fig, ints)
    # Midpoints from the LIVE manifest (same path the overlay hits) — no duplicated figure math
    L = only(arrow_widget.manifest["layers"])
    g = L["geometry"]
    mids = [[(g[4k + 1] + g[4k + 3]) / 2, (g[4k + 2] + g[4k + 4]) / 2] for k in 0:2]
end

# ╔═╡ a0000000-0000-0000-0000-000000000011
@bind ev arrow_widget

# ╔═╡ a0000000-0000-0000-0000-000000000012
HTML(
    "<span id=\"bondout\">BOND=$(repr(ev))</span>" *
        "<span id=\"mids\" data-json='$(JSON3.write(mids))' style=\"display:none\"></span>" *
        "<span id=\"backend\">cairo</span>"
)

# ╔═╡ Cell order:
# ╠═a0000000-0000-0000-0000-000000000001
# ╠═a0000000-0000-0000-0000-000000000010
# ╠═a0000000-0000-0000-0000-000000000011
# ╠═a0000000-0000-0000-0000-000000000012
