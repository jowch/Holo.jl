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
        Pkg.develop(path = joinpath(@__DIR__, "..", "..", ".."))
        Pkg.add(["CairoMakie", "JSON3"])
        Pkg.instantiate()
    end
    using Masque
    using CairoMakie
    import JSON3
end

# ╔═╡ d1000000-0000-0000-0000-000000000002
begin
    cities_data = [
        (city = "Tokyo", pop_m = 37.4, pop = 37_400_000, gdp = 1600),
        (city = "Delhi", pop_m = 32.9, pop = 32_900_000, gdp = 370),
        (city = "Shanghai", pop_m = 28.5, pop = 28_500_000, gdp = 780),
        (city = "São Paulo", pop_m = 22.4, pop = 22_400_000, gdp = 430),
        (city = "Mexico City", pop_m = 22.1, pop = 22_100_000, gdp = 411),
        (city = "Cairo", pop_m = 21.3, pop = 21_300_000, gdp = 165),
        (city = "Mumbai", pop_m = 20.7, pop = 20_700_000, gdp = 310),
        (city = "Beijing", pop_m = 21.5, pop = 21_500_000, gdp = 700),
    ]
    city_colors = [
        "#e6194b", "#3cb44b", "#4363d8", "#f58231",
        "#911eb4", "#0e9aa7", "#f032e6", "#9a8b00",
    ]
    xs = Float64[c.pop_m for c in cities_data]
    ys = Float64[c.gdp for c in cities_data]

    fig = Figure(size = (560, 360))
    ax = Axis(fig[1, 1]; xlabel = "Population (millions)", ylabel = "GDP (US\$bn)")
    scatter!(ax, xs, ys; color = city_colors, markersize = 18)

    cities = PointInteractable(
        ax, collect(zip(xs, ys));
        id = :cities,
        payloads = [(; city = c.city, pop = c.pop) for c in cities_data],
        colors = (; palette = city_colors, index = collect(0:(length(cities_data) - 1))),
        tooltip = masque"<b>$(city)</b><br>pop $(pop:,)",
    )
    nothing
end

# ╔═╡ d1000000-0000-0000-0000-000000000003
@bind pick masque(fig, cities)

# ╔═╡ d1000000-0000-0000-0000-000000000004
pick === nothing ? md"*Hover a city, then click one.*" : md"**$(pick.payload[\"city\"])** selected — index $(pick.index)"

# ╔═╡ d1000000-0000-0000-0000-000000000005
HTML("<span id=\"coords\" style=\"display:none\">$(JSON3.write(masque(fig, cities).manifest["layers"]))</span>")

# ╔═╡ Cell order:
# ╟─d1000000-0000-0000-0000-000000000001
# ╟─d1000000-0000-0000-0000-000000000002
# ╠═d1000000-0000-0000-0000-000000000003
# ╟─d1000000-0000-0000-0000-000000000004
# ╟─d1000000-0000-0000-0000-000000000005
