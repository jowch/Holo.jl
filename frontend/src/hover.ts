import { hitTest, resolvePayload } from "./geometry"
import { renderTemplate, renderAutoTable, esc } from "./template"
import { drawHi, clearHi } from "./highlight"
import { fmt, imgPx, prefersReducedMotion, MOTION_MS, cancelPendingMove, cancelPendingDrag } from "./state"
import type { OverlayCtx, OverlayState } from "./state"
import type { Hit } from "./types"

const TIP_GAP = 8
const TIP_OFFSET = 10

// role="tooltip" is static markup (set at creation); aria-hidden tracks the same visibility
// the "show" class drives, so assistive tech's view matches the sighted one. The tooltip itself
// is still not an announcement path for AT (aria-hidden toggling isn't observable the way
// aria-live is) — that's what keyboard.ts's separate live region is for; showTip/showTipAt just
// give sighted keyboard users the same visual tooltip a mouse hover would.
export function setTipVisible(ctx: OverlayCtx, visible: boolean): void {
    ctx.tip_.classList.toggle("show", visible)
    ctx.tip_.setAttribute("aria-hidden", visible ? "false" : "true")
}

export function hideTip(ctx: OverlayCtx, state: OverlayState): void {
    setTipVisible(ctx, false)
    if (state.tipFlipTimer_ != null) clearTimeout(state.tipFlipTimer_)
    const delay = prefersReducedMotion() ? 0 : MOTION_MS
    state.tipFlipTimer_ = setTimeout(() => {
        state.tipFlipTimer_ = null
        if (!ctx.tip_.classList.contains("show")) ctx.tip_.classList.remove("flip-x", "flip-y")
    }, delay)
}

export function tipOffset(ctx: OverlayCtx, e: MouseEvent): { x: number; y: number } {
    const r = ctx.surface_.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return { x: e.clientX - r.left, y: e.clientY - r.top }
    return { x: e.offsetX || e.clientX, y: e.offsetY || e.clientY }
}

export function placeTip(ctx: OverlayCtx, state: OverlayState, ox: number, oy: number): void {
    if (!state.tipSized_) {
        state.tipW_ = ctx.tip_.offsetWidth; state.tipH_ = ctx.tip_.offsetHeight
        state.tipSized_ = state.tipW_ > 0 && state.tipH_ > 0
    }
    if (!state.surfaceSized_) {
        state.surfaceW_ = ctx.surface_.clientWidth; state.surfaceH_ = ctx.surface_.clientHeight
        state.surfaceSized_ = state.surfaceW_ > 0 && state.surfaceH_ > 0
    }
    const tw = state.tipW_, th = state.tipH_, hw = state.surfaceW_, hh = state.surfaceH_
    ctx.tip_.classList.remove("flip-x", "flip-y")
    if (tw <= 0 || th <= 0 || hw <= 0 || hh <= 0) {
        ctx.tip_.style.left = `${ox + TIP_OFFSET}px`
        ctx.tip_.style.top = `${oy + TIP_OFFSET}px`
        return
    }
    let left = ox + TIP_OFFSET, top = oy + TIP_OFFSET
    const flipX = left + tw > hw - TIP_GAP
    const flipY = top + th > hh - TIP_GAP
    if (flipX) { left = ox - tw - TIP_OFFSET; ctx.tip_.classList.add("flip-x") }
    if (flipY) { top = oy - th - TIP_OFFSET; ctx.tip_.classList.add("flip-y") }
    ctx.tip_.style.left = `${Math.max(TIP_GAP, Math.min(left, hw - tw - TIP_GAP))}px`
    ctx.tip_.style.top = `${Math.max(TIP_GAP, Math.min(top, hh - th - TIP_GAP))}px`
}

// The html-selection branching shared by pointer hover (showTip, below) and keyboard focus
// (keyboard.ts's focusTo) — factored out so keyboard.ts can build the same content without a
// MouseEvent to derive an offset from.
export function tipHtmlForHit(ctx: OverlayCtx, hit: Hit, x: number, y: number): string | null {
    const layer = hit.layer
    if (layer.tooltip === false) return null
    if (layer.template) {
        return renderTemplate(layer.template, resolvePayload(hit, ctx.manifest_, x, y))
    } else if (hit.grid_) {
        return hit.grid_[2] === undefined ? `(${hit.grid_[0]},${hit.grid_[1]})` : `(${hit.grid_[0]},${hit.grid_[1]}) = ${esc(hit.grid_[2])}`
    } else if (hit.axis_) {
        const v = resolvePayload(hit, ctx.manifest_, x, y) as { x?: unknown; y?: unknown; value?: unknown }
        return "value" in v ? esc(fmt(v.value)) : `x=${esc(fmt(v.x))}, y=${esc(fmt(v.y))}`
    }
    return renderAutoTable(hit.layer.payloads[hit.index])
}

export function applyTipHtml(ctx: OverlayCtx, state: OverlayState, html: string): void {
    if (html !== state.tipHtml_) {
        ctx.tip_.innerHTML = html
        state.tipHtml_ = html
        state.tipSized_ = false
    }
    setTipVisible(ctx, true)
}

export function showTip(ctx: OverlayCtx, state: OverlayState, hit: Hit, x: number, y: number, e: MouseEvent): void {
    const html = tipHtmlForHit(ctx, hit, x, y)
    if (html === null) { hideTip(ctx, state); return }
    applyTipHtml(ctx, state, html)
    const p = tipOffset(ctx, e)
    placeTip(ctx, state, p.x, p.y)
}

// Same as showTip, but placed at an explicit CSS-px offset rather than derived from a
// MouseEvent — keyboard.ts's focus has no pointer event to read clientX/Y from.
export function showTipAt(ctx: OverlayCtx, state: OverlayState, hit: Hit, x: number, y: number, cssX: number, cssY: number): string | null {
    const html = tipHtmlForHit(ctx, hit, x, y)
    if (html === null) { hideTip(ctx, state); return null }
    applyTipHtml(ctx, state, html)
    placeTip(ctx, state, cssX, cssY)
    return html
}

// Redraw the keyboard-focus ring/tooltip from state's cache (set by keyboard.ts's focusTo) in
// place of a plain clear — called from applyMove's hover-miss branch and onLeave so mousing
// over empty canvas, or off the surface, doesn't erase a focus ring that's still logically set.
// Returns false (nothing to restore) so the caller falls back to its usual clearHi/hideTip.
export function restoreFocus(ctx: OverlayCtx, state: OverlayState): boolean {
    if (!state.focusHit_) return false
    drawHi(state, ctx.hiGroup_, state.focusHit_)
    if (state.focusTipHtml_ !== null && state.focusTipCss_) {
        applyTipHtml(ctx, state, state.focusTipHtml_)
        placeTip(ctx, state, state.focusTipCss_.x, state.focusTipCss_.y)
    } else {
        hideTip(ctx, state)
    }
    return true
}

export function setTipText(ctx: OverlayCtx, state: OverlayState, s: string): void {
    if (s === state.tipHtml_) return
    ctx.tip_.textContent = s
    state.tipHtml_ = s
    state.tipSized_ = false
}

export function applyMove(ctx: OverlayCtx, state: OverlayState, e: MouseEvent): void {
    // onPointerMove routes drag-active moves to queueDrag instead — this is only ever
    // reached with drag === null, but keep the guard as defense-in-depth.
    if (state.drag_) return
    const p = imgPx(ctx.base_, ctx.manifest_, e)
    const dragHit = hitTest(ctx.manifest_, p.x, p.y, "drag")
    // A full-viewport :view hit must not suppress element hover.
    if (dragHit && dragHit.layer.kind !== "view") {
        if (!restoreFocus(ctx, state)) { clearHi(state, ctx.hiGroup_, true); hideTip(ctx, state) }
        ctx.surface_.classList.add("grab"); ctx.surface_.classList.remove("hot")
        return
    }
    ctx.surface_.classList.remove("grab")
    const hit = hitTest(ctx.manifest_, p.x, p.y, "hover")
    if (hit) {
        drawHi(state, ctx.hiGroup_, hit); showTip(ctx, state, hit, p.x, p.y, e); ctx.surface_.classList.add("hot")
    } else {
        if (!restoreFocus(ctx, state)) { clearHi(state, ctx.hiGroup_, true); hideTip(ctx, state) }
        ctx.surface_.classList.remove("hot")
        if (dragHit?.layer.kind === "view") ctx.surface_.classList.add("grab")
    }
}

export function onMove(ctx: OverlayCtx, state: OverlayState, e: MouseEvent): void {
    if (state.pendingMove_ !== null) { state.pendingMove_ = e; return }
    applyMove(ctx, state, e)
    if (typeof requestAnimationFrame !== "function") return
    state.pendingMove_ = e
    state.moveRaf_ = requestAnimationFrame(() => {
        state.moveRaf_ = 0
        const last = state.pendingMove_
        state.pendingMove_ = null
        if (last && last !== e) applyMove(ctx, state, last)
    })
}

export function onLeave(ctx: OverlayCtx, state: OverlayState): void {
    cancelPendingMove(state)
    if (!restoreFocus(ctx, state)) { clearHi(state, ctx.hiGroup_, true); hideTip(ctx, state) }
    // Fallback for tryCapture's uncaptured path: without real capture, leaving the surface
    // fires pointerleave (capture would otherwise suppress it until release), and the
    // pointermove/pointerup that follow off-element never reach these listeners — so drag
    // would stay non-null with the cursor stuck "grabbing", reopening the pre-PR bug. Under
    // real capture this check is false (hasPointerCapture is still true) and it's a no-op.
    if (state.drag_ && !ctx.surface_.hasPointerCapture(state.drag_.pointerId_)) {
        cancelPendingDrag(state)
        state.drag_ = null
        ctx.surface_.classList.remove("grabbing")
    }
}
