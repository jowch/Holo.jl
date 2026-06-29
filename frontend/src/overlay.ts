// DOM layer: builds a shadow-root overlay over the (light-DOM) base image, wires hover/click,
// draws highlights, and round-trips clicks through the @bind element. Stateless across re-render.
import { hitTest, invertAxis, resolvePayload, findBin } from "./geometry"
import { renderTemplate, renderAutoTable, esc } from "./template"
import type { AxisTransform, Hit, HitLayer, Manifest, ThresholdGeometry, ROIGeometry, GridGeometry } from "./types"

const SVG_NS = "http://www.w3.org/2000/svg"

const STYLE = `
:host { position: absolute; inset: 0; }
.surface { position: absolute; inset: 0; cursor: crosshair; }
.surface.hot { cursor: pointer; }
.surface.grab { cursor: grab; }
.surface.grabbing { cursor: grabbing; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.holo-tip { position: absolute; display: none; pointer-events: none; z-index: 10;
       padding: var(--holo-tip-padding, 8px 12px); border-radius: var(--holo-tip-radius, 4px);
       background: var(--holo-tip-bg, #ffffff); color: var(--holo-tip-color, #1a1a1a);
       border: 1px solid var(--holo-tip-border, rgba(0,0,0,0.1));
       box-shadow: var(--holo-tip-shadow, 0 2px 4px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08));
       font: var(--holo-tip-font-size, 11px)/1.4 var(--holo-tip-font, system-ui, -apple-system, sans-serif);
       max-width: var(--holo-tip-maxwidth, 320px); white-space: normal; transform: translate(10px, 10px); }
.holo-tip::before { content: ""; position: absolute; top: -5px; left: 8px;
       border: 5px solid transparent; border-top: none; border-bottom-color: var(--holo-tip-bg, #ffffff);
       display: var(--holo-tip-caret, block); }
.holo-tip-row { display: flex; gap: 8px; justify-content: space-between; }
.holo-tip-key { color: var(--holo-tip-accent, #6b7280); }
.holo-tip-val { font-variant-numeric: tabular-nums; }
@media (prefers-color-scheme: dark) {
  .holo-tip { background: var(--holo-tip-bg, #1e1e1e); color: var(--holo-tip-color, #e8e8e8);
       border-color: var(--holo-tip-border, rgba(255,255,255,0.15));
       box-shadow: var(--holo-tip-shadow, 0 2px 4px rgba(0,0,0,0.4), 0 8px 16px rgba(0,0,0,0.3)); }
  .holo-tip::before { border-bottom-color: var(--holo-tip-bg, #1e1e1e); }
}
`

interface Mounted {
    cleanup: () => void
}

/**
 * Mount the interaction overlay.
 * @param scriptEl  the cell's <script> (its parent is the light-DOM host containing <img>)
 * @param manifest  hit-region manifest (from published_to_js or inlined JSON)
 * @param invalidation  Pluto's cleanup promise (resolves on cell re-render)
 */
export function mount(scriptEl: HTMLElement, manifest: Manifest, invalidation?: Promise<unknown>): Mounted {
    const host = scriptEl.parentElement as HTMLElement | null
    const img = host?.querySelector("img") as HTMLImageElement | null
    const noop: Mounted = { cleanup: () => {} }
    if (!host || !img) return noop

    // the @bind target is the host element; start with no selection
    ;(host as unknown as { value: unknown }).value = null

    const shadowHost = document.createElement("div")
    const shadow = shadowHost.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = STYLE
    const svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("viewBox", `0 0 ${manifest.width} ${manifest.height}`)
    svg.setAttribute("preserveAspectRatio", "none")
    const selGroup = document.createElementNS(SVG_NS, "g") // persistent box-selection highlights (g.sel, z-below hover)
    selGroup.setAttribute("class", "sel")
    svg.appendChild(selGroup)
    const hiGroup = document.createElementNS(SVG_NS, "g") // transient hover highlights (g.hi, z-above sel)
    hiGroup.setAttribute("class", "hi")
    svg.appendChild(hiGroup)
    const surface = document.createElement("div")
    surface.className = "surface"
    const tip = document.createElement("div")
    tip.className = "holo-tip"
    shadow.append(style, svg, surface, tip)
    host.appendChild(shadowHost)
    if (manifest.tipStyle) for (const [k, v] of Object.entries(manifest.tipStyle)) shadowHost.style.setProperty(k, v)

    const imgPx = (e: MouseEvent) => {
        const r = img.getBoundingClientRect()
        const s = img.naturalWidth / r.width // image-px per CSS-px
        return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s }
    }

    // --- draggable threshold lines (Tier 0): persistent, inverted via AxisTransform on release ---
    const setLine = (line: SVGLineElement, tg: ThresholdGeometry, pos: number) => {
        const [lo, hi] = tg.span
        const [x1, y1, x2, y2] = tg.orientation === "h" ? [lo, pos, hi, pos] : [pos, lo, pos, hi]
        line.setAttribute("x1", String(x1)); line.setAttribute("y1", String(y1))
        line.setAttribute("x2", String(x2)); line.setAttribute("y2", String(y2))
    }
    const thresholdLines = new Map<string, SVGLineElement>()
    for (const layer of manifest.layers) {
        if (layer.kind !== "threshold") continue
        const tg = layer.geometry as ThresholdGeometry
        const line = document.createElementNS(SVG_NS, "line")
        setLine(line, tg, tg.pos)
        const st = layer.style ?? { stroke: "#ff3b30", width: 3 }
        line.setAttribute("stroke", st.stroke); line.setAttribute("stroke-width", String(st.width))
        line.setAttribute("vector-effect", "non-scaling-stroke")
        svg.appendChild(line) // sibling of hiGroup → never hover-cleared
        thresholdLines.set(layer.id, line)
    }

    // --- draggable + resizable ROI boxes (Tier 0) ---
    interface ROIBox { rect: SVGRectElement; handles: SVGRectElement[]; g: { x: number; y: number; w: number; h: number }; handle: number; t: AxisTransform }
    const setROI = (box: ROIBox) => {
        const { x, y, w, h } = box.g
        box.rect.setAttribute("x", String(x)); box.rect.setAttribute("y", String(y))
        box.rect.setAttribute("width", String(w)); box.rect.setAttribute("height", String(h))
        const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
        for (let k = 0; k < 4; k++) {
            box.handles[k].setAttribute("x", String(corners[k][0] - box.handle))
            box.handles[k].setAttribute("y", String(corners[k][1] - box.handle))
            box.handles[k].setAttribute("width", String(2 * box.handle))
            box.handles[k].setAttribute("height", String(2 * box.handle))
        }
    }
    const roiBounds = (box: ROIBox) => {
        const a = invertAxis(box.t, box.g.x, box.g.y), b = invertAxis(box.t, box.g.x + box.g.w, box.g.y + box.g.h)
        const ax = a.x as number, bx = b.x as number, ay = a.y as number, by = b.y as number
        return { xmin: Math.min(ax, bx), xmax: Math.max(ax, bx), ymin: Math.min(ay, by), ymax: Math.max(ay, by) }
    }
    const roiBoxes = new Map<string, ROIBox>()
    for (const layer of manifest.layers) {
        if (layer.kind !== "roi") continue
        const rg = layer.geometry as ROIGeometry
        const st = layer.style ?? { stroke: "#ff3b30", width: 3 }
        const rect = document.createElementNS(SVG_NS, "rect")
        rect.setAttribute("fill", "none"); rect.setAttribute("stroke", st.stroke)
        rect.setAttribute("stroke-width", String(st.width)); rect.setAttribute("vector-effect", "non-scaling-stroke")
        svg.appendChild(rect)
        const handles: SVGRectElement[] = []
        for (let k = 0; k < 4; k++) {
            const hdl = document.createElementNS(SVG_NS, "rect")
            hdl.setAttribute("fill", st.stroke)
            svg.appendChild(hdl); handles.push(hdl)
        }
        const box: ROIBox = { rect, handles, g: { x: rg.x, y: rg.y, w: rg.w, h: rg.h }, handle: rg.handle, t: manifest.transforms[layer.axis] }
        setROI(box)
        roiBoxes.set(layer.id, box)
    }

    type Drag =
        | { kind: "threshold"; id: string; line: SVGLineElement; tg: ThresholdGeometry; t: AxisTransform }
        | { kind: "roi"; id: string; box: ROIBox; mode: { corner: number } | { move: true }; ax: number; ay: number; target?: HitLayer }
    let drag: Drag | null = null
    let justDragged = false
    const clampX = (t: AxisTransform, x: number) => Math.max(t.viewport[0], Math.min(t.viewport[0] + t.viewport[2], x))
    const clampY = (t: AxisTransform, y: number) => Math.max(t.viewport[1], Math.min(t.viewport[1] + t.viewport[3], y))

    const clearHi = () => { while (hiGroup.firstChild) hiGroup.removeChild(hiGroup.firstChild) }
    const clearSel = () => { while (selGroup.firstChild) selGroup.removeChild(selGroup.firstChild) }
    const drawHi = (hit: Hit) => { clearHi(); const el = makeHiElement(hit); if (el) hiGroup.appendChild(el) }
    const drawSelection = (hits: Hit[]) => { clearSel(); for (const h of hits) { const el = makeHiElement(h); if (el) selGroup.appendChild(el) } }

    const showTip = (hit: Hit, x: number, y: number, e: MouseEvent) => {
        const layer = hit.layer
        if (layer.tooltip === false) { tip.style.display = "none"; return }
        let html: string
        if (layer.template) {
            html = renderTemplate(layer.template, resolvePayload(hit, manifest, x, y))
        } else if (hit.grid) {
            html = hit.grid[2] === undefined ? `(${hit.grid[0]},${hit.grid[1]})` : `(${hit.grid[0]},${hit.grid[1]}) = ${esc(hit.grid[2])}`
        } else if (hit.axis) {
            const v = resolvePayload(hit, manifest, x, y) as { x: unknown; y: unknown }
            html = `x=${esc(fmt(v.x))}, y=${esc(fmt(v.y))}`
        } else {
            html = renderAutoTable(hit.layer.payloads[hit.index])
        }
        tip.innerHTML = html
        tip.style.display = "block"
        tip.style.left = `${e.offsetX}px`
        tip.style.top = `${e.offsetY}px`
    }

    const onMove = (e: MouseEvent) => {
        if (drag) return // window-level onDrag owns the pointer mid-drag
        const p = imgPx(e)
        if (hitTest(manifest, p.x, p.y, "drag")) { clearHi(); tip.style.display = "none"; surface.classList.add("grab"); surface.classList.remove("hot"); return }
        surface.classList.remove("grab")
        const hit = hitTest(manifest, p.x, p.y, "hover")
        if (hit) { drawHi(hit); showTip(hit, p.x, p.y, e); surface.classList.add("hot") }
        else { clearHi(); tip.style.display = "none"; surface.classList.remove("hot") }
    }
    const onLeave = () => { clearHi(); tip.style.display = "none" }
    const onDown = (e: MouseEvent) => {
        justDragged = false
        const p = imgPx(e)
        const hit = hitTest(manifest, p.x, p.y, "drag")
        if (!hit) return
        if (hit.layer.kind === "threshold") {
            const line = thresholdLines.get(hit.layer.id)
            if (!line) return
            drag = { kind: "threshold", id: hit.layer.id, line, tg: hit.layer.geometry as ThresholdGeometry, t: manifest.transforms[hit.layer.axis] }
        } else if (hit.layer.kind === "roi" && hit.roiPart) {
            const box = roiBoxes.get(hit.layer.id)
            if (!box) return
            const target = hit.layer.selects ? (manifest.layers.find((l) => l.id === hit.layer.selects) as HitLayer | undefined) : undefined
            if (hit.roiPart.move) {
                drag = { kind: "roi", id: hit.layer.id, box, mode: { move: true }, ax: p.x - box.g.x, ay: p.y - box.g.y, target }
            } else {
                const k = hit.roiPart.corner as number
                const c = [[box.g.x, box.g.y], [box.g.x + box.g.w, box.g.y], [box.g.x + box.g.w, box.g.y + box.g.h], [box.g.x, box.g.y + box.g.h]]
                const opp = c[(k + 2) % 4]
                drag = { kind: "roi", id: hit.layer.id, box, mode: { corner: k }, ax: opp[0], ay: opp[1], target }
            }
        } else return
        surface.classList.add("grabbing")
        e.preventDefault()
    }
    const onDrag = (e: MouseEvent) => {
        if (!drag) return
        const p = imgPx(e)
        if (drag.kind === "threshold") {
            const pos = drag.tg.orientation === "h" ? clampY(drag.t, p.y) : clampX(drag.t, p.x)
            setLine(drag.line, drag.tg, pos)
            const v = invertAxis(drag.t, clampX(drag.t, p.x), clampY(drag.t, p.y))
            tip.textContent = fmt(drag.tg.orientation === "h" ? v.y : v.x)
        } else {
            const box = drag.box, [vx, vy, vw, vh] = box.t.viewport
            if ("move" in drag.mode) {
                box.g.x = Math.max(vx, Math.min(vx + vw - box.g.w, p.x - drag.ax))
                box.g.y = Math.max(vy, Math.min(vy + vh - box.g.h, p.y - drag.ay))
            } else {
                const cx = clampX(box.t, p.x), cy = clampY(box.t, p.y)
                box.g.x = Math.min(drag.ax, cx); box.g.y = Math.min(drag.ay, cy)
                box.g.w = Math.abs(cx - drag.ax); box.g.h = Math.abs(cy - drag.ay)
            }
            setROI(box)
            if (drag.target) {
                const sel = computeSelection(box.g, drag.target, manifest.transforms[drag.target.axis])
                drawSelection(sel.hits)
                tip.textContent = `${sel.items.length} selected`
            } else {
                const b = roiBounds(box)
                tip.textContent = `x:[${fmt(b.xmin)}, ${fmt(b.xmax)}] y:[${fmt(b.ymin)}, ${fmt(b.ymax)}]`
            }
        }
        tip.style.display = "block"; tip.style.left = `${e.offsetX}px`; tip.style.top = `${e.offsetY}px`
    }
    const onUp = (e: MouseEvent) => {
        if (!drag) return
        const p = imgPx(e)
        if (drag.kind === "roi" && drag.target) {
            const sel = computeSelection(drag.box.g, drag.target, manifest.transforms[drag.target.axis])
            drawSelection(sel.hits)
            ;(host as unknown as { value: unknown }).value = { items: sel.items }
        } else if (drag.kind === "threshold") {
            const v = invertAxis(drag.t, clampX(drag.t, p.x), clampY(drag.t, p.y))
            const payload = drag.tg.orientation === "h" ? v.y : v.x
            ;(host as unknown as { value: unknown }).value = { layer: drag.id, index: 0, payload }
        } else {
            ;(host as unknown as { value: unknown }).value = { layer: drag.id, index: 0, payload: roiBounds(drag.box) }
        }
        host.dispatchEvent(new CustomEvent("input"))
        tip.style.display = "none"; surface.classList.remove("grabbing")
        justDragged = true
        drag = null
    }
    const onClick = (e: MouseEvent) => {
        if (justDragged) { justDragged = false; return }
        const p = imgPx(e)
        const hit = hitTest(manifest, p.x, p.y, "click")
        if (!hit) return // miss = no-op, no round-trip
        drawHi(hit)
        ;(host as unknown as { value: unknown }).value = { layer: hit.layer.id, index: hit.index, payload: resolvePayload(hit, manifest, p.x, p.y) }
        host.dispatchEvent(new CustomEvent("input"))
    }

    surface.addEventListener("mousemove", onMove)
    surface.addEventListener("mouseleave", onLeave)
    surface.addEventListener("click", onClick)
    surface.addEventListener("mousedown", onDown)
    window.addEventListener("mousemove", onDrag)
    window.addEventListener("mouseup", onUp)

    // persistent selected-state from the manifest (re-derived each render)
    for (const layer of manifest.layers) {
        for (const idx of layer.selected ?? []) {
            const h = hitLayerByIndex(layer, idx)
            if (h) drawHi({ layer, ...h })
        }
    }

    const cleanup = () => {
        surface.removeEventListener("mousemove", onMove)
        surface.removeEventListener("mouseleave", onLeave)
        surface.removeEventListener("click", onClick)
        surface.removeEventListener("mousedown", onDown)
        window.removeEventListener("mousemove", onDrag)
        window.removeEventListener("mouseup", onUp)
        shadowHost.remove()
    }
    invalidation?.then(cleanup)
    return { cleanup }
}

const fmt = (v: unknown) => (typeof v === "number" ? v.toPrecision(4) : String(v))

// --- highlight element factory (shared by hover drawHi and box-selection selGroup) ---
function makeHiElement(hit: Hit): SVGElement | null {
    if (!hit.geom) return null
    const st = hit.layer.style ?? { stroke: "#ff3b30", width: 3 }
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
    el.setAttribute("fill", "none")
    el.setAttribute("stroke", st.stroke)
    el.setAttribute("stroke-width", String(st.width))
    el.setAttribute("vector-effect", "non-scaling-stroke")
    return el
}

// Bond item shape emitted per contained element in a selects-ROI { items: SelectionItem[] }
type SelectionItem = { layer: string; index: number; payload: unknown }
type SelectionResult = { items: SelectionItem[]; hits: Hit[] }

// [lo,hi] pixel span over an edge array → inclusive cell-index range clamped to the grid, or null if no overlap.
function cellRange(edges: number[], lo: number, hi: number): [number, number] | null {
    const gmin = Math.min(edges[0], edges[edges.length - 1]), gmax = Math.max(edges[0], edges[edges.length - 1])
    const clo = Math.max(lo, gmin), chi = Math.min(hi, gmax)
    if (chi < clo) return null
    const a = findBin(edges, clo), b = findBin(edges, chi)
    if (a < 0 || b < 0) return null
    return [Math.min(a, b), Math.max(a, b)]
}

// Box pixel-rect → contained items + highlight hits, dispatched by target kind.
function computeSelection(
    box: { x: number; y: number; w: number; h: number },
    target: HitLayer,
    t: AxisTransform
): SelectionResult {
    const xlo = box.x, xhi = box.x + box.w, ylo = box.y, yhi = box.y + box.h
    if (target.kind === "circles" && Array.isArray(target.geometry)) {
        const a = target.geometry as number[]
        const items: SelectionItem[] = [], hits: Hit[] = []
        for (let k = 0; k < Math.floor(a.length / 3); k++) {
            const cx = a[3 * k], cy = a[3 * k + 1]
            if (cx >= xlo && cx <= xhi && cy >= ylo && cy <= yhi) {
                items.push({ layer: target.id, index: k, payload: target.payloads[k] })
                hits.push({ layer: target, index: k, geom: ["circle", cx, cy, a[3 * k + 2]] })
            }
        }
        return { items, hits }
    }
    if (target.kind === "grid") {
        const gg = target.geometry as GridGeometry
        const ci = cellRange(gg.xedges, xlo, xhi), cj = cellRange(gg.yedges, ylo, yhi)
        if (!ci || !cj) return { items: [], hits: [] }
        const [i0, i1] = ci, [j0, j1] = cj
        const a = invertAxis(t, xlo, ylo), b = invertAxis(t, xhi, yhi)
        const ax = a.x as number, bx = b.x as number, ay = a.y as number, by = b.y as number
        const payload = {
            i0, i1, j0, j1,
            xmin: Math.min(ax, bx), xmax: Math.max(ax, bx),
            ymin: Math.min(ay, by), ymax: Math.max(ay, by),
        }
        const rx0 = gg.xedges[i0], rx1 = gg.xedges[i1 + 1], ry0 = gg.yedges[j0], ry1 = gg.yedges[j1 + 1]
        const hits: Hit[] = [{ layer: target, index: 0,
            geom: ["rect", (rx0 + rx1) / 2, (ry0 + ry1) / 2, Math.abs(rx1 - rx0), Math.abs(ry1 - ry0)] }]
        return { items: [{ layer: target.id, index: 0, payload }], hits }
    }
    return { items: [], hits: [] } // unsupported target kind
}

// resolve a layer element by index to a highlight geom (for pre-selected drawing)
function hitLayerByIndex(layer: import("./types").HitLayer, index: number): Omit<Hit, "layer"> | null {
    const g = layer.geometry
    if (layer.kind === "circles" && Array.isArray(g)) {
        const a = g as number[]
        return { index, geom: ["circle", a[3 * index], a[3 * index + 1], a[3 * index + 2]] }
    }
    if (layer.kind === "rects" && Array.isArray(g)) {
        const a = g as number[]
        return { index, geom: ["rect", a[4 * index], a[4 * index + 1], a[4 * index + 2], a[4 * index + 3]] }
    }
    if (layer.kind === "polygons" && Array.isArray(g)) {
        return { index, geom: ["poly", (g as number[][])[index]] }
    }
    return null
}
