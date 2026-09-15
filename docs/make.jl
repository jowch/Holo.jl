using Documenter
using Holo

include("export_notebooks.jl")
export_notebooks(joinpath(@__DIR__, "src", "notebooks"))

makedocs(;
    modules = [Holo],
    authors = "Jonathan Chen <jwhc@ucla.edu>",
    sitename = "Holo.jl",
    format = Documenter.HTML(;
        prettyurls = get(ENV, "CI", "false") == "true",
        canonical = "https://jowch.github.io/Holo.jl",
        edit_link = "main",
        assets = String[],
    ),
    pages = [
        "Home" => "index.md",
        "Getting started" => "getting-started.md",
        "Interactables" => "interactables.md",
        "Selection" => "selection.md",
        "Tooltips" => "tooltips.md",
        "Keyboard and screen readers" => "accessibility.md",
        "Custom interactions" => "custom.md",
        "Backends" => "backends.md",
        "Troubleshooting" => "troubleshooting.md",
        "Examples" => "examples.md",
        "API Reference" => "api.md",
        "Development" => "contributing.md",
    ],
    doctest = false,
    checkdocs = :exports,
    warnonly = false,
)

deploydocs(;
    repo = "github.com/jowch/Holo.jl",
    devbranch = "main",
    push_preview = false,
)
