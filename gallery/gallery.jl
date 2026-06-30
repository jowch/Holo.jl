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

# ╔═╡ 57d4b438-fcdb-43f9-9322-0016c56b8c7e
md"""
## 2. Image ROI — per-channel stats

A colored image (think fluorescence microscopy or a spectroscopic frame). Drag the box to select a
region; a second cell slices the **full-resolution array** server-side and reports per-channel
**min / p1 / p50 / p99 / max** with a Lightroom-style per-channel histogram.

The box returns a *region descriptor* (cell-index bounds + data bounds), not the pixels — so the
image never crosses the wire, and this scales to large frames. The histogram recomputes **once per
box adjustment** (each is a reactive round-trip — per-frame at 60 fps is out of scope for a
static-base overlay).
"""

# ╔═╡ 3035d60d-a0ac-46f1-a7a7-462618bd6576
img_data = let
    nx, ny = 96, 64
    clamp01(v) = clamp(v, 0.0, 1.0)
    R = clamp01.([0.5 + 0.45 * sin(i / 9) * cos(j / 7) for i in 1:nx, j in 1:ny])
    G = clamp01.([0.5 + 0.40 * cos(i / 11) for i in 1:nx, j in 1:ny])
    B = clamp01.([0.5 + 0.45 * (j / ny) for i in 1:nx, j in 1:ny])
    (; nx, ny, R, G, B)
end

# ╔═╡ 23af9149-57d0-4849-8509-59971a03f9af
image_widget = let
    (; nx, ny, R, G, B) = img_data
    rgb = [RGBf(R[i, j], G[i, j], B[i, j]) for i in 1:nx, j in 1:ny]
    imf = Figure(size = (560, 400)); iax = Axis(imf[1, 1], title = "Drag the box to select a region")
    image!(iax, 0 .. Float64(nx), 0 .. Float64(ny), rgb)
    xe = collect(0.0:1.0:nx)            # cell edges in data space (one boundary per column/row)
    ye = collect(0.0:1.0:ny)
    lum = [0.299 * R[i, j] + 0.587 * G[i, j] + 0.114 * B[i, j] for i in 1:nx, j in 1:ny]
    holo(imf, [
        RectInteractable(iax; grid = (xe, ye, lum), id = :img),
        ROIInteractable(iax; bounds = (10.0, 40.0, 10.0, 40.0), selects = :img),
    ])
end

# ╔═╡ b7a4bbf8-fa6e-4af7-8062-3ac0c6ab0c55
@bind region image_widget

# ╔═╡ 540533c2-83f6-41c7-819f-c23cd76ed92c
let
    if region === nothing || isempty(region)
        md"_Adjust the box to select an image region._"
    else
        (; R, G, B) = img_data
        r = only(region).payload
        i0, i1 = Int(r["i0"]) + 1, Int(r["i1"]) + 1      # 0-based cell indices → 1-based array
        j0, j1 = Int(r["j0"]) + 1, Int(r["j1"]) + 1
        Rs, Gs, Bs = vec(R[i0:i1, j0:j1]), vec(G[i0:i1, j0:j1]), vec(B[i0:i1, j0:j1])
        stat(v) = (min = minimum(v), p1 = quantile(v, 0.01), p50 = quantile(v, 0.5), p99 = quantile(v, 0.99), max = maximum(v))
        sr, sg, sb = stat(Rs), stat(Gs), stat(Bs)
        f = Figure(size = (560, 280)); ax = Axis(f[1, 1], title = "channel histograms (n=$(length(Rs)) px)", xlabel = "intensity")
        for (v, c) in ((Rs, :red), (Gs, :green), (Bs, :blue))
            hist!(ax, v; bins = 24, color = (c, 0.35), strokecolor = c, strokewidth = 1)
        end
        tbl(s) = "min $(round(s.min; digits = 3)) · p1 $(round(s.p1; digits = 3)) · p50 $(round(s.p50; digits = 3)) · p99 $(round(s.p99; digits = 3)) · max $(round(s.max; digits = 3))"
        md"""
**R** — $(tbl(sr))

**G** — $(tbl(sg))

**B** — $(tbl(sb))

$(f)
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
# ╟─57d4b438-fcdb-43f9-9322-0016c56b8c7e
# ╠═3035d60d-a0ac-46f1-a7a7-462618bd6576
# ╠═23af9149-57d0-4849-8509-59971a03f9af
# ╠═b7a4bbf8-fa6e-4af7-8062-3ac0c6ab0c55
# ╠═540533c2-83f6-41c7-819f-c23cd76ed92c
