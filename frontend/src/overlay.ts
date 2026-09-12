// DOM layer: builds a shadow-root overlay over the (light-DOM) base image, wires hover/click,
// draws highlights, and round-trips clicks through the @bind element. Stateless across re-render.
import { hitTest, invertAxis, resolvePayload, findBin, panLimits, orbitAngles } from "./geometry"
import { renderTemplate, renderAutoTable, esc } from "./template"
import type { AxisTransform, Hit, HitLayer, Manifest, ThresholdGeometry, ROIGeometry, GridGeometry, ViewGeometry } from "./types"

const SVG_NS = "http://www.w3.org/2000/svg"

// Inspector ink — locked first-polish default (visual-design.md). Not a theming API.
const INSPECTOR_INK = "#3A6F7C"
const DEFAULT_STYLE = { stroke: INSPECTOR_INK, width: 2 }
const TIP_GAP = 8
const TIP_OFFSET = 10
const MOTION_MS = 100 // 80–120 ms window; prefers-reduced-motion disables below

const STYLE = `
:host { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.surface { position: absolute; inset: 0; cursor: crosshair; pointer-events: auto; }
.surface.hot { cursor: pointer; }
.surface.grab { cursor: grab; }
.surface.grabbing { cursor: grabbing; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.holo-enter { animation: holo-in ${MOTION_MS}ms ease-out; }
.holo-leave { animation: holo-out ${MOTION_MS}ms ease-in forwards; }
@keyframes holo-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes holo-out { from { opacity: 1 } to { opacity: 0 } }
.holo-tip { position: absolute; opacity: 0; pointer-events: none; z-index: 10;
       padding: var(--holo-tip-padding, 8px 12px); border-radius: var(--holo-tip-radius, 4px);
       background: var(--holo-tip-bg, #ffffff); color: var(--holo-tip-color, #1a1a1a);
       border: 1px solid var(--holo-tip-border, rgba(0,0,0,0.1));
       box-shadow: var(--holo-tip-shadow, 0 2px 4px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08));
       font: var(--holo-tip-font-size, 11px)/1.4 var(--holo-tip-font, system-ui, -apple-system, sans-serif);
       max-width: var(--holo-tip-maxwidth, 320px); white-space: normal;
       transition: opacity ${MOTION_MS}ms ease-out; }
.holo-tip.show { opacity: 1; }
.holo-tip::before { content: ""; position: absolute; top: -5px; left: 8px;
       border: 5px solid transparent; border-top: none; border-bottom-color: var(--holo-tip-bg, #ffffff);
       display: var(--holo-tip-caret, block); }
.holo-tip.flip-y::before { top: auto; bottom: -5px; border-bottom: none;
       border-top: 5px solid var(--holo-tip-bg, #ffffff); }
.holo-tip.flip-x::before { left: auto; right: 8px; }
.holo-tip-row { display: flex; gap: 8px; justify-content: space-between; }
.holo-tip-key { color: var(--holo-tip-accent, #6b7280); }
.holo-tip-val { font-variant-numeric: tabular-nums; }
@media (prefers-color-scheme: dark) {
  .holo-tip { background: var(--holo-tip-bg, #1e1e1e); color: var(--holo-tip-color, #e8e8e8);
       border-color: var(--holo-tip-border, rgba(255,255,255,0.15));
       box-shadow: var(--holo-tip-shadow, 0 2px 4px rgba(0,0,0,0.4), 0 8px 16px rgba(0,0,0,0.3)); }
  .holo-tip::before { border-bottom-color: var(--holo-tip-bg, #1e1e1e); }
  .holo-tip.flip-y::before { border-top-color: var(--holo-tip-bg, #1e1e1e); }
}
@media (prefers-reduced-motion: reduce) {
  .holo-enter, .holo-leave { animation: none; }
  .holo-tip { transition: none; }
}
`

interface Mounted {
    cleanup: () => void
}

/**
 * Mount the interaction overlay.
 * @param scriptEl  the cell's <script> (its parent is the light-DOM host containing the <img>/<canvas> base)
 * @param manifest  hit-region manifest (from published_to_js or inlined JSON)
 * @param invalidation  Pluto's cleanup promise (resolves on cell re-render)
 */
export function mount(scriptEl: HTMLElement, manifest: Manifest, invalidation?: Promise<unknown>): Mounted {
    const host = scriptEl.parentElement as HTMLElement | null
    // Base-agnostic: an <img> (CairoBackend PNG) or a <canvas> (WebGLBackend). We only need its
    // on-screen rect; the image-px scale comes from manifest.width (design.md §6), not the
    // element's intrinsic size — so a <canvas> needs no sizer shim. Invariant: the host holds
    // exactly one base element (Cairo emits one <img>, WGL one <canvas>); if both were ever
    // present, document order would pick the first.
    const base = host?.querySelector("img, canvas") as HTMLElement | null
    const noop: Mounted = { cleanup: () => {} }
    if (!host || !base) return noop

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

    // Pin the overlay to the BASE (img/canvas), not the host. WGLMakie can size the
    // <canvas> differently from `.ip-host` (DPR / setup_scene_init), which left g.sel
    // sitting beside the marker when the SVG was `inset:0` on the host.
    const syncOverlayToBase = () => {
        const hr = host.getBoundingClientRect()
        const br = base.getBoundingClientRect()
        if (!(br.width > 0 && br.height > 0)) return
        shadowHost.style.left = `${br.left - hr.left}px`
        shadowHost.style.top = `${br.top - hr.top}px`
        shadowHost.style.width = `${br.width}px`
        shadowHost.style.height = `${br.height}px`
    }
    syncOverlayToBase()
    const overlayRO = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncOverlayToBase) : null
    overlayRO?.observe(host)
    overlayRO?.observe(base)
    window.addEventListener("resize", syncOverlayToBase)
    let overlayFrames = 0
    const overlayTick = () => {
        syncOverlayToBase()
        if (++overlayFrames < 24) requestAnimationFrame(overlayTick)
    }
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(overlayTick)

    const imgPx = (e: MouseEvent) => {
        const r = base.getBoundingClientRect()
        const s = manifest.width / r.width // image-px per CSS-px (manifest renderWidth ÷ live rect; never the base's intrinsic size)
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
        const st = layer.style ?? DEFAULT_STYLE
        line.setAttribute("stroke", st.stroke); line.setAttribute("stroke-width", String(st.width))
        line.setAttribute("vector-effect", "non-scaling-stroke")
        svg.appendChild(line) // sibling of hiGroup → never hover-cleared
        thresholdLines.set(layer.id, line)
    }

    // --- draggable + resizable ROI boxes (Tier 0) ---
    interface ROIBox { rect: SVGRectElement; handles: SVGRectElement[]; g: { x: number; y: number; w: number; h: number }; handle: number; t: AxisTransform; target?: HitLayer }
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
        const st = layer.style ?? DEFAULT_STYLE
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
        // Alias box.g to the manifest ROIGeometry so that drag mutations (box.g.x = …) are
        // immediately visible to hitLayer, which reads layer.geometry directly. Without this
        // alias, hit-testing uses stale original bounds after the box is moved or resized.
        // The manifest is rebuilt fresh on every Pluto re-render, so this mutation is scoped
        // to the current mount session — exactly the "box stays where you left it" behavior.
        // Resolve a selects-ROI's target layer once at build time (mirrors the cached `t`),
        // rather than on every mousedown. undefined when this ROI has no `selects` (bounds-only).
        const target = layer.selects ? (manifest.layers.find((l) => l.id === layer.selects) as HitLayer | undefined) : undefined
        const box: ROIBox = { rect, handles, g: rg, handle: rg.handle, t: manifest.transforms[layer.axis], target }
        setROI(box)
        roiBoxes.set(layer.id, box)
    }

    type Drag =
        | { kind: "threshold"; id: string; line: SVGLineElement; tg: ThresholdGeometry; t: AxisTransform }
        | { kind: "roi"; id: string; box: ROIBox; mode: { corner: number } | { move: true }; ax: number; ay: number; target?: HitLayer }
        | { kind: "view"; id: string; g: ViewGeometry; t: AxisTransform; x0: number; y0: number }
    let drag: Drag | null = null
    let justDragged = false
    const VIEW_MIN_PX = 3 // image-px; ignore accidental micro-drags
    const clampX = (t: AxisTransform, x: number) => Math.max(t.viewport[0], Math.min(t.viewport[0] + t.viewport[2], x))
    const clampY = (t: AxisTransform, y: number) => Math.max(t.viewport[1], Math.min(t.viewport[1] + t.viewport[3], y))

    const startViewDrag = (layer: HitLayer, p: { x: number; y: number }) => {
        drag = {
            kind: "view", id: layer.id, g: layer.geometry as ViewGeometry,
            t: manifest.transforms[layer.axis], x0: p.x, y0: p.y,
        }
    }
    const viewTip = (d: Extract<Drag, { kind: "view" }>, p: { x: number; y: number }) => {
        if (d.g.mode === "orbit") {
            const o = orbitAngles(d.g, d.x0, d.y0, p.x, p.y)
            return `az=${fmt(o.azimuth)} el=${fmt(o.elevation)}`
        }
        const lim = panLimits(d.t, d.x0, d.y0, p.x, p.y)
        return `x:[${fmt(lim.xmin)}, ${fmt(lim.xmax)}] y:[${fmt(lim.ymin)}, ${fmt(lim.ymax)}]`
    }

    const hitKey = (h: Hit) => `${h.layer.id}:${h.index}`
    const prefersReducedMotion = () =>
        typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
    let hiKey: string | null = null
    let selKeys = new Set<string>()
    let hiLeaveTimer: ReturnType<typeof setTimeout> | null = null
    let tipFlipTimer: ReturnType<typeof setTimeout> | null = null

    const clearHiImmediate = () => {
        if (hiLeaveTimer != null) { clearTimeout(hiLeaveTimer); hiLeaveTimer = null }
        hiKey = null
        while (hiGroup.firstChild) hiGroup.removeChild(hiGroup.firstChild)
    }
    // Fade-out is hover-only (leave / miss). selects-ROI remounts g.sel every drag
    // frame — a leave class there would wash the box-select on every pointer tick.
    const clearHi = (fade = false) => {
        if (!fade || !hiGroup.firstChild || prefersReducedMotion()) {
            clearHiImmediate()
            return
        }
        hiKey = null
        for (const el of [...hiGroup.children]) {
            el.classList.remove("holo-enter")
            el.classList.add("holo-leave")
        }
        if (hiLeaveTimer != null) clearTimeout(hiLeaveTimer)
        hiLeaveTimer = setTimeout(() => {
            hiLeaveTimer = null
            while (hiGroup.firstChild) hiGroup.removeChild(hiGroup.firstChild)
        }, MOTION_MS)
    }
    const clearSel = () => { while (selGroup.firstChild) selGroup.removeChild(selGroup.firstChild) }
    const drawHi = (hit: Hit) => {
        const key = hitKey(hit)
        const cur = hiGroup.firstElementChild
        if (key === hiKey && cur && !cur.classList.contains("holo-leave")) return
        clearHiImmediate()
        const el = makeHiElement(hit, "hover")
        if (!el) return
        el.classList.add("holo-enter")
        hiGroup.appendChild(el)
        hiKey = key
    }
    const drawSelection = (hits: Hit[]) => {
        const next = new Set(hits.map(hitKey))
        const entering = new Set<string>()
        for (const k of next) if (!selKeys.has(k)) entering.add(k)
        clearSel()
        for (const h of hits) {
            const el = makeHiElement(h, "selected")
            if (!el) continue
            if (entering.has(hitKey(h))) el.classList.add("holo-enter")
            selGroup.appendChild(el)
        }
        selKeys = next
    }

    const hideTip = () => {
        tip.classList.remove("show")
        if (tipFlipTimer != null) clearTimeout(tipFlipTimer)
        const delay = prefersReducedMotion() ? 0 : MOTION_MS
        tipFlipTimer = setTimeout(() => {
            tipFlipTimer = null
            if (!tip.classList.contains("show")) tip.classList.remove("flip-x", "flip-y")
        }, delay)
    }
    const tipOffset = (e: MouseEvent) => {
        const r = surface.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) return { x: e.clientX - r.left, y: e.clientY - r.top }
        return { x: e.offsetX || e.clientX, y: e.offsetY || e.clientY }
    }
    const placeTip = (ox: number, oy: number) => {
        const tw = tip.offsetWidth, th = tip.offsetHeight
        const hw = surface.clientWidth, hh = surface.clientHeight
        tip.classList.remove("flip-x", "flip-y")
        if (tw <= 0 || th <= 0 || hw <= 0 || hh <= 0) {
            tip.style.left = `${ox + TIP_OFFSET}px`
            tip.style.top = `${oy + TIP_OFFSET}px`
            return
        }
        let left = ox + TIP_OFFSET, top = oy + TIP_OFFSET
        const flipX = left + tw > hw - TIP_GAP
        const flipY = top + th > hh - TIP_GAP
        if (flipX) { left = ox - tw - TIP_OFFSET; tip.classList.add("flip-x") }
        if (flipY) { top = oy - th - TIP_OFFSET; tip.classList.add("flip-y") }
        tip.style.left = `${Math.max(TIP_GAP, Math.min(left, hw - tw - TIP_GAP))}px`
        tip.style.top = `${Math.max(TIP_GAP, Math.min(top, hh - th - TIP_GAP))}px`
    }

    const showTip = (hit: Hit, x: number, y: number, e: MouseEvent) => {
        const layer = hit.layer
        if (layer.tooltip === false) { hideTip(); return }
        let html: string
        if (layer.template) {
            html = renderTemplate(layer.template, resolvePayload(hit, manifest, x, y))
        } else if (hit.grid) {
            html = hit.grid[2] === undefined ? `(${hit.grid[0]},${hit.grid[1]})` : `(${hit.grid[0]},${hit.grid[1]}) = ${esc(hit.grid[2])}`
        } else if (hit.axis) {
            const v = resolvePayload(hit, manifest, x, y) as { x?: unknown; y?: unknown; value?: unknown }
            html = "value" in v ? esc(fmt(v.value)) : `x=${esc(fmt(v.x))}, y=${esc(fmt(v.y))}`
        } else {
            html = renderAutoTable(hit.layer.payloads[hit.index])
        }
        tip.innerHTML = html
        tip.classList.add("show")
        const p = tipOffset(e)
        placeTip(p.x, p.y)
    }

    const onMove = (e: MouseEvent) => {
        if (drag) return // window-level onDrag owns the pointer mid-drag
        const p = imgPx(e)
        const dragHit = hitTest(manifest, p.x, p.y, "drag")
        // Full-viewport :view must not suppress element hover — only sparse Tier-0
        // drag targets (threshold / ROI) take the grab early-return.
        if (dragHit && dragHit.layer.kind !== "view") {
            clearHi(true); hideTip()
            surface.classList.add("grab"); surface.classList.remove("hot")
            return
        }
        surface.classList.remove("grab")
        const hit = hitTest(manifest, p.x, p.y, "hover")
        if (hit) {
            drawHi(hit); showTip(hit, p.x, p.y, e); surface.classList.add("hot")
        } else {
            clearHi(true); hideTip(); surface.classList.remove("hot")
            if (dragHit?.layer.kind === "view") surface.classList.add("grab")
        }
    }
    const onLeave = () => { clearHi(true); hideTip() }
    const onDown = (e: MouseEvent) => {
        justDragged = false
        const p = imgPx(e)
        // Shift+drag forces view (arbitration vs box-select / ROI / threshold).
        if (e.shiftKey) {
            const viewLayer = manifest.layers.find((l) => {
                if (l.kind !== "view" || !l.events.includes("drag")) return false
                return hitTest({ ...manifest, layers: [l] }, p.x, p.y, "drag") !== null
            })
            if (viewLayer) {
                startViewDrag(viewLayer, p)
                surface.classList.add("grabbing")
                e.preventDefault()
                return
            }
        }
        const hit = hitTest(manifest, p.x, p.y, "drag")
        if (!hit) return
        if (hit.layer.kind === "threshold") {
            const line = thresholdLines.get(hit.layer.id)
            if (!line) return
            drag = { kind: "threshold", id: hit.layer.id, line, tg: hit.layer.geometry as ThresholdGeometry, t: manifest.transforms[hit.layer.axis] }
        } else if (hit.layer.kind === "roi" && hit.roiPart) {
            const box = roiBoxes.get(hit.layer.id)
            if (!box) return
            const target = box.target   // resolved once when roiBoxes was built
            if (hit.roiPart.move) {
                drag = { kind: "roi", id: hit.layer.id, box, mode: { move: true }, ax: p.x - box.g.x, ay: p.y - box.g.y, target }
            } else {
                const k = hit.roiPart.corner as number
                const c = [[box.g.x, box.g.y], [box.g.x + box.g.w, box.g.y], [box.g.x + box.g.w, box.g.y + box.g.h], [box.g.x, box.g.y + box.g.h]]
                const opp = c[(k + 2) % 4]
                drag = { kind: "roi", id: hit.layer.id, box, mode: { corner: k }, ax: opp[0], ay: opp[1], target }
            }
        } else if (hit.layer.kind === "view") {
            startViewDrag(hit.layer, p)
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
        } else if (drag.kind === "view") {
            tip.textContent = viewTip(drag, p)
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
        tip.classList.add("show")
        const tp = tipOffset(e)
        placeTip(tp.x, tp.y)
    }
    const onUp = (e: MouseEvent) => {
        if (!drag) return
        const p = imgPx(e)
        if (drag.kind === "roi" && drag.target) {
            const sel = computeSelection(drag.box.g, drag.target, manifest.transforms[drag.target.axis])
            drawSelection(sel.hits)
            ;(host as unknown as { value: unknown }).value = { items: sel.items }
            host.dispatchEvent(new CustomEvent("input"))
        } else if (drag.kind === "threshold") {
            const v = invertAxis(drag.t, clampX(drag.t, p.x), clampY(drag.t, p.y))
            const payload = drag.tg.orientation === "h" ? v.y : v.x
            ;(host as unknown as { value: unknown }).value = { layer: drag.id, index: 0, payload }
            host.dispatchEvent(new CustomEvent("input"))
        } else if (drag.kind === "view") {
            const dist = Math.hypot(p.x - drag.x0, p.y - drag.y0)
            if (dist >= VIEW_MIN_PX) {
                const payload = drag.g.mode === "orbit"
                    ? orbitAngles(drag.g, drag.x0, drag.y0, p.x, p.y)
                    : panLimits(drag.t, drag.x0, drag.y0, p.x, p.y)
                ;(host as unknown as { value: unknown }).value = { layer: drag.id, index: 0, payload }
                host.dispatchEvent(new CustomEvent("input"))
            }
        } else {
            ;(host as unknown as { value: unknown }).value = { layer: drag.id, index: 0, payload: roiBounds(drag.box) }
            host.dispatchEvent(new CustomEvent("input"))
        }
        hideTip(); surface.classList.remove("grabbing")
        // :view micro-drags (below VIEW_MIN_PX) intentionally skip commit — don't swallow
        // the synthesized click that follows, so co-mounted click layers still fire.
        if (drag.kind === "view") {
            const dist = Math.hypot(p.x - drag.x0, p.y - drag.y0)
            justDragged = dist >= VIEW_MIN_PX
        } else {
            justDragged = true
        }
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

    // persistent selected-state from the manifest (re-derived each render) — drawn into the
    // PERSISTENT selection group (g.sel, z-below hover), NOT the transient hover group: it
    // must survive hovers (onMove clears g.hi on every miss) and support multiple selected
    // indices (drawHi keeps only the last). Pre-#38 this used drawHi — an M1.2 leftover from
    // before box-select introduced the persistent group.
    {
        const pre: Hit[] = []
        for (const layer of manifest.layers) {
            for (const idx of layer.selected ?? []) {
                pre.push({ layer, ...hitLayerByIndex(layer, idx) })
            }
        }
        if (pre.length) drawSelection(pre)
    }

    const cleanup = () => {
        surface.removeEventListener("mousemove", onMove)
        surface.removeEventListener("mouseleave", onLeave)
        surface.removeEventListener("click", onClick)
        surface.removeEventListener("mousedown", onDown)
        window.removeEventListener("mousemove", onDrag)
        window.removeEventListener("mouseup", onUp)
        window.removeEventListener("resize", syncOverlayToBase)
        overlayRO?.disconnect()
        overlayFrames = 24
        if (hiLeaveTimer != null) clearTimeout(hiLeaveTimer)
        if (tipFlipTimer != null) clearTimeout(tipFlipTimer)
        shadowHost.remove()
    }
    invalidation?.then(cleanup)
    return { cleanup }
}

const fmt = (v: unknown) => (typeof v === "number" ? v.toPrecision(4) : String(v))

// --- highlight element factory (shared by hover drawHi and box-selection selGroup) ---
type HiMode = "hover" | "selected"

function colorWithAlpha(stroke: string, a: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(stroke.trim())
    if (!m) return `color-mix(in srgb, ${stroke} ${Math.round(a * 100)}%, transparent)`
    const n = parseInt(m[1], 16)
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function makeRing(shape: SVGElement, stroke: string): SVGGElement {
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

function makeHiElement(hit: Hit, mode: HiMode = "hover"): SVGElement | null {
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
        // Note: i0..j1 are the covered CELL indices (clamped to the grid by cellRange), while
        // xmin..ymax are the data-space bounds of the raw drawn BOX (unclamped). For a box that
        // overhangs the grid these describe different extents — consumers slicing the array use the
        // cell indices; the box bounds are where the user dragged.
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

// Kinds that can be drawn as a persistent pre-highlight (mirrors Julia `_SELECTED_KINDS`).
// Open kinds (segments / polyline) use the selected-ring recipe; closed kinds use the wash.
const SELECTED_KINDS = new Set(["circles", "rects", "polygons", "segments", "polyline"])

function layerNElements(layer: import("./types").HitLayer): number {
    const g = layer.geometry
    if (layer.kind === "circles" && Array.isArray(g)) return Math.floor((g as number[]).length / 3)
    if (layer.kind === "rects" && Array.isArray(g)) return Math.floor((g as number[]).length / 4)
    if (layer.kind === "polygons" && Array.isArray(g)) return (g as number[][]).length
    if (layer.kind === "segments" && Array.isArray(g)) return Math.floor((g as number[]).length / 4)
    if (layer.kind === "polyline" && Array.isArray(g)) return Math.max(0, Math.floor((g as number[]).length / 2) - 1)
    if (layer.kind === "grid" && g && typeof g === "object" && "ncols" in (g as object)) {
        const gg = g as import("./types").GridGeometry
        return gg.ncols * gg.nrows
    }
    return 0
}

// Resolve a layer element by index to a highlight geom (for pre-selected drawing).
// Fail loud on unsupported kinds / OOB indices — Julia `build_manifest` validates the same;
// this is the defense-in-depth path when a hand-built / stale manifest reaches mount.
function hitLayerByIndex(layer: import("./types").HitLayer, index: number): Omit<Hit, "layer"> {
    if (!SELECTED_KINDS.has(layer.kind)) {
        throw new Error(
            `selected: layer ${layer.id} has kind ${layer.kind}, which does not support pre-highlight ` +
                `(supported: circles, rects, polygons, segments, polyline)`,
        )
    }
    const n = layerNElements(layer)
    if (index < 0 || index >= n) {
        throw new Error(
            `selected: layer ${layer.id} index ${index} out of range for ${n} elements` +
                (n > 0 ? ` (valid: 0:${n - 1})` : ""),
        )
    }
    const g = layer.geometry
    if (layer.kind === "circles" && Array.isArray(g)) {
        const a = g as number[]
        return { index, geom: ["circle", a[3 * index], a[3 * index + 1], a[3 * index + 2]] }
    }
    if (layer.kind === "rects" && Array.isArray(g)) {
        const a = g as number[]
        return { index, geom: ["rect", a[4 * index], a[4 * index + 1], a[4 * index + 2], a[4 * index + 3]] }
    }
    if (layer.kind === "segments" && Array.isArray(g)) {
        const a = g as number[]
        return { index, geom: ["seg", a[4 * index], a[4 * index + 1], a[4 * index + 2], a[4 * index + 3]] }
    }
    if (layer.kind === "polyline" && Array.isArray(g)) {
        const a = g as number[]
        return { index, geom: ["seg", a[2 * index], a[2 * index + 1], a[2 * index + 2], a[2 * index + 3]] }
    }
    // polygons (only remaining closed SELECTED_KINDS entry)
    return { index, geom: ["poly", (g as number[][])[index]] }
}
