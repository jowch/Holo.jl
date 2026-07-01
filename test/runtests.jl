using Test

# Holo has two backend extensions (CairoMakie, WGLMakie) that are mutually exclusive by
# design (holo() rejects a session with both loaded). Each suite below needs a specific,
# non-overlapping set of packages loaded, so they run as separate GROUPs rather than one
# file — see the plan/spec for why. Default GROUP is "Core" (today's behavior unchanged).
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
