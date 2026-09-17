using Pluto

# examples/ci_run.jl runs the same notebooks as the CI gate; keep the discovery and error
# handling in step.
const HEADER = "### A Pluto.jl notebook ###"
is_notebook(p) = isfile(p) && endswith(p, ".jl") && startswith(readline(p), HEADER)

function find_notebooks()
    root = normpath(joinpath(@__DIR__, ".."))
    dirs = [joinpath(root, "examples"), joinpath(root, "gallery")]
    notebooks = String[]
    for d in dirs
        isdir(d) || continue
        append!(notebooks, filter(is_notebook, readdir(d; join = true)))
    end
    return sort(notebooks)
end

function export_notebook(path, outdir)
    name = basename(path)
    session = Pluto.ServerSession()
    session.options.server.disable_writing_notebook_files = true
    nb = Pluto.SessionActions.open(session, path; run_async = false)
    try
        errored = [c for c in nb.cells if c.errored]
        for c in errored
            firstline = first(split(strip(string(c.code)), '\n'))
            @error "cell errored in $name" code = firstline output = string(c.output.body)
        end
        isempty(errored) ||
            error("notebook $name has errored cell(s); fix the notebook before docs can build")

        # binder_url_js = "undefined" disables the export's "run on Binder" launch: Binder would
        # open the notebook from a URL into a temp dir, where the notebook's own
        # `Pkg.develop(path = joinpath(@__DIR__, ".."))` cell can't resolve the package.
        html = Pluto.generate_html(nb; binder_url_js = "undefined")
        outpath = joinpath(outdir, splitext(name)[1] * ".html")
        write(outpath, html)
        return outpath
    finally
        Pluto.SessionActions.shutdown(session, nb)
    end
end

function export_notebooks(outdir)
    if get(ENV, "MASQUE_SKIP_NOTEBOOK_EXPORT", "") == "true"
        @info "MASQUE_SKIP_NOTEBOOK_EXPORT set — reusing exports already in $outdir"
        return
    end
    mkpath(outdir)
    notebooks = find_notebooks()
    isempty(notebooks) && error("no Pluto notebooks found under examples/ or gallery/")
    @info "Exporting $(length(notebooks)) notebook(s)" names = basename.(notebooks)

    for path in notebooks
        t0 = time()
        outpath = export_notebook(path, outdir)
        elapsed = round(time() - t0; digits = 1)
        size_mb = round(filesize(outpath) / 1024^2; digits = 2)
        @info "✓ exported $(basename(path))" elapsed_s = elapsed size_mb = size_mb
    end
    return
end
