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

# ╔═╡ c1000000-0000-0000-0000-000000000001
begin
    import Pkg
    dev = get(ENV, "HOLO_DEV_ENV", "")
    if !isempty(dev)
        Pkg.activate(dev)
    else
        Pkg.activate(; temp = true)
        Pkg.develop(path = joinpath(@__DIR__, "..", ".."))
        Pkg.add(["CairoMakie", "JSON3"])
        Pkg.instantiate()
    end
    using Holo
    using CairoMakie
    import JSON3
end

# ╔═╡ c1000000-0000-0000-0000-000000000002
md"""
# Kind sweep — `:cairo` (agent live-verify)

One widget per interactable kind. Agents drive this with `test/e2e/kind_sweep.mjs`
and `test/e2e/polish_verify.mjs` (interaction **and** visual). Not a human Try Live notebook.
"""

# ╔═╡ c1000000-0000-0000-0000-000000000003
include(joinpath(@__DIR__, "kind_sweep_figures.jl"))  # kind-sweep figures v2

# ╔═╡ c1000000-0000-0000-0000-000000000004
begin
    sweep = build_kind_sweep()
    nothing
end

# ╔═╡ c1000000-0000-0000-0000-000000000010
@bind ev_scatter sweep.scatter

# ╔═╡ c1000000-0000-0000-0000-000000000011
HTML(
    "<span id=\"out_scatter\">SCATTER=$(repr(ev_scatter))</span>" *
        "<span id=\"coords_scatter\" style=\"display:none\">$(JSON3.write(sweep.scatter.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000012
@bind ev_lines sweep.lines

# ╔═╡ c1000000-0000-0000-0000-000000000013
HTML(
    "<span id=\"out_lines\">LINES=$(repr(ev_lines))</span>" *
        "<span id=\"coords_lines\" style=\"display:none\">$(JSON3.write(sweep.lines.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000014
@bind ev_segments sweep.segments

# ╔═╡ c1000000-0000-0000-0000-000000000015
HTML(
    "<span id=\"out_segments\">SEGMENTS=$(repr(ev_segments))</span>" *
        "<span id=\"coords_segments\" style=\"display:none\">$(JSON3.write(sweep.segments.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000016
@bind ev_heatmap sweep.heatmap

# ╔═╡ c1000000-0000-0000-0000-000000000017
HTML(
    "<span id=\"out_heatmap\">HEATMAP=$(repr(ev_heatmap))</span>" *
        "<span id=\"coords_heatmap\" style=\"display:none\">$(JSON3.write(sweep.heatmap.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000018
@bind ev_image sweep.image

# ╔═╡ c1000000-0000-0000-0000-000000000019
HTML(
    "<span id=\"out_image\">IMAGE=$(repr(ev_image))</span>" *
        "<span id=\"coords_image\" style=\"display:none\">$(JSON3.write(sweep.image.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000020
@bind ev_barplot sweep.barplot

# ╔═╡ c1000000-0000-0000-0000-000000000021
HTML(
    "<span id=\"out_barplot\">BARPLOT=$(repr(ev_barplot))</span>" *
        "<span id=\"coords_barplot\" style=\"display:none\">$(JSON3.write(sweep.barplot.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000022
@bind ev_poly sweep.poly

# ╔═╡ c1000000-0000-0000-0000-000000000023
HTML(
    "<span id=\"out_poly\">POLY=$(repr(ev_poly))</span>" *
        "<span id=\"coords_poly\" style=\"display:none\">$(JSON3.write(sweep.poly.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000024
@bind ev_polar sweep.polar

# ╔═╡ c1000000-0000-0000-0000-000000000025
HTML(
    "<span id=\"out_polar\">POLAR=$(repr(ev_polar))</span>" *
        "<span id=\"coords_polar\" style=\"display:none\">$(JSON3.write(sweep.polar.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000036
@bind ev_scatter_dark sweep.scatter_dark

# ╔═╡ c1000000-0000-0000-0000-000000000037
HTML(
    "<span id=\"out_scatter_dark\">SCATTER_DARK=$(repr(ev_scatter_dark))</span>" *
        "<span id=\"coords_scatter_dark\" style=\"display:none\">$(JSON3.write(sweep.scatter_dark.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000026
@bind ev_arrows3d sweep.arrows3d

# ╔═╡ c1000000-0000-0000-0000-000000000027
HTML(
    "<span id=\"out_arrows3d\">ARROWS3D=$(repr(ev_arrows3d))</span>" *
        "<span id=\"coords_arrows3d\" style=\"display:none\">$(JSON3.write(sweep.arrows3d.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000028
@bind ev_hlines sweep.hlines

# ╔═╡ c1000000-0000-0000-0000-000000000029
HTML(
    "<span id=\"out_hlines\">HLINES=$(repr(ev_hlines))</span>" *
        "<span id=\"coords_hlines\" style=\"display:none\">$(JSON3.write(sweep.hlines.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000030
@bind ev_threshold sweep.threshold

# ╔═╡ c1000000-0000-0000-0000-000000000031
HTML(
    "<span id=\"out_threshold\">THRESHOLD=$(repr(ev_threshold))</span>" *
        "<span id=\"coords_threshold\" style=\"display:none\">$(JSON3.write(sweep.threshold.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000032
@bind ev_roi sweep.roi

# ╔═╡ c1000000-0000-0000-0000-000000000033
HTML(
    "<span id=\"out_roi\">ROI=$(repr(ev_roi))</span>" *
        "<span id=\"coords_roi\" style=\"display:none\">$(JSON3.write(sweep.roi.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000034
@bind ev_view sweep.view

# ╔═╡ c1000000-0000-0000-0000-000000000035
HTML(
    "<span id=\"out_view\">VIEW=$(repr(ev_view))</span>" *
        "<span id=\"coords_view\" style=\"display:none\">$(JSON3.write(sweep.view.manifest["layers"]))</span>",
)

# ╔═╡ c1000000-0000-0000-0000-000000000040
HTML(
    "<span id=\"kind_meta\" style=\"display:none\">$(JSON3.write(kind_sweep_meta()))</span>" *
        "<span id=\"kind_backend\">cairo</span>" *
        "<span id=\"kind_env\" style=\"display:none\">$(!isempty(dev))</span>",
)

# ╔═╡ Cell order:
# ╠═c1000000-0000-0000-0000-000000000001
# ╟─c1000000-0000-0000-0000-000000000002
# ╠═c1000000-0000-0000-0000-000000000003
# ╠═c1000000-0000-0000-0000-000000000004
# ╠═c1000000-0000-0000-0000-000000000010
# ╠═c1000000-0000-0000-0000-000000000011
# ╠═c1000000-0000-0000-0000-000000000012
# ╠═c1000000-0000-0000-0000-000000000013
# ╠═c1000000-0000-0000-0000-000000000014
# ╠═c1000000-0000-0000-0000-000000000015
# ╠═c1000000-0000-0000-0000-000000000016
# ╠═c1000000-0000-0000-0000-000000000017
# ╠═c1000000-0000-0000-0000-000000000018
# ╠═c1000000-0000-0000-0000-000000000019
# ╠═c1000000-0000-0000-0000-000000000020
# ╠═c1000000-0000-0000-0000-000000000021
# ╠═c1000000-0000-0000-0000-000000000022
# ╠═c1000000-0000-0000-0000-000000000023
# ╠═c1000000-0000-0000-0000-000000000024
# ╠═c1000000-0000-0000-0000-000000000025
# ╠═c1000000-0000-0000-0000-000000000036
# ╠═c1000000-0000-0000-0000-000000000037
# ╠═c1000000-0000-0000-0000-000000000026
# ╠═c1000000-0000-0000-0000-000000000027
# ╠═c1000000-0000-0000-0000-000000000028
# ╠═c1000000-0000-0000-0000-000000000029
# ╠═c1000000-0000-0000-0000-000000000030
# ╠═c1000000-0000-0000-0000-000000000031
# ╠═c1000000-0000-0000-0000-000000000032
# ╠═c1000000-0000-0000-0000-000000000033
# ╠═c1000000-0000-0000-0000-000000000034
# ╠═c1000000-0000-0000-0000-000000000035
# ╠═c1000000-0000-0000-0000-000000000040
