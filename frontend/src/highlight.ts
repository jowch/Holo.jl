import { hitKey, prefersReducedMotion, MOTION_MS } from "./state"
import type { HiGroups, OverlayState } from "./state"
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

// An explicit per-layer hoverstyle stroke from Julia (wins outright, used verbatim). Shared by
// every unblended (mount.ts's svg.masque-plain) highlight element — the explicit-stroke path
// below, rings, the ROI rect/handles, the threshold line. A resolved mark colour no longer feeds
// a highlight's own colour (mount.ts's blend-tint path replaces that); markColorFor is still
// exported for hover.ts's tooltip accent border.
function setHiStroke(el: SVGElement | SVGGElement, stroke: string | undefined): void {
    if (stroke) el.style.setProperty("--masque-hi-stroke", stroke)
}

export function makeRing(shape: SVGElement, stroke: string | undefined): SVGGElement {
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
    setHiStroke(g, stroke) // custom property inherits — set once on the wrapper
    g.append(outer, inner) // outer under inner so the 2px stroke stays crisp
    return g
}

// Which svg(s) a highlight lands in. An explicit hoverstyle stroke, or the selected-open ring,
// is unblended → plain only. Otherwise a closed shape splits into a brightening fill shape
// (fill svg) and a darkening stroke shape (edge svg) of identical geometry; an open (seg) shape
// has no interior, so hover on it is edge-only; a rectfill (grid cell-block union rect) is
// fill-only, since the ROI box itself already draws that outline.
export interface HiResult {
    fill?: SVGElement
    edge?: SVGElement
    plain?: SVGElement
}

export function makeHiElement(hit: Hit, mode: HiMode = "hover"): HiResult | null {
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
    const rectfill = g[0] === "rectfill"

    // Explicit hoverstyle stroke: today's single unblended element in svg.masque-plain, unchanged.
    if (st.stroke) {
        if (mode === "selected" && open) return { plain: makeRing(el, st.stroke) }
        el.classList.add("masque-hi")
        el.setAttribute("vector-effect", "non-scaling-stroke")
        setHiStroke(el, st.stroke)
        if (mode === "hover") {
            el.setAttribute("stroke-width", "1.5")
            if (!open) el.classList.add("masque-hover")
        } else if (rectfill) {
            el.classList.add("masque-wash", "masque-nostroke")
        } else {
            el.classList.add("masque-wash")
            el.setAttribute("stroke-width", "2")
        }
        return { plain: el }
    }

    // Selected open geometry always renders as the unblended ring, in svg.masque-plain, whether
    // or not this layer would otherwise split — a bare stroke ring reads fine unblended, and
    // mount.ts's ring rules never gained a fill/edge variant.
    if (mode === "selected" && open) return { plain: makeRing(el, undefined) }

    if (rectfill) {
        // Fill only: the ROI box itself already draws the outline, so an edge shape here would
        // double it into two parallel edges that persist after release.
        el.classList.add("masque-hi", "masque-fillshape")
        return { fill: el }
    }

    if (open) {
        // A line has no interior — hover is edge (stroke) only, no fill shape.
        el.classList.add("masque-hi", "masque-hover")
        el.setAttribute("vector-effect", "non-scaling-stroke")
        el.setAttribute("stroke-width", "1.5")
        return { edge: el }
    }

    // Closed geometry: two shapes of identical geometry, cloned before either is modified — a
    // brightening fill (no stroke) and a darkening stroke (no fill), same source colour for
    // hover and selected, distinguished only by the edge shape's width/darkness.
    const fillEl = el
    const edgeEl = el.cloneNode(true) as SVGElement
    fillEl.classList.add("masque-hi", "masque-fillshape")
    edgeEl.classList.add("masque-hi")
    edgeEl.setAttribute("vector-effect", "non-scaling-stroke")
    if (mode === "hover") {
        edgeEl.classList.add("masque-hover")
        edgeEl.setAttribute("stroke-width", "1.5")
    } else {
        edgeEl.classList.add("masque-wash")
        edgeEl.setAttribute("stroke-width", "2")
    }
    return { fill: fillEl, edge: edgeEl }
}

// --- highlight/selection DOM-lifecycle: keyed by OverlayState.hiKey_ / selKeys_ ---
// Every function below takes ALL THREE groups (fill_/edge_/plain_) since a single
// hover/selection can land in one or two of them, and a redraw or clear must not leave a stale
// element behind in a group it isn't using this time (e.g. a hover moving off an explicit-stroke
// mark onto a plain one switches which svg(s) hold the live element).

// Fade-out is hover-only (leave / miss). selects-ROI remounts g.sel every drag
// frame — a leave class there would wash the box-select on every pointer tick.
export function clearHiImmediate(state: OverlayState, hiGroups: HiGroups): void {
    if (state.hiLeaveTimer_ != null) { clearTimeout(state.hiLeaveTimer_); state.hiLeaveTimer_ = null }
    state.hiKey_ = null
    for (const hiGroup of [hiGroups.fill_, hiGroups.edge_, hiGroups.plain_]) {
        while (hiGroup.firstChild) hiGroup.removeChild(hiGroup.firstChild)
    }
}

export function clearHi(state: OverlayState, hiGroups: HiGroups, fade = false): void {
    const cur = hiGroups.fill_.firstChild ?? hiGroups.edge_.firstChild ?? hiGroups.plain_.firstChild
    if (!fade || !cur || prefersReducedMotion()) {
        clearHiImmediate(state, hiGroups)
        return
    }
    state.hiKey_ = null
    for (const hiGroup of [hiGroups.fill_, hiGroups.edge_, hiGroups.plain_]) {
        for (const el of [...hiGroup.children]) {
            el.classList.remove("masque-enter")
            el.classList.add("masque-leave")
        }
    }
    if (state.hiLeaveTimer_ != null) clearTimeout(state.hiLeaveTimer_)
    state.hiLeaveTimer_ = setTimeout(() => {
        state.hiLeaveTimer_ = null
        for (const hiGroup of [hiGroups.fill_, hiGroups.edge_, hiGroups.plain_]) {
            while (hiGroup.firstChild) hiGroup.removeChild(hiGroup.firstChild)
        }
    }, MOTION_MS)
}

export function clearSel(selGroups: HiGroups): void {
    for (const selGroup of [selGroups.fill_, selGroups.edge_, selGroups.plain_]) {
        while (selGroup.firstChild) selGroup.removeChild(selGroup.firstChild)
    }
}

// Hovering an already-selected mark draws no hover chrome at all: both layers are opaque, so a
// 1.5px hover stroke painting over the 2px selected stroke would thin it, reading as WEAKER, not
// added emphasis — the selected wash/ring already shows this element. The tooltip is unaffected;
// callers (hover.ts, keyboard.ts) show it via a separate call.
export function drawHi(state: OverlayState, hiGroups: HiGroups, hit: Hit): void {
    const key = hitKey(hit)
    if (state.selKeys_.has(key)) { clearHiImmediate(state, hiGroups); return }
    const cur = hiGroups.fill_.firstElementChild ?? hiGroups.edge_.firstElementChild ?? hiGroups.plain_.firstElementChild
    if (key === state.hiKey_ && cur && !cur.classList.contains("masque-leave")) return
    clearHiImmediate(state, hiGroups)
    const made = makeHiElement(hit, "hover")
    if (!made) return
    if (made.fill) { made.fill.classList.add("masque-enter"); hiGroups.fill_.appendChild(made.fill) }
    if (made.edge) { made.edge.classList.add("masque-enter"); hiGroups.edge_.appendChild(made.edge) }
    if (made.plain) { made.plain.classList.add("masque-enter"); hiGroups.plain_.appendChild(made.plain) }
    state.hiKey_ = key
}

export function drawSelection(state: OverlayState, selGroups: HiGroups, hits: Hit[]): void {
    const next = new Set(hits.map(hitKey))
    const entering = new Set<string>()
    for (const k of next) if (!state.selKeys_.has(k)) entering.add(k)
    clearSel(selGroups)
    for (const h of hits) {
        const made = makeHiElement(h, "selected")
        if (!made) continue
        const enter = entering.has(hitKey(h))
        if (made.fill) { if (enter) made.fill.classList.add("masque-enter"); selGroups.fill_.appendChild(made.fill) }
        if (made.edge) { if (enter) made.edge.classList.add("masque-enter"); selGroups.edge_.appendChild(made.edge) }
        if (made.plain) { if (enter) made.plain.classList.add("masque-enter"); selGroups.plain_.appendChild(made.plain) }
    }
    state.selKeys_ = next
}
