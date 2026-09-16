import { anchorFor, computeAnchoredPlacement, hitTest, resolvePayload, CURSOR_FOLLOWING_KINDS } from "./geometry"
import type { Anchor } from "./geometry"
import { renderTemplate, renderAutoTable, esc } from "./template"
import { drawHi, clearHi } from "./highlight"
import { fmt, imgPx, cssAnchor, prefersReducedMotion, MOTION_MS, cancelPendingMove, cancelPendingDrag } from "./state"
import type { OverlayCtx, OverlayState } from "./state"
import type { Hit, ThresholdGeometry } from "./types"

const TIP_GAP = 8
const TIP_OFFSET = 10

// Cursor classes are mutually exclusive and must never stick: every hover-path branch that can
// set one goes through setCursorClass, which clears all of them first.
const CURSOR_CLASSES = ["grab", "cur-nwse", "cur-nesw", "cur-ns", "cur-ew", "cur-move"]
const CURSOR_NAME_TO_CLASS: Record<string, string> = {
    grab: "grab", "nwse-resize": "cur-nwse", "nesw-resize": "cur-nesw",
    "ns-resize": "cur-ns", "ew-resize": "cur-ew", move: "cur-move",
}

export function setCursorClass(surface: HTMLElement, name: string | null): void {
    surface.classList.remove(...CURSOR_CLASSES)
    if (name && CURSOR_NAME_TO_CLASS[name]) surface.classList.add(CURSOR_NAME_TO_CLASS[name])
}

// Directional feedback for the drag-target hover path: which cursor a :threshold/:roi/:view hit
// should show, based on which part of it was hit. ROI corners 0/2 (top-left, bottom-right) sit on
// the "\" diagonal → nwse-resize; corners 1/3 (top-right, bottom-left) sit on "/" → nesw-resize.
export function cursorForDragHit(hit: Hit): string {
    // No explicit :view case: applyMove (below) never calls setDragHoverChrome with a :view
    // dragHit (its own `grab` cursor for :view goes through setCursorClass directly), and the
    // terminal `return "grab"` below already gives the right answer if it ever did — a separate
    // `if (kind === "view") return "grab"` would be redundant with that fallback.
    if (hit.layer.kind === "threshold") {
        return (hit.layer.geometry as ThresholdGeometry).orientation === "h" ? "ns-resize" : "ew-resize"
    }
    if (hit.layer.kind === "roi" && hit.roiPart_) {
        if (hit.roiPart_.move) return "move"
        if (hit.roiPart_.edge) return hit.roiPart_.edge === "n" || hit.roiPart_.edge === "s" ? "ns-resize" : "ew-resize"
        if (hit.roiPart_.corner !== undefined) return hit.roiPart_.corner % 2 === 0 ? "nwse-resize" : "nesw-resize"
    }
    // Unreachable on a real drag hit: geometry.ts's roi hitLayer case always sets exactly one of
    // corner/edge/move on a match, so a :roi hit always returns above. Kept as a type-safe
    // fallback (cursorForDragHit's return type is a plain string, not narrowed to the three
    // known values), not tested via a fabricated, impossible roiPart_.
    return "grab"
}

// Sets the cursor class AND toggles the one hovered :threshold line's thicker-stroke class
// (`hovered`, drag/threshold.ts) — the two are the same "this is what a drag would grab" signal,
// so they're driven from a single call site to keep them from drifting out of sync.
export function setDragHoverChrome(ctx: OverlayCtx, state: OverlayState, hit: Hit | null): void {
    setCursorClass(ctx.surface_, hit ? cursorForDragHit(hit) : null)
    const thresholdId = hit && hit.layer.kind === "threshold" ? hit.layer.id : null
    if (state.hoveredThresholdId_ === thresholdId) return
    if (state.hoveredThresholdId_) ctx.thresholdLines_.get(state.hoveredThresholdId_)?.classList.remove("hovered")
    if (thresholdId) ctx.thresholdLines_.get(thresholdId)?.classList.add("hovered")
    state.hoveredThresholdId_ = thresholdId
}

// role="tooltip" is static markup (set at creation); aria-hidden tracks the same visibility
// the "show" class drives, so assistive tech's view matches the sighted one. The tooltip itself
// is still not an announcement path for AT (aria-hidden toggling isn't observable the way
// aria-live is) — that's what keyboard.ts's separate live region is for; showTip/showTipAt just
// give sighted keyboard users the same visual tooltip a mouse hover would.
export function setTipVisible(ctx: OverlayCtx, visible: boolean): void {
    ctx.tip_.classList.toggle("show", visible)
    ctx.tip_.setAttribute("aria-hidden", visible ? "false" : "true")
}

// hit.layer.colors is per-LAYER (a single string, or a layer-wide palette + one index per
// element) — never resolved per the specific hit here beyond that one palette lookup, so an
// out-of-range index (a payload/colors length mismatch) degrades to no accent rather than
// throwing.
function markColorFor(hit: Hit): string | null {
    const c = hit.layer.colors
    if (!c) return null
    if (typeof c === "string") return c
    return c.palette[c.index[hit.index]] ?? null
}

// Drives .holo-tip's border-left accent (mount.ts's STYLE). Called from applyTipHtml (set, from
// the hit whose content is being shown) and hideTip (clear) — every path that shows or hides the
// tooltip goes through one of those two, so a stale accent can't survive a hover/focus change.
function setMarkAccent(ctx: OverlayCtx, hit: Hit | null): void {
    const color = hit && markColorFor(hit)
    if (color) ctx.tip_.style.setProperty("--holo-mark-border", `3px solid ${color}`)
    else ctx.tip_.style.removeProperty("--holo-mark-border")
}

export function hideTip(ctx: OverlayCtx, state: OverlayState): void {
    setMarkAccent(ctx, null)
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
    ctx.tip_.style.removeProperty("--holo-caret-x") // only the anchored path (placeAnchored) uses this
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

const ANCHOR_GAP = 10 // px between the mark and the box — mirrors geometry.ts's ANCHOR_GAP

// Places the tooltip above (or, if that clips the surface's top, below) a mark's anchor point —
// used for every kind except the cursor-following four (geometry.ts's CURSOR_FOLLOWING_KINDS).
// Shared by showTip (pointer) and showTipAt/restoreFocus (keyboard) so both paths place
// identically; `anchor` is already in css px (state.ts's cssAnchor).
export function placeAnchored(ctx: OverlayCtx, state: OverlayState, anchor: Anchor): void {
    if (!state.tipSized_) {
        state.tipW_ = ctx.tip_.offsetWidth; state.tipH_ = ctx.tip_.offsetHeight
        state.tipSized_ = state.tipW_ > 0 && state.tipH_ > 0
    }
    if (!state.surfaceSized_) {
        state.surfaceW_ = ctx.surface_.clientWidth; state.surfaceH_ = ctx.surface_.clientHeight
        state.surfaceSized_ = state.surfaceW_ > 0 && state.surfaceH_ > 0
    }
    ctx.tip_.classList.remove("flip-x") // horizontal clipping is handled by shifting the caret, not this
    const tw = state.tipW_, th = state.tipH_, sw = state.surfaceW_, sh = state.surfaceH_
    if (tw <= 0 || th <= 0 || sw <= 0 || sh <= 0) {
        ctx.tip_.style.left = `${anchor.x}px`
        ctx.tip_.style.top = `${Math.max(0, anchor.top - ANCHOR_GAP)}px`
        ctx.tip_.style.removeProperty("--holo-caret-x")
        ctx.tip_.classList.remove("flip-y")
        return
    }
    const p = computeAnchoredPlacement(anchor, tw, th, sw, sh)
    ctx.tip_.style.left = `${p.left}px`
    ctx.tip_.style.top = `${p.top}px`
    ctx.tip_.style.setProperty("--holo-caret-x", `${p.caretX}px`)
    // Reuses flip-y's existing CSS meaning ("caret at the box's bottom, pointing down") — here
    // inverted from its cursor-following sense: the box defaults to ABOVE the mark (caret must
    // point down, i.e. flip-y set), and only clears it when the top-clip flip put the box below
    // the mark (caret must point up instead).
    ctx.tip_.classList.toggle("flip-y", !p.below)
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

export function applyTipHtml(ctx: OverlayCtx, state: OverlayState, html: string, hit: Hit | null): void {
    setMarkAccent(ctx, hit)
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
    applyTipHtml(ctx, state, html, hit)
    if (CURSOR_FOLLOWING_KINDS.has(hit.layer.kind)) {
        const p = tipOffset(ctx, e)
        placeTip(ctx, state, p.x, p.y)
        return
    }
    placeAnchored(ctx, state, cssAnchor(ctx.base_, ctx.manifest_, anchorFor(hit, { x, y })))
}

// Same as showTip, but placed at an explicit css-px anchor rather than derived from a
// MouseEvent — keyboard.ts's focus has no pointer event to read clientX/Y from. Only reached for
// element-indexed kinds (keyboard.ts's FOCUSABLE_KINDS), so always the anchored path.
export function showTipAt(ctx: OverlayCtx, state: OverlayState, hit: Hit, x: number, y: number, css: Anchor): string | null {
    const html = tipHtmlForHit(ctx, hit, x, y)
    if (html === null) { hideTip(ctx, state); return null }
    applyTipHtml(ctx, state, html, hit)
    placeAnchored(ctx, state, css)
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
        applyTipHtml(ctx, state, state.focusTipHtml_, state.focusHit_)
        placeAnchored(ctx, state, state.focusTipCss_)
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
        setDragHoverChrome(ctx, state, dragHit); ctx.surface_.classList.remove("hot")
        return
    }
    setDragHoverChrome(ctx, state, null)
    const hit = hitTest(ctx.manifest_, p.x, p.y, "hover")
    if (hit) {
        drawHi(state, ctx.hiGroup_, hit); showTip(ctx, state, hit, p.x, p.y, e); ctx.surface_.classList.add("hot")
    } else {
        if (!restoreFocus(ctx, state)) { clearHi(state, ctx.hiGroup_, true); hideTip(ctx, state) }
        ctx.surface_.classList.remove("hot")
        if (dragHit?.layer.kind === "view") setCursorClass(ctx.surface_, "grab")
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
    ctx.surface_.classList.remove("hot")
    setDragHoverChrome(ctx, state, null)
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
