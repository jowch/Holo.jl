# Seam closure for the @bind round-trip: feed the value the browser ACTUALLY emitted
# (captured.json, written by click.mjs from the real host.value) through the real Julia
# `transform_value` and assert the typed InteractionEvent. The runtests.jl contract test
# proves transform_value against a payload synthesized from the manifest; this proves it
# against the byte-for-byte browser emission — stitching emit→consume with no synthesized
# middle (the closest we get to the Pluto round-trip without launching a Pluto kernel).
#
#   julia --project=HoloWGL HoloWGL/test/e2e/verify_capture.jl <artifact-dir>

using HoloWGL
import JSON3
import AbstractPlutoDingetjes as APD

dir = abspath(ARGS[1])
# Parse to Dict{String,Any} (nested too) — mirrors what Pluto hands transform_value, not a
# JSON3 lazy view.
captured = JSON3.read(read(joinpath(dir, "captured.json"), String), Dict{String, Any})

# transform_value dispatches on the widget type (it reads only `captured`); build any instance.
fig = Figure(; size = (400, 300)); ax = Axis(fig[1, 1]); scatter!(ax, 1:5, (1:5) .^ 2)
w = holo_webgl(fig)

ev = APD.Bonds.transform_value(w, captured)   # the REAL browser emission -> InteractionEvent

ev isa HoloWGL.Holo.InteractionEvent || error("transform_value did not return an InteractionEvent: $(typeof(ev))")
ev.layer === :scatter || error("layer mismatch: $(ev.layer)")
ev.index == 0 || error("index mismatch: $(ev.index)")
ev.payload === nothing && error("payload dropped (browser emitted one)")

println("seam OK — browser host.value -> ", ev)
