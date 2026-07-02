# Emit a self-contained :webgl widget page + the expected click/bond for the browser E2E
# (test/e2e/click.mjs). Run: julia test/e2e/make_page.jl <outdir>
#
# Writes <outdir>/page.html (the real widget HTML — overlay + canvas, scene/manifest/
# bundle/shim inlined as JSON, no server / no published_to_js) and <outdir>/expected.json
# (the host-relative CSS pixel to click marker 0, and the bond value that click must produce).
# The browser half asserts host.value == {layer, index}; the Julia half (runtests.jl
# "@bind round-trip contract") asserts transform_value rebuilds the InteractionEvent.
#
# WGLMakie is a weak dep of Holo (the extension only loads when WGLMakie is `using`'d), so a
# bare `--project=.` can't `using WGLMakie` directly — same temp-env dance as examples/webgl_demo.jl.
import Pkg
Pkg.activate(; temp = true)
Pkg.develop(path = normpath(joinpath(@__DIR__, "..", "..")))   # test/e2e -> package root
Pkg.add(["WGLMakie", "JSON3", "HypertextLiteral"])
Pkg.instantiate()

using Holo
using WGLMakie
import JSON3
using HypertextLiteral: JavaScript

# _widget_html/_bundle_text/_shim_text live in the :webgl extension module — reach them via
# Base.get_extension, same pattern test/webgl_ext_tests.jl uses.
const _WGLExt = Base.get_extension(Holo, :HoloWGLMakieExt)

outdir = abspath(get(ARGS, 1, mktempdir()))
mkpath(outdir)

fig = Figure(; size = (400, 300))
ax = Axis(fig[1, 1])
scatter!(ax, 1:5, (1:5) .^ 2)
w = holo(fig)                              # auto-extract -> one :scatter circles layer

# Real widget HTML with everything inlined (the self-contained path the unit test exercises,
# but with the ACTUAL bundle + shim text so the overlay really mounts in a browser).
inner = sprint(
    show, MIME"text/html"(),
    _WGLExt._widget_html(
        w;
        scene_expr = JavaScript(JSON3.write(w.scene)),
        manifest_expr = JavaScript(JSON3.write(w.manifest)),
        bundle_js = JavaScript(JSON3.write(_WGLExt._bundle_text())),
        shim_js = JavaScript(JSON3.write(_WGLExt._shim_text())),
    ),
)
page = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>\n$inner\n</body></html>"
write(joinpath(outdir, "page.html"), page)

# Marker 0's click point: circles geometry is flat [cx, cy, r, …] in image px; the host is
# CSS-scaled by display_css/width, uniformly. So css = image_px × scale, host-relative.
layer = only(w.manifest["layers"])
g = layer["geometry"]
scale = w.display_css / w.manifest["width"]
expected = Dict(
    "cssX" => g[1] * scale, "cssY" => g[2] * scale,
    "layer" => layer["id"], "index" => 0,
)
write(joinpath(outdir, "expected.json"), JSON3.write(expected))

# --- Axis3 case (WS-3D): the same self-contained page for a 3D scatter. Clicking marker 0
# at its BUILD-TIME projected center asserts, in a real browser, that the overlay's
# 3D-projected hit geometry and the {index,x,y,z} payload survive the wire end-to-end.
# Red markers + explicit azimuth/elevation literals so the projection snapshot is
# deterministic AND the local canvas-alignment check can pixel-assert against the render.
fig3 = Figure(; size = (400, 300))
ax3 = Axis3(fig3[1, 1]; azimuth = 0.4, elevation = 0.5)
scatter!(ax3, Point3f[(1, 2, 3), (4, 5, 6), (7, 8, 2)]; markersize = 16, color = :red)
w3 = holo(fig3)

inner3 = sprint(
    show, MIME"text/html"(),
    _WGLExt._widget_html(
        w3;
        scene_expr = JavaScript(JSON3.write(w3.scene)),
        manifest_expr = JavaScript(JSON3.write(w3.manifest)),
        bundle_js = JavaScript(JSON3.write(_WGLExt._bundle_text())),
        shim_js = JavaScript(JSON3.write(_WGLExt._shim_text())),
    ),
)
write(
    joinpath(outdir, "page3d.html"),
    "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>\n$inner3\n</body></html>",
)

layer3 = only(w3.manifest["layers"])
g3 = layer3["geometry"]
scale3 = w3.display_css / w3.manifest["width"]
# All three projected marker centers (image px): [0] is click.mjs's click target; alignment.mjs
# (the local GL canvas-alignment check) pixel-probes the rendered canvas at every one.
expected3 = Dict(
    "cssX" => g3[1] * scale3, "cssY" => g3[2] * scale3,
    "layer" => layer3["id"], "index" => 0,
    "markersPx" => [Dict("x" => g3[3k + 1], "y" => g3[3k + 2], "r" => g3[3k + 3]) for k in 0:2],
)
write(joinpath(outdir, "expected3d.json"), JSON3.write(expected3))

println(outdir)   # the runner reads this line to find the artifacts
