# Emit a self-contained :webgl widget page + the expected click/bond for the browser E2E
# (test/e2e/click.mjs). Run: julia --project=HoloWGL HoloWGL/test/e2e/make_page.jl <outdir>
#
# Writes <outdir>/page.html (the real widget HTML — overlay + canvas, scene/manifest/
# bundle/shim inlined as JSON, no server / no published_to_js) and <outdir>/expected.json
# (the host-relative CSS pixel to click marker 0, and the bond value that click must produce).
# The browser half asserts host.value == {layer, index}; the Julia half (runtests.jl
# "@bind round-trip contract") asserts transform_value rebuilds the InteractionEvent.

using HoloWGL
import JSON3
using HypertextLiteral: JavaScript

outdir = abspath(get(ARGS, 1, mktempdir()))
mkpath(outdir)

fig = Figure(; size = (400, 300))
ax = Axis(fig[1, 1])
scatter!(ax, 1:5, (1:5) .^ 2)
w = holo_webgl(fig)                       # auto-extract -> one :scatter circles layer

# Real widget HTML with everything inlined (the self-contained path the unit test exercises,
# but with the ACTUAL bundle + shim text so the overlay really mounts in a browser).
inner = sprint(
    show, MIME"text/html"(),
    HoloWGL._widget_html(
        w;
        scene_expr = JavaScript(JSON3.write(w.scene)),
        manifest_expr = JavaScript(JSON3.write(w.manifest)),
        bundle_js = JavaScript(JSON3.write(HoloWGL._bundle_text())),
        shim_js = JavaScript(JSON3.write(HoloWGL._shim_text())),
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

println(outdir)   # the runner reads this line to find the artifacts
