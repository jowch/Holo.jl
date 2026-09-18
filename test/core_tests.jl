using Masque
using Masque: hitlayers, validate, events, HitLayer, build_manifest, MasqueWidget
import Masque as IP
using CairoMakie
import Makie
using Test

include(joinpath(@__DIR__, "testutils.jl"))

# Canary FIRST: a Makie internal that changed shape should fail loudly here, not as a
# scattered downstream MethodError/wrong-pixel bug in one of the testsets below.
include("makie_compat_tests.jl")

# Split by concern (was one 1,985-line file/testset) — each of these also runs standalone
# via `julia --project=. test/core/<file>.jl`. See testutils.jl for the shared fixtures.
include("core/backend_tests.jl")
include("core/axis3_polar_tests.jl")
include("core/interactables_tests.jl")
include("core/drag_tests.jl")
include("core/introspect_tests.jl")
include("core/markup_tests.jl")
include("core/selection_tests.jl")
include("core/parity_tests.jl")
include("core/keyboard_a11y_label_tests.jl")
include("core/colors_tests.jl")
include("core/legend_tests.jl")

include("docstrings_tests.jl")
