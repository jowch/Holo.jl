# Headlessly run every Pluto notebook in this directory and fail if any cell errors.
# This is the CI gate that keeps the examples in lockstep with the package API: an
# example that breaks against the current code fails the build instead of rotting
# silently. No display needed — the notebooks render through CairoMakie (headless).
#
# Run locally:  julia examples/ci_run.jl
# The notebooks manage their own env (Pkg.develop the package + add CairoMakie), so
# this runner only needs Pluto itself.

import Pkg
Pkg.activate(; temp = true)
Pkg.add(name = "Pluto", version = "0.20")   # pin major; the notebooks declare v0.20.x
using Pluto

const HEADER = "### A Pluto.jl notebook ###"
is_notebook(p) = isfile(p) && endswith(p, ".jl") && startswith(readline(p), HEADER)

dirs = [@__DIR__, normpath(joinpath(@__DIR__, "..", "gallery"))]
notebooks = String[]
for d in dirs
    isdir(d) || continue
    append!(notebooks, filter(is_notebook, readdir(d; join = true)))
end
notebooks = sort(notebooks)
isempty(notebooks) && error("no Pluto notebooks found in $(join(dirs, ", "))")
@info "Found $(length(notebooks)) notebook(s)" names = basename.(notebooks)

failed = String[]
for path in notebooks
    name = basename(path)
    @info "▶ running $name"
    session = Pluto.ServerSession()
    session.options.server.disable_writing_notebook_files = true   # never mutate the committed file
    nb = Pluto.SessionActions.open(session, path; run_async = false)
    errored = [c for c in nb.cells if c.errored]
    for c in errored
        firstline = first(split(strip(string(c.code)), '\n'))
        @error "cell errored in $name" code = firstline output = string(c.output.body)
    end
    Pluto.SessionActions.shutdown(session, nb)
    isempty(errored) ? (@info "✓ $name ran clean") : push!(failed, name)
end

isempty(failed) ||
    error("example notebook(s) with errored cells: $(join(failed, ", "))")
@info "All example notebooks ran clean ✓"
