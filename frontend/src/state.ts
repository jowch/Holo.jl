import type { AxisTransform, FocusRef, Hit, HitLayer, Manifest, ThresholdGeometry, ViewGeometry } from "./types"

export const MOTION_MS = 100 // 80–120 ms window; prefers-reduced-motion disables below
export const VIEW_MIN_PX = 3 // image-px; ignore accidental micro-drags

export const fmt = (v: unknown): string => (typeof v === "number" ? v.toPrecision(4) : String(v))

export const clampX = (t: AxisTransform, x: number): number => Math.max(t.viewport[0], Math.min(t.viewport[0] + t.viewport[2], x))
export const clampY = (t: AxisTransform, y: number): number => Math.max(t.viewport[1], Math.min(t.viewport[1] + t.viewport[3], y))

export const prefersReducedMotion = (): boolean =>
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

export const hitKey = (h: Hit): string => `${h.layer.id}:${h.index}`

// Image-px scale comes from manifest.width, not the element's intrinsic size, so a
// <canvas> needs no sizer shim.
export const imgPx = (base: HTMLElement, manifest: Manifest, e: MouseEvent): { x: number; y: number } => {
    const r = base.getBoundingClientRect()
    const s = manifest.width / r.width // image-px per CSS-px (manifest renderWidth ÷ live rect; never the base's intrinsic size)
    return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s }
}

// Inverse of imgPx's scale factor — image px → CSS px offset from the surface/base origin,
// for placing the tooltip at a keyboard-focused element's anchor (no MouseEvent to read
// clientX/Y from). In happy-dom, getBoundingClientRect() is all zeros, so `s` is Infinity and
// this degenerates to {0,0} — the same degenerate branch placeTip already takes for a
// zero-sized surface.
export const cssPx = (base: HTMLElement, manifest: Manifest, x: number, y: number): { x: number; y: number } => {
    const r = base.getBoundingClientRect()
    const s = manifest.width / r.width
    return { x: x / s, y: y / s }
}

export interface ROIBox {
    rect: SVGRectElement
    handles: SVGRectElement[]
    g: { x: number; y: number; w: number; h: number }
    handle: number
    t: AxisTransform
    target?: HitLayer
}

// Every variant carries the pointerId that started it — onPointerMove/onUp/onCancel gate on
// this so a second concurrent pointer (e.g. two-finger touch, now let through by
// touch-action:none) can move/release/cancel without hijacking an in-flight drag it didn't
// start. onDown's `if (drag) return` only stops a second pointerDOWN; without this field the
// second pointer's move/up/cancel still routed into the first pointer's drag.
export type Drag =
    | { kind: "threshold"; id: string; line: SVGLineElement; tg: ThresholdGeometry; t: AxisTransform; pointerId: number }
    | { kind: "roi"; id: string; box: ROIBox; mode: { corner: number } | { move: true }; ax: number; ay: number; target?: HitLayer; pointerId: number }
    | { kind: "view"; id: string; g: ViewGeometry; t: AxisTransform; x0: number; y0: number; pointerId: number }

// Construction-time DOM/manifest refs, built once by mount.ts and threaded read-mostly through
// hover/drag/bond as `ctx`. Distinct from OverlayState, which is the mutable interaction state.
export interface OverlayCtx {
    manifest: Manifest
    host: HTMLElement
    base: HTMLElement
    surface: HTMLElement
    tip: HTMLElement
    hiGroup: SVGGElement
    selGroup: SVGGElement
    thresholdLines: Map<string, SVGLineElement>
    roiBoxes: Map<string, ROIBox>
    shadowRoot: ShadowRoot // for `shadowRoot.activeElement === surface` focus gating (keyboard.ts)
    focusable: FocusRef[] // flat, manifest-order list of element-indexed hits — keyboard.ts's nav domain
    layerStarts: number[] // computeLayerStarts(focusable), cached once — PageUp/PageDown's layer-jump index
    liveRegion: HTMLElement // visually-hidden aria-live="polite" announcer (NOT the tooltip)
}

export interface OverlayState {
    drag: Drag | null
    justDragged: boolean
    hiKey: string | null
    selKeys: Set<string>
    hiLeaveTimer: ReturnType<typeof setTimeout> | null
    tipFlipTimer: ReturnType<typeof setTimeout> | null
    pendingMove: MouseEvent | null
    moveRaf: number
    pendingDrag: PointerEvent | null
    dragRaf: number
    tipHtml: string
    tipW: number
    tipH: number
    tipSized: boolean
    surfaceW: number
    surfaceH: number
    surfaceSized: boolean
    // Keyboard focus (keyboard.ts). focusIdx indexes OverlayCtx.focusable; focusHit/focusTipHtml/
    // focusTipCss are hover.ts's cache to redraw the ring/tooltip after a pointer miss clears
    // g.hi — see restoreFocus in hover.ts — without hover.ts importing keyboard.ts (no cycle).
    focusIdx: number | null
    focusHit: Hit | null
    focusTipHtml: string | null
    focusTipCss: { x: number; y: number } | null
    announceTimer: ReturnType<typeof setTimeout> | null
}

export function createOverlayState(): OverlayState {
    return {
        drag: null,
        justDragged: false,
        hiKey: null,
        selKeys: new Set(),
        hiLeaveTimer: null,
        tipFlipTimer: null,
        pendingMove: null,
        moveRaf: 0,
        pendingDrag: null,
        dragRaf: 0,
        tipHtml: "",
        tipW: 0,
        tipH: 0,
        tipSized: false,
        surfaceW: 0,
        surfaceH: 0,
        surfaceSized: false,
        focusIdx: null,
        focusHit: null,
        focusTipHtml: null,
        focusTipCss: null,
        announceTimer: null,
    }
}

export function cancelPendingMove(state: OverlayState): void {
    if (state.moveRaf) {
        cancelAnimationFrame(state.moveRaf)
        state.moveRaf = 0
    }
    state.pendingMove = null
}

export function cancelPendingDrag(state: OverlayState): void {
    if (state.dragRaf) {
        cancelAnimationFrame(state.dragRaf)
        state.dragRaf = 0
    }
    state.pendingDrag = null
}
