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

# ╔═╡ d0000000-0000-0000-0000-000000000001
# Self-contained env: dev the local package via a checkout-relative path, add WGLMakie.
# Pkg.develop disables Pluto's own pkg management (the local package is unregistered). Holo
# resolves exactly one backend per session from which extension loads — `using WGLMakie` here
# (not CairoMakie) selects the `:webgl` backend automatically.
begin
    import Pkg
    Pkg.activate(; temp = true)
    Pkg.develop(path = joinpath(@__DIR__, ".."))   # examples/ -> package root (portable)
    Pkg.add(["WGLMakie", "JSON3"])
    Pkg.instantiate()
    using Holo
    using WGLMakie
    import JSON3
end

# ╔═╡ d0000000-0000-0000-0000-000000000002
md"""
# Holo.jl — `:webgl` backend demo

Each figure renders **live on the browser GPU** (a WGLMakie `<canvas>`) with Holo's interactive
overlay on top — same `@bind` / `InteractionEvent` contract as the `:cairo` backend's `holo`, but
it handles **3D** and large/animated data the static `CairoBackend` can't. Click a marker; the
bond below reports the typed event. (As of M3.1 the overlay binds straight to the canvas — no
sizer shim.)
"""

# ╔═╡ d0000000-0000-0000-0000-000000000010
md"## 2D scatter — click a marker"

# ╔═╡ d0000000-0000-0000-0000-000000000011
fig2d = let
    f = Figure(; size = (480, 320))
    ax = Axis(f[1, 1]; title = "click a point")
    scatter!(ax, 1:8, (1:8) .^ 1.6; markersize = 16)
    f
end;

# ╔═╡ d0000000-0000-0000-0000-000000000012
@bind ev2d holo(fig2d)

# ╔═╡ d0000000-0000-0000-0000-000000000013
ev2d

# ╔═╡ d0000000-0000-0000-0000-000000000014
# Exports a widget's live hit-layer geometry as a hidden span — the e2e sweep driver reads
# real manifest coordinates from the DOM instead of duplicating figure math. Invisible in
# normal use; harmless everywhere.
coordspan(domid, w) = HTML(
    "<span id=\"$(domid)\" style=\"display:none\">" *
        JSON3.write(w.manifest["layers"]) * "</span>"
)

# ╔═╡ d0000000-0000-0000-0000-000000000020
md"## 3D — live on `:webgl` (also available static on `:cairo` since the Axis3 parity work)"

# ╔═╡ d0000000-0000-0000-0000-000000000021
fig3d = let
    f = Figure(; size = (480, 360))
    ax = Axis3(f[1, 1]; title = "helix")
    ts = range(0, 6π, 240)
    lines!(ax, cos.(ts), sin.(ts), ts ./ 6; linewidth = 3)
    scatter!(ax, cos.(ts[1:20:end]), sin.(ts[1:20:end]), ts[1:20:end] ./ 6; markersize = 14, color = :tomato)
    f
end;

# ╔═╡ d0000000-0000-0000-0000-000000000022
@bind ev3d holo(fig3d)

# ╔═╡ d0000000-0000-0000-0000-000000000023
ev3d

# ╔═╡ d0000000-0000-0000-0000-000000000030
md"""
## Kitchen sink — every overlay path, live on `:webgl`

The same overlay JS runs on both backends; the sections below exercise each distinct
overlay code path (template tooltips, grid readout, colorbar value readout, polygon /
region / text hits, threshold + ROI drags, box-select, `selected=` pre-highlights) on the
live canvas. These are the cells the `:webgl` live-verify sweep drives
(`test/e2e/webgl_sweep.mjs`, a local tool).
"""

# ╔═╡ d0000000-0000-0000-0000-000000000031
md"### Template tooltip — hover a marker"

# ╔═╡ d0000000-0000-0000-0000-000000000032
begin
    w_tip = let
        f = Figure(; size = (480, 300))
        ax = Axis(f[1, 1]; title = "hover: templated tooltip")
        pts = [(1.0, 1.0), (2.0, 3.0), (3.0, 2.0)]
        scatter!(ax, first.(pts), last.(pts); markersize = 16)
        holo(
            f, [
                PointInteractable(
                    ax, pts; id = :tpts,
                    payloads = [(; index = k - 1, label = ("alpha", "beta", "gamma")[k]) for k in 1:3],
                    tooltip = holo"point $(label)",
                ),
            ]
        )
    end
    nothing
end

# ╔═╡ d0000000-0000-0000-0000-000000000033
@bind ev_tip w_tip

# ╔═╡ d0000000-0000-0000-0000-000000000034
HTML("<span id=\"out_tip\">TIP=$(repr(ev_tip))</span>")

# ╔═╡ d0000000-0000-0000-0000-000000000035
coordspan("coords_tip", w_tip)

# ╔═╡ d0000000-0000-0000-0000-000000000040
md"### Heatmap grid + colorbar — hover a cell for `(i,j) = value`, the bar for a 1-D value"

# ╔═╡ d0000000-0000-0000-0000-000000000041
begin
    w_grid = let
        f = Figure(; size = (520, 300))
        ax = Axis(f[1, 1]; title = "grid readout")
        z = [Float64(i + 3j) for i in 1:4, j in 1:5]
        hm = heatmap!(ax, 1:4, 1:5, z)
        Colorbar(f[1, 2], hm)
        holo(f)   # auto-extract: grid cells + colorbar
    end
    nothing
end

# ╔═╡ d0000000-0000-0000-0000-000000000042
@bind ev_grid w_grid

# ╔═╡ d0000000-0000-0000-0000-000000000043
HTML("<span id=\"out_grid\">GRID=$(repr(ev_grid))</span>")

# ╔═╡ d0000000-0000-0000-0000-000000000044
coordspan("coords_grid", w_grid)

# ╔═╡ d0000000-0000-0000-0000-000000000050
md"### Polygon, declarative region, and text labels — click each"

# ╔═╡ d0000000-0000-0000-0000-000000000051
begin
    w_poly = let
        f = Figure(; size = (520, 320))
        ax = Axis(f[1, 1]; title = "polygon / region / text", limits = (0, 10, 0, 6))
        poly!(ax, [Makie.Point2f(1, 1), Makie.Point2f(3, 1), Makie.Point2f(2, 3)]; color = :orange)
        txt = text!(ax, [8.0], [5.0]; text = ["labelled"], fontsize = 16)
        holo(
            f, [
                PolygonInteractable(ax, [[(1.0, 1.0), (3.0, 1.0), (2.0, 3.0)]]; id = :tri),
                RegionInteractable(
                    ax;
                    regions = [(:circle, (6.0, 2.0), 14), (:rect, (8.5, 2.0), 2.0, 1.5)],
                    payloads = ["circ", "box"], id = :reg,
                ),
                TextInteractable(ax, txt; id = :lbl),
            ]
        )
    end
    nothing
end

# ╔═╡ d0000000-0000-0000-0000-000000000052
@bind ev_poly w_poly

# ╔═╡ d0000000-0000-0000-0000-000000000053
HTML("<span id=\"out_poly\">POLY=$(repr(ev_poly))</span>")

# ╔═╡ d0000000-0000-0000-0000-000000000054
coordspan("coords_poly", w_poly)

# ╔═╡ d0000000-0000-0000-0000-000000000060
md"### Threshold drag + whole-axis readout"

# ╔═╡ d0000000-0000-0000-0000-000000000061
begin
    w_thr = let
        f = Figure(; size = (480, 300))
        ax = Axis(f[1, 1]; title = "drag the line; click anywhere", limits = (0, 10, 0, 10))
        scatter!(ax, [2.0, 5.0, 8.0], [2.0, 5.0, 8.0]; markersize = 12)
        holo(
            f, [
                ThresholdInteractable(ax; orientation = :horizontal, value = 4.0, id = :thr),
                AxisInteractable(ax; id = :axis),
            ]
        )
    end
    nothing
end

# ╔═╡ d0000000-0000-0000-0000-000000000062
@bind ev_thr w_thr

# ╔═╡ d0000000-0000-0000-0000-000000000063
HTML("<span id=\"out_thr\">THR=$(repr(ev_thr))</span>")

# ╔═╡ d0000000-0000-0000-0000-000000000064
coordspan("coords_thr", w_thr)

# ╔═╡ d0000000-0000-0000-0000-000000000070
md"### Box-select (`selects`-ROI) + `selected=` pre-highlight"

# ╔═╡ d0000000-0000-0000-0000-000000000071
begin
    w_sel = let
        f = Figure(; size = (480, 300))
        ax = Axis(f[1, 1]; title = "drag the box over points", limits = (0, 10, 0, 10))
        pts = [(1.0, 1.0), (3.0, 3.0), (5.0, 5.0), (7.0, 7.0), (9.0, 9.0)]
        scatter!(ax, first.(pts), last.(pts); markersize = 14)
        holo(
            f, [
                PointInteractable(ax, pts; id = :pts),
                ROIInteractable(ax; bounds = (2.0, 6.0, 2.0, 6.0), selects = :pts, id = :roi),
            ];
            selected = Dict(:pts => [0]),
        )
    end
    nothing
end

# ╔═╡ d0000000-0000-0000-0000-000000000072
@bind ev_sel w_sel

# ╔═╡ d0000000-0000-0000-0000-000000000073
HTML("<span id=\"out_sel\">SEL=$(repr(ev_sel))</span>")

# ╔═╡ d0000000-0000-0000-0000-000000000074
coordspan("coords_sel", w_sel)

# ╔═╡ Cell order:
# ╟─d0000000-0000-0000-0000-000000000002
# ╠═d0000000-0000-0000-0000-000000000001
# ╟─d0000000-0000-0000-0000-000000000010
# ╠═d0000000-0000-0000-0000-000000000011
# ╠═d0000000-0000-0000-0000-000000000012
# ╠═d0000000-0000-0000-0000-000000000013
# ╠═d0000000-0000-0000-0000-000000000014
# ╟─d0000000-0000-0000-0000-000000000020
# ╠═d0000000-0000-0000-0000-000000000021
# ╠═d0000000-0000-0000-0000-000000000022
# ╠═d0000000-0000-0000-0000-000000000023
# ╟─d0000000-0000-0000-0000-000000000030
# ╟─d0000000-0000-0000-0000-000000000031
# ╠═d0000000-0000-0000-0000-000000000032
# ╠═d0000000-0000-0000-0000-000000000033
# ╠═d0000000-0000-0000-0000-000000000034
# ╠═d0000000-0000-0000-0000-000000000035
# ╟─d0000000-0000-0000-0000-000000000040
# ╠═d0000000-0000-0000-0000-000000000041
# ╠═d0000000-0000-0000-0000-000000000042
# ╠═d0000000-0000-0000-0000-000000000043
# ╠═d0000000-0000-0000-0000-000000000044
# ╟─d0000000-0000-0000-0000-000000000050
# ╠═d0000000-0000-0000-0000-000000000051
# ╠═d0000000-0000-0000-0000-000000000052
# ╠═d0000000-0000-0000-0000-000000000053
# ╠═d0000000-0000-0000-0000-000000000054
# ╟─d0000000-0000-0000-0000-000000000060
# ╠═d0000000-0000-0000-0000-000000000061
# ╠═d0000000-0000-0000-0000-000000000062
# ╠═d0000000-0000-0000-0000-000000000063
# ╠═d0000000-0000-0000-0000-000000000064
# ╟─d0000000-0000-0000-0000-000000000070
# ╠═d0000000-0000-0000-0000-000000000071
# ╠═d0000000-0000-0000-0000-000000000072
# ╠═d0000000-0000-0000-0000-000000000073
# ╠═d0000000-0000-0000-0000-000000000074
