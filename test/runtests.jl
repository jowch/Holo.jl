using Holo
using Holo: hitlayers, validate, HitLayer, build_manifest, HoloWidget
import Holo as IP
using CairoMakie
import Makie
using Test

# finalize + context the way holo does internally
function ctx_for(fig; max_width = 700)
    bk = CairoBackend(; max_width)
    Makie.update_state_before_display!(fig)
    ppu = IP._ppu(bk, fig)
    return bk, ppu, IP.context(bk, fig, ppu)
end

function drawn_near(img, cx, cy; tol = 8)
    ih, iw = size(img)
    notwhite(c) = !(Float64(Makie.red(c)) > 0.95 && Float64(Makie.green(c)) > 0.95 && Float64(Makie.blue(c)) > 0.95)
    x, y = round(Int, cx), round(Int, cy)
    for dy in -tol:tol, dx in -tol:tol
        xx, yy = x + dx, y + dy
        (1 <= xx <= iw && 1 <= yy <= ih) || continue
        notwhite(img[yy, xx]) && return true
    end
    return false
end

@testset "Holo" begin
    pts = [(1.0, 1.0), (2.0, 4.0), (3.0, 9.0)]
    fig = Figure(size = (600, 400)); ax = Axis(fig[1, 1])
    scatter!(ax, first.(pts), last.(pts); color = :red, markersize = 16)
    bk, ppu, ctx = ctx_for(fig)

    @testset "DPI from layout fact" begin
        @test ppu == 2.0                              # 600 ≤ 700 column → render at 2×
        @test ctx.scaling == 2.0
        # a figure wider than the column renders at ~2× the column, not 2× itself
        fw = Figure(size = (1400, 400)); Axis(fw[1, 1])
        _, ppw, _ = ctx_for(fw)
        @test ppw == 2 * 700 / 1400                   # = 1.0  → output 1400 px = 2× column
    end

    @testset "context / transforms" begin
        t = ctx.transforms[:ax1]
        @test t.xscale == :identity && t.yscale == :identity
        @test t.viewport[3] > 0 && t.viewport[4] > 0
        @test t.xcats === nothing
    end

    @testset "categorical axis ships a category map" begin
        fc = Figure(); axc = Axis(fc[1, 1]; dim1_conversion = Makie.CategoricalConversion())
        scatter!(axc, ["a", "b", "c"], [1.0, 2.0, 3.0])
        _, _, ctxc = ctx_for(fc)
        @test ctxc.transforms[:ax1].xcats == ["a", "b", "c"]
    end

    @testset "PointInteractable lands on markers" begin
        pin = PointInteractable(ax, pts; id = :scatter)
        @test validate(pin, ctx) === nothing
        L = only(hitlayers(pin, ctx))
        @test L.kind === :circles && length(L.geometry) == 9
        img = Makie.colorbuffer(fig; px_per_unit = ppu)
        for k in 0:2
            @test drawn_near(img, L.geometry[3k+1], L.geometry[3k+2])
        end
    end

    @testset "validate is per-capability" begin
        fl = Figure(); axl = Axis(fl[1, 1]; xscale = sqrt)   # sqrt: not JS-invertible
        scatter!(axl, [1.0, 2.0, 3.0], [1.0, 2.0, 3.0])
        _, _, ctxl = ctx_for(fl)
        @test validate(PointInteractable(axl, pts), ctxl) === nothing    # element type: no gate
        @test validate(AxisInteractable(axl), ctxl) isa String          # axis readout: gated, fails loud
        fg = Figure(); axg = Axis(fg[1, 1]; yscale = log10); scatter!(axg, [1.0, 2.0], [1.0, 10.0])
        _, _, ctxg = ctx_for(fg)
        @test validate(AxisInteractable(axg), ctxg) === nothing          # log is invertible
    end

    @testset "RectInteractable grid is compact" begin
        fh = Figure(); axh = Axis(fh[1, 1]); z = rand(20, 30); heatmap!(axh, 1:20, 1:30, z)
        _, _, ctxh = ctx_for(fh)
        L = only(hitlayers(RectInteractable(axh; grid = (0.5:1:20.5, 0.5:1:30.5, z)), ctxh))
        @test L.kind === :grid
        @test L.geometry["ncols"] == 20 && L.geometry["nrows"] == 30
        @test length(L.geometry["xedges"]) == 21 && length(L.geometry["values"]) == 600
    end

    @testset "Segment + Axis + custom" begin
        @test only(hitlayers(SegmentInteractable(ax, pts; mode = :polyline), ctx)).kind === :polyline
        @test only(hitlayers(AxisInteractable(ax), ctx)).geometry === nothing
        ri = RegionInteractable(ax; regions = [(:circle, (1.0, 1.0), 10), (:rect, (2.0, 4.0), 1.0, 2.0)],
                                payloads = ["a", "b"], tooltip = pl -> "tip:" * pl)
        @test Set(L.kind for L in hitlayers(ri, ctx)) == Set([:circles, :rects])
        @test IP.tooltip(ri, 1, "a") == "tip:a"
        fi = FunctionInteractable(c -> [HitLayer(:f, :circles, Float32[10, 10, 5], Any[(; v = 1)], :ax1, (:click,))])
        @test only(hitlayers(fi, ctx)).id === :f
    end

    @testset "build_manifest + widget + bond" begin
        m = build_manifest([PointInteractable(ax, pts; id = :scatter), AxisInteractable(ax)], ctx)
        @test [L["kind"] for L in m["layers"]] == ["circles", "axis"]
        @test haskey(m["transforms"], "ax1")

        w = holo(fig, PointInteractable(ax, pts; id = :scatter))
        @test w isa HoloWidget
        @test w.manifest["layers"][1]["kind"] == "circles"
        @test !isempty(w.b64)
        @test w.display_css == 600

        @test IP.APD.Bonds.initial_value(w) === nothing
        @test IP.APD.Bonds.transform_value(w, nothing) === nothing
        ev = IP.APD.Bonds.transform_value(w, Dict("layer" => "scatter", "index" => 2, "payload" => Dict("i" => 2)))
        @test ev isa InteractionEvent && ev.layer === :scatter && ev.index == 2
    end
end
