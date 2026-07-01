# Launch a headless Pluto server for the through-Pluto @bind E2E (bind_click.mjs drives it).
# Pluto lives in its OWN temp env (only Pluto needed here); the notebook activates its own
# temp env (dev Holo by path + add WGLMakie) when it runs. Blocks — run in the background, poll the port for readiness
# (curl localhost:PORT -> 200; do NOT grep the log, Pluto doesn't reliably flush its banner).
#
#   julia test/e2e/serve.jl [port]

import Pkg
Pkg.activate(; temp = true)
Pkg.add(name = "Pluto", version = "0.20")
using Pluto

port = length(ARGS) >= 1 ? parse(Int, ARGS[1]) : 1234
Pluto.run(;
    port,
    launch_browser = false,
    require_secret_for_open_links = false,
    require_secret_for_access = false,
    disable_writing_notebook_files = true,   # never mutate the committed notebook on open
)
