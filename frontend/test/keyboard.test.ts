// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest"
import { mount } from "../src/overlay"
import type { Manifest } from "../src/types"

function setup(manifest: Manifest) {
    const host = document.createElement("div")
    const img = document.createElement("img")
    img.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
    const script = document.createElement("script")
    host.append(img, script)
    document.body.append(host)
    mount(script, manifest)
    const shadow = (host.lastElementChild as HTMLElement).shadowRoot!
    const surface = shadow.querySelector(".surface") as HTMLElement
    return { host, surface, shadow }
}

// Two circle layers ("a": 2 points, "b": 1 point) so PageDown/Up and cross-layer order are
// exercised, plus one polyline (unlabeled) to prove kind-mixing preserves manifest order.
const manifest: Manifest = {
    width: 1200, height: 800, scaling: 2, transforms: {},
    layers: [
        { id: "a", kind: "circles", geometry: [100, 100, 10, 300, 100, 10], payloads: [{ v: 1 }, { v: 2 }], axis: "ax1", events: ["click", "hover"], label: "Scatter" },
        { id: "b", kind: "rects", geometry: [500, 500, 20, 20], payloads: [{ v: 3 }], axis: "ax1", events: ["click", "hover"] },
    ],
}

const down = (surface: HTMLElement, key: string): KeyboardEvent => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    surface.dispatchEvent(e)
    return e
}

// onMove (hover.ts) rAF-coalesces: a pointermove dispatched while a previous one's frame is
// still pending only updates the pending event, it doesn't apply synchronously. A test driving
// two pointermoves in a row (hover, then a miss) needs to flush between them, same as
// overlay.test.ts's identical helper.
const flushFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

// No layer in this file's manifest sets an explicit style.stroke, so every highlight lands in
// svg.masque-blend's g.hi (mount.ts) as a bare shape — svg.masque-plain's own g.hi stays empty
// throughout, and since svg.masque-blend is first in DOM order, plain ".hi > *" always finds the
// blend side's live child without needing to disambiguate between the two svgs.
describe("keyboard navigation", () => {
    it("ignores keys when the surface isn't focused", () => {
        const { surface } = setup(manifest)
        const e = down(surface, "ArrowRight")
        expect(e.defaultPrevented).toBe(false)
    })

    it("moves focus in manifest order (layer, then element) on ArrowRight, and clamps at the end", () => {
        const { surface } = setup(manifest)
        surface.focus()
        down(surface, "ArrowRight") // -> a[0]
        down(surface, "ArrowRight") // -> a[1]
        down(surface, "ArrowRight") // -> b[0]
        const e = down(surface, "ArrowRight") // clamp, stay at b[0]
        expect(e.defaultPrevented).toBe(true) // still a handled key even though it's a no-op move
    })

    it("ArrowLeft/Home/End move backward and to the ends", () => {
        const { surface, shadow } = setup(manifest)
        surface.focus()
        down(surface, "End")
        const ring = () => shadow.querySelector(".hi > *")
        expect(ring()).toBeTruthy()
        down(surface, "Home")
        expect(ring()).toBeTruthy()
        // ArrowLeft from the first element clamps, not wraps, to the same element
        down(surface, "ArrowLeft")
        expect(ring()).toBeTruthy()
    })

    it("PageDown jumps to the next layer's first element", () => {
        const { surface, host } = setup(manifest)
        surface.focus()
        down(surface, "ArrowRight") // a[0]
        down(surface, "PageDown") // -> b[0], the only element of layer b
        down(surface, "Enter")
        expect((host as unknown as { value: { layer: string; index: number } }).value).toMatchObject({ layer: "b", index: 0 })
    })

    it("Enter dispatches the identical bond payload a click on the same element would", () => {
        // Two independent mounts — a mouse click now syncs keyboard focus too (see the
        // "syncs keyboard focus to the clicked element" test below), so sharing one surface
        // between the click and the keyboard checks would make the click's own focus-sync
        // shift where the following ArrowRights land.
        const clickMount = setup(manifest)
        let clickValue: unknown
        clickMount.host.addEventListener("input", () => { clickValue = (clickMount.host as unknown as { value: unknown }).value })
        // click a[1] directly: circle at image (300,100), display scale 1200/600=2 -> client (150,50)
        clickMount.surface.dispatchEvent(new MouseEvent("click", { clientX: 150, clientY: 50, bubbles: true }))

        const kbdMount = setup(manifest)
        kbdMount.surface.focus()
        down(kbdMount.surface, "ArrowRight") // a[0]
        down(kbdMount.surface, "ArrowRight") // a[1]
        let kbdValue: unknown
        kbdMount.host.addEventListener("input", () => { kbdValue = (kbdMount.host as unknown as { value: unknown }).value })
        down(kbdMount.surface, "Enter")
        expect(kbdValue).toEqual(clickValue)
    })

    it("Escape clears the ring (fade-out, same as a hover miss) and blurs the surface", () => {
        const { surface, shadow } = setup(manifest)
        surface.focus()
        down(surface, "ArrowRight")
        expect(shadow.querySelector(".hi > *")).toBeTruthy()
        down(surface, "Escape")
        // Fades like any other g.hi clear (highlight.ts's clearHi) rather than an instant
        // remove — same convention overlay.test.ts asserts for hover-miss.
        const leaving = shadow.querySelector(".hi > *")
        expect(leaving === null || leaving.classList.contains("masque-leave")).toBe(true)
        expect(shadow.activeElement).not.toBe(surface)
    })

    it("preventDefault only for handled keys — Tab passes through untouched", () => {
        const { surface } = setup(manifest)
        surface.focus()
        const tab = down(surface, "Tab")
        expect(tab.defaultPrevented).toBe(false)
        const right = down(surface, "ArrowRight")
        expect(right.defaultPrevented).toBe(true)
    })

    it("live region text updates, debounced to the last of a rapid burst", async () => {
        vi.useFakeTimers()
        try {
            const { surface, shadow } = setup(manifest)
            const live = shadow.querySelector('[aria-live="polite"]') as HTMLElement
            expect(live.textContent).toBe("")
            surface.focus()
            down(surface, "ArrowRight") // a[0] — label present
            down(surface, "ArrowRight") // a[1] — burst: only this one should announce
            expect(live.textContent).toBe("") // not yet — debounced
            vi.advanceTimersByTime(200)
            expect(live.textContent).toContain("Scatter")
            expect(live.textContent).toContain("element 2 of 2") // layer "a" has 2 points
        } finally {
            vi.useRealTimers()
        }
    })

    it("omits the label prefix when the layer has none", async () => {
        vi.useFakeTimers()
        try {
            const { surface, shadow } = setup(manifest)
            const live = shadow.querySelector('[aria-live="polite"]') as HTMLElement
            surface.focus()
            down(surface, "End") // -> b[0], unlabeled (layer "b" has 1 rect)
            vi.advanceTimersByTime(200)
            expect(live.textContent).toMatch(/^element 1 of 1/)
        } finally {
            vi.useRealTimers()
        }
    })

    it("pointer hover and keyboard focus never draw two rings", () => {
        const { surface, shadow } = setup(manifest)
        surface.focus()
        down(surface, "ArrowRight") // focus a[0]
        // hover a different element (a[1]): image (300,100) -> client (150,50)
        surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 150, clientY: 50, bubbles: true }))
        expect(shadow.querySelectorAll(".hi > *").length).toBe(1)
        // move the mouse off any element — the focus ring (still a[0]) must reappear, not vanish
        surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 5, bubbles: true }))
        expect(shadow.querySelectorAll(".hi > *").length).toBe(1)
    })

    it("a pointer miss restores BOTH the ring and the tooltip content of the keyboard-focused element", async () => {
        const { surface, shadow } = setup(manifest)
        surface.focus()
        down(surface, "ArrowRight") // focus a[0] — has a real tooltip (auto-table from {v: 1})
        const tip = shadow.querySelector(".masque-tip") as HTMLElement
        expect(tip.classList.contains("show")).toBe(true)
        const focusedHtml = tip.innerHTML
        // hover a different element (a[1]) — overwrites the visible tooltip with a[1]'s content
        surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 150, clientY: 50, bubbles: true }))
        await flushFrame()
        expect(tip.innerHTML).not.toBe(focusedHtml)
        // move to empty canvas — restoreFocus (hover.ts) must bring back a[0]'s cached
        // tooltip content, not just the ring (its focusTipHtml/focusTipCss branch).
        surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 5, bubbles: true }))
        await flushFrame()
        expect(tip.classList.contains("show")).toBe(true)
        expect(tip.innerHTML).toBe(focusedHtml)
    })

    it(":grid layers are excluded from the focus list", () => {
        const gridManifest: Manifest = {
            width: 1200, height: 800, scaling: 2,
            transforms: { ax1: { xlims: [0, 10], ylims: [0, 10], xscale: "identity", yscale: "identity",
                viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
            layers: [{ id: "g", kind: "grid", axis: "ax1", events: ["click", "hover"], payloads: [],
                geometry: { xedges: [0, 600, 1200], yedges: [0, 400, 800], ncols: 2, nrows: 2 } }],
        }
        const { surface, shadow } = setup(gridManifest)
        surface.focus()
        down(surface, "ArrowRight")
        expect(shadow.querySelector(".hi > *")).toBeFalsy()
    })

    it("ArrowDown/ArrowUp are aliases for Right/Left", () => {
        const { surface, host } = setup(manifest)
        surface.focus()
        down(surface, "ArrowDown") // a[0]
        down(surface, "ArrowDown") // a[1]
        down(surface, "ArrowUp") // back to a[0]
        down(surface, "Enter")
        expect((host as unknown as { value: { layer: string; index: number } }).value).toMatchObject({ layer: "a", index: 0 })
    })

    it("PageUp with no current focus goes to the last layer's start; PageDown with none goes to the first", () => {
        const { surface, host } = setup(manifest)
        surface.focus()
        down(surface, "PageUp") // no focus yet -> last layer ("b")'s first element
        down(surface, "Enter")
        expect((host as unknown as { value: { layer: string; index: number } }).value).toMatchObject({ layer: "b", index: 0 })

        down(surface, "Escape")
        surface.focus() // Escape blurred the surface — re-focus, same as a real Tab back in
        down(surface, "PageDown") // no focus yet -> first layer ("a")'s first element
        down(surface, "Enter")
        expect((host as unknown as { value: { layer: string; index: number } }).value).toMatchObject({ layer: "a", index: 0 })
    })

    it("Enter on a hover-only layer (no :click) is a no-op — no bond dispatch", () => {
        const hoverOnly: Manifest = {
            width: 1200, height: 800, scaling: 2, transforms: {},
            layers: [{ id: "h", kind: "circles", geometry: [100, 100, 10], payloads: [{ v: 1 }], axis: "ax1", events: ["hover"] }],
        }
        const { surface, host } = setup(hoverOnly)
        let fired = false
        host.addEventListener("input", () => { fired = true })
        surface.focus()
        down(surface, "ArrowRight")
        down(surface, "Enter")
        expect(fired).toBe(false)
    })

    it("focusing an element with tooltip=false shows no tooltip but still announces position", async () => {
        vi.useFakeTimers()
        try {
            const noTip: Manifest = {
                width: 1200, height: 800, scaling: 2, transforms: {},
                layers: [{ id: "nt", kind: "circles", geometry: [100, 100, 10], payloads: [{ v: 1 }], axis: "ax1", events: ["click", "hover"], tooltip: false }],
            }
            const { surface, shadow } = setup(noTip)
            surface.focus()
            down(surface, "ArrowRight")
            expect(shadow.querySelector(".masque-tip")?.classList.contains("show")).toBe(false)
            vi.advanceTimersByTime(200)
            const live = shadow.querySelector('[aria-live="polite"]') as HTMLElement
            expect(live.textContent).toBe("element 1 of 1") // no ": <plain>" suffix — tooltip suppressed
        } finally {
            vi.useRealTimers()
        }
    })

    it("focus on a template-tooltip layer shows the template in the tooltip and announces plain text", async () => {
        vi.useFakeTimers()
        try {
            const tmplManifest: Manifest = {
                width: 1200, height: 800, scaling: 2, transforms: {},
                layers: [{
                    id: "t", kind: "circles", geometry: [100, 100, 10], payloads: [{ name: "A & B" }],
                    axis: "ax1", events: ["click", "hover"],
                    template: ["<b>", { f: "name" }, "</b>"],
                }],
            }
            const { surface, shadow } = setup(tmplManifest)
            surface.focus()
            down(surface, "ArrowRight")
            const tip = shadow.querySelector(".masque-tip") as HTMLElement
            expect(tip.innerHTML).toContain("<b>")
            expect(tip.innerHTML).toContain("&amp;") // esc() ran on the interpolated field
            vi.advanceTimersByTime(200)
            const live = shadow.querySelector('[aria-live="polite"]') as HTMLElement
            // plain text: tags stripped, entities un-escaped — not "A &amp; B" or "<b>A & B</b>"
            expect(live.textContent).toBe("element 1 of 1: A & B")
        } finally {
            vi.useRealTimers()
        }
    })

    it("a pointer miss keeps a tooltip-suppressed focus ring and shows no tooltip", () => {
        const noTip: Manifest = {
            width: 1200, height: 800, scaling: 2, transforms: {},
            layers: [{ id: "nt", kind: "circles", geometry: [100, 100, 10], payloads: [{ v: 1 }], axis: "ax1", events: ["click", "hover"], tooltip: false }],
        }
        const { surface, shadow } = setup(noTip)
        surface.focus()
        down(surface, "ArrowRight")
        // pointer miss (nothing at 5,5) — restoreFocus should redraw the ring, and since
        // focusTipHtml is null (tooltip suppressed), hide rather than show the tooltip.
        surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 5, bubbles: true }))
        expect(shadow.querySelector(".hi > *")).toBeTruthy()
        expect(shadow.querySelector(".masque-tip")?.classList.contains("show")).toBe(false)
    })

    it("PageDown/PageUp clamp (don't wrap) at the last/first layer", () => {
        const { surface, host } = setup(manifest)
        surface.focus()
        down(surface, "End") // -> b[0], the last layer
        down(surface, "PageDown") // already in the last layer — clamp, stay at b[0]
        down(surface, "Enter")
        expect((host as unknown as { value: { layer: string; index: number } }).value).toMatchObject({ layer: "b", index: 0 })

        down(surface, "Home") // -> a[0], the first layer
        down(surface, "PageUp") // already in the first layer — clamp, stay at a[0]
        down(surface, "Enter")
        expect((host as unknown as { value: { layer: string; index: number } }).value).toMatchObject({ layer: "a", index: 0 })
    })

    it("DOM focus leaving the surface (Tab-away or focus moving elsewhere) clears keyboard focus, not just Escape", () => {
        const { surface, shadow } = setup(manifest)
        surface.focus()
        down(surface, "ArrowRight")
        expect(shadow.querySelector(".hi > *")).toBeTruthy()
        surface.blur() // stands in for "Tab moved focus elsewhere" — fires focusout either way
        const leaving = shadow.querySelector(".hi > *")
        expect(leaving === null || leaving.classList.contains("masque-leave")).toBe(true)
        // A subsequent pointer miss must NOT restore a fresh ring — restoreFocus's cache
        // should be cleared, not just visually faded, so the element the fading circle above
        // never gets re-entered with "masque-enter" (the regression restoreFocus (hover.ts)
        // could reintroduce if focusout didn't call focusTo(ctx, state, null)). Real timers
        // here, so the fading circle from blur() may still be mid-fade-out in the DOM —
        // exactly like the "Escape clears the ring" test above, that's expected, not a miss.
        surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 5, bubbles: true }))
        const afterMiss = shadow.querySelector(".hi > *")
        expect(afterMiss === null || afterMiss.classList.contains("masque-leave")).toBe(true)
        expect(afterMiss?.classList.contains("masque-enter")).not.toBe(true)
    })

    it("Enter does not preventDefault when nothing is keyboard-focused yet", () => {
        // e.g. a mouse click focused the surface but didn't move keyboard focus (cur === null)
        // — Enter/Space must not swallow a subsequent native action for no reason.
        const { surface } = setup(manifest)
        surface.focus()
        const enterNoFocus = down(surface, "Enter")
        expect(enterNoFocus.defaultPrevented).toBe(false)
    })

    it("Space does not preventDefault on a hover-only (no :click) focused layer", () => {
        const hoverOnly: Manifest = {
            width: 1200, height: 800, scaling: 2, transforms: {},
            layers: [{ id: "h", kind: "circles", geometry: [100, 100, 10], payloads: [{ v: 1 }], axis: "ax1", events: ["hover"] }],
        }
        const { surface } = setup(hoverOnly)
        surface.focus()
        down(surface, "ArrowRight")
        const spaceHoverOnly = down(surface, " ")
        expect(spaceHoverOnly.defaultPrevented).toBe(false)
    })

    it("Enter DOES preventDefault when a click-eligible element is keyboard-focused", () => {
        const { surface } = setup(manifest)
        surface.focus()
        down(surface, "ArrowRight")
        const enterWithFocus = down(surface, "Enter")
        expect(enterWithFocus.defaultPrevented).toBe(true)
    })

    it("a mouse click syncs keyboard focus to the clicked element (ring/bond agree)", () => {
        const { surface, shadow, host } = setup(manifest)
        surface.focus()
        down(surface, "ArrowRight") // keyboard-focus a[0]
        // mouse-click a[1]: circle at image (300,100), display scale 1200/600=2 -> client (150,50)
        surface.dispatchEvent(new MouseEvent("click", { clientX: 150, clientY: 50, bubbles: true }))
        expect((host as unknown as { value: { layer: string; index: number } }).value).toMatchObject({ layer: "a", index: 1 })
        // A later pointer miss must restore a[1]'s ring (the clicked element), not a[0]'s
        // (the stale keyboard focus commitClick is supposed to overwrite).
        surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 5, bubbles: true }))
        const ring = shadow.querySelector(".hi > *") as SVGCircleElement
        expect(ring).toBeTruthy()
        expect(ring.getAttribute("cx")).toBe("300") // a[1]'s cx, not a[0]'s (100)
    })

    it("a pure-mouse click (no prior keyboard focus) does NOT pin the ring — it still fades on a later miss", async () => {
        // Regression guard: syncing focusIdx/focusHit unconditionally on every click broke the
        // locked hover-fade recipe for a mouse-only user — restoreFocus's later redraw is a
        // no-op when hiKey already matches, so the ring would never fade at all. The sync must
        // only engage once keyboard nav is already active (state.focusIdx !== null).
        const { surface, shadow, host } = setup(manifest)
        // hover then click a[0], via the mouse only — surface.focus() is never called.
        surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 50, clientY: 50, bubbles: true }))
        await flushFrame() // let onMove's rAF coalescing settle before the next pointermove
        surface.dispatchEvent(new MouseEvent("click", { clientX: 50, clientY: 50, bubbles: true }))
        expect((host as unknown as { value: { layer: string; index: number } }).value).toMatchObject({ layer: "a", index: 0 })
        expect(shadow.querySelector(".hi > *")).toBeTruthy()
        // move to empty canvas — the ring must fade, not persist forever.
        surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 5, bubbles: true }))
        await flushFrame()
        const afterMiss = shadow.querySelector(".hi > *")
        expect(afterMiss === null || afterMiss.classList.contains("masque-leave")).toBe(true)
    })

    it("a click on a non-focusable kind (e.g. :grid) leaves existing keyboard focus untouched", () => {
        const mixedManifest: Manifest = {
            width: 1200, height: 800, scaling: 2,
            transforms: { ax1: { xlims: [0, 10], ylims: [0, 10], xscale: "identity", yscale: "identity",
                viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
            layers: [
                { id: "a", kind: "circles", geometry: [100, 100, 10], payloads: [{ v: 1 }], axis: "ax1", events: ["click", "hover"] },
                { id: "g", kind: "grid", axis: "ax1", events: ["click", "hover"], payloads: [],
                    geometry: { xedges: [0, 600, 1200], yedges: [0, 400, 800], ncols: 2, nrows: 2 } },
            ],
        }
        const { surface, shadow, host } = setup(mixedManifest)
        surface.focus()
        down(surface, "ArrowRight") // keyboard-focus a[0] (the only focusable element)
        // click a grid cell (not in the focus list): image (300,600) -> client (150,300)
        surface.dispatchEvent(new MouseEvent("click", { clientX: 150, clientY: 300, bubbles: true }))
        expect((host as unknown as { value: { layer: string } }).value).toMatchObject({ layer: "g" })
        // keyboard focus (a[0]'s ring) must still be there — the grid click didn't clear it
        surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 5, bubbles: true }))
        expect(shadow.querySelector(".hi > *")).toBeTruthy()
    })

    // A single NaN vertex invalidates BOTH segments touching it (matches geometry.ts's own
    // hit-test skip, which checks each segment's endpoints independently) — 5 vertices around
    // one NaN gives 4 candidate segments, 2 valid (0 and 3) and 2 invalid (1 and 2).
    const gappedGeometry = [0, 0, 50, 50, NaN, NaN, 100, 100, 200, 200]
    const gappedPayloads = [{ s: 0 }, { s: 1 }, { s: 2 }, { s: 3 }]

    it(":polyline skips NaN-gap segments in the focus list (matches the mouse hit-test)", () => {
        const gappedManifest: Manifest = {
            width: 1200, height: 800, scaling: 2, transforms: {},
            layers: [{ id: "l", kind: "polyline", geometry: gappedGeometry, payloads: gappedPayloads, axis: "ax1", events: ["click", "hover"] }],
        }
        const { surface, shadow, host } = setup(gappedManifest)
        surface.focus()
        down(surface, "ArrowRight") // must land on segment 0 (valid)
        let ring = shadow.querySelector(".hi > *") as SVGLineElement
        expect(ring.getAttribute("x1")).toBe("0")
        expect(ring.getAttribute("x2")).toBe("50")
        down(surface, "ArrowRight") // must skip segments 1 and 2 (both touch the NaN vertex) straight to 3
        ring = shadow.querySelector(".hi > *") as SVGLineElement
        expect(ring.getAttribute("x1")).toBe("100")
        expect(ring.getAttribute("x2")).toBe("200")
        down(surface, "Enter")
        expect((host as unknown as { value: { layer: string; index: number } }).value).toMatchObject({ layer: "l", index: 3 })
    })

    it("announces position/count over non-gap segments only, for a gapped :polyline", async () => {
        vi.useFakeTimers()
        try {
            const gappedManifest: Manifest = {
                width: 1200, height: 800, scaling: 2, transforms: {},
                layers: [{ id: "l", kind: "polyline", geometry: gappedGeometry, payloads: gappedPayloads, axis: "ax1", events: ["click", "hover"], label: "Line" }],
            }
            const { surface, shadow } = setup(gappedManifest)
            surface.focus()
            down(surface, "ArrowRight") // segment 0 of 2 focusable (not "of 4")
            vi.advanceTimersByTime(200)
            const live = shadow.querySelector('[aria-live="polite"]') as HTMLElement
            expect(live.textContent).toBe("Line, element 1 of 2: s 0")
            down(surface, "ArrowRight") // segment 3, announced as "2 of 2"
            vi.advanceTimersByTime(200)
            expect(live.textContent).toBe("Line, element 2 of 2: s 3")
        } finally {
            vi.useRealTimers()
        }
    })

    it("the tooltip is placed at a segment's midpoint and a polygon's centroid, not offset elsewhere", () => {
        // display scale = manifest.width(1200) / base rect width(600) = 2, so image px -> CSS
        // px is /2; happy-dom has no layout engine (tip/surface report zero size), so
        // placeAnchored takes its degenerate branch: left = anchor.x, top = anchor.top - 10
        // (geometry.ts's ANCHOR_GAP), exactly — segments/polygons have no separate top edge, so
        // anchor.top === anchor.y (the midpoint/centroid itself).
        const mixedManifest: Manifest = {
            width: 1200, height: 800, scaling: 2, transforms: {},
            layers: [
                { id: "seg", kind: "segments", geometry: [0, 0, 100, 100], payloads: [{ v: 1 }], axis: "ax1", events: ["click", "hover"] },
                { id: "pg", kind: "polygons", geometry: [[0, 0, 10, 0, 10, 10, 0, 10]], payloads: [{ v: 2 }], axis: "ax1", events: ["click", "hover"] },
            ],
        }
        const { surface, shadow } = setup(mixedManifest)
        surface.focus()
        const tip = shadow.querySelector(".masque-tip") as HTMLElement
        down(surface, "ArrowRight") // seg[0]: midpoint of (0,0)-(100,100) = image (50,50) -> CSS (25,25)
        expect(tip.style.left).toBe("25px")
        expect(tip.style.top).toBe("15px") // 25 - ANCHOR_GAP(10)
        down(surface, "ArrowRight") // pg[0]: centroid of the 10x10 square = image (5,5) -> CSS (2.5,2.5)
        expect(tip.style.left).toBe("2.5px")
        expect(tip.style.top).toBe("0px") // max(0, 2.5 - 10)
    })
})
