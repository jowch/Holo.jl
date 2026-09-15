# Every exported name (checkdocs = :exports) needs a real docstring, not the "no docs found"
# fallback — this is what would let a Documenter site build `@docs` blocks for the API
# reference. `Docs.hasdoc` only exists from Julia 1.11 on (CI's floor is 1.10), so render the
# doc to a String and check it isn't the fallback text — one code path, every supported version.
# Scope: `names(Holo)` only — the extension structs `CairoBackend` (unexported) and
# `WebGLBackend` (exported from HoloWGLMakieExt, not from Holo) are out of reach here and are
# NOT exercised by this testset; their docstrings are reviewed by hand.
@testset "every exported name has a docstring" begin
    for n in names(Holo)
        doc_str = sprint(show, MIME"text/plain"(), Base.Docs.doc(Base.Docs.Binding(Holo, n)))
        @test !occursin("No documentation found", doc_str)
        @test length(doc_str) > 40
    end
end
