import { SVG_NS, drawSelection } from "./highlight"
import { hitLayerByIndex } from "./selection"
import { onLeave } from "./hover"
import { onDown, onUp, onCancel, onLostCapture, onClick, onPointerMove } from "./bond"
import * as thresholdDrag from "./drag/threshold"
import * as roiDrag from "./drag/roi"
import { createOverlayState, cancelPendingMove, cancelPendingDrag, MOTION_MS } from "./state"
import type { OverlayCtx } from "./state"
import type { Hit, Manifest } from "./types"

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

    const thresholdLines = thresholdDrag.buildThresholdLines(manifest, svg)
    const roiBoxes = roiDrag.buildROIBoxes(manifest, svg)
    const ctx: OverlayCtx = { manifest, host, base, surface, tip, hiGroup, selGroup, thresholdLines, roiBoxes }
    const state = createOverlayState()

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
        state.surfaceSized = false
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

    const down = (e: PointerEvent) => onDown(ctx, state, e)
    const move = (e: PointerEvent) => onPointerMove(ctx, state, e)
    const up = (e: PointerEvent) => onUp(ctx, state, e)
    const cancel = (e: PointerEvent) => onCancel(ctx, state, e)
    const leave = () => onLeave(ctx, state)
    const lostCapture = () => onLostCapture(ctx, state)
    const click = (e: MouseEvent) => onClick(ctx, state, e)

    surface.addEventListener("pointerdown", down)
    surface.addEventListener("pointermove", move)
    surface.addEventListener("pointerup", up)
    surface.addEventListener("pointercancel", cancel)
    surface.addEventListener("pointerleave", leave)
    surface.addEventListener("lostpointercapture", lostCapture)
    surface.addEventListener("click", click)

    // Drawn into g.sel, not g.hi: it must survive hovers (onMove clears g.hi on every miss)
    // and support multiple selected indices (drawHi keeps only the last).
    {
        const pre: Hit[] = []
        for (const layer of manifest.layers) {
            for (const idx of layer.selected ?? []) {
                pre.push({ layer, ...hitLayerByIndex(layer, idx) })
            }
        }
        if (pre.length) drawSelection(state, selGroup, pre)
    }

    const cleanup = () => {
        surface.removeEventListener("pointerdown", down)
        surface.removeEventListener("pointermove", move)
        surface.removeEventListener("pointerup", up)
        surface.removeEventListener("pointercancel", cancel)
        surface.removeEventListener("pointerleave", leave)
        surface.removeEventListener("lostpointercapture", lostCapture)
        surface.removeEventListener("click", click)
        window.removeEventListener("resize", syncOverlayToBase)
        overlayRO?.disconnect()
        overlayFrames = 24
        cancelPendingMove(state)
        cancelPendingDrag(state)
        if (state.hiLeaveTimer != null) clearTimeout(state.hiLeaveTimer)
        if (state.tipFlipTimer != null) clearTimeout(state.tipFlipTimer)
        shadowHost.remove()
    }
    invalidation?.then(cleanup)
    return { cleanup }
}
