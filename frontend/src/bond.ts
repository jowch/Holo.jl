import { hitTest, resolvePayload } from "./geometry"
import { drawHi } from "./highlight"
import { onMove, hideTip, setTipText, setTipVisible, tipOffset, placeTip } from "./hover"
import { imgPx, cancelPendingMove, cancelPendingDrag } from "./state"
import type { Drag, OverlayCtx, OverlayState } from "./state"
import * as thresholdDrag from "./drag/threshold"
import * as roiDrag from "./drag/roi"
import * as viewDrag from "./drag/view"
import type { Hit, ThresholdGeometry, ViewGeometry } from "./types"

// setPointerCapture throws InvalidPointerId if the UA doesn't consider this pointerId active
// (observed live in Chromium for a synthetic/non-primary pointerId — real touch/pen input can
// hit the same path). An uncaught throw here would abort onDown before `e.preventDefault()`,
// so swallow it: the drag still proceeds on `drag`/"grabbing" state alone, just without the
// "events keep targeting `surface` even off-element" guarantee capture would otherwise add.
function tryCapture(surface: HTMLElement, pointerId: number): void {
    try {
        surface.setPointerCapture(pointerId)
    } catch {
        /* not capturable — drag proceeds uncaptured */
    }
}

// Takes the drag explicitly rather than reading `state.drag_` — onUp/onCancel null that out
// before this can run (see the reentrancy note there), so a stale read here would apply to a
// gesture that's already been discarded.
function applyDrag(ctx: OverlayCtx, state: OverlayState, d: Drag, e: PointerEvent): void {
    const p = imgPx(ctx.base_, ctx.manifest_, e)
    let text: string
    if (d.kind === "threshold") {
        text = thresholdDrag.move(d, p)
    } else if (d.kind === "view") {
        text = viewDrag.tip(d, p)
    } else {
        text = roiDrag.move(d, state, ctx.selGroup_, ctx.manifest_, p)
    }
    setTipText(ctx, state, text)
    setTipVisible(ctx, true)
    const tp = tipOffset(ctx, e)
    placeTip(ctx, state, tp.x, tp.y)
}

// rAF-coalesce the drag path the same way hover's onMove coalesces hover: apply the first event
// of a burst immediately, then collapse any further events that land before the next frame into one.
function queueDrag(ctx: OverlayCtx, state: OverlayState, d: Drag, e: PointerEvent): void {
    if (state.pendingDrag_ !== null) { state.pendingDrag_ = e; return }
    applyDrag(ctx, state, d, e)
    if (typeof requestAnimationFrame !== "function") return
    state.pendingDrag_ = e
    state.dragRaf_ = requestAnimationFrame(() => {
        state.dragRaf_ = 0
        const last = state.pendingDrag_
        state.pendingDrag_ = null
        if (last && last !== e) applyDrag(ctx, state, d, last)
    })
}

export function onDown(ctx: OverlayCtx, state: OverlayState, e: PointerEvent): void {
    // A drag is already in progress (e.g. a second concurrent touch) — refuse to let a new
    // pointer overwrite the first one's `drag` and pointer capture mid-gesture.
    if (state.drag_) return
    cancelPendingMove(state)
    state.justDragged_ = false
    const p = imgPx(ctx.base_, ctx.manifest_, e)
    // Shift+drag forces view (arbitration vs box-select / ROI / threshold).
    if (e.shiftKey) {
        const viewLayer = ctx.manifest_.layers.find((l) => {
            if (l.kind !== "view" || !l.events.includes("drag")) return false
            return hitTest({ ...ctx.manifest_, layers: [l] }, p.x, p.y, "drag") !== null
        })
        if (viewLayer) {
            state.drag_ = viewDrag.begin(viewLayer.id, viewLayer.geometry as ViewGeometry, ctx.manifest_.transforms[viewLayer.axis], p.x, p.y, e.pointerId)
            ctx.surface_.classList.add("grabbing")
            tryCapture(ctx.surface_, e.pointerId)
            e.preventDefault()
            return
        }
    }
    const hit = hitTest(ctx.manifest_, p.x, p.y, "drag")
    if (!hit) return
    if (hit.layer.kind === "threshold") {
        const line = ctx.thresholdLines_.get(hit.layer.id)
        if (!line) return
        state.drag_ = thresholdDrag.begin(hit.layer.id, line, hit.layer.geometry as ThresholdGeometry, ctx.manifest_.transforms[hit.layer.axis], e.pointerId)
    } else if (hit.layer.kind === "roi" && hit.roiPart_) {
        const box = ctx.roiBoxes_.get(hit.layer.id)
        if (!box) return
        if (hit.roiPart_.move) {
            state.drag_ = roiDrag.begin(hit.layer.id, box, { move: true }, p.x - box.g_.x, p.y - box.g_.y, e.pointerId)
        } else {
            const k = hit.roiPart_.corner as number
            const c = [[box.g_.x, box.g_.y], [box.g_.x + box.g_.w, box.g_.y], [box.g_.x + box.g_.w, box.g_.y + box.g_.h], [box.g_.x, box.g_.y + box.g_.h]]
            const opp = c[(k + 2) % 4]
            state.drag_ = roiDrag.begin(hit.layer.id, box, { corner: k }, opp[0], opp[1], e.pointerId)
        }
    } else if (hit.layer.kind === "view") {
        state.drag_ = viewDrag.begin(hit.layer.id, hit.layer.geometry as ViewGeometry, ctx.manifest_.transforms[hit.layer.axis], p.x, p.y, e.pointerId)
    } else return
    ctx.surface_.classList.add("grabbing")
    tryCapture(ctx.surface_, e.pointerId)
    e.preventDefault()
}

export function onUp(ctx: OverlayCtx, state: OverlayState, e: PointerEvent): void {
    cancelPendingMove(state)
    const d = state.drag_
    // Ignore a pointer that isn't the one that owns this drag (e.g. a second touch lifting
    // first) — without this, any pointer's up committed and ended whichever drag happened
    // to be in flight, at that pointer's own coordinates.
    if (!d || e.pointerId !== d.pointerId_) return
    cancelPendingDrag(state)
    // Claim (null out) `drag` BEFORE releasing capture: releasePointerCapture can synchronously
    // dispatch lostpointercapture (spec leaves the exact timing to "process pending pointer
    // capture", which runs between dispatches — implementation-dependent), and onLostCapture
    // also nulls `drag`. Reading `state.drag_` after that point would see null (or a new drag, if
    // one had already started) instead of the gesture this event belongs to — so everything
    // below operates on the locally-claimed `d`, never `state.drag_`.
    state.drag_ = null
    if (ctx.surface_.hasPointerCapture(e.pointerId)) ctx.surface_.releasePointerCapture(e.pointerId)
    // Apply the release event's own position synchronously — a coalesced rAF frame may have
    // been dropped, and the commit below reads mutated drag state, not e, so the final visual
    // (and the value it derives from) must come from this event.
    applyDrag(ctx, state, d, e)
    const p = imgPx(ctx.base_, ctx.manifest_, e)
    if (d.kind === "threshold") {
        (ctx.host_ as unknown as { value: unknown }).value = thresholdDrag.end(d, p)
        ctx.host_.dispatchEvent(new CustomEvent("input"))
    } else if (d.kind === "view") {
        const value = viewDrag.end(d, p)
        if (value !== undefined) {
            (ctx.host_ as unknown as { value: unknown }).value = value
            ctx.host_.dispatchEvent(new CustomEvent("input"))
        }
    } else {
        (ctx.host_ as unknown as { value: unknown }).value = roiDrag.end(d, state, ctx.selGroup_, ctx.manifest_)
        ctx.host_.dispatchEvent(new CustomEvent("input"))
    }
    hideTip(ctx, state); ctx.surface_.classList.remove("grabbing")
    if (d.kind === "view") {
        const dist = Math.hypot(p.x - d.x0_, p.y - d.y0_)
        state.justDragged_ = dist >= viewDrag.VIEW_MIN_PX
    } else {
        state.justDragged_ = true
    }
}

// pointercancel: the interaction was aborted out from under us (browser-initiated gesture
// takeover, stylus leaving range, etc.) — unlike pointerup this is not a commit, just a clean
// reset so drag can't stay non-null with the cursor stuck in "grabbing". None of the three kinds
// roll back their visual state on cancel (the box/line intentionally stays put), so there's no
// per-kind cancel hook to call into here.
export function onCancel(ctx: OverlayCtx, state: OverlayState, e: PointerEvent): void {
    // Same pointerId gate as onUp — a non-owning pointer's cancel must not touch a drag it
    // didn't start.
    if (!state.drag_ || e.pointerId !== state.drag_.pointerId_) return
    cancelPendingDrag(state)
    state.drag_ = null // claim before releasePointerCapture, same reentrancy hazard as onUp
    if (ctx.surface_.hasPointerCapture(e.pointerId)) ctx.surface_.releasePointerCapture(e.pointerId)
    ctx.surface_.classList.remove("grabbing")
    hideTip(ctx, state)
}

// lostpointercapture fires after any capture release, including the explicit ones in onUp/
// onCancel above (where drag is already null by the time this runs — a no-op then). It's the
// safety net for capture being taken away some other way while a drag is still in progress.
export function onLostCapture(ctx: OverlayCtx, state: OverlayState): void {
    cancelPendingDrag(state)
    if (!state.drag_) return
    ctx.surface_.classList.remove("grabbing")
    hideTip(ctx, state)
    state.drag_ = null
}

// The click→bond commit, factored out of onClick so keyboard.ts's Enter/Space can dispatch the
// identical bond value for a keyboard-focused hit — same highlight draw, same payload
// resolution, same "input" event.
export function commitClick(ctx: OverlayCtx, state: OverlayState, hit: Hit, px: number, py: number): void {
    drawHi(state, ctx.hiGroup_, hit)
    // Keep keyboard focus in sync with the mouse, but ONLY once keyboard nav is already
    // engaged (state.focusIdx_ !== null) — gating on that, not just "click landed on a
    // focus-list element", matters for a PURE mouse user: setting state.focusHit_ unconditionally
    // regressed the locked hover-fade recipe, because restoreFocus's later redraw
    // (hover.ts:restoreFocus -> highlight.ts:drawHi) is a no-op when hiKey_ already matches —
    // so a click, then a miss, would leave the ring never fading at all for someone who never
    // touched the keyboard. Gated this way: arrowing to element A then mouse-clicking element B
    // still resyncs focusHit_ to B (so a later miss doesn't wrongly restore A's stale ring), but
    // clicking B with no prior keyboard focus leaves focusHit_ null and the plain hover-fade
    // path (clearHi) runs exactly as before this feature existed.
    if (state.focusIdx_ !== null) {
        // A click on a non-focus-list kind (e.g. :grid/:axis) while keyboard focus was already
        // on some other element must leave that focus alone, not clear it.
        const idx = ctx.focusable_.findIndex((r) => r.layer_ === hit.layer && r.index_ === hit.index)
        if (idx >= 0) {
            state.focusIdx_ = idx
            state.focusHit_ = hit
            state.focusTipHtml_ = null
            state.focusTipCss_ = null
        }
    }
    ;(ctx.host_ as unknown as { value: unknown }).value = { layer: hit.layer.id, index: hit.index, payload: resolvePayload(hit, ctx.manifest_, px, py) }
    ctx.host_.dispatchEvent(new CustomEvent("input"))
}

export function onClick(ctx: OverlayCtx, state: OverlayState, e: MouseEvent): void {
    if (state.justDragged_) { state.justDragged_ = false; return }
    const p = imgPx(ctx.base_, ctx.manifest_, e)
    const hit = hitTest(ctx.manifest_, p.x, p.y, "click")
    if (!hit) return // miss = no-op, no round-trip
    commitClick(ctx, state, hit, p.x, p.y)
}

// Single entry point for pointermove: while a drag owns the pointer, route to the
// rAF-coalesced drag path; otherwise it's hover. Pointer capture (set in onDown) keeps these
// events targeted at `surface` even once the pointer leaves its bounds or the viewport.
export function onPointerMove(ctx: OverlayCtx, state: OverlayState, e: PointerEvent): void {
    if (state.drag_) {
        // A second pointer's move (e.g. two-finger touch, now let through by touch-action:none)
        // must not steer a drag it didn't start — ignore it outright rather than falling through
        // to hover, which would fight the "grabbing" cursor and hi/tip state mid-drag.
        if (e.pointerId !== state.drag_.pointerId_) return
        queueDrag(ctx, state, state.drag_, e)
    } else onMove(ctx, state, e)
}
