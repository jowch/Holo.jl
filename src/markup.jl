struct Field
    name::Symbol
    spec::Union{Nothing, String}
end

"""
    Markup

A parsed `masque"..."` tooltip template: ordered `segments` (each a literal `String`, emitted
verbatim as HTML, or a `Field` placeholder) plus the unique `fields` referenced. Built by
[`@masque_str`](@ref) — see that macro for template syntax; construct a `Markup` yourself only
if you need `parse_template`/`check_fields` directly.

Pass a `Markup` as an interactable's `tooltip=` keyword to render it client-side, from the
hovered element's `payloads[]` entry, with no round-trip to Julia. At `masque()`/`build_manifest`
time every field the template references is checked against the layer's actual payload keys
(when payloads are `NamedTuple`s); a missing field raises `ArgumentError` with a "did you
mean?" suggestion, before any figure is rendered.
"""
struct Markup
    raw::String
    segments::Vector{Union{String, Field}}
    fields::Vector{Symbol}
end

struct TemplateValidationError <: Exception
    msg::String
    template::String
    pos::Int            # 1-based char index of the offending span (0 = no caret)
end
function Base.showerror(io::IO, e::TemplateValidationError)
    print(io, "TemplateValidationError: ", e.msg)
    e.pos > 0 && print(io, "\n  ", e.template, "\n  ", " "^(e.pos - 1), "^")
    return nothing
end

# Structural check only: precision/trim/sign meaning is the browser's d3 format() to enforce.
const _D3_SPEC = r"^(?:.?[<>=^])?[-+( ]?[$#]?0?(?:\d+)?,?(?:\.\d+)?~?[dboxXfegrspcn%]?$"
_valid_spec(s::AbstractString) = occursin(_D3_SPEC, s)

_markup_error(msg, s, pos) = throw(TemplateValidationError(msg, String(s), pos))

"""
    parse_template(s) -> Markup

Parse a `masque"..."` template literal, validating structure (balanced `\$()`, identifier fields,
well-formed d3 specs). Throws `TemplateValidationError` on malformed input.
"""
function parse_template(s::AbstractString)
    segments = Union{String, Field}[]
    fields = Symbol[]
    buf = IOBuffer()
    i = firstindex(s)
    while i <= lastindex(s)
        c = s[i]
        if c == '\\' && nextind(s, i) <= lastindex(s) && s[nextind(s, i)] == '$'
            print(buf, '$')
            i = nextind(s, nextind(s, i))
        elseif c == '$'
            j = nextind(s, i)
            (j > lastindex(s) || s[j] != '(') &&
                _markup_error("bare `\$` — write `\$(field)` to reference a payload field, or `\\\$` for a literal dollar.", s, i)
            depth = 1
            k = nextind(s, j)
            start = k
            while k <= lastindex(s)
                s[k] == '(' && (depth += 1)
                s[k] == ')' && (depth -= 1)
                depth == 0 && break
                k = nextind(s, k)
            end
            depth == 0 || _markup_error("unclosed `\$(`.", s, i)
            inner = strip(s[start:prevind(s, k)])
            lit = String(take!(buf))
            isempty(lit) || push!(segments, lit)
            field_str, spec = if occursin(':', inner)
                parts = split(inner, ':', limit = 2)
                (strip(parts[1]), strip(parts[2]))
            else
                (inner, nothing)
            end
            isempty(field_str) && _markup_error("empty `\$()` — expected a payload field name.", s, i)
            Base.isidentifier(field_str) ||
                _markup_error("`\$($inner)` — `$field_str` is not a field name. Reference payload fields by name; compute derived values in the payload, not the template.", s, i)
            spec !== nothing && isempty(spec) &&
                _markup_error("`\$($inner)` — empty format spec after `:`. Omit the colon for the default (`\$($field_str)`), or give a d3-format spec.", s, i)
            (spec === nothing || _valid_spec(spec)) ||
                _markup_error("`\$($inner)` — `$spec` is not a valid d3-format spec (https://d3js.org/d3-format).", s, i)
            f = Field(Symbol(field_str), spec === nothing ? nothing : String(spec))
            push!(segments, f)
            push!(fields, f.name)
            i = nextind(s, k)
        else
            print(buf, c)
            i = nextind(s, i)
        end
    end
    lit = String(take!(buf))
    isempty(lit) || push!(segments, lit)
    return Markup(String(s), segments, unique(fields))
end

"""
    masque"..."

Build a [`Markup`](@ref) tooltip template for an interactable's `tooltip=` keyword. Placeholders
are resolved **in the browser**, from the hovered element's `payloads[]` entry — `\$(field)` is
not Julia string interpolation, and there is no runtime `masque(string)` form.

# Syntax
- Everything outside `\$(...)` is literal HTML, inserted as-is (author-trusted, not
  sanitized) — escape your own `<`/`&` as you would in `@htl`.
- `\$(field)` — the hovered element's payload field `field` (an identifier), HTML-escaped at
  hover time.
- `\$(field:spec)` — same, formatted by a [d3-format](https://d3js.org/d3-format) `spec` before
  escaping (e.g. `\$(population:,)`, `\$(pct:.1%)`). `spec` is checked structurally at
  macro-expansion (valid d3-format grammar); its runtime *meaning* (precision, trim, sign) is
  the browser's `format()` to interpret.
- `\\\$` — a literal dollar sign.

A template with no `\$(...)` at all is a fixed label, e.g. `masque"<em>static</em>"`.

# Errors
Malformed syntax (a bare `\$`, unbalanced/empty `\$()`, a non-identifier field name, or a
structurally invalid d3-format spec) raises `TemplateValidationError` at macro-expansion —
before `masque()` is ever called, with a caret pointing at the offending span. A field that
parses fine but is absent from the payload at `masque()`/`build_manifest` time raises
`ArgumentError` instead (see [`Markup`](@ref)).

See the Tooltips page of the documentation for the full template/tooltip system (styling,
security model, wire format).

# Examples
```julia
tooltip = masque"<b>\$(name)</b> — \$(population:,) people"
PointInteractable(ax, pts; payloads = [(; name = "a", population = 1200)], tooltip)
```
"""
macro masque_str(s)
    parse_template(s)
    return :($(parse_template)($s))
end

# Levenshtein for did-you-mean (Base has no public closest-string API).
function _editdistance(a::AbstractString, b::AbstractString)
    ca, cb = collect(a), collect(b)
    m, n = length(ca), length(cb)
    d = collect(0:n)
    for ii in 1:m
        prev = d[1]
        d[1] = ii
        for jj in 1:n
            cur = d[jj + 1]
            d[jj + 1] = min(d[jj + 1] + 1, d[jj] + 1, prev + (ca[ii] == cb[jj] ? 0 : 1))
            prev = cur
        end
    end
    return d[n + 1]
end

function _suggest(name::Symbol, avail)
    isempty(avail) && return nothing
    best = argmin(k -> _editdistance(string(name), string(k)), collect(avail))
    return _editdistance(string(name), string(best)) <= 2 ? best : nothing
end

"""
    check_fields(m::Markup, payload_keys) -> m

Build-time check: every `\$(field)` in the template must exist in `payload_keys` (an iterable of
Symbols). Throws `ArgumentError` listing missing fields + a did-you-mean and the available fields.
"""
function check_fields(m::Markup, payload_keys)
    keyset = Set(Symbol.(collect(payload_keys)))
    missing_fields = [f for f in m.fields if !(f in keyset)]
    isempty(missing_fields) && return m
    lines = map(missing_fields) do f
        s = _suggest(f, keyset)
        s === nothing ? "  • \$($f) — no field `$f`" : "  • \$($f) — no field `$f`; did you mean `$s`?"
    end
    throw(
        ArgumentError(
            "masque tooltip template references fields missing from the payload:\n" *
                join(lines, "\n") *
                "\n  available: " * join(sort(string.(collect(keyset))), ", "),
        ),
    )
end

"Serialize a Markup to the wire: an array of literal `String` | `Dict(\"f\"=>name[, \"spec\"=>spec])`."
function markup_segments(m::Markup)
    return Any[
        if seg isa Field
            seg.spec === nothing ? Dict("f" => string(seg.name)) :
                Dict("f" => string(seg.name), "spec" => seg.spec)
        else
            seg
        end
            for seg in m.segments
    ]
end
