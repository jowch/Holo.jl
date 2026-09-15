import type { Hit } from "./types"

export const SVG_NS = "http://www.w3.org/2000/svg"

// Inspector ink is a locked design decision (CLAUDE.md) — not a theming API.
export const INSPECTOR_INK = "#3A6F7C"
export const DEFAULT_STYLE = { stroke: INSPECTOR_INK, width: 2 }

// --- highlight element factory (shared by hover drawHi and box-selection selGroup) ---
type HiMode = "hover" | "selected"

export function colorWithAlpha(stroke: string, a: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(stroke.trim())
    if (!m) return `color-mix(in srgb, ${stroke} ${Math.round(a * 100)}%, transparent)`
    const n = parseInt(m[1], 16)
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export function makeRing(shape: SVGElement, stroke: string): SVGGElement {
    const g = document.createElementNS(SVG_NS, "g")
    const inner = shape
    const outer = shape.cloneNode(true) as SVGElement
    for (const el of [inner, outer]) {
        el.setAttribute("fill", "none")
        el.setAttribute("stroke", stroke)
        el.setAttribute("vector-effect", "non-scaling-stroke")
    }
    inner.setAttribute("stroke-width", "2")
    inner.setAttribute("stroke-opacity", "1")
    outer.setAttribute("stroke-width", "4")
    outer.setAttribute("stroke-opacity", "0.25")
    g.append(outer, inner) // outer under inner so the 2px stroke stays crisp
    return g
}

export function makeHiElement(hit: Hit, mode: HiMode = "hover"): SVGElement | null {
    if (!hit.geom) return null
    const st = hit.layer.style ?? DEFAULT_STYLE
    const g = hit.geom as [string, ...number[]] | [string, number[]]
    let el: SVGElement | null = null
    if (g[0] === "circle") {
        el = document.createElementNS(SVG_NS, "circle")
        el.setAttribute("cx", String(g[1])); el.setAttribute("cy", String(g[2])); el.setAttribute("r", String((g[3] as number) + 2))
    } else if (g[0] === "rect") {
        el = document.createElementNS(SVG_NS, "rect")
        el.setAttribute("x", String((g[1] as number) - (g[3] as number) / 2))
        el.setAttribute("y", String((g[2] as number) - (g[4] as number) / 2))
        el.setAttribute("width", String(g[3])); el.setAttribute("height", String(g[4]))
    } else if (g[0] === "seg") {
        el = document.createElementNS(SVG_NS, "line")
        el.setAttribute("x1", String(g[1])); el.setAttribute("y1", String(g[2]))
        el.setAttribute("x2", String(g[3])); el.setAttribute("y2", String(g[4]))
    } else if (g[0] === "poly") {
        el = document.createElementNS(SVG_NS, "polygon")
        const ring = g[1] as number[]
        let pts = ""
        for (let k = 0; k < ring.length; k += 2) pts += `${ring[k]},${ring[k + 1]} `
        el.setAttribute("points", pts.trim())
    }
    if (!el) return null
    const open = g[0] === "seg"
    if (mode === "selected" && open) return makeRing(el, st.stroke)
    el.setAttribute("vector-effect", "non-scaling-stroke")
    el.setAttribute("stroke", st.stroke)
    if (mode === "hover") {
        el.setAttribute("fill", "none")
        el.setAttribute("stroke-width", "2")
        el.setAttribute("stroke-opacity", "0.85")
    } else {
        el.setAttribute("fill", colorWithAlpha(st.stroke, 0.12))
        el.setAttribute("stroke-width", "2.5")
        el.setAttribute("stroke-opacity", "1")
    }
    return el
}
