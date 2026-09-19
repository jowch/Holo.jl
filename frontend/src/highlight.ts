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

// blend: true → belongs in mount.ts's svg.masque-blend (its own g.hi/g.sel), whose
// mix-blend-mode lives on the svg element itself, not on this shape — Firefox doesn't reliably
// blend an element nested inside a second, unblended <svg> (verified live: the shape rendered as
// a flat, unblended tint there), so the shape returned here is deliberately bare, never wrapped.
export interface HiResult {
    el: SVGElement
    blend: boolean
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
    // An explicit hoverstyle stroke routes to svg.masque-plain outright (today's unblended
    // rules); every other layer (the default) routes to svg.masque-blend instead.
    const blend = !st.stroke

    // Selected open geometry always renders as the unblended ring, in svg.masque-plain, whether
    // or not this layer would otherwise blend — a bare stroke ring reads fine unblended, and
    // mount.ts's ring rules never gained a blend variant.
    if (mode === "selected" && open) return { el: makeRing(el, st.stroke), blend: false }

    el.classList.add("masque-hi")
    el.setAttribute("vector-effect", "non-scaling-stroke")
    setHiStroke(el, st.stroke)
    if (mode === "hover") {
        el.setAttribute("stroke-width", "1.5")
        // The unblended path keeps a seg stroke-only (no fill class, matching its plain ink
        // stroke); the blend path tints every kind including seg — a <line> has no area, so the
        // fill is a no-op, but the class still selects the blended stroke colour (mount.ts's
        // --masque-hi-line-hover) over the plain ink.
        if (blend || !open) el.classList.add("masque-hover")
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
    return { el, blend }
}

// --- highlight/selection DOM-lifecycle: keyed by OverlayState.hiKey_ / selKeys_ ---
// Every function below takes BOTH sides (blend_/plain_) since a single hover/selection can land
// in either, and a redraw or clear must not leave a stale element behind in the side it isn't
// using this time (e.g. a hover moving off an explicit-stroke mark onto a plain one switches
// which svg holds the live element).

// Fade-out is hover-only (leave / miss). selects-ROI remounts g.sel every drag
// frame — a leave class there would wash the box-select on every pointer tick.
export function clearHiImmediate(state: OverlayState, hiGroups: HiGroups): void {
    if (state.hiLeaveTimer_ != null) { clearTimeout(state.hiLeaveTimer_); state.hiLeaveTimer_ = null }
    state.hiKey_ = null
    for (const hiGroup of [hiGroups.blend_, hiGroups.plain_]) {
        while (hiGroup.firstChild) hiGroup.removeChild(hiGroup.firstChild)
    }
}

export function clearHi(state: OverlayState, hiGroups: HiGroups, fade = false): void {
    const cur = hiGroups.blend_.firstChild ?? hiGroups.plain_.firstChild
    if (!fade || !cur || prefersReducedMotion()) {
        clearHiImmediate(state, hiGroups)
        return
    }
    state.hiKey_ = null
    for (const hiGroup of [hiGroups.blend_, hiGroups.plain_]) {
        for (const el of [...hiGroup.children]) {
            el.classList.remove("masque-enter")
            el.classList.add("masque-leave")
        }
    }
    if (state.hiLeaveTimer_ != null) clearTimeout(state.hiLeaveTimer_)
    state.hiLeaveTimer_ = setTimeout(() => {
        state.hiLeaveTimer_ = null
        for (const hiGroup of [hiGroups.blend_, hiGroups.plain_]) {
            while (hiGroup.firstChild) hiGroup.removeChild(hiGroup.firstChild)
        }
    }, MOTION_MS)
}

export function clearSel(selGroups: HiGroups): void {
    for (const selGroup of [selGroups.blend_, selGroups.plain_]) {
        while (selGroup.firstChild) selGroup.removeChild(selGroup.firstChild)
    }
}

export function drawHi(state: OverlayState, hiGroups: HiGroups, hit: Hit): void {
    const key = hitKey(hit)
    const cur = hiGroups.blend_.firstElementChild ?? hiGroups.plain_.firstElementChild
    if (key === state.hiKey_ && cur && !cur.classList.contains("masque-leave")) return
    clearHiImmediate(state, hiGroups)
    const made = makeHiElement(hit, "hover")
    if (!made) return
    made.el.classList.add("masque-enter")
    ;(made.blend ? hiGroups.blend_ : hiGroups.plain_).appendChild(made.el)
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
        if (entering.has(hitKey(h))) made.el.classList.add("masque-enter")
        ;(made.blend ? selGroups.blend_ : selGroups.plain_).appendChild(made.el)
    }
    state.selKeys_ = next
}
