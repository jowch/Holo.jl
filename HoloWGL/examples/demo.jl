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
# Self-contained env: dev BOTH local packages by checkout-relative path (Holo at the repo root,
# HoloWGL one level in). `using HoloWGL` re-exports the full Makie API (Figure/Axis/plots).
begin
    import Pkg
    Pkg.activate(; temp = true)
    Pkg.develop(
        [
            Pkg.PackageSpec(path = normpath(joinpath(@__DIR__, "..", ".."))),   # Holo (repo root)
            Pkg.PackageSpec(path = normpath(joinpath(@__DIR__, ".."))),         # HoloWGL
        ]
    )
    Pkg.instantiate()
    using HoloWGL
end

# ╔═╡ d0000000-0000-0000-0000-000000000002
md"""
# HoloWGL — `:webgl` backend demo

Each figure renders **live on the browser GPU** (a WGLMakie `<canvas>`) with Holo's interactive
overlay on top — same `@bind` / `InteractionEvent` contract as `Holo.holo`, but it handles **3D**
and large/animated data the static CairoBackend can't. Click a marker; the bond below reports the
typed event. (As of M3.1 the overlay binds straight to the canvas — no sizer shim.)
"""

# ╔═╡ d0000000-0000-0000-0000-000000000010
md"## 2D scatter — click a marker"

# ╔═╡ d0000000-0000-0000-0000-000000000011
fig2d = let
    f = Figure(; size = (480, 320))
    ax = Axis(f[1, 1]; title = "click a point")
    scatter!(ax, 1:8, (1:8) .^ 1.6; markersize = 16)
    f
end

# ╔═╡ d0000000-0000-0000-0000-000000000012
@bind ev2d holo_webgl(fig2d)

# ╔═╡ d0000000-0000-0000-0000-000000000013
ev2d

# ╔═╡ d0000000-0000-0000-0000-000000000020
md"## 3D — the reason `:webgl` exists (CairoBackend rejects `Axis3`)"

# ╔═╡ d0000000-0000-0000-0000-000000000021
fig3d = let
    f = Figure(; size = (480, 360))
    ax = Axis3(f[1, 1]; title = "helix")
    ts = range(0, 6π, 240)
    lines!(ax, cos.(ts), sin.(ts), ts ./ 6; linewidth = 3)
    scatter!(ax, cos.(ts[1:20:end]), sin.(ts[1:20:end]), ts[1:20:end] ./ 6; markersize = 14, color = :tomato)
    f
end

# ╔═╡ d0000000-0000-0000-0000-000000000022
@bind ev3d holo_webgl(fig3d)

# ╔═╡ d0000000-0000-0000-0000-000000000023
ev3d

# ╔═╡ Cell order:
# ╟─d0000000-0000-0000-0000-000000000002
# ╠═d0000000-0000-0000-0000-000000000001
# ╟─d0000000-0000-0000-0000-000000000010
# ╠═d0000000-0000-0000-0000-000000000011
# ╠═d0000000-0000-0000-0000-000000000012
# ╠═d0000000-0000-0000-0000-000000000013
# ╟─d0000000-0000-0000-0000-000000000020
# ╠═d0000000-0000-0000-0000-000000000021
# ╠═d0000000-0000-0000-0000-000000000022
# ╠═d0000000-0000-0000-0000-000000000023
