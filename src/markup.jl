# The `holo"..."` template system: a layer-level HTML template whose $(field) placeholders are
# resolved browser-side from payloads[] (escaped) + an optional d3-format spec. See docs/tooltips.md.

struct Field
    name::Symbol
    spec::Union{Nothing, String}
end

"""
    Markup

A parsed `holo"..."` template: ordered `segments` (each a literal `String` or a `Field`) plus the
unique `fields` referenced. `\$(field)` placeholders are resolved in the browser from `payloads[]`;
they are NOT Julia interpolation. `\$(field:spec)` applies a d3-format spec browser-side.
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

# d3-format specifier grammar with `type` restricted to d3's MEANINGFUL set, so typos like `.2z` are
# rejected rather than silently aliased to the default (stricter than d3 — better UX). Structural
# only: precision/trim/sign *meaning* is the browser's d3 format() to enforce. See docs/tooltips.md.
const _D3_SPEC = r"^(?:.?[<>=^])?[-+( ]?[$#]?0?(?:\d+)?,?(?:\.\d+)?~?[dboxXfegrspcn%]?$"
_valid_spec(s::AbstractString) = occursin(_D3_SPEC, s)

_markup_error(msg, s, pos) = throw(TemplateValidationError(msg, String(s), pos))

"""
    parse_template(s) -> Markup

Parse a `holo"..."` template literal, validating structure (balanced `\$()`, identifier fields,
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

# Validate at macro-expansion (the LoadError carries the user's source file:line); rebuild the value
# at runtime. The double-parse is cheap and keeps the early-error UX.
macro holo_str(s)
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
            "holo tooltip template references fields missing from the payload:\n" *
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
