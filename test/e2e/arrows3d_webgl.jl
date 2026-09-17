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

# ╔═╡ b0000000-0000-0000-0000-000000000001
begin
    import Pkg
    Pkg.activate(; temp = true)
    Pkg.develop(path = joinpath(@__DIR__, "..", ".."))
    Pkg.add(["WGLMakie", "JSON3"])
    Pkg.instantiate()
    using Masque
    using WGLMakie
    import JSON3
end

# ╔═╡ b0000000-0000-0000-0000-000000000010
begin
    fig = Figure(; size = (600, 450))
    ax = Axis3(fig[1, 1]; azimuth = 0.4, elevation = 0.5, title = "arrows3d webgl")
    apts = Makie.Point3f[(1, 1, 1), (3, 2, 1), (2, 4, 3)]
    adirs = Makie.Vec3f[(1, 0, 0), (0, 1, 0.5), (-0.5, 0, 1)]
    arrows3d!(ax, apts, adirs; color = :red)
    ints = auto_interactables(fig)
    arrow_widget = masque(fig, ints)
    L = only(arrow_widget.manifest["layers"])
    g = L["geometry"]
    mids = [[(g[4k + 1] + g[4k + 3]) / 2, (g[4k + 2] + g[4k + 4]) / 2] for k in 0:2]
end

# ╔═╡ b0000000-0000-0000-0000-000000000011
@bind ev arrow_widget

# ╔═╡ b0000000-0000-0000-0000-000000000012
HTML("<span id=\"bondout\">BOND=$(repr(ev))</span>")

# ╔═╡ b0000000-0000-0000-0000-000000000013
HTML(
    "<span id=\"backend\">webgl</span>" *
        "<pre id=\"arrows3d_mids\" style=\"position:absolute;left:-10000px;top:0;width:1px;height:1px;overflow:hidden\">" *
        JSON3.write(mids) *
        "</pre>"
)

# ╔═╡ Cell order:
# ╠═b0000000-0000-0000-0000-000000000001
# ╠═b0000000-0000-0000-0000-000000000010
# ╠═b0000000-0000-0000-0000-000000000011
# ╠═b0000000-0000-0000-0000-000000000012
# ╠═b0000000-0000-0000-0000-000000000013
