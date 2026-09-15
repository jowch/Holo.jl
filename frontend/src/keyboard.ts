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
import { cssPx } from "./state"
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

export function buildFocusable(manifest: Manifest): FocusRef[] {
    const out: FocusRef[] = []
    for (const layer of manifest.layers) {
        if (!FOCUSABLE_KINDS.has(layer.kind)) continue
        // A layer with neither :click nor :hover (e.g. a :drag-only layer, if one of these
        // kinds is ever built drag-only) has nothing for keyboard focus to show or dispatch.
        if (!layer.events.includes("click") && !layer.events.includes("hover")) continue
        const n = layerNElements(layer)
        for (let i = 0; i < n; i++) out.push({ layer, index: i })
    }
    return out
}

function hitFor(ref: FocusRef): Hit {
    return { layer: ref.layer, ...hitLayerByIndex(ref.layer, ref.index) }
}

// Anchor point (image px) for the tooltip/announcement, per kind — mirrors
// test/e2e/kind_sweep.mjs's hitPoint(), which computes the same points for the live-verify
// click targets. Circle anchors below the marker (like a mouse hovering its lower edge would);
// rect/seg/poly anchor at their visual center.
function anchorImgPx(hit: Hit): { x: number; y: number } {
    const g = hit.geom as [string, ...number[]] | [string, number[]] | undefined
    if (!g) return { x: 0, y: 0 }
    if (g[0] === "circle") return { x: g[1] as number, y: (g[2] as number) + (g[3] as number) }
    if (g[0] === "rect") return { x: g[1] as number, y: g[2] as number }
    if (g[0] === "seg") return { x: ((g[1] as number) + (g[3] as number)) / 2, y: ((g[2] as number) + (g[4] as number)) / 2 }
    if (g[0] === "poly") {
        const ring = g[1] as number[]
        let sx = 0, sy = 0
        const n = ring.length / 2
        for (let k = 0; k < ring.length; k += 2) { sx += ring[k]; sy += ring[k + 1] }
        return { x: sx / n, y: sy / n }
    }
    return { x: 0, y: 0 }
}

// Position is relative to the element's own layer ("point 3 of 10" for a 10-point Scatter
// layer), not the flat cross-layer focus-list index — the number a user layers a Scatter
// `label` against is its own element count, not how many other layers happen to precede it.
function announceText(ref: FocusRef, plain: string): string {
    const total = layerNElements(ref.layer)
    const prefix = ref.layer.label ? `${ref.layer.label}, ` : ""
    const pos = `element ${ref.index + 1} of ${total}`
    return plain ? `${prefix}${pos}: ${plain}` : `${prefix}${pos}`
}

function scheduleAnnounce(ctx: OverlayCtx, state: OverlayState, text: string): void {
    if (state.announceTimer != null) clearTimeout(state.announceTimer)
    state.announceTimer = setTimeout(() => {
        state.announceTimer = null
        ctx.liveRegion.textContent = text
    }, ANNOUNCE_DEBOUNCE_MS)
}

// Move focus to `i` (clamped into range), or clear it entirely when `i` is null. The single
// entry point for every nav key below — draws the ring, positions the tooltip, and schedules
// the live-region announcement all in one place.
export function focusTo(ctx: OverlayCtx, state: OverlayState, i: number | null): void {
    const n = ctx.focusable.length
    if (i === null || n === 0) {
        state.focusIdx = null
        state.focusHit = null
        state.focusTipHtml = null
        state.focusTipCss = null
        ctx.surface.classList.remove("kbd-ring")
        clearHi(state, ctx.hiGroup, true)
        hideTip(ctx, state)
        scheduleAnnounce(ctx, state, "")
        return
    }
    const clamped = Math.max(0, Math.min(n - 1, i))
    state.focusIdx = clamped
    const ref = ctx.focusable[clamped]
    const hit = hitFor(ref)
    state.focusHit = hit
    ctx.surface.classList.add("kbd-ring")
    drawHi(state, ctx.hiGroup, hit)
    const { x, y } = anchorImgPx(hit)
    const css = cssPx(ctx.base, ctx.manifest, x, y)
    const html = showTipAt(ctx, state, hit, x, y, css.x, css.y)
    state.focusTipHtml = html
    state.focusTipCss = html === null ? null : css
    scheduleAnnounce(ctx, state, announceText(ref, plainTextForHit(hit)))
}

// First index of each distinct layer run in `list` (list is manifest-order, so a layer's
// elements are always contiguous).
function layerStarts(list: FocusRef[]): number[] {
    const starts: number[] = []
    let last: HitLayer | null = null
    for (let i = 0; i < list.length; i++) {
        if (list[i].layer !== last) { starts.push(i); last = list[i].layer }
    }
    return starts
}

function adjacentLayerStart(list: FocusRef[], cur: number, dir: 1 | -1): number {
    const starts = layerStarts(list)
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
    if (ctx.shadowRoot.activeElement !== ctx.surface) return
    const n = ctx.focusable.length
    if (n === 0) return
    const cur = state.focusIdx
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
            focusTo(ctx, state, adjacentLayerStart(ctx.focusable, cur ?? -1, 1))
            return
        case "PageUp":
            e.preventDefault(); e.stopPropagation()
            focusTo(ctx, state, adjacentLayerStart(ctx.focusable, cur ?? n, -1))
            return
        case "Enter":
        case " ":
            e.preventDefault(); e.stopPropagation()
            if (cur === null) return
            {
                const ref = ctx.focusable[cur]
                if (!ref.layer.events.includes("click")) return // hover-only layer: nothing to dispatch
                const hit = hitFor(ref)
                const { x, y } = anchorImgPx(hit)
                commitClick(ctx, state, hit, x, y)
            }
            return
        case "Escape":
            e.preventDefault(); e.stopPropagation()
            focusTo(ctx, state, null)
            ctx.surface.blur()
            return
        default:
            return // notably Tab: never prevented, or the surface becomes a keyboard trap
    }
}
