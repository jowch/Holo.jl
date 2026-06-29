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

# ╔═╡ 4f0fc191-30af-4205-9871-f9d38497e23c
# Self-contained env: dev the local package via a checkout-relative path, add CairoMakie.
# Pkg.develop disables Pluto's own pkg management (the local package is unregistered).
begin
    import Pkg
    Pkg.activate(; temp = true)
    Pkg.develop(path = joinpath(@__DIR__, ".."))   # gallery/ -> package root (portable)
    Pkg.add("CairoMakie")
    Pkg.instantiate()
    using Holo
    using CairoMakie
    using Statistics
end

# ╔═╡ b5f71b56-5c9b-4aa8-998d-8c8a905794f1
md"""
# Holo.jl — recipe gallery

Recipes for **real applications**, beyond the feature tour in `examples/demo.jl`. Each section is a
self-contained pattern: an interactive plot whose `@bind` value drives a downstream cell.

## 1. Box-select scatter

Drag or resize the **ROI box** to select the points it encloses. The bond is a
`Vector{InteractionEvent}` — one per selected point — which a second cell consumes.
"""

# ╔═╡ 24735e6d-3732-4b1f-ae9f-1077918b3d30
scatter_data = let
    npts = 200
    xs = [2 + 6 * (i / npts) + 0.6 * sin(i) for i in 1:npts]
    ys = [3 + 5 * cos(i / 7) + 0.5 * (i % 5) for i in 1:npts]
    grp = [iseven(i) ? "A" : "B" for i in 1:npts]
    (; npts, xs, ys, grp)
end

# ╔═╡ 9f392637-e9c0-4084-9f32-6fd791eba5cf
scatter_widget = let
    (; xs, ys, grp) = scatter_data
    sf = Figure(size = (560, 380)); sax = Axis(sf[1, 1], title = "Drag the box to select points")
    scatter!(sax, xs, ys; color = map(g -> g == "A" ? :steelblue : :darkorange, grp), markersize = 9)
    pts = Point2f.(xs, ys)
    payloads = [(; idx = i - 1, x = xs[i], y = ys[i], group = grp[i]) for i in eachindex(xs)]
    holo(sf, [
        PointInteractable(sax, pts; id = :pts, payloads),
        ROIInteractable(sax; bounds = (3.0, 6.0, 2.0, 7.0), selects = :pts),
    ])
end

# ╔═╡ 8cf49d51-22b7-4e5a-9ceb-8ebe483bfd39
@bind picks scatter_widget

# ╔═╡ 43d69d97-8027-4a47-a0bb-3a9968012c5d
let
    if picks === nothing || isempty(picks)
        md"_Adjust the box to select points._"
    else
        (; xs, ys, grp) = scatter_data
        idx = [e.index + 1 for e in picks]          # InteractionEvent.index is 0-based
        n = length(idx)
        ga = count(i -> grp[i] == "A", idx)
        md"""
**$(n) points selected** — group A: $(ga), group B: $(n - ga)

mean x = $(round(sum(xs[idx]) / n; digits = 2)), mean y = $(round(sum(ys[idx]) / n; digits = 2))
"""
    end
end

# ╔═╡ Cell order:
# ╠═4f0fc191-30af-4205-9871-f9d38497e23c
# ╟─b5f71b56-5c9b-4aa8-998d-8c8a905794f1
# ╠═24735e6d-3732-4b1f-ae9f-1077918b3d30
# ╠═9f392637-e9c0-4084-9f32-6fd791eba5cf
# ╠═8cf49d51-22b7-4e5a-9ceb-8ebe483bfd39
# ╠═43d69d97-8027-4a47-a0bb-3a9968012c5d
