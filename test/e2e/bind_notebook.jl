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

# ╔═╡ c0000000-0000-0000-0000-000000000001
# Self-contained env: dev the local package via a checkout-relative path, add WGLMakie — same
# dance as examples/webgl_demo.jl. WGLMakie is a weak dep of Holo (the :webgl extension only
# loads once WGLMakie is `using`'d), so a plain activate of the package root alone can't
# `using WGLMakie`. Pkg.develop/activate disables Pluto's own pkg management.
begin
    import Pkg
    Pkg.activate(; temp = true)
    Pkg.develop(path = normpath(joinpath(@__DIR__, "..", "..")))   # test/e2e -> package root
    Pkg.add("WGLMakie")
    Pkg.instantiate()
    using Holo
    using WGLMakie
end

# ╔═╡ c0000000-0000-0000-0000-000000000010
fig = let
    f = Figure(; size = (400, 300))
    ax = Axis(f[1, 1])
    scatter!(ax, 1:5, (1:5) .^ 2)
    f
end

# ╔═╡ c0000000-0000-0000-0000-000000000011
# The @bind under test: clicking a scatter marker in the :webgl widget round-trips an
# InteractionEvent back to `ev` THROUGH the live Pluto kernel (bond transport + reactive re-run).
@bind ev holo(fig)

# ╔═╡ c0000000-0000-0000-0000-000000000012
# Stable output element the browser asserts on (a distinct id, so it can't match the cell SOURCE
# which also contains "BOND="). Starts "BOND=nothing"; a click makes the kernel re-run this cell.
HTML("<span id=\"bondout\">BOND=$(repr(ev))</span>")

# ╔═╡ Cell order:
# ╠═c0000000-0000-0000-0000-000000000001
# ╠═c0000000-0000-0000-0000-000000000010
# ╠═c0000000-0000-0000-0000-000000000011
# ╠═c0000000-0000-0000-0000-000000000012
