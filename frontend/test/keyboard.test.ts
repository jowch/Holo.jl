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
        const { surface, host } = setup(manifest)
        let clickValue: unknown
        host.addEventListener("input", () => { clickValue = (host as unknown as { value: unknown }).value })
        // click a[1] directly: circle at image (300,100), display scale 1200/600=2 -> client (150,50)
        surface.dispatchEvent(new MouseEvent("click", { clientX: 150, clientY: 50, bubbles: true }))
        const viaClick = clickValue

        surface.focus()
        down(surface, "ArrowRight") // a[0]
        down(surface, "ArrowRight") // a[1]
        let kbdValue: unknown
        host.addEventListener("input", () => { kbdValue = (host as unknown as { value: unknown }).value })
        down(surface, "Enter")
        expect(kbdValue).toEqual(viaClick)
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
        expect(leaving === null || leaving.classList.contains("holo-leave")).toBe(true)
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
})
