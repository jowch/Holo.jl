# Seam closure for the @bind round-trip: feed the value the browser ACTUALLY emitted
# (captured.json, written by click.mjs from the real host.value) through the real Julia
# `transform_value` and assert the typed InteractionEvent. The runtests.jl contract test
# proves transform_value against a payload synthesized from the manifest; this proves it
# against the byte-for-byte browser emission — stitching emit→consume with no synthesized
# middle (the closest we get to the Pluto round-trip without launching a Pluto kernel).
#
#   julia test/e2e/verify_capture.jl <artifact-dir>
#
# WGLMakie is a weak dep of Holo, so a bare `--project=.` can't `using WGLMakie` — same
# temp-env dance as make_page.jl / examples/webgl_demo.jl.
import Pkg
Pkg.activate(; temp = true)
Pkg.develop(path = normpath(joinpath(@__DIR__, "..", "..")))   # test/e2e -> package root
Pkg.add(["WGLMakie", "JSON3", "AbstractPlutoDingetjes"])
Pkg.instantiate()

using Holo
using WGLMakie
import JSON3
import AbstractPlutoDingetjes as APD

dir = abspath(ARGS[1])
# Parse to Dict{String,Any} (nested too) — mirrors what Pluto hands transform_value, not a
# JSON3 lazy view.
captured = JSON3.read(read(joinpath(dir, "captured.json"), String), Dict{String, Any})

# transform_value dispatches on the widget type (it reads only `captured`); build any instance.
fig = Figure(; size = (400, 300)); ax = Axis(fig[1, 1]); scatter!(ax, 1:5, (1:5) .^ 2)
w = holo(fig)

ev = APD.Bonds.transform_value(w, captured)   # the REAL browser emission -> InteractionEvent

ev isa Holo.InteractionEvent || error("transform_value did not return an InteractionEvent: $(typeof(ev))")
ev.layer === :scatter || error("layer mismatch: $(ev.layer)")
ev.index == 0 || error("index mismatch: $(ev.index)")
ev.payload === nothing && error("payload dropped (browser emitted one)")

println("seam OK — browser host.value -> ", ev)

# Axis3 case (WS-3D): same seam, and the payload must carry the z the 3D scatter shipped.
captured3 = JSON3.read(read(joinpath(dir, "captured3d.json"), String), Dict{String, Any})
ev3 = APD.Bonds.transform_value(w, captured3)
ev3 isa Holo.InteractionEvent || error("transform_value (3D) did not return an InteractionEvent: $(typeof(ev3))")
ev3.layer === :scatter || error("3D layer mismatch: $(ev3.layer)")
ev3.index == 0 || error("3D index mismatch: $(ev3.index)")
(ev3.payload isa AbstractDict && haskey(ev3.payload, "z")) ||
    error("Axis3 payload missing z (got $(ev3.payload)) — the {index,x,y,z} payload was dropped on the wire")

println("seam OK (Axis3) — browser host.value -> ", ev3)
