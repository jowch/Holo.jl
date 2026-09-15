import { hitTest, invertAxis, resolvePayload, panLimits, orbitAngles } from "./geometry"
import { renderTemplate, renderAutoTable, esc } from "./template"
import { SVG_NS, DEFAULT_STYLE, makeHiElement } from "./highlight"
import { computeSelection, hitLayerByIndex } from "./selection"
import type { AxisTransform, Hit, HitLayer, Manifest, ThresholdGeometry, ROIGeometry, ViewGeometry } from "./types"

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
    // Image-px scale comes from manifest.width, not the element's intrinsic size, so a
    // <canvas> needs no sizer shim. The host is assumed to hold exactly one base element.
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
    // touch-action: block native scroll/pinch on the surface ONLY when this manifest has a drag
    // interaction (threshold / ROI / view) — a hover/click-only plot (e.g. a plain scatter) must
    // not hijack page scrolling when a finger lands on it. This has to be decided up front, not
    // toggled per-pointerdown: UAs resolve touch-action at the touch's first contact, so setting
    // it later has no effect on the gesture already in flight.
    if (manifest.layers.some((l) => l.events.includes("drag"))) surface.style.touchAction = "none"
    const tip = document.createElement("div")
    tip.className = "holo-tip"
    tip.setAttribute("role", "tooltip")
    tip.setAttribute("aria-hidden", "true")
    shadow.append(style, svg, surface, tip)
    host.appendChild(shadowHost)
    if (manifest.tipStyle) for (const [k, v] of Object.entries(manifest.tipStyle)) shadowHost.style.setProperty(k, v)

    let tipHtml = ""
    let tipW = 0, tipH = 0, tipSized = false
    let surfaceW = 0, surfaceH = 0, surfaceSized = false
    let pendingMove: MouseEvent | null = null
    let moveRaf = 0
    let pendingDrag: PointerEvent | null = null
    let dragRaf = 0

    // Pinned to the base (img/canvas), not the host: WGLMakie can size the <canvas>
    // differently from `.ip-host`, which left g.sel offset when the SVG was `inset:0` on the host.
    const syncOverlayToBase = () => {
        const hr = host.getBoundingClientRect()
        const br = base.getBoundingClientRect()
        if (!(br.width > 0 && br.height > 0)) return
        shadowHost.style.left = `${br.left - hr.left}px`
        shadowHost.style.top = `${br.top - hr.top}px`
        shadowHost.style.width = `${br.width}px`
        shadowHost.style.height = `${br.height}px`
        surfaceSized = false
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
        // box.g aliases the manifest ROIGeometry so drag mutations stay visible to hitLayer,
        // which reads layer.geometry directly. `target` is resolved once here, not per mousedown;
        // undefined when this ROI has no `selects` (bounds-only).
        const target = layer.selects ? (manifest.layers.find((l) => l.id === layer.selects) as HitLayer | undefined) : undefined
        const box: ROIBox = { rect, handles, g: rg, handle: rg.handle, t: manifest.transforms[layer.axis], target }
        setROI(box)
        roiBoxes.set(layer.id, box)
    }

    // Every variant carries the pointerId that started it — onPointerMove/onUp/onCancel gate on
    // this so a second concurrent pointer (e.g. two-finger touch, now let through by
    // touch-action:none) can move/release/cancel without hijacking an in-flight drag it didn't
    // start. onDown's `if (drag) return` only stops a second pointerDOWN; without this field the
    // second pointer's move/up/cancel still routed into the first pointer's drag.
    type Drag =
        | { kind: "threshold"; id: string; line: SVGLineElement; tg: ThresholdGeometry; t: AxisTransform; pointerId: number }
        | { kind: "roi"; id: string; box: ROIBox; mode: { corner: number } | { move: true }; ax: number; ay: number; target?: HitLayer; pointerId: number }
        | { kind: "view"; id: string; g: ViewGeometry; t: AxisTransform; x0: number; y0: number; pointerId: number }
    let drag: Drag | null = null
    let justDragged = false
    const VIEW_MIN_PX = 3 // image-px; ignore accidental micro-drags
    const clampX = (t: AxisTransform, x: number) => Math.max(t.viewport[0], Math.min(t.viewport[0] + t.viewport[2], x))
    const clampY = (t: AxisTransform, y: number) => Math.max(t.viewport[1], Math.min(t.viewport[1] + t.viewport[3], y))

    const startViewDrag = (layer: HitLayer, p: { x: number; y: number }, pointerId: number) => {
        drag = {
            kind: "view", id: layer.id, g: layer.geometry as ViewGeometry,
            t: manifest.transforms[layer.axis], x0: p.x, y0: p.y, pointerId,
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

    // role="tooltip" is static markup (set at creation); aria-hidden tracks the same visibility
    // the "show" class drives, so assistive tech's view matches the sighted one. No keyboard path
    // in this PR — the tooltip is exposed to AT only via the existing pointer-driven hover/drag.
    const setTipVisible = (visible: boolean) => {
        tip.classList.toggle("show", visible)
        tip.setAttribute("aria-hidden", visible ? "false" : "true")
    }

    const hideTip = () => {
        setTipVisible(false)
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
        if (!tipSized) {
            tipW = tip.offsetWidth; tipH = tip.offsetHeight
            tipSized = tipW > 0 && tipH > 0
        }
        if (!surfaceSized) {
            surfaceW = surface.clientWidth; surfaceH = surface.clientHeight
            surfaceSized = surfaceW > 0 && surfaceH > 0
        }
        const tw = tipW, th = tipH, hw = surfaceW, hh = surfaceH
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
        if (html !== tipHtml) {
            tip.innerHTML = html
            tipHtml = html
            tipSized = false
        }
        setTipVisible(true)
        const p = tipOffset(e)
        placeTip(p.x, p.y)
    }

    const setTipText = (s: string) => {
        if (s === tipHtml) return
        tip.textContent = s
        tipHtml = s
        tipSized = false
    }

    const applyMove = (e: MouseEvent) => {
        // onPointerMove routes drag-active moves to queueDrag instead — this is only ever
        // reached with drag === null, but keep the guard as defense-in-depth.
        if (drag) return
        const p = imgPx(e)
        const dragHit = hitTest(manifest, p.x, p.y, "drag")
        // A full-viewport :view hit must not suppress element hover.
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
    const onMove = (e: MouseEvent) => {
        if (pendingMove !== null) { pendingMove = e; return }
        applyMove(e)
        if (typeof requestAnimationFrame !== "function") return
        pendingMove = e
        moveRaf = requestAnimationFrame(() => {
            moveRaf = 0
            const last = pendingMove
            pendingMove = null
            if (last && last !== e) applyMove(last)
        })
    }
    const cancelPendingMove = () => {
        if (moveRaf) {
            cancelAnimationFrame(moveRaf)
            moveRaf = 0
        }
        pendingMove = null
    }
    const onLeave = () => {
        cancelPendingMove(); clearHi(true); hideTip()
        // Fallback for tryCapture's uncaptured path: without real capture, leaving the surface
        // fires pointerleave (capture would otherwise suppress it until release), and the
        // pointermove/pointerup that follow off-element never reach these listeners — so drag
        // would stay non-null with the cursor stuck "grabbing", reopening the pre-PR bug. Under
        // real capture this check is false (hasPointerCapture is still true) and it's a no-op.
        if (drag && !surface.hasPointerCapture(drag.pointerId)) {
            cancelPendingDrag()
            drag = null
            surface.classList.remove("grabbing")
        }
    }
    // setPointerCapture throws InvalidPointerId if the UA doesn't consider this pointerId active
    // (observed live in Chromium for a synthetic/non-primary pointerId — real touch/pen input can
    // hit the same path). An uncaught throw here would abort onDown before `e.preventDefault()`,
    // so swallow it: the drag still proceeds on `drag`/"grabbing" state alone, just without the
    // "events keep targeting `surface` even off-element" guarantee capture would otherwise add.
    const tryCapture = (pointerId: number) => {
        try {
            surface.setPointerCapture(pointerId)
        } catch {
            /* not capturable — drag proceeds uncaptured */
        }
    }
    const onDown = (e: PointerEvent) => {
        // A drag is already in progress (e.g. a second concurrent touch) — refuse to let a new
        // pointer overwrite the first one's `drag` and pointer capture mid-gesture.
        if (drag) return
        cancelPendingMove()
        justDragged = false
        const p = imgPx(e)
        // Shift+drag forces view (arbitration vs box-select / ROI / threshold).
        if (e.shiftKey) {
            const viewLayer = manifest.layers.find((l) => {
                if (l.kind !== "view" || !l.events.includes("drag")) return false
                return hitTest({ ...manifest, layers: [l] }, p.x, p.y, "drag") !== null
            })
            if (viewLayer) {
                startViewDrag(viewLayer, p, e.pointerId)
                surface.classList.add("grabbing")
                tryCapture(e.pointerId)
                e.preventDefault()
                return
            }
        }
        const hit = hitTest(manifest, p.x, p.y, "drag")
        if (!hit) return
        if (hit.layer.kind === "threshold") {
            const line = thresholdLines.get(hit.layer.id)
            if (!line) return
            drag = { kind: "threshold", id: hit.layer.id, line, tg: hit.layer.geometry as ThresholdGeometry, t: manifest.transforms[hit.layer.axis], pointerId: e.pointerId }
        } else if (hit.layer.kind === "roi" && hit.roiPart) {
            const box = roiBoxes.get(hit.layer.id)
            if (!box) return
            const target = box.target   // resolved once when roiBoxes was built
            if (hit.roiPart.move) {
                drag = { kind: "roi", id: hit.layer.id, box, mode: { move: true }, ax: p.x - box.g.x, ay: p.y - box.g.y, target, pointerId: e.pointerId }
            } else {
                const k = hit.roiPart.corner as number
                const c = [[box.g.x, box.g.y], [box.g.x + box.g.w, box.g.y], [box.g.x + box.g.w, box.g.y + box.g.h], [box.g.x, box.g.y + box.g.h]]
                const opp = c[(k + 2) % 4]
                drag = { kind: "roi", id: hit.layer.id, box, mode: { corner: k }, ax: opp[0], ay: opp[1], target, pointerId: e.pointerId }
            }
        } else if (hit.layer.kind === "view") {
            startViewDrag(hit.layer, p, e.pointerId)
        } else return
        surface.classList.add("grabbing")
        tryCapture(e.pointerId)
        e.preventDefault()
    }
    // Takes the drag explicitly rather than reading the outer `drag` — onUp/onCancel null that
    // out before this can run (see the reentrancy note there), so a stale read here would apply
    // to a gesture that's already been discarded.
    const applyDrag = (d: Drag, e: PointerEvent) => {
        const p = imgPx(e)
        if (d.kind === "threshold") {
            const pos = d.tg.orientation === "h" ? clampY(d.t, p.y) : clampX(d.t, p.x)
            setLine(d.line, d.tg, pos)
            const v = invertAxis(d.t, clampX(d.t, p.x), clampY(d.t, p.y))
            setTipText(fmt(d.tg.orientation === "h" ? v.y : v.x))
        } else if (d.kind === "view") {
            setTipText(viewTip(d, p))
        } else {
            const box = d.box, [vx, vy, vw, vh] = box.t.viewport
            if ("move" in d.mode) {
                box.g.x = Math.max(vx, Math.min(vx + vw - box.g.w, p.x - d.ax))
                box.g.y = Math.max(vy, Math.min(vy + vh - box.g.h, p.y - d.ay))
            } else {
                const cx = clampX(box.t, p.x), cy = clampY(box.t, p.y)
                box.g.x = Math.min(d.ax, cx); box.g.y = Math.min(d.ay, cy)
                box.g.w = Math.abs(cx - d.ax); box.g.h = Math.abs(cy - d.ay)
            }
            setROI(box)
            if (d.target) {
                const sel = computeSelection(box.g, d.target, manifest.transforms[d.target.axis])
                drawSelection(sel.hits)
                setTipText(`${sel.items.length} selected`)
            } else {
                const b = roiBounds(box)
                setTipText(`x:[${fmt(b.xmin)}, ${fmt(b.xmax)}] y:[${fmt(b.ymin)}, ${fmt(b.ymax)}]`)
            }
        }
        setTipVisible(true)
        const tp = tipOffset(e)
        placeTip(tp.x, tp.y)
    }
    // rAF-coalesce the drag path the same way onMove coalesces hover: apply the first event of a
    // burst immediately, then collapse any further events that land before the next frame into one.
    const queueDrag = (d: Drag, e: PointerEvent) => {
        if (pendingDrag !== null) { pendingDrag = e; return }
        applyDrag(d, e)
        if (typeof requestAnimationFrame !== "function") return
        pendingDrag = e
        dragRaf = requestAnimationFrame(() => {
            dragRaf = 0
            const last = pendingDrag
            pendingDrag = null
            if (last && last !== e) applyDrag(d, last)
        })
    }
    const cancelPendingDrag = () => {
        if (dragRaf) {
            cancelAnimationFrame(dragRaf)
            dragRaf = 0
        }
        pendingDrag = null
    }
    const onUp = (e: PointerEvent) => {
        cancelPendingMove()
        const d = drag
        // Ignore a pointer that isn't the one that owns this drag (e.g. a second touch lifting
        // first) — without this, any pointer's up committed and ended whichever drag happened
        // to be in flight, at that pointer's own coordinates.
        if (!d || e.pointerId !== d.pointerId) return
        cancelPendingDrag()
        // Claim (null out) `drag` BEFORE releasing capture: releasePointerCapture can synchronously
        // dispatch lostpointercapture (spec leaves the exact timing to "process pending pointer
        // capture", which runs between dispatches — implementation-dependent), and onLostCapture
        // also nulls `drag`. Reading the module-level `drag` after that point would see null (or a
        // new drag, if one had already started) instead of the gesture this event belongs to — so
        // everything below operates on the locally-claimed `d`, never the mutable `drag`.
        drag = null
        if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId)
        // Apply the release event's own position synchronously — a coalesced rAF frame may have
        // been dropped, and the commit below (roiBounds / d.box.g) reads mutated drag state, not
        // e, so the final visual (and the value it derives from) must come from this event.
        applyDrag(d, e)
        const p = imgPx(e)
        if (d.kind === "roi" && d.target) {
            const sel = computeSelection(d.box.g, d.target, manifest.transforms[d.target.axis])
            drawSelection(sel.hits)
            ;(host as unknown as { value: unknown }).value = { items: sel.items }
            host.dispatchEvent(new CustomEvent("input"))
        } else if (d.kind === "threshold") {
            const v = invertAxis(d.t, clampX(d.t, p.x), clampY(d.t, p.y))
            const payload = d.tg.orientation === "h" ? v.y : v.x
            ;(host as unknown as { value: unknown }).value = { layer: d.id, index: 0, payload }
            host.dispatchEvent(new CustomEvent("input"))
        } else if (d.kind === "view") {
            const dist = Math.hypot(p.x - d.x0, p.y - d.y0)
            if (dist >= VIEW_MIN_PX) {
                const payload = d.g.mode === "orbit"
                    ? orbitAngles(d.g, d.x0, d.y0, p.x, p.y)
                    : panLimits(d.t, d.x0, d.y0, p.x, p.y)
                ;(host as unknown as { value: unknown }).value = { layer: d.id, index: 0, payload }
                host.dispatchEvent(new CustomEvent("input"))
            }
        } else {
            ;(host as unknown as { value: unknown }).value = { layer: d.id, index: 0, payload: roiBounds(d.box) }
            host.dispatchEvent(new CustomEvent("input"))
        }
        hideTip(); surface.classList.remove("grabbing")
        // :view micro-drags (below VIEW_MIN_PX) intentionally skip commit — don't swallow
        // the synthesized click that follows, so co-mounted click layers still fire.
        if (d.kind === "view") {
            const dist = Math.hypot(p.x - d.x0, p.y - d.y0)
            justDragged = dist >= VIEW_MIN_PX
        } else {
            justDragged = true
        }
    }
    // pointercancel: the interaction was aborted out from under us (browser-initiated gesture
    // takeover, stylus leaving range, etc.) — unlike pointerup this is not a commit, just a clean
    // reset so drag can't stay non-null with the cursor stuck in "grabbing".
    const onCancel = (e: PointerEvent) => {
        // Same pointerId gate as onUp — a non-owning pointer's cancel must not touch a drag it
        // didn't start.
        if (!drag || e.pointerId !== drag.pointerId) return
        cancelPendingDrag()
        drag = null // claim before releasePointerCapture, same reentrancy hazard as onUp
        if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId)
        surface.classList.remove("grabbing")
        hideTip()
    }
    // lostpointercapture fires after any capture release, including the explicit ones in onUp/
    // onCancel above (where drag is already null by the time this runs — a no-op then). It's the
    // safety net for capture being taken away some other way while a drag is still in progress.
    const onLostCapture = () => {
        cancelPendingDrag()
        if (!drag) return
        surface.classList.remove("grabbing")
        hideTip()
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
    // Single entry point for pointermove: while a drag owns the pointer, route to the
    // rAF-coalesced drag path; otherwise it's hover. Pointer capture (set in onDown) keeps these
    // events targeted at `surface` even once the pointer leaves its bounds or the viewport.
    const onPointerMove = (e: PointerEvent) => {
        if (drag) {
            // A second pointer's move (e.g. two-finger touch, now let through by touch-action:none)
            // must not steer a drag it didn't start — ignore it outright rather than falling through
            // to hover, which would fight the "grabbing" cursor and hi/tip state mid-drag.
            if (e.pointerId !== drag.pointerId) return
            queueDrag(drag, e)
        } else onMove(e)
    }

    surface.addEventListener("pointerdown", onDown)
    surface.addEventListener("pointermove", onPointerMove)
    surface.addEventListener("pointerup", onUp)
    surface.addEventListener("pointercancel", onCancel)
    surface.addEventListener("pointerleave", onLeave)
    surface.addEventListener("lostpointercapture", onLostCapture)
    surface.addEventListener("click", onClick)

    // Drawn into g.sel, not g.hi: it must survive hovers (onMove clears g.hi on every miss)
    // and support multiple selected indices (drawHi keeps only the last).
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
        surface.removeEventListener("pointerdown", onDown)
        surface.removeEventListener("pointermove", onPointerMove)
        surface.removeEventListener("pointerup", onUp)
        surface.removeEventListener("pointercancel", onCancel)
        surface.removeEventListener("pointerleave", onLeave)
        surface.removeEventListener("lostpointercapture", onLostCapture)
        surface.removeEventListener("click", onClick)
        window.removeEventListener("resize", syncOverlayToBase)
        overlayRO?.disconnect()
        overlayFrames = 24
        cancelPendingMove()
        cancelPendingDrag()
        if (hiLeaveTimer != null) clearTimeout(hiLeaveTimer)
        if (tipFlipTimer != null) clearTimeout(tipFlipTimer)
        shadowHost.remove()
    }
    invalidation?.then(cleanup)
    return { cleanup }
}

const fmt = (v: unknown) => (typeof v === "number" ? v.toPrecision(4) : String(v))
