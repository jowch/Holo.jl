# Light workload baked into the PackageCompiler sysimage.
# Keep this side-effect free (no servers, no display) so install stays non-interactive.
# CairoMakie + Masque only — do not `using WGLMakie` here (that is the fat-image bug).
using Makie
using CairoMakie
using Masque
using Pluto

CairoMakie.activate!()
fig = Figure(size = (200, 200))
ax = Axis(fig[1, 1])
scatter!(ax, 1:5, 1:5)
# Force the colorbuffer path Masque's static render uses, then the widget itself.
_ = Makie.colorbuffer(fig; px_per_unit = 1)
_ = masque(fig)
