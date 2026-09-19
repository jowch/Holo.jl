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

# ╔═╡ d1000000-0000-0000-0000-000000000001
begin
    import Pkg
    dev = get(ENV, "MASQUE_DEV_ENV", "")
    if !isempty(dev)
        Pkg.activate(dev)
    else
        Pkg.activate(; temp = true)
        Pkg.develop(path = joinpath(@__DIR__, "..", ".."))
        Pkg.add(["WGLMakie", "JSON3"])
        Pkg.instantiate()
    end
    using Masque
    using WGLMakie
    import JSON3
end

# ╔═╡ d1000000-0000-0000-0000-000000000002
md"""
# Kind sweep — `:webgl` (agent live-verify)

One widget per interactable kind. Agents drive this with `test/e2e/kind_sweep.mjs`
and `test/e2e/polish_verify.mjs` (interaction **and** visual).
Not a human Try Live notebook.
"""

# ╔═╡ d1000000-0000-0000-0000-000000000003
include(joinpath(@__DIR__, "kind_sweep_figures.jl"))  # kind-sweep figures v2

# ╔═╡ d1000000-0000-0000-0000-000000000004
begin
    sweep = build_kind_sweep()
    nothing
end

# ╔═╡ d1000000-0000-0000-0000-000000000010
@bind ev_scatter sweep.scatter

# ╔═╡ d1000000-0000-0000-0000-000000000011
HTML(
    "<span id=\"out_scatter\">SCATTER=$(repr(ev_scatter))</span>" *
        "<span id=\"coords_scatter\" style=\"display:none\">$(JSON3.write(sweep.scatter.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000012
@bind ev_lines sweep.lines

# ╔═╡ d1000000-0000-0000-0000-000000000013
HTML(
    "<span id=\"out_lines\">LINES=$(repr(ev_lines))</span>" *
        "<span id=\"coords_lines\" style=\"display:none\">$(JSON3.write(sweep.lines.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000014
@bind ev_segments sweep.segments

# ╔═╡ d1000000-0000-0000-0000-000000000015
HTML(
    "<span id=\"out_segments\">SEGMENTS=$(repr(ev_segments))</span>" *
        "<span id=\"coords_segments\" style=\"display:none\">$(JSON3.write(sweep.segments.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000016
@bind ev_heatmap sweep.heatmap

# ╔═╡ d1000000-0000-0000-0000-000000000017
HTML(
    "<span id=\"out_heatmap\">HEATMAP=$(repr(ev_heatmap))</span>" *
        "<span id=\"coords_heatmap\" style=\"display:none\">$(JSON3.write(sweep.heatmap.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000018
@bind ev_image sweep.image

# ╔═╡ d1000000-0000-0000-0000-000000000019
HTML(
    "<span id=\"out_image\">IMAGE=$(repr(ev_image))</span>" *
        "<span id=\"coords_image\" style=\"display:none\">$(JSON3.write(sweep.image.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000020
@bind ev_barplot sweep.barplot

# ╔═╡ d1000000-0000-0000-0000-000000000021
HTML(
    "<span id=\"out_barplot\">BARPLOT=$(repr(ev_barplot))</span>" *
        "<span id=\"coords_barplot\" style=\"display:none\">$(JSON3.write(sweep.barplot.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000022
@bind ev_poly sweep.poly

# ╔═╡ d1000000-0000-0000-0000-000000000023
HTML(
    "<span id=\"out_poly\">POLY=$(repr(ev_poly))</span>" *
        "<span id=\"coords_poly\" style=\"display:none\">$(JSON3.write(sweep.poly.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000024
@bind ev_polar sweep.polar

# ╔═╡ d1000000-0000-0000-0000-000000000025
HTML(
    "<span id=\"out_polar\">POLAR=$(repr(ev_polar))</span>" *
        "<span id=\"coords_polar\" style=\"display:none\">$(JSON3.write(sweep.polar.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000036
@bind ev_scatter_dark sweep.scatter_dark

# ╔═╡ d1000000-0000-0000-0000-000000000037
HTML(
    "<span id=\"out_scatter_dark\">SCATTER_DARK=$(repr(ev_scatter_dark))</span>" *
        "<span id=\"coords_scatter_dark\" style=\"display:none\">$(JSON3.write(sweep.scatter_dark.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000026
@bind ev_arrows3d sweep.arrows3d

# ╔═╡ d1000000-0000-0000-0000-000000000027
HTML(
    "<span id=\"out_arrows3d\">ARROWS3D=$(repr(ev_arrows3d))</span>" *
        "<span id=\"coords_arrows3d\" style=\"display:none\">$(JSON3.write(sweep.arrows3d.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000028
@bind ev_hlines sweep.hlines

# ╔═╡ d1000000-0000-0000-0000-000000000029
HTML(
    "<span id=\"out_hlines\">HLINES=$(repr(ev_hlines))</span>" *
        "<span id=\"coords_hlines\" style=\"display:none\">$(JSON3.write(sweep.hlines.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000030
@bind ev_threshold sweep.threshold

# ╔═╡ d1000000-0000-0000-0000-000000000031
HTML(
    "<span id=\"out_threshold\">THRESHOLD=$(repr(ev_threshold))</span>" *
        "<span id=\"coords_threshold\" style=\"display:none\">$(JSON3.write(sweep.threshold.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000032
@bind ev_roi sweep.roi

# ╔═╡ d1000000-0000-0000-0000-000000000033
HTML(
    "<span id=\"out_roi\">ROI=$(repr(ev_roi))</span>" *
        "<span id=\"coords_roi\" style=\"display:none\">$(JSON3.write(sweep.roi.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000034
@bind ev_view sweep.view

# ╔═╡ d1000000-0000-0000-0000-000000000035
HTML(
    "<span id=\"out_view\">VIEW=$(repr(ev_view))</span>" *
        "<span id=\"coords_view\" style=\"display:none\">$(JSON3.write(sweep.view.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000038
@bind ev_legend sweep.legend

# ╔═╡ d1000000-0000-0000-0000-000000000039
HTML(
    "<span id=\"out_legend\">LEGEND=$(repr(ev_legend))</span>" *
        "<span id=\"coords_legend\" style=\"display:none\">$(JSON3.write(sweep.legend.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000041
@bind ev_legend_overlap sweep.legend_overlap

# ╔═╡ d1000000-0000-0000-0000-000000000042
HTML(
    "<span id=\"out_legend_overlap\">LEGEND_OVERLAP=$(repr(ev_legend_overlap))</span>" *
        "<span id=\"coords_legend_overlap\" style=\"display:none\">$(JSON3.write(sweep.legend_overlap.manifest["layers"]))</span>",
)

# ╔═╡ d1000000-0000-0000-0000-000000000040
HTML(
    "<span id=\"kind_meta\" style=\"display:none\">$(JSON3.write(kind_sweep_meta()))</span>" *
        "<span id=\"kind_backend\">webgl</span>" *
        "<span id=\"kind_env\" style=\"display:none\">$(!isempty(dev))</span>",
)

# ╔═╡ Cell order:
# ╠═d1000000-0000-0000-0000-000000000001
# ╟─d1000000-0000-0000-0000-000000000002
# ╠═d1000000-0000-0000-0000-000000000003
# ╠═d1000000-0000-0000-0000-000000000004
# ╠═d1000000-0000-0000-0000-000000000010
# ╠═d1000000-0000-0000-0000-000000000011
# ╠═d1000000-0000-0000-0000-000000000012
# ╠═d1000000-0000-0000-0000-000000000013
# ╠═d1000000-0000-0000-0000-000000000014
# ╠═d1000000-0000-0000-0000-000000000015
# ╠═d1000000-0000-0000-0000-000000000016
# ╠═d1000000-0000-0000-0000-000000000017
# ╠═d1000000-0000-0000-0000-000000000018
# ╠═d1000000-0000-0000-0000-000000000019
# ╠═d1000000-0000-0000-0000-000000000020
# ╠═d1000000-0000-0000-0000-000000000021
# ╠═d1000000-0000-0000-0000-000000000022
# ╠═d1000000-0000-0000-0000-000000000023
# ╠═d1000000-0000-0000-0000-000000000024
# ╠═d1000000-0000-0000-0000-000000000025
# ╠═d1000000-0000-0000-0000-000000000036
# ╠═d1000000-0000-0000-0000-000000000037
# ╠═d1000000-0000-0000-0000-000000000026
# ╠═d1000000-0000-0000-0000-000000000027
# ╠═d1000000-0000-0000-0000-000000000028
# ╠═d1000000-0000-0000-0000-000000000029
# ╠═d1000000-0000-0000-0000-000000000030
# ╠═d1000000-0000-0000-0000-000000000031
# ╠═d1000000-0000-0000-0000-000000000032
# ╠═d1000000-0000-0000-0000-000000000033
# ╠═d1000000-0000-0000-0000-000000000034
# ╠═d1000000-0000-0000-0000-000000000035
# ╠═d1000000-0000-0000-0000-000000000038
# ╠═d1000000-0000-0000-0000-000000000039
# ╠═d1000000-0000-0000-0000-000000000041
# ╠═d1000000-0000-0000-0000-000000000042
# ╠═d1000000-0000-0000-0000-000000000040
