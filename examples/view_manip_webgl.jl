### A Pluto.jl notebook ###
# v0.20.28

using Markdown
using InteractiveUtils

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

# ╔═╡ 60000000-0000-0000-0000-000000000001
begin
    import Pkg
    Pkg.activate(; temp = true)
    Pkg.develop(path = joinpath(@__DIR__, ".."))
    Pkg.add(["WGLMakie", "JSON3"])
    Pkg.instantiate()
    using Holo
    using WGLMakie
end

# ╔═╡ 60000000-0000-0000-0000-000000000010
md"""
# ViewManip WebGL — drag-to-pan / drag-to-rotate live-verify
"""

# ╔═╡ 60000000-0000-0000-0000-000000000011
zoom_data = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0), (4.0, 16.0), (5.0, 25.0), (6.0, 36.0)]

# ╔═╡ 60000000-0000-0000-0000-000000000020
pan_seed = (0.0, 8.0, 0.0, 40.0)

# ╔═╡ 60000000-0000-0000-0000-000000000021
begin
    pan_fig = Figure(size = (500, 320))
    pan_ax = Axis(pan_fig[1, 1]; limits = pan_seed, title = "drag to pan (webgl)")
    scatter!(pan_ax, first.(zoom_data), last.(zoom_data); color = :dodgerblue, markersize = 18)
    pan_pts = PointInteractable(pan_ax, zoom_data; id = :scatter)
    pan_view = ViewInteractable(pan_ax)
end

# ╔═╡ 60000000-0000-0000-0000-000000000022
@bind pan_ev holo(pan_fig, pan_pts, pan_view)

# ╔═╡ 60000000-0000-0000-0000-000000000023
pan_committed = begin
    if pan_ev !== nothing && pan_ev isa InteractionEvent && pan_ev.layer === :view
        pl = pan_ev.payload
        (Float64(pl["xmin"]), Float64(pl["xmax"]), Float64(pl["ymin"]), Float64(pl["ymax"]))
    else
        pan_seed
    end
end

# ╔═╡ 60000000-0000-0000-0000-000000000024
HTML("<span id=\"panout\">PAN=$(repr(pan_ev)) lims=$(pan_committed)</span>")

# ╔═╡ 60000000-0000-0000-0000-000000000025
begin
    pan_fig2 = Figure(size = (500, 320))
    pan_ax2 = Axis(pan_fig2[1, 1]; limits = pan_committed, title = "committed pan (webgl)")
    scatter!(pan_ax2, first.(zoom_data), last.(zoom_data); color = :dodgerblue, markersize = 18)
    holo(pan_fig2, PointInteractable(pan_ax2, zoom_data; id = :scatter))
end

# ╔═╡ 60000000-0000-0000-0000-000000000030
orb_seed = (0.4, 0.5)

# ╔═╡ 60000000-0000-0000-0000-000000000031
begin
    orb_fig = Figure(size = (500, 380))
    orb_ax = Axis3(orb_fig[1, 1]; azimuth = orb_seed[1], elevation = orb_seed[2], title = "drag to rotate (webgl)")
    scatter!(orb_ax, Makie.Point3f[(1, 2, 3), (4, 5, 6), (7, 8, 2)]; color = :crimson, markersize = 16)
    orb_view = ViewInteractable(orb_ax)
end

# ╔═╡ 60000000-0000-0000-0000-000000000032
@bind orb_ev holo(orb_fig, orb_view)

# ╔═╡ 60000000-0000-0000-0000-000000000033
orbit_committed = begin
    if orb_ev !== nothing && orb_ev isa InteractionEvent && orb_ev.layer === :view
        op = orb_ev.payload
        (Float64(op["azimuth"]), Float64(op["elevation"]))
    else
        orb_seed
    end
end

# ╔═╡ 60000000-0000-0000-0000-000000000034
HTML("<span id=\"orbout\">ORB=$(repr(orb_ev)) cam=$(orbit_committed)</span>")

# ╔═╡ 60000000-0000-0000-0000-000000000035
begin
    orb_fig2 = Figure(size = (500, 380))
    orb_ax2 = Axis3(orb_fig2[1, 1]; azimuth = orbit_committed[1], elevation = orbit_committed[2], title = "committed orbit (webgl)")
    scatter!(orb_ax2, Makie.Point3f[(1, 2, 3), (4, 5, 6), (7, 8, 2)]; color = :crimson, markersize = 16)
    holo(orb_fig2)
end

# ╔═╡ Cell order:
# ╠═60000000-0000-0000-0000-000000000001
# ╟─60000000-0000-0000-0000-000000000010
# ╠═60000000-0000-0000-0000-000000000011
# ╠═60000000-0000-0000-0000-000000000020
# ╠═60000000-0000-0000-0000-000000000021
# ╠═60000000-0000-0000-0000-000000000022
# ╠═60000000-0000-0000-0000-000000000023
# ╠═60000000-0000-0000-0000-000000000024
# ╠═60000000-0000-0000-0000-000000000025
# ╠═60000000-0000-0000-0000-000000000030
# ╠═60000000-0000-0000-0000-000000000031
# ╠═60000000-0000-0000-0000-000000000032
# ╠═60000000-0000-0000-0000-000000000033
# ╠═60000000-0000-0000-0000-000000000034
# ╠═60000000-0000-0000-0000-000000000035
