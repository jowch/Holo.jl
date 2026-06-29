// DOM layer: builds a shadow-root overlay over the (light-DOM) base image, wires hover/click,
// draws highlights, and round-trips clicks through the @bind element. Stateless across re-render.
import { hitTest, invertAxis, resolvePayload } from "./geometry"
import type { AxisTransform, Hit, Manifest, ThresholdGeometry } from "./types"

const SVG_NS = "http://www.w3.org/2000/svg"

const STYLE = `
:host { position: absolute; inset: 0; }
.surface { position: absolute; inset: 0; cursor: crosshair; }
.surface.hot { cursor: pointer; }
.surface.grab { cursor: grab; }
.surface.grabbing { cursor: grabbing; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.tip { position: absolute; display: none; padding: 2px 6px; font: 12px sans-serif;
       background: #111; color: #fff; border-radius: 4px; pointer-events: none;
       transform: translate(8px, 8px); white-space: nowrap; z-index: 10; }
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
    const hiGroup = document.createElementNS(SVG_NS, "g") // transient hover/selected highlights
    svg.appendChild(hiGroup)
    const surface = document.createElement("div")
    surface.className = "surface"
    const tip = document.createElement("div")
    tip.className = "tip"
    shadow.append(style, svg, surface, tip)
    host.appendChild(shadowHost)

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

    interface Drag { id: string; line: SVGLineElement; tg: ThresholdGeometry; t: AxisTransform }
    let drag: Drag | null = null
    const clampX = (t: AxisTransform, x: number) => Math.max(t.viewport[0], Math.min(t.viewport[0] + t.viewport[2], x))
    const clampY = (t: AxisTransform, y: number) => Math.max(t.viewport[1], Math.min(t.viewport[1] + t.viewport[3], y))

    const clearHi = () => { while (hiGroup.firstChild) hiGroup.removeChild(hiGroup.firstChild) }

    const drawHi = (hit: Hit) => {
        clearHi()
        if (!hit.geom) return
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
        if (!el) return
        el.setAttribute("fill", "none")
        el.setAttribute("stroke", st.stroke)
        el.setAttribute("stroke-width", String(st.width))
        el.setAttribute("vector-effect", "non-scaling-stroke")
        hiGroup.appendChild(el)
    }

    const showTip = (hit: Hit, x: number, y: number, e: MouseEvent) => {
        let txt = hit.layer.tooltips?.[hit.index] ?? null
        if (txt == null) {
            if (hit.grid) txt = `(${hit.grid[0]},${hit.grid[1]}) = ${hit.grid[2]}`
            else if (hit.axis) {
                const v = resolvePayload(hit, manifest, x, y) as { x: unknown; y: unknown }
                txt = `x=${fmt(v.x)}, y=${fmt(v.y)}`
            } else {
                const pl = hit.layer.payloads[hit.index]
                txt = pl && typeof pl === "object" ? JSON.stringify(pl) : String(pl)
            }
        }
        tip.textContent = txt
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
        const p = imgPx(e)
        const hit = hitTest(manifest, p.x, p.y, "drag")
        if (!hit || hit.layer.kind !== "threshold") return
        const line = thresholdLines.get(hit.layer.id)
        if (!line) return
        drag = { id: hit.layer.id, line, tg: hit.layer.geometry as ThresholdGeometry, t: manifest.transforms[hit.layer.axis] }
        surface.classList.add("grabbing")
        e.preventDefault()
    }
    const onDrag = (e: MouseEvent) => {
        if (!drag) return
        const p = imgPx(e)
        const pos = drag.tg.orientation === "h" ? clampY(drag.t, p.y) : clampX(drag.t, p.x)
        setLine(drag.line, drag.tg, pos)
        const v = invertAxis(drag.t, clampX(drag.t, p.x), clampY(drag.t, p.y))
        tip.textContent = fmt(drag.tg.orientation === "h" ? v.y : v.x)
        tip.style.display = "block"; tip.style.left = `${e.offsetX}px`; tip.style.top = `${e.offsetY}px`
    }
    const onUp = (e: MouseEvent) => {
        if (!drag) return
        const p = imgPx(e)
        const v = invertAxis(drag.t, clampX(drag.t, p.x), clampY(drag.t, p.y))
        ;(host as unknown as { value: unknown }).value = { layer: drag.id, index: 0, payload: drag.tg.orientation === "h" ? v.y : v.x }
        host.dispatchEvent(new CustomEvent("input"))
        tip.style.display = "none"; surface.classList.remove("grabbing")
        drag = null
    }
    const onClick = (e: MouseEvent) => {
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
