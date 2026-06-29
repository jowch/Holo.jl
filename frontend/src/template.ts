// Tooltip content rendering: layer-template interpolation (escape-by-default + d3-format) and the
// auto name/value table default. Template literal markup is author-trusted; every interpolated data
// value is HTML-escaped. See docs/tooltips.md.
import { format } from "d3-format"
import type { TemplateSegment } from "./types"

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
export const esc = (v: unknown): string => String(v).replace(/[&<>"']/g, (c) => ESC[c])

const fmtCache = new Map<string, (n: number) => string>()
function applySpec(spec: string, v: unknown): string {
    if (typeof v !== "number" || !Number.isFinite(v)) return esc(v)
    let f = fmtCache.get(spec)
    if (!f) {
        try { f = format(spec) } catch { f = String as unknown as (n: number) => string }
        fmtCache.set(spec, f)
    }
    try { return esc(f(v)) } catch { return esc(v) }
}

// Render a layer template over a payload object. Literal segments are emitted as-is (author-trusted);
// field segments resolve from the payload, are d3-formatted if a spec is present, and are escaped.
// Missing fields (undefined) emit nothing.
export function renderTemplate(segments: TemplateSegment[], payload: unknown): string {
    const obj = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>
    let html = ""
    for (const seg of segments) {
        if (typeof seg === "string") { html += seg; continue }
        const v = obj[seg.f]
        if (v === undefined) continue
        html += seg.spec ? applySpec(seg.spec, v) : esc(v)
    }
    return html
}

// Auto name/value table from a payload object (the zero-config default). All values escaped.
export function renderAutoTable(payload: unknown): string {
    if (payload == null) return ""
    if (typeof payload !== "object") return esc(payload)
    return Object.entries(payload as Record<string, unknown>)
        .map(([k, v]) => `<div class="holo-tip-row"><span class="holo-tip-key">${esc(k)}</span><span class="holo-tip-val">${esc(v)}</span></div>`)
        .join("")
}
