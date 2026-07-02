# Shared parity corpus — deterministic figures + interactables, built with plain Makie
# (constructing figures needs no rendering backend). Consumed by:
#   - test/fixtures/parity/generate.jl  (golden generation, one backend loaded)
#   - the "parity goldens" drift testsets in core_tests.jl / webgl_ext_tests.jl
#   - the cross-backend invariant testset in no_backend_tests.jl (reads the goldens only)
#
# EVERY value is a literal — no rand(): goldens must reproduce bit-for-bit, and rand
# streams are not stable across Julia versions. All figures are 600 px wide (< the
# 700 px max_width) so CairoBackend's derived _ppu equals WebGLBackend's fixed 2.0 —
# the ppu quotient that makes cross-backend manifests directly comparable.
#
# The corpus is a spot-check of the two known divergence points between the backends'
# context() implementations — the Colorbar-transform loop and the Axis-collection
# filter — plus one figure per high-value interactable family. It is not blanket
# coverage: kinds not listed here rest on the shared-core structural guarantee
# (identical interactables.jl/introspect.jl running against structurally-identical
# transforms).

# each entry: name => build() -> (fig, interactables)
function _parity_corpus()
    corpus = Pair{String, Function}[]

    # 1. THE colorbar discriminator: heatmap + Colorbar + scatter + lines in one axis.
    # Pre-#32-era :webgl misbound the colorbar layer to :ax1 (whole-plot 2-D readout);
    # the cross-backend invariant + valueaxis oracle catch exactly that class of gap.
    push!(
        corpus, "colorbar" => function ()
            fig = Figure(size = (600, 400))
            ax = Axis(fig[1, 1])
            z = [Float64(i + 3j) for i in 1:4, j in 1:5]
            hm = heatmap!(ax, 1:4, 1:5, z)
            sc = scatter!(ax, [1.0, 2.5, 4.0], [1.5, 3.0, 4.5])
            ln = lines!(ax, [1.0, 2.0, 3.0, 4.0], [4.0, 3.0, 2.0, 1.0])
            cb = Colorbar(fig[1, 2], hm)
            Makie.update_state_before_display!(fig)
            return (
                fig, [
                    RectInteractable(ax, hm), PointInteractable(ax, sc),
                    SegmentInteractable(ax, ln), ColorbarInteractable(cb),
                ],
            )
        end
    )

    # 2. multi-axis: per-axis transform ids must bind identically on both backends
    push!(
        corpus, "multiaxis" => function ()
            fig = Figure(size = (600, 400))
            ax1 = Axis(fig[1, 1]); ax2 = Axis(fig[1, 2])
            scatter!(ax1, [1.0, 2.0], [1.0, 2.0])
            scatter!(ax2, [1.0, 2.0], [2.0, 1.0])
            Makie.update_state_before_display!(fig)
            return (
                fig, [
                    PointInteractable(ax1, [(1.0, 1.0), (2.0, 2.0)]; id = :left),
                    PointInteractable(ax2, [(1.0, 2.0), (2.0, 1.0)]; id = :right),
                ],
            )
        end
    )

    # 3. drag/readout family: Threshold + ROI + Axis readout (axis-transform channel)
    push!(
        corpus, "dragreadout" => function ()
            fig = Figure(size = (600, 400))
            ax = Axis(fig[1, 1])
            scatter!(ax, [1.0, 2.0, 3.0], [1.0, 4.0, 9.0])
            Makie.update_state_before_display!(fig)
            return (
                fig, [
                    ThresholdInteractable(ax; orientation = :horizontal, value = 4.0),
                    ROIInteractable(ax; bounds = (1.5, 2.5, 2.0, 6.0)),
                    AxisInteractable(ax),
                ],
            )
        end
    )

    # 4. grouped custom regions: one interactable fanning out to several layer kinds
    push!(
        corpus, "region" => function ()
            fig = Figure(size = (600, 400))
            ax = Axis(fig[1, 1])
            lines!(ax, [0.0, 10.0], [0.0, 10.0])
            Makie.update_state_before_display!(fig)
            return (
                fig, [
                    RegionInteractable(
                        ax;
                        regions = [
                            (:circle, (2.0, 2.0), 12), (:rect, (5.0, 5.0), 2.0, 1.0),
                            (:polygon, [(7.0, 1.0), (9.0, 1.0), (8.0, 3.0)]),
                        ],
                        payloads = ["c", "r", "p"],
                    ),
                ],
            )
        end
    )

    # 5. polygon + tooltip template + a categorical axis (category maps in the transform)
    push!(
        corpus, "polygon_cat" => function ()
            fig = Figure(size = (600, 400))
            ax = Axis(fig[1, 1])
            poly!(ax, [Makie.Point2f(1, 1), Makie.Point2f(3, 1), Makie.Point2f(2, 3)])
            axc = Axis(fig[1, 2]; dim1_conversion = Makie.CategoricalConversion())
            scc = scatter!(axc, ["a", "b", "c"], [1.0, 2.0, 3.0])
            Makie.update_state_before_display!(fig)
            return (
                fig, [
                    PolygonInteractable(
                        ax, [[(1.0, 1.0), (3.0, 1.0), (2.0, 3.0)]];
                        tooltip = holo"tri $(index)"
                    ),
                    PointInteractable(axc, scc),
                ],
            )
        end
    )

    # 6. log-scale axis: the projection transform_func path (post-#32 both backends
    # share the corrected closure; the golden pins it)
    push!(
        corpus, "logscale" => function ()
            fig = Figure(size = (600, 400))
            ax = Axis(fig[1, 1]; yscale = log10)
            sc = scatter!(ax, [1.0, 2.0, 3.0], [0.1, 10.0, 1000.0])
            ln = lines!(ax, [1.0, 2.0, 3.0], [1.0, 10.0, 100.0])
            Makie.update_state_before_display!(fig)
            return (fig, [PointInteractable(ax, sc), SegmentInteractable(ax, ln)])
        end
    )

    return corpus
end
