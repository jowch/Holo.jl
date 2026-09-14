using Documenter
using Holo

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
        "Interactables" => "interactables.md",
        "Custom interactions" => "custom.md",
        "Selection" => "selection.md",
        "Tooltips" => "tooltips.md",
        "Backends" => "backends.md",
        "API" => "api.md",
    ],
    doctest = true,
    checkdocs = :none,
)

deploydocs(;
    repo = "github.com/jowch/Holo.jl.git",
    devbranch = "main",
    push_preview = true,
)
