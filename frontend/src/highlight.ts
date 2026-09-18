import { hitKey, prefersReducedMotion, MOTION_MS } from "./state"
import type { OverlayState } from "./state"
import type { Hit, LayerStyle } from "./types"

export const SVG_NS = "http://www.w3.org/2000/svg"

export const DEFAULT_STYLE: LayerStyle = { width: 2 }

// --- highlight element factory (shared by hover drawHi and box-selection selGroup) ---
type HiMode = "hover" | "selected"

// hit.layer.colors is per-LAYER (a single string, or a layer-wide palette + one index per
// element) — never resolved per the specific hit here beyond that one palette lookup, so an
// out-of-range index (a payload/colors length mismatch) degrades to no accent rather than
// throwing.
export function markColorFor(hit: Hit): string | null {
    const c = hit.layer.colors
    if (!c) return null
    if (typeof c === "string") return c
    return c.palette[c.index[hit.index]] ?? null
}

// Applies the two colour-derivation inputs (mount.ts's STYLE .masque-hi rules read them): the
// mark's own colour (drives the color-mix toward --masque-ink) and an explicit per-layer
// hoverstyle override (wins outright, used verbatim). Shared by every highlight element —
// hover/selected circles, rings, the ROI rect/handles, the threshold line.
function setHiColorProps(el: SVGElement | SVGGElement, mark: string | null, stroke: string | undefined): void {
    if (mark) el.style.setProperty("--masque-mark", mark)
    if (stroke) el.style.setProperty("--masque-hi-stroke", stroke)
}

export function makeRing(shape: SVGElement, mark: string | null, stroke: string | undefined): SVGGElement {
    const g = document.createElementNS(SVG_NS, "g")
    const inner = shape
    const outer = shape.cloneNode(true) as SVGElement
    for (const el of [inner, outer]) {
        el.classList.add("masque-hi")
        el.setAttribute("vector-effect", "non-scaling-stroke")
    }
    inner.setAttribute("stroke-width", "2")
    inner.setAttribute("stroke-opacity", "1")
    outer.setAttribute("stroke-width", "4")
    outer.setAttribute("stroke-opacity", "0.25")
    setHiColorProps(g, mark, stroke) // custom properties inherit — set once on the wrapper
    g.append(outer, inner) // outer under inner so the 2px stroke stays crisp
    return g
}

export function makeHiElement(hit: Hit, mode: HiMode = "hover"): SVGElement | null {
    if (!hit.geom_) return null
    const st = hit.layer.style ?? DEFAULT_STYLE
    const g = hit.geom_ as [string, ...number[]] | [string, number[]]
    let el: SVGElement | null = null
    if (g[0] === "circle") {
        el = document.createElementNS(SVG_NS, "circle")
        el.setAttribute("cx", String(g[1])); el.setAttribute("cy", String(g[2])); el.setAttribute("r", String(g[3]))
    } else if (g[0] === "rect" || g[0] === "rectfill") {
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
    const mark = markColorFor(hit)
    if (mode === "selected" && open) return makeRing(el, mark, st.stroke)
    el.classList.add("masque-hi")
    el.setAttribute("vector-effect", "non-scaling-stroke")
    setHiColorProps(el, mark, st.stroke)
    if (mode === "hover") {
        el.setAttribute("stroke-width", "1.5")
        if (!open) el.classList.add("masque-hover") // seg stays stroke-only, no fill class
    } else if (g[0] === "rectfill") {
        // The grid cell-block union rect from an ROI's selects: fill only, no stroke — the ROI
        // box itself is already drawing that outline, and stroking this rect too doubles it
        // into two parallel edges that persist after release (see selection.ts's cellRange/grid
        // branch for why this rect exists at all).
        el.classList.add("masque-wash", "masque-nostroke")
    } else {
        el.classList.add("masque-wash")
        el.setAttribute("stroke-width", "2")
    }
    return el
}

// --- highlight/selection DOM-lifecycle: keyed by OverlayState.hiKey_ / selKeys_ ---

// Fade-out is hover-only (leave / miss). selects-ROI remounts g.sel every drag
// frame — a leave class there would wash the box-select on every pointer tick.
export function clearHiImmediate(state: OverlayState, hiGroup: SVGGElement): void {
    if (state.hiLeaveTimer_ != null) { clearTimeout(state.hiLeaveTimer_); state.hiLeaveTimer_ = null }
    state.hiKey_ = null
    while (hiGroup.firstChild) hiGroup.removeChild(hiGroup.firstChild)
}

export function clearHi(state: OverlayState, hiGroup: SVGGElement, fade = false): void {
    if (!fade || !hiGroup.firstChild || prefersReducedMotion()) {
        clearHiImmediate(state, hiGroup)
        return
    }
    state.hiKey_ = null
    for (const el of [...hiGroup.children]) {
        el.classList.remove("masque-enter")
        el.classList.add("masque-leave")
    }
    if (state.hiLeaveTimer_ != null) clearTimeout(state.hiLeaveTimer_)
    state.hiLeaveTimer_ = setTimeout(() => {
        state.hiLeaveTimer_ = null
        while (hiGroup.firstChild) hiGroup.removeChild(hiGroup.firstChild)
    }, MOTION_MS)
}

export function clearSel(selGroup: SVGGElement): void {
    while (selGroup.firstChild) selGroup.removeChild(selGroup.firstChild)
}

export function drawHi(state: OverlayState, hiGroup: SVGGElement, hit: Hit): void {
    const key = hitKey(hit)
    const cur = hiGroup.firstElementChild
    if (key === state.hiKey_ && cur && !cur.classList.contains("masque-leave")) return
    clearHiImmediate(state, hiGroup)
    const el = makeHiElement(hit, "hover")
    if (!el) return
    el.classList.add("masque-enter")
    hiGroup.appendChild(el)
    state.hiKey_ = key
}

export function drawSelection(state: OverlayState, selGroup: SVGGElement, hits: Hit[]): void {
    const next = new Set(hits.map(hitKey))
    const entering = new Set<string>()
    for (const k of next) if (!state.selKeys_.has(k)) entering.add(k)
    clearSel(selGroup)
    for (const h of hits) {
        const el = makeHiElement(h, "selected")
        if (!el) continue
        if (entering.has(hitKey(h))) el.classList.add("masque-enter")
        selGroup.appendChild(el)
    }
    state.selKeys_ = next
}
