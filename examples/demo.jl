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
**Point · Segment · Rect (grid + list) · Polygon · Axis readout**, plus **rich tooltips**
and the **selection round-trip** (click → re-highlight, flicker-free across re-renders).

Each plot is a static CairoMakie render with a thin JS hit-testing overlay. Click a
plot; the bond below it reports the typed `InteractionEvent`. **Hover** for a tooltip —
see the *Rich tooltips* section for `holo"…"` templates, the auto-table default, and theming.
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

# ╔═╡ 40000000-0000-0000-0000-000000000080
md"""
## Rich tooltips (M2.3) — `holo"…"` templates, auto-table, theming

**Hover** (don't click) over the markers to see tooltips. Author content with the `holo"…"`
macro: `$(city)` pulls a field from the payload (filled in the browser), and `$(pop:,)`
applies a [d3-format](https://d3js.org/d3-format) number spec — `37000000` → `37,000,000`.
A dataset value that contains HTML is escaped automatically; only the template's own markup
is live.
"""

# ╔═╡ 40000000-0000-0000-0000-000000000081
begin
    tt_xy = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0), (4.0, 16.0)]
    tt_city = ["Tokyo", "Delhi", "Shanghai", "São Paulo"]
    tt_pop = [37_000_000, 32_000_000, 29_000_000, 22_000_000]
    tt_fig = Figure(size = (500, 350))
    tt_ax = Axis(tt_fig[1, 1]; title = "hover: template tooltip + d3-format")
    scatter!(tt_ax, first.(tt_xy), last.(tt_xy); color = :crimson, markersize = 20)
    tt_int = PointInteractable(
        tt_ax, tt_xy; id = :cities,
        payloads = [(; city = tt_city[k], pop = tt_pop[k]) for k in eachindex(tt_city)],
        tooltip = holo"<b>$(city)</b><br>pop $(pop:,)",
    )
end

# ╔═╡ 40000000-0000-0000-0000-000000000082
@bind tt_sel holo(tt_fig, tt_int)

# ╔═╡ 40000000-0000-0000-0000-000000000083
tt_sel === nothing ? "tooltip: hover a marker; click to read the payload" :
    "clicked: $(tt_sel.payload["city"]) (pop $(tt_sel.payload["pop"]))"

# ╔═╡ 40000000-0000-0000-0000-000000000084
md"""
### Auto-table default + figure theming

With **no** `tooltip=`, the overlay renders a name/value table straight from the payload.
The `tooltip_*` keyword args on `holo(…)` theme the whole figure (Makie colors work) — here
a dark card with no caret.
"""

# ╔═╡ 40000000-0000-0000-0000-000000000085
begin
    at_xy = [(1.0, 2.0), (2.0, 3.5), (3.0, 1.0), (4.0, 2.8)]
    at_fig = Figure(size = (500, 350))
    at_ax = Axis(at_fig[1, 1]; title = "hover: auto-table, themed")
    scatter!(at_ax, first.(at_xy), last.(at_xy); color = :slateblue, markersize = 20)
    at_int = PointInteractable(
        at_ax, at_xy; id = :auto,
        payloads = [(; index = k - 1, x = at_xy[k][1], y = at_xy[k][2]) for k in eachindex(at_xy)],
    )
end

# ╔═╡ 40000000-0000-0000-0000-000000000086
@bind at_sel holo(at_fig, at_int; tooltip_bg = :midnightblue, tooltip_color = :white, tooltip_caret = false, tooltip_radius = 8)

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

# ╔═╡ 40000000-0000-0000-0000-000000000090
md"""
## Bars / areas / spans (Phase 2a) — auto-extraction

`holo(fig)` auto-detects histogram bins (`hist!`), waterfall bars (`waterfall!`),
crossbar ranges (`crossbar!`), bar plots (`barplot!`), and horizontal/vertical
spans (`hspan!`/`vspan!`) across every `Axis` — no manual `Interactable` wiring
needed. Hover over the bars, bands, or ranges below.
"""

# ╔═╡ 40000000-0000-0000-0000-000000000091
bars_widget = let
    bf = Figure(size = (760, 520))
    a1 = Axis(bf[1, 1], title = "hist"); hist!(a1, randn(300); bins = 12, color = :steelblue)
    a2 = Axis(bf[1, 2], title = "waterfall"); waterfall!(a2, 1:4, [3.0, -1.0, 2.0, -0.5])
    a3 = Axis(bf[2, 1], title = "crossbar"); crossbar!(a3, [1, 2, 3], [5.0, 6.0, 4.0], [3.0, 4.0, 2.0], [7.0, 8.0, 6.0])
    a4 = Axis(bf[2, 2], title = "bars + spans"); barplot!(a4, 1:3, [2.0, 3.0, 1.0]); hspan!(a4, [0.4], [0.8]; color = (:orange, 0.2)); vspan!(a4, [1.6], [2.0]; color = (:green, 0.2))
    holo(bf)   # auto-detects Hist + Waterfall + CrossBar + BarPlot + HSpan + VSpan
end

# ╔═╡ 40000000-0000-0000-0000-0000000000a0
md"""
## Polygon surfaces (Phase 2b) — auto-extraction

`holo(fig)` auto-detects filled-area curves (`band!`, `density!`), contour fills
(`contourf!`), violin plots (`violin!`), Voronoi diagrams (`voronoiplot!`), and box
plots (`boxplot!`) across every `Axis` — no manual `Interactable` wiring needed.
Hover over the plots below to inspect payloads.
"""

# ╔═╡ 40000000-0000-0000-0000-0000000000a1
poly_widget = let
    pf = Figure(size = (900, 520))
    band!(Axis(pf[1, 1]; title = "band"), 1:10, (1:10) .- 0.5, (1:10) .+ 1.5)
    density!(Axis(pf[1, 2]; title = "density"), randn(400))
    contourf!(
        Axis(pf[1, 3]; title = "contourf"),
        1:20,
        1:20,
        [sin(i / 3) * cos(j / 3) for i in 1:20, j in 1:20];
        levels = 6,
    )
    violin!(Axis(pf[2, 1]; title = "violin"), repeat([1, 2, 3], inner = 100), randn(300))
    voronoiplot!(Axis(pf[2, 2]; title = "voronoi"), rand(15), rand(15))
    boxplot!(Axis(pf[2, 3]; title = "boxplot"), repeat([1, 2], inner = 120), randn(240))
    holo(pf)   # auto-detects Band + Density + Contourf + Violin + Voronoiplot + BoxPlot
end

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
# ╟─40000000-0000-0000-0000-000000000080
# ╠═40000000-0000-0000-0000-000000000081
# ╠═40000000-0000-0000-0000-000000000082
# ╠═40000000-0000-0000-0000-000000000083
# ╟─40000000-0000-0000-0000-000000000084
# ╠═40000000-0000-0000-0000-000000000085
# ╠═40000000-0000-0000-0000-000000000086
# ╟─40000000-0000-0000-0000-000000000070
# ╠═40000000-0000-0000-0000-000000000071
# ╠═40000000-0000-0000-0000-000000000072
# ╠═40000000-0000-0000-0000-000000000073
# ╠═40000000-0000-0000-0000-000000000074
# ╠═40000000-0000-0000-0000-000000000075
# ╠═40000000-0000-0000-0000-000000000076
# ╠═40000000-0000-0000-0000-000000000077
# ╟─40000000-0000-0000-0000-000000000090
# ╠═40000000-0000-0000-0000-000000000091
# ╟─40000000-0000-0000-0000-0000000000a0
# ╠═40000000-0000-0000-0000-0000000000a1
