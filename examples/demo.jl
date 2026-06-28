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

# ╔═╡ 40000000-0000-0000-0000-000000000001
# Self-contained env: dev the local package via a checkout-relative path, add CairoMakie.
# Pkg.develop disables Pluto's own pkg management (the local package is unregistered).
begin
    import Pkg
    Pkg.activate(; temp = true)
    Pkg.develop(path = joinpath(@__DIR__, ".."))   # examples/ -> package root (portable)
    Pkg.add("CairoMakie")
    Pkg.instantiate()
    using Holo
    using CairoMakie
end

# ╔═╡ 40000000-0000-0000-0000-000000000000
md"""
# Holo.jl — interactive plot gallery

One self-contained notebook exercising every built-in interactable kind end-to-end:
**Point · Segment · Rect (grid + list) · Polygon · Axis readout**, plus the
**selection round-trip** (click → re-highlight, flicker-free across re-renders).

Each plot is a static CairoMakie render with a thin JS hit-testing overlay. Click a
plot; the bond below it reports the typed `InteractionEvent`.
"""

# ╔═╡ 40000000-0000-0000-0000-000000000010
md"## Point — `PointInteractable` (scatter markers)"

# ╔═╡ 40000000-0000-0000-0000-000000000011
begin
    pt_data = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0), (4.0, 16.0), (1.5, 12.0)]
    pt_labels = ["alpha", "beta", "gamma", "delta", "epsilon"]
    pt_fig = Figure(size = (500, 350))
    pt_ax = Axis(pt_fig[1, 1]; title = "click a point")
    scatter!(pt_ax, first.(pt_data), last.(pt_data); color = :dodgerblue, markersize = 20)
    pt_int = PointInteractable(
        pt_ax, pt_data; id = :scatter,
        payloads = [(; index = k - 1, label = pt_labels[k]) for k in eachindex(pt_labels)],
    )
end

# ╔═╡ 40000000-0000-0000-0000-000000000012
@bind pt_sel holo(pt_fig, pt_int)

# ╔═╡ 40000000-0000-0000-0000-000000000013
pt_sel === nothing ? "point: click a marker" :
    "point: index=$(pt_sel.index) label=$(pt_sel.payload["label"])"   # payload round-trips as a Dict

# ╔═╡ 40000000-0000-0000-0000-000000000020
md"## Segment — `SegmentInteractable` (polyline)"

# ╔═╡ 40000000-0000-0000-0000-000000000021
begin
    sg_verts = [(0.0, 0.0), (1.0, 2.0), (2.0, 1.0), (3.0, 3.0), (4.0, 0.5)]
    sg_fig = Figure(size = (500, 350))
    sg_ax = Axis(sg_fig[1, 1]; title = "click a segment")
    lines!(sg_ax, first.(sg_verts), last.(sg_verts); color = :firebrick, linewidth = 4)
    sg_int = SegmentInteractable(sg_ax, sg_verts; id = :poly, mode = :polyline)
end

# ╔═╡ 40000000-0000-0000-0000-000000000022
@bind sg_sel holo(sg_fig, sg_int)

# ╔═╡ 40000000-0000-0000-0000-000000000023
sg_sel === nothing ? "segment: click a line segment" :
    "segment: segment_index=$(sg_sel.payload["segment_index"])"

# ╔═╡ 40000000-0000-0000-0000-000000000030
md"## Rect (grid) — `RectInteractable(; grid)` (heatmap cells)"

# ╔═╡ 40000000-0000-0000-0000-000000000031
begin
    hm_z = [Float64((i + j) % 5) for i in 1:8, j in 1:6]
    hm_fig = Figure(size = (500, 350))
    hm_ax = Axis(hm_fig[1, 1]; title = "click a heatmap cell")
    heatmap!(hm_ax, 1:8, 1:6, hm_z)
    hm_int = RectInteractable(hm_ax; id = :cells, grid = (0.5:1:8.5, 0.5:1:6.5, hm_z))
end

# ╔═╡ 40000000-0000-0000-0000-000000000032
@bind hm_sel holo(hm_fig, hm_int)

# ╔═╡ 40000000-0000-0000-0000-000000000033
hm_sel === nothing ? "grid: click a cell" :
    "grid: cell index=$(hm_sel.index) payload=$(hm_sel.payload)"

# ╔═╡ 40000000-0000-0000-0000-000000000040
md"## Rect (list) — `RectInteractable(; rects)` (explicit boxes)"

# ╔═╡ 40000000-0000-0000-0000-000000000041
begin
    # (xc, yc, w, h) in data space; drawn to match the hit rects exactly
    rl_rects = [(1.0, 1.0, 1.2, 0.8), (3.0, 2.0, 0.8, 1.4), (5.0, 1.5, 1.6, 1.0)]
    rl_fig = Figure(size = (500, 350))
    rl_ax = Axis(rl_fig[1, 1]; title = "click a box", limits = (0, 6, 0, 4))
    for (xc, yc, w, h) in rl_rects
        poly!(rl_ax, Rect2f(xc - w / 2, yc - h / 2, w, h); color = (:seagreen, 0.5), strokewidth = 2)
    end
    rl_int = RectInteractable(
        rl_ax; id = :boxes, rects = rl_rects,
        payloads = [(; index = k - 1, name = "box$k") for k in eachindex(rl_rects)],
    )
end

# ╔═╡ 40000000-0000-0000-0000-000000000042
@bind rl_sel holo(rl_fig, rl_int)

# ╔═╡ 40000000-0000-0000-0000-000000000043
rl_sel === nothing ? "list: click a box" :
    "list: index=$(rl_sel.index) name=$(rl_sel.payload["name"])"

# ╔═╡ 40000000-0000-0000-0000-000000000050
md"## Polygon — `PolygonInteractable` (filled regions)"

# ╔═╡ 40000000-0000-0000-0000-000000000051
begin
    pg_rings = [
        [(0.5, 0.5), (2.0, 0.7), (1.5, 2.0), (0.6, 1.8)],
        [(2.5, 1.0), (4.0, 1.2), (3.8, 3.0), (2.7, 2.6)],
    ]
    pg_fig = Figure(size = (500, 350))
    pg_ax = Axis(pg_fig[1, 1]; title = "click a polygon", limits = (0, 4.5, 0, 3.5))
    for (k, ring) in enumerate(pg_rings)
        poly!(pg_ax, Point2f.(ring); color = (k == 1 ? :orchid : :goldenrod, 0.6), strokewidth = 2)
    end
    pg_int = PolygonInteractable(
        pg_ax, pg_rings; id = :regions,
        payloads = [(; index = k - 1, shape = "ring$k") for k in eachindex(pg_rings)],
    )
end

# ╔═╡ 40000000-0000-0000-0000-000000000052
@bind pg_sel holo(pg_fig, pg_int)

# ╔═╡ 40000000-0000-0000-0000-000000000053
pg_sel === nothing ? "polygon: click a filled region" :
    "polygon: index=$(pg_sel.index) shape=$(pg_sel.payload["shape"])"

# ╔═╡ 40000000-0000-0000-0000-000000000060
md"## Axis readout — `AxisInteractable` (data coordinate under the cursor)"

# ╔═╡ 40000000-0000-0000-0000-000000000061
begin
    ar_fig = Figure(size = (500, 350))
    ar_ax = Axis(ar_fig[1, 1]; title = "click anywhere for (x, y)")
    lines!(ar_ax, 0:0.1:10, sin.(0:0.1:10); color = :purple)
    ar_int = AxisInteractable(ar_ax; id = :readout)
end

# ╔═╡ 40000000-0000-0000-0000-000000000062
@bind ar_sel holo(ar_fig, ar_int)

# ╔═╡ 40000000-0000-0000-0000-000000000063
ar_sel === nothing ? "axis: click in the plot area" :
    "axis: x=$(round(ar_sel.payload["x"]; digits = 3)) y=$(round(ar_sel.payload["y"]; digits = 3))"

# ╔═╡ 40000000-0000-0000-0000-000000000070
md"""
## Selection round-trip — click → re-highlight (M1.2)

Click points in the **left** plot. Each click's index accumulates and is fed back as
`selected` to the **right** plot, which pre-highlights them on mount — surviving
re-renders flicker-free. This is the bond-value → `Dict(layer => indices)` → manifest loop.
"""

# ╔═╡ 40000000-0000-0000-0000-000000000071
# persistent accumulator (runs once; the Ref survives later cells' re-runs)
sel_acc = Ref(Int[])

# ╔═╡ 40000000-0000-0000-0000-000000000072
begin
    rt_data = [(1.0, 1.0), (2.0, 2.0), (3.0, 1.5), (4.0, 2.5), (5.0, 1.2)]
    rt_fig_l = Figure(size = (420, 300))
    rt_ax_l = Axis(rt_fig_l[1, 1]; title = "click to select")
    scatter!(rt_ax_l, first.(rt_data), last.(rt_data); color = :teal, markersize = 20)
    rt_int_l = PointInteractable(rt_ax_l, rt_data; id = :scatter)
end

# ╔═╡ 40000000-0000-0000-0000-000000000073
@bind rt_sel holo(rt_fig_l, rt_int_l)

# ╔═╡ 40000000-0000-0000-0000-000000000074
# accumulate the clicked index (acyclic: depends on rt_sel + the once-init Ref)
picked = begin
    rt_sel === nothing || push!(sel_acc[], rt_sel.index)
    unique!(sort(sel_acc[]))
end

# ╔═╡ 40000000-0000-0000-0000-000000000075
"selected indices: $(picked)"

# ╔═╡ 40000000-0000-0000-0000-000000000076
begin
    rt_fig_r = Figure(size = (420, 300))
    rt_ax_r = Axis(rt_fig_r[1, 1]; title = "pre-highlighted from selection")
    scatter!(rt_ax_r, first.(rt_data), last.(rt_data); color = :teal, markersize = 20)
    rt_int_r = PointInteractable(rt_ax_r, rt_data; id = :scatter)
end

# ╔═╡ 40000000-0000-0000-0000-000000000077
@bind _rt_ignore holo(rt_fig_r, rt_int_r; selected = Dict(:scatter => picked))

# ╔═╡ Cell order:
# ╟─40000000-0000-0000-0000-000000000000
# ╠═40000000-0000-0000-0000-000000000001
# ╟─40000000-0000-0000-0000-000000000010
# ╠═40000000-0000-0000-0000-000000000011
# ╠═40000000-0000-0000-0000-000000000012
# ╠═40000000-0000-0000-0000-000000000013
# ╟─40000000-0000-0000-0000-000000000020
# ╠═40000000-0000-0000-0000-000000000021
# ╠═40000000-0000-0000-0000-000000000022
# ╠═40000000-0000-0000-0000-000000000023
# ╟─40000000-0000-0000-0000-000000000030
# ╠═40000000-0000-0000-0000-000000000031
# ╠═40000000-0000-0000-0000-000000000032
# ╠═40000000-0000-0000-0000-000000000033
# ╟─40000000-0000-0000-0000-000000000040
# ╠═40000000-0000-0000-0000-000000000041
# ╠═40000000-0000-0000-0000-000000000042
# ╠═40000000-0000-0000-0000-000000000043
# ╟─40000000-0000-0000-0000-000000000050
# ╠═40000000-0000-0000-0000-000000000051
# ╠═40000000-0000-0000-0000-000000000052
# ╠═40000000-0000-0000-0000-000000000053
# ╟─40000000-0000-0000-0000-000000000060
# ╠═40000000-0000-0000-0000-000000000061
# ╠═40000000-0000-0000-0000-000000000062
# ╠═40000000-0000-0000-0000-000000000063
# ╟─40000000-0000-0000-0000-000000000070
# ╠═40000000-0000-0000-0000-000000000071
# ╠═40000000-0000-0000-0000-000000000072
# ╠═40000000-0000-0000-0000-000000000073
# ╠═40000000-0000-0000-0000-000000000074
# ╠═40000000-0000-0000-0000-000000000075
# ╠═40000000-0000-0000-0000-000000000076
# ╠═40000000-0000-0000-0000-000000000077
