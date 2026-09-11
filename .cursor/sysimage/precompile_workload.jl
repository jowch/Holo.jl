# Light workload baked into the PackageCompiler sysimage.
# Keep this side-effect free (no servers, no display) so install stays non-interactive.
using Makie
using CairoMakie
using WGLMakie
using Pluto

CairoMakie.activate!()
fig = Figure(size = (200, 200))
ax = Axis(fig[1, 1])
scatter!(ax, 1:5, 1:5)
# Force a colorbuffer path similar to Holo's static render.
_ = Makie.colorbuffer(fig; px_per_unit = 1)
