using Test

# Masque has two backend extensions (CairoMakie, WGLMakie). Each suite below needs a
# specific, non-overlapping set of packages loaded, so they run as separate GROUPs
# rather than one file — see the plan/spec for why. Default GROUP is "Core".
# Implicit masque() still prefers a single loaded backend; if both are present (e.g. a
# fat sysimage) it honors backend= or defaults to Cairo instead of throwing.
const GROUP = get(ENV, "GROUP", "Core")

if GROUP == "Core"
    include("core_tests.jl")
elseif GROUP == "NoBackend"
    include("no_backend_tests.jl")
elseif GROUP == "WebGL"
    include("webgl_ext_tests.jl")
else
    error("Unknown GROUP=$GROUP — expected \"Core\", \"NoBackend\", or \"WebGL\"")
end
