import type { Anchor } from "./geometry"
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

// Anchor (image px, from geometry.ts's anchorFor) → css px, for the tooltip placement math —
// shared by the pointer (hover.ts) and keyboard (keyboard.ts) paths so both convert identically.
// One getBoundingClientRect() (not three, via cssPx) — this runs on every hover-path mousemove
// for the mark-anchored kinds, same rAF-throttled budget as imgPx's own per-move read.
export const cssAnchor = (base: HTMLElement, manifest: Manifest, a: Anchor): Anchor => {
    const r = base.getBoundingClientRect()
    const s = manifest.width / r.width
    return { x: a.x / s, y: a.y / s, top: a.top / s }
}

// ROIBox/Drag/OverlayCtx/OverlayState/FocusRef are frontend-only interaction state — they
// never reach Julia, Pluto, or the DOM as object shapes (only individual field *values* do,
// copied out into the `@bind` payload by bond.ts/drag/*.ts). Every field below therefore
// takes the trailing-underscore convention esbuild's `mangleProps: /_$/` shortens in the
// bundle (see frontend-delivery.md's Bundle row). The `kind` discriminant is deliberately
// left unmangled: `.kind` is also how HitLayer's own boundary discriminant is spelled, and
// keeping the two textually identical avoids having to thread that distinction through every
// `.kind` read in bond.ts/hover.ts for a saving of a few bytes.
export interface ROIBox {
    rect_: SVGRectElement
    handles_: SVGRectElement[]
    g_: { x: number; y: number; w: number; h: number }
    handle_: number
    t_: AxisTransform
    target_?: HitLayer
}

// Every variant carries the pointerId that started it — onPointerMove/onUp/onCancel gate on
// this so a second concurrent pointer (e.g. two-finger touch, now let through by
// touch-action:none) can move/release/cancel without hijacking an in-flight drag it didn't
// start. onDown's `if (drag) return` only stops a second pointerDOWN; without this field the
// second pointer's move/up/cancel still routed into the first pointer's drag.
export type Drag =
    | { kind: "threshold"; id_: string; line_: SVGLineElement; tg_: ThresholdGeometry; t_: AxisTransform; pointerId_: number }
    | {
        kind: "roi"; id_: string; box_: ROIBox
        mode_: { corner: number } | { edge: "n" | "s" | "w" | "e" } | { move: true }
        ax_: number; ay_: number; target_?: HitLayer; pointerId_: number
    }
    | { kind: "view"; id_: string; g_: ViewGeometry; t_: AxisTransform; x0_: number; y0_: number; pointerId_: number }

// Construction-time DOM/manifest refs, built once by mount.ts and threaded read-mostly through
// hover/drag/bond as `ctx`. Distinct from OverlayState, which is the mutable interaction state.
export interface OverlayCtx {
    manifest_: Manifest
    host_: HTMLElement
    base_: HTMLElement
    surface_: HTMLElement
    tip_: HTMLElement
    hiGroup_: SVGGElement
    selGroup_: SVGGElement
    thresholdLines_: Map<string, SVGLineElement>
    roiBoxes_: Map<string, ROIBox>
    shadowRoot_: ShadowRoot // for `shadowRoot.activeElement === surface` focus gating (keyboard.ts)
    focusable_: FocusRef[] // flat, manifest-order list of element-indexed hits — keyboard.ts's nav domain
    layerStarts_: number[] // computeLayerStarts(focusable), cached once — PageUp/PageDown's layer-jump index
    liveRegion_: HTMLElement // visually-hidden aria-live="polite" announcer (NOT the tooltip)
}

export interface OverlayState {
    drag_: Drag | null
    justDragged_: boolean
    hiKey_: string | null
    selKeys_: Set<string>
    hiLeaveTimer_: ReturnType<typeof setTimeout> | null
    tipFlipTimer_: ReturnType<typeof setTimeout> | null
    pendingMove_: MouseEvent | null
    moveRaf_: number
    pendingDrag_: PointerEvent | null
    dragRaf_: number
    tipHtml_: string
    tipW_: number
    tipH_: number
    tipSized_: boolean
    surfaceW_: number
    surfaceH_: number
    surfaceSized_: boolean
    // Keyboard focus (keyboard.ts). focusIdx indexes OverlayCtx.focusable; focusHit/focusTipHtml/
    // focusTipCss are hover.ts's cache to redraw the ring/tooltip after a pointer miss clears
    // g.hi — see restoreFocus in hover.ts — without hover.ts importing keyboard.ts (no cycle).
    focusIdx_: number | null
    focusHit_: Hit | null
    focusTipHtml_: string | null
    focusTipCss_: Anchor | null
    announceTimer_: ReturnType<typeof setTimeout> | null
    // :threshold layer id currently drawn thicker for drag-hover feedback; cleared on any miss
    // (hover.ts's setDragHoverChrome) so it can never point at a line no longer under the cursor.
    hoveredThresholdId_: string | null
}

export function createOverlayState(): OverlayState {
    return {
        drag_: null,
        justDragged_: false,
        hiKey_: null,
        selKeys_: new Set(),
        hiLeaveTimer_: null,
        tipFlipTimer_: null,
        pendingMove_: null,
        moveRaf_: 0,
        pendingDrag_: null,
        dragRaf_: 0,
        tipHtml_: "",
        tipW_: 0,
        tipH_: 0,
        tipSized_: false,
        surfaceW_: 0,
        surfaceH_: 0,
        surfaceSized_: false,
        focusIdx_: null,
        focusHit_: null,
        focusTipHtml_: null,
        focusTipCss_: null,
        announceTimer_: null,
        hoveredThresholdId_: null,
    }
}

export function cancelPendingMove(state: OverlayState): void {
    if (state.moveRaf_) {
        cancelAnimationFrame(state.moveRaf_)
        state.moveRaf_ = 0
    }
    state.pendingMove_ = null
}

export function cancelPendingDrag(state: OverlayState): void {
    if (state.dragRaf_) {
        cancelAnimationFrame(state.dragRaf_)
        state.dragRaf_ = 0
    }
    state.pendingDrag_ = null
}
