// @vitest-environment happy-dom
import { describe, it, expect } from "vitest"
import { mount } from "../src/overlay"
import type { Manifest } from "../src/types"

// build a light-DOM host (img + script) like the Julia widget emits, with layout mocked
function setup() {
    const host = document.createElement("div")
    const img = document.createElement("img")
    Object.defineProperty(img, "naturalWidth", { value: 1200 })
    img.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
    const script = document.createElement("script")
    host.append(img, script)
    document.body.append(host)
    return { host, img, script }
}

const manifest: Manifest = {
    width: 1200, height: 800, scaling: 2, transforms: {},
    layers: [{ id: "pts", kind: "circles", geometry: [600, 400, 20], payloads: [{ i: 0 }], axis: "ax1", events: ["click", "hover"] }],
}

const shadowOf = (host: HTMLElement) => (host.lastElementChild as HTMLElement).shadowRoot!

describe("mount", () => {
    it("builds a shadow overlay and round-trips a click to host.value", () => {
        const { host, script } = setup()
        mount(script, manifest)
        const shadow = shadowOf(host)
        expect(shadow.querySelector("svg")).toBeTruthy()
        const surface = shadow.querySelector(".surface") as HTMLElement
        let fired = false
        host.addEventListener("input", () => { fired = true })
        // circle center image-px (600,400); display scale = 1200/600 = 2 → client (300,200)
        surface.dispatchEvent(new MouseEvent("click", { clientX: 300, clientY: 200, bubbles: true }))
        expect(fired).toBe(true)
        expect((host as unknown as { value: { layer: string; index: number } }).value).toMatchObject({ layer: "pts", index: 0 })
    })

    it("click on empty space is a no-op (no round-trip)", () => {
        const { host, script } = setup()
        mount(script, manifest)
        const surface = shadowOf(host).querySelector(".surface") as HTMLElement
        let fired = false
        host.addEventListener("input", () => { fired = true })
        surface.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true }))
        expect(fired).toBe(false)
    })

    it("removes the shadow host on invalidation", async () => {
        const { host, script } = setup()
        let resolve!: () => void
        const inval = new Promise<void>((r) => { resolve = r })
        mount(script, manifest, inval)
        expect(host.lastElementChild?.tagName).toBe("DIV") // shadow host present
        resolve()
        await inval
        await Promise.resolve()
        expect(host.lastElementChild?.tagName).toBe("SCRIPT") // shadow host gone, script remains
    })

    it("drags a threshold line and commits the inverted value on mouse-up", () => {
        const dragManifest: Manifest = {
            width: 1200, height: 800, scaling: 2,
            transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
                viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
            layers: [{ id: "thr", kind: "threshold", axis: "ax1", events: ["drag"], payloads: [],
                geometry: { orientation: "h", pos: 400, span: [0, 1200] } }],
        }
        const { host, script } = setup()
        mount(script, dragManifest)
        const shadow = shadowOf(host)
        const surface = shadow.querySelector(".surface") as HTMLElement
        const line = shadow.querySelector("line") as SVGLineElement
        expect(line).toBeTruthy()
        expect(line.getAttribute("y1")).toBe("400")              // persistent, drawn on mount
        let committed: { layer: string; index: number; payload: number } | null = null
        host.addEventListener("input", () => {
            committed = (host as unknown as { value: { layer: string; index: number; payload: number } }).value
        })
        // display scale = 1200/600 = 2 → client (300,200) == image (600,400) == on the line
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 300, bubbles: true }))
        expect(line.getAttribute("y1")).toBe("600")              // line followed the drag (image y = 2*300)
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 300, clientY: 300, bubbles: true }))
        expect(committed).toMatchObject({ layer: "thr", index: 0 })
        // image (600,600): fy = 1 - 600/800 = 0.25; ylims [0,100] → 25
        expect(committed!.payload).toBeCloseTo(25)
    })

    it("synthesized click after drag does not overwrite threshold commit (justDragged guard)", () => {
        // Both a threshold layer and a click-enabled circles layer whose center sits at the drag-release point.
        // Release point: client (300,300) → image (600,600). Circle centered at (600,600) r=30 will be hit by click.
        const mixedManifest: Manifest = {
            width: 1200, height: 800, scaling: 2,
            transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
                viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
            layers: [
                { id: "thr", kind: "threshold", axis: "ax1", events: ["drag"], payloads: [],
                    geometry: { orientation: "h", pos: 400, span: [0, 1200] } },
                { id: "pts", kind: "circles", geometry: [600, 600, 30], payloads: [{ i: 0 }], axis: "ax1", events: ["click", "hover"] },
            ],
        }
        const { host, script } = setup()
        mount(script, mixedManifest)
        const shadow = shadowOf(host)
        const surface = shadow.querySelector(".surface") as HTMLElement
        // drag the threshold: mousedown on line (clientY=200 → image y=400 = threshold pos), release at clientY=300
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 300, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 300, clientY: 300, bubbles: true }))
        const afterDrag = (host as unknown as { value: { layer: string; index: number; payload: number } }).value
        expect(afterDrag).toMatchObject({ layer: "thr", index: 0 })
        // synthesized click at the release point — browser fires this after mouseup; circle is at (600,600) and would be hit
        surface.dispatchEvent(new MouseEvent("click", { clientX: 300, clientY: 300, bubbles: true }))
        const afterClick = (host as unknown as { value: { layer: string; index: number; payload: number } }).value
        // guard must have blocked the click — threshold commit must survive
        expect(afterClick.layer).toBe("thr")
    })

    const roiManifest: Manifest = {
        width: 1200, height: 800, scaling: 2,
        transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
            viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
        layers: [{ id: "roi", kind: "roi", axis: "ax1", events: ["drag"], payloads: [],
            geometry: { x: 200, y: 200, w: 400, h: 400, handle: 16 } }],
    }

    it("draws an ROI box + 4 handles and commits inverted bounds after a move", () => {
        const { host, script } = setup()
        mount(script, roiManifest)
        const shadow = shadowOf(host)
        const surface = shadow.querySelector(".surface") as HTMLElement
        const rects = shadow.querySelectorAll("rect")
        expect(rects.length).toBe(5)                 // 1 box + 4 corner handles
        const box = rects[0] as SVGRectElement
        expect(box.getAttribute("x")).toBe("200")
        let committed: { layer: string; payload: { xmin: number; xmax: number; ymin: number; ymax: number } } | null = null
        host.addEventListener("input", () => {
            committed = (host as unknown as { value: { layer: string; payload: { xmin: number; xmax: number; ymin: number; ymax: number } } }).value
        })
        // display scale 1200/600 = 2 → client (200,200) == image (400,400) == interior center
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 200, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 200, bubbles: true })) // image x 400→600
        expect(box.getAttribute("x")).toBe("400")    // origin moved +200 image px (clamped within viewport)
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 300, clientY: 200, bubbles: true }))
        expect(committed).toMatchObject({ layer: "roi" })
        // box x now [400,800] image → data [400/1200*10, 800/1200*10]
        expect(committed!.payload.xmin).toBeCloseTo(10 * 400 / 1200)
        expect(committed!.payload.xmax).toBeCloseTo(10 * 800 / 1200)
    })

    it("resizes an ROI box from a corner with the opposite corner fixed", () => {
        const { host, script } = setup()
        mount(script, roiManifest)
        const shadow = shadowOf(host)
        const surface = shadow.querySelector(".surface") as HTMLElement
        const box = shadow.querySelectorAll("rect")[0] as SVGRectElement
        // BR corner is image (600,600) == client (300,300); drag to image (800,800) == client (400,400)
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 300, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 400, bubbles: true }))
        expect(box.getAttribute("x")).toBe("200")        // TL anchor unchanged
        expect(box.getAttribute("y")).toBe("200")
        expect(box.getAttribute("width")).toBe("600")    // 800 - 200
        expect(box.getAttribute("height")).toBe("600")
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 400, clientY: 400, bubbles: true }))
    })
})
