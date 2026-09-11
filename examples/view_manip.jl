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

# ╔═╡ 50000000-0000-0000-0000-000000000001
# Self-contained env: dev the local package via a checkout-relative path, add CairoMakie
# and PlutoUI. Pkg.develop disables Pluto's own pkg management (the package is unregistered).
begin
    import Pkg
    Pkg.activate(; temp = true)
    Pkg.develop(path = joinpath(@__DIR__, ".."))   # examples/ -> package root (portable)
    Pkg.add(["CairoMakie", "PlutoUI"])
    Pkg.instantiate()
    using Holo
    using CairoMakie
    using PlutoUI
end

# ╔═╡ 50000000-0000-0000-0000-000000000000
md"""
# Holo.jl — view manipulation via `@bind` re-render

Pan, zoom, and 3D rotation use the same server-authoritative `@bind` re-render model:
change `limits` (2D) or `azimuth`/`elevation` (`Axis3`) and rebuild — `holo` re-projects
the overlay so hit regions never drift. Drive those params with PlutoUI sliders (no Holo
API) or with **`ViewInteractable`** drag-to-pan / drag-to-rotate (commit-on-release).
The same notebook runs on `:webgl` (`examples/view_manip_webgl.jl`).
"""

# ╔═╡ 50000000-0000-0000-0000-000000000010
md"""
## 2D zoom — a `limits` slider

Drag the slider: the axis re-renders with new `limits` and every marker stays clickable
at its new pixel position.
"""

# ╔═╡ 50000000-0000-0000-0000-000000000011
@bind xmax PlutoUI.Slider(4:1:10; default = 6, show_value = true)

# ╔═╡ 50000000-0000-0000-0000-000000000012
zoom_data = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0), (4.0, 16.0), (5.0, 25.0), (6.0, 36.0)]

# ╔═╡ 50000000-0000-0000-0000-000000000013
begin
    zoom_fig = Figure(size = (500, 320))
    zoom_ax = Axis(zoom_fig[1, 1]; limits = (0, xmax, 0, 40), title = "zoom via limits — markers stay clickable")
    scatter!(zoom_ax, first.(zoom_data), last.(zoom_data); color = :dodgerblue, markersize = 18)
    zoom_int = PointInteractable(zoom_ax, zoom_data; id = :scatter)
end

# ╔═╡ 50000000-0000-0000-0000-000000000014
@bind zoom_sel holo(zoom_fig, zoom_int)

# ╔═╡ 50000000-0000-0000-0000-000000000015
HTML("<span id=\"zoomout\">ZOOM=$(repr(zoom_sel)) xmax=$(xmax)</span>")

# ╔═╡ 50000000-0000-0000-0000-000000000020
md"""
## Selection survives view re-renders

Click points in the **left** plot to select them; the **right** plot pre-highlights that
selection via `selected=` — and because Julia re-derives the highlight on every render,
it survives the zoom slider re-rendering the right plot. This is the backend-symmetric
persistence rule: a re-render clears client state, so selection state lives in Julia and
rides the manifest.
"""

# ╔═╡ 50000000-0000-0000-0000-000000000021
# persistent accumulator (runs once; the Ref survives later cells' re-runs)
vm_acc = Ref(Int[])

# ╔═╡ 50000000-0000-0000-0000-000000000022
begin
    vm_fig_l = Figure(size = (420, 300))
    vm_ax_l = Axis(vm_fig_l[1, 1]; title = "click to select")
    scatter!(vm_ax_l, first.(zoom_data), last.(zoom_data); color = :teal, markersize = 18)
    vm_int_l = PointInteractable(vm_ax_l, zoom_data; id = :scatter)
end

# ╔═╡ 50000000-0000-0000-0000-000000000023
@bind vm_sel holo(vm_fig_l, vm_int_l)

# ╔═╡ 50000000-0000-0000-0000-000000000024
# accumulate clicked indices (acyclic: depends on vm_sel + the once-init Ref)
vm_picked = begin
    vm_sel === nothing || push!(vm_acc[], vm_sel.index)
    unique!(sort!(vm_acc[]))
end

# ╔═╡ 50000000-0000-0000-0000-000000000025
@bind vm_zoom PlutoUI.Slider(4:1:10; default = 8, show_value = true)

# ╔═╡ 50000000-0000-0000-0000-000000000026
begin
    vm_fig_r = Figure(size = (420, 300))
    vm_ax_r = Axis(vm_fig_r[1, 1]; limits = (0, vm_zoom, 0, 40), title = "zoom me — selection persists")
    scatter!(vm_ax_r, first.(zoom_data), last.(zoom_data); color = :teal, markersize = 18)
    vm_int_r = PointInteractable(vm_ax_r, zoom_data; id = :scatter)
end

# ╔═╡ 50000000-0000-0000-0000-000000000027
@bind _vm_ignore holo(vm_fig_r, vm_int_r; selected = Dict(:scatter => vm_picked))

# ╔═╡ 50000000-0000-0000-0000-000000000028
HTML("<span id=\"pickout\">PICKED=$(vm_picked)</span>")

# ╔═╡ 50000000-0000-0000-0000-000000000030
md"""
## 3D rotation — `azimuth` / `elevation` sliders

The `Axis3` re-render path: each slider change re-projects the overlay onto the new
camera, so 3D markers stay hoverable/clickable at every angle. Payloads carry
`{index, x, y, z}`.
"""

# ╔═╡ 50000000-0000-0000-0000-000000000031
@bind rot_az PlutoUI.Slider(0.2:0.2:1.4; default = 0.4, show_value = true)

# ╔═╡ 50000000-0000-0000-0000-000000000032
@bind rot_el PlutoUI.Slider(0.1:0.2:0.9; default = 0.5, show_value = true)

# ╔═╡ 50000000-0000-0000-0000-000000000033
begin
    rot_fig = Figure(size = (500, 380))
    rot_ax = Axis3(rot_fig[1, 1]; azimuth = rot_az, elevation = rot_el, title = "rotate via re-render")
    scatter!(rot_ax, Makie.Point3f[(1, 2, 3), (4, 5, 6), (7, 8, 2)]; color = :crimson, markersize = 16)
    nothing
end

# ╔═╡ 50000000-0000-0000-0000-000000000034
@bind rot_sel holo(rot_fig)

# ╔═╡ 50000000-0000-0000-0000-000000000035
HTML("<span id=\"rotout\">ROT=$(repr(rot_sel)) az=$(rot_az) el=$(rot_el)</span>")

# ╔═╡ 50000000-0000-0000-0000-000000000040
md"""
## Drag-to-pan (2D) — commit on release

`ViewInteractable` emits new `limits` on mouse-up. Pluto forbids feeding that bond back
into the *same* figure cell (cyclic reference), so the **top** plot is a fixed-seed drag
surface and the **bottom** plot re-renders from the committed bond — same server-authoritative
contract as the slider. **Shift+drag** forces pan over Tier-0 ROI/threshold.
"""

# ╔═╡ 50000000-0000-0000-0000-000000000041
pan_seed = (0.0, 8.0, 0.0, 40.0)

# ╔═╡ 50000000-0000-0000-0000-000000000042
begin
    pan_fig = Figure(size = (500, 320))
    pan_ax = Axis(pan_fig[1, 1]; limits = pan_seed, title = "drag to pan — commit on release")
    scatter!(pan_ax, first.(zoom_data), last.(zoom_data); color = :dodgerblue, markersize = 18)
    pan_pts = PointInteractable(pan_ax, zoom_data; id = :scatter)
    pan_view = ViewInteractable(pan_ax)
end

# ╔═╡ 50000000-0000-0000-0000-000000000043
@bind pan_ev holo(pan_fig, pan_pts, pan_view)

# ╔═╡ 50000000-0000-0000-0000-000000000044
pan_committed = begin
    if pan_ev !== nothing && pan_ev isa InteractionEvent && pan_ev.layer === :view
        pl = pan_ev.payload
        (Float64(pl["xmin"]), Float64(pl["xmax"]), Float64(pl["ymin"]), Float64(pl["ymax"]))
    else
        pan_seed
    end
end

# ╔═╡ 50000000-0000-0000-0000-000000000045
HTML("<span id=\"panout\">PAN=$(repr(pan_ev)) lims=$(pan_committed)</span>")

# ╔═╡ 50000000-0000-0000-0000-000000000046
begin
    pan_fig2 = Figure(size = (500, 320))
    pan_ax2 = Axis(pan_fig2[1, 1]; limits = pan_committed, title = "committed pan view")
    scatter!(pan_ax2, first.(zoom_data), last.(zoom_data); color = :dodgerblue, markersize = 18)
    holo(pan_fig2, PointInteractable(pan_ax2, zoom_data; id = :scatter))
end

# ╔═╡ 50000000-0000-0000-0000-000000000050
md"""
## Drag-to-rotate (Axis3) — commit on release

Same split: drag on the seed camera (top); bottom re-renders from committed
`(azimuth, elevation)`.
"""

# ╔═╡ 50000000-0000-0000-0000-000000000051
orb_seed = (0.4, 0.5)

# ╔═╡ 50000000-0000-0000-0000-000000000052
begin
    orb_fig = Figure(size = (500, 380))
    orb_ax = Axis3(orb_fig[1, 1]; azimuth = orb_seed[1], elevation = orb_seed[2], title = "drag to rotate")
    scatter!(orb_ax, Makie.Point3f[(1, 2, 3), (4, 5, 6), (7, 8, 2)]; color = :crimson, markersize = 16)
    orb_view = ViewInteractable(orb_ax)
end

# ╔═╡ 50000000-0000-0000-0000-000000000053
@bind orb_ev holo(orb_fig, orb_view)

# ╔═╡ 50000000-0000-0000-0000-000000000054
orbit_committed = begin
    if orb_ev !== nothing && orb_ev isa InteractionEvent && orb_ev.layer === :view
        op = orb_ev.payload
        (Float64(op["azimuth"]), Float64(op["elevation"]))
    else
        orb_seed
    end
end

# ╔═╡ 50000000-0000-0000-0000-000000000055
HTML("<span id=\"orbout\">ORB=$(repr(orb_ev)) cam=$(orbit_committed)</span>")

# ╔═╡ 50000000-0000-0000-0000-000000000056
begin
    orb_fig2 = Figure(size = (500, 380))
    orb_ax2 = Axis3(orb_fig2[1, 1]; azimuth = orbit_committed[1], elevation = orbit_committed[2], title = "committed orbit view")
    scatter!(orb_ax2, Makie.Point3f[(1, 2, 3), (4, 5, 6), (7, 8, 2)]; color = :crimson, markersize = 16)
    holo(orb_fig2)
end

# ╔═╡ Cell order:
# ╠═50000000-0000-0000-0000-000000000001
# ╟─50000000-0000-0000-0000-000000000000
# ╟─50000000-0000-0000-0000-000000000010
# ╠═50000000-0000-0000-0000-000000000011
# ╠═50000000-0000-0000-0000-000000000012
# ╠═50000000-0000-0000-0000-000000000013
# ╠═50000000-0000-0000-0000-000000000014
# ╠═50000000-0000-0000-0000-000000000015
# ╟─50000000-0000-0000-0000-000000000020
# ╠═50000000-0000-0000-0000-000000000021
# ╠═50000000-0000-0000-0000-000000000022
# ╠═50000000-0000-0000-0000-000000000023
# ╠═50000000-0000-0000-0000-000000000024
# ╠═50000000-0000-0000-0000-000000000025
# ╠═50000000-0000-0000-0000-000000000026
# ╠═50000000-0000-0000-0000-000000000027
# ╠═50000000-0000-0000-0000-000000000028
# ╟─50000000-0000-0000-0000-000000000030
# ╠═50000000-0000-0000-0000-000000000031
# ╠═50000000-0000-0000-0000-000000000032
# ╠═50000000-0000-0000-0000-000000000033
# ╠═50000000-0000-0000-0000-000000000034
# ╠═50000000-0000-0000-0000-000000000035
# ╟─50000000-0000-0000-0000-000000000040
# ╠═50000000-0000-0000-0000-000000000041
# ╠═50000000-0000-0000-0000-000000000042
# ╠═50000000-0000-0000-0000-000000000043
# ╠═50000000-0000-0000-0000-000000000044
# ╠═50000000-0000-0000-0000-000000000045
# ╠═50000000-0000-0000-0000-000000000046
# ╟─50000000-0000-0000-0000-000000000050
# ╠═50000000-0000-0000-0000-000000000051
# ╠═50000000-0000-0000-0000-000000000052
# ╠═50000000-0000-0000-0000-000000000053
# ╠═50000000-0000-0000-0000-000000000054
# ╠═50000000-0000-0000-0000-000000000055
# ╠═50000000-0000-0000-0000-000000000056
