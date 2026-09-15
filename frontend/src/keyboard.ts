// Keyboard navigation + screen-reader announcements for the overlay surface. Focus moves over
// a flat, manifest-order list of hittable elements (built once by buildFocusable); the ring and
// tooltip reuse the existing hover/highlight machinery (drawHi, showTipAt) so there is exactly
// one visual language for "this element is what you're on" whether you got there by mouse or
// keyboard — see hover.ts's restoreFocus for how the two stay in sync on a pointer miss.
import { hitLayerByIndex, layerNElements } from "./selection"
import { drawHi, clearHi } from "./highlight"
import { showTipAt, hideTip } from "./hover"
import { commitClick } from "./bond"
import { plainTextForHit } from "./template"
import { cssAnchor } from "./state"
import { anchorFor } from "./geometry"
import type { OverlayCtx, OverlayState } from "./state"
import type { FocusRef, Hit, HitLayer, Manifest } from "./types"

// Debounce so a burst of arrow presses (holding the key down) announces only the element you
// land on, not every one you pass through.
const ANNOUNCE_DEBOUNCE_MS = 150

// :grid is excluded even though it's element-indexed: hitLayerByIndex (selection.ts) throws for
// it (grid isn't in SELECTED_KINDS — no pre-highlight geometry helper), its payloads[] is empty
// (values are resolved client-side from a (i,j) lookup, not positional), and ncols*nrows is
// unbounded (a 1000x1000 heatmap is not something you arrow through one cell at a time).
// :axis/:threshold/:roi/:view are continuous or drag-only, not element-indexed at all.
const FOCUSABLE_KINDS = new Set(["circles", "rects", "polygons", "segments", "polyline"])

// A :polyline's flat [x,y,…] vertex array uses NaN as Julia's gap sentinel (interactables.jl's
// `_q`) — geometry.ts's hitLayer already skips a segment with either endpoint NaN for mouse
// hover/click (`Number.isNaN(x0) || Number.isNaN(x1)`, checked on x only since a real gap
// always carries through both coordinates of the same vertex). Do the same here: an
// unfiltered gap "segment" would draw a highlight `<line>` with a NaN coordinate (a Chromium
// console error) and announce/dispatch an element the mouse can never reach.
function isGapSegment(layer: HitLayer, k: number): boolean {
    const a = layer.geometry as number[]
    return Number.isNaN(a[2 * k]) || Number.isNaN(a[2 * k + 2])
}

export function buildFocusable(manifest: Manifest): FocusRef[] {
    const out: FocusRef[] = []
    for (const layer of manifest.layers) {
        if (!FOCUSABLE_KINDS.has(layer.kind)) continue
        // A layer with neither :click nor :hover (e.g. a :drag-only layer, if one of these
        // kinds is ever built drag-only) has nothing for keyboard focus to show or dispatch.
        if (!layer.events.includes("click") && !layer.events.includes("hover")) continue
        const n = layerNElements(layer)
        const indices: number[] = []
        for (let i = 0; i < n; i++) {
            if (layer.kind === "polyline" && isGapSegment(layer, i)) continue
            indices.push(i)
        }
        indices.forEach((index, k) => out.push({ layer_: layer, index_: index, ordinal_: k + 1, layerTotal_: indices.length }))
    }
    return out
}

function hitFor(ref: FocusRef): Hit {
    return { layer: ref.layer_, ...hitLayerByIndex(ref.layer_, ref.index_) }
}

// Position is relative to the element's own layer ("element 3 of 10" for a 10-point Scatter
// layer), not the flat cross-layer focus-list index — the number a user labels a Scatter
// `label` against is its own element count, not how many other layers happen to precede it.
// Uses ref.ordinal_/layerTotal_ (computed once in buildFocusable), not layerNElements(layer) —
// they differ once a :polyline has any NaN-gap segments skipped from the focus list.
function announceText(ref: FocusRef, plain: string): string {
    const prefix = ref.layer_.label ? `${ref.layer_.label}, ` : ""
    const pos = `element ${ref.ordinal_} of ${ref.layerTotal_}`
    return plain ? `${prefix}${pos}: ${plain}` : `${prefix}${pos}`
}

function scheduleAnnounce(ctx: OverlayCtx, state: OverlayState, text: string): void {
    if (state.announceTimer_ != null) clearTimeout(state.announceTimer_)
    state.announceTimer_ = setTimeout(() => {
        state.announceTimer_ = null
        ctx.liveRegion_.textContent = text
    }, ANNOUNCE_DEBOUNCE_MS)
}

// Move focus to `i` (clamped into range), or clear it entirely when `i` is null. The single
// entry point for every nav key below — draws the ring, positions the tooltip, and schedules
// the live-region announcement all in one place.
export function focusTo(ctx: OverlayCtx, state: OverlayState, i: number | null): void {
    const n = ctx.focusable_.length
    if (i === null || n === 0) {
        state.focusIdx_ = null
        state.focusHit_ = null
        state.focusTipHtml_ = null
        state.focusTipCss_ = null
        ctx.surface_.classList.remove("kbd-ring")
        clearHi(state, ctx.hiGroup_, true)
        hideTip(ctx, state)
        scheduleAnnounce(ctx, state, "")
        return
    }
    const clamped = Math.max(0, Math.min(n - 1, i))
    state.focusIdx_ = clamped
    const ref = ctx.focusable_[clamped]
    const hit = hitFor(ref)
    state.focusHit_ = hit
    ctx.surface_.classList.add("kbd-ring")
    drawHi(state, ctx.hiGroup_, hit)
    // anchorFor(hit, null): no pointer to derive a "closest point on segment"/"cursor inside
    // polygon" placement from, so this falls back to the midpoint/centroid rule (geometry.ts).
    const anchor = anchorFor(hit, null)
    const css = cssAnchor(ctx.base_, ctx.manifest_, anchor)
    const html = showTipAt(ctx, state, hit, anchor.x, anchor.y, css)
    state.focusTipHtml_ = html
    state.focusTipCss_ = html === null ? null : css
    scheduleAnnounce(ctx, state, announceText(ref, plainTextForHit(hit)))
}

// First index of each distinct layer run in `list` (list is manifest-order, so a layer's
// elements are always contiguous). Computed once by mount.ts alongside buildFocusable and
// cached on OverlayCtx — PageUp/PageDown used to recompute this by rescanning the whole focus
// list on every keypress.
export function computeLayerStarts(list: FocusRef[]): number[] {
    const starts: number[] = []
    let last: HitLayer | null = null
    for (let i = 0; i < list.length; i++) {
        if (list[i].layer_ !== last) { starts.push(i); last = list[i].layer_ }
    }
    return starts
}

function adjacentLayerStart(starts: number[], cur: number, dir: 1 | -1): number {
    if (starts.length === 0) return cur
    if (dir === 1) {
        for (const s of starts) if (s > cur) return s
        return starts[starts.length - 1]
    }
    for (let k = starts.length - 1; k >= 0; k--) if (starts[k] < cur) return starts[k]
    return starts[0]
}

// Handles ArrowRight/Down (next), ArrowLeft/Up (previous), Home/End, PageDown/Up (next/previous
// layer), Enter/Space (dispatch the click bond for the focused element), and Escape (clear +
// blur). Everything else — Tab above all, so the browser's own focus order still works — passes
// through untouched. Gated on the surface actually having DOM focus (not just this listener
// being attached to it): a keydown dispatched programmatically at the surface without focus, or
// arriving after a click moved focus elsewhere, must not steer the overlay.
export function handleKeydown(ctx: OverlayCtx, state: OverlayState, e: KeyboardEvent): void {
    if (ctx.shadowRoot_.activeElement !== ctx.surface_) return
    const n = ctx.focusable_.length
    if (n === 0) return
    const cur = state.focusIdx_
    switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
            e.preventDefault(); e.stopPropagation()
            focusTo(ctx, state, cur === null ? 0 : cur + 1)
            return
        case "ArrowLeft":
        case "ArrowUp":
            e.preventDefault(); e.stopPropagation()
            focusTo(ctx, state, cur === null ? 0 : cur - 1)
            return
        case "Home":
            e.preventDefault(); e.stopPropagation()
            focusTo(ctx, state, 0)
            return
        case "End":
            e.preventDefault(); e.stopPropagation()
            focusTo(ctx, state, n - 1)
            return
        case "PageDown":
            e.preventDefault(); e.stopPropagation()
            focusTo(ctx, state, adjacentLayerStart(ctx.layerStarts_, cur ?? -1, 1))
            return
        case "PageUp":
            e.preventDefault(); e.stopPropagation()
            focusTo(ctx, state, adjacentLayerStart(ctx.layerStarts_, cur ?? n, -1))
            return
        case "Enter":
        case " ": {
            // preventDefault only when there's actually something to dispatch: unconditionally
            // calling it here would swallow Space's native scroll for a mouse click that
            // focused the surface but landed nothing keyboard-focused (cur === null), or a
            // hover-only layer with no :click to dispatch.
            if (cur === null) return
            const ref = ctx.focusable_[cur]
            if (!ref.layer_.events.includes("click")) return // hover-only layer: nothing to dispatch
            e.preventDefault(); e.stopPropagation()
            const hit = hitFor(ref)
            const { x, y } = anchorFor(hit, null)
            commitClick(ctx, state, hit, x, y)
            return
        }
        case "Escape":
            e.preventDefault(); e.stopPropagation()
            focusTo(ctx, state, null)
            ctx.surface_.blur()
            return
        default:
            return // notably Tab: never prevented, or the surface becomes a keyboard trap
    }
}
