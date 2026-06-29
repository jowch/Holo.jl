// @vitest-environment happy-dom
import { describe, it, expect } from "vitest"
import { mount } from "../src/overlay"
import type { HitLayer, Manifest } from "../src/types"

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
        let committed: { layer: string; index: number; payload: { xmin: number; xmax: number; ymin: number; ymax: number } } | null = null
        host.addEventListener("input", () => {
            committed = (host as unknown as { value: { layer: string; index: number; payload: { xmin: number; xmax: number; ymin: number; ymax: number } } }).value
        })
        // display scale 1200/600 = 2 → client (200,200) == image (400,400) == interior center
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 200, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 200, bubbles: true })) // image x 400→600
        expect(box.getAttribute("x")).toBe("400")    // origin moved +200 image px (clamped within viewport)
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 300, clientY: 200, bubbles: true }))
        expect(committed).toMatchObject({ layer: "roi", index: 0 })
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
        let committed: { layer: string; index: number; payload: { xmin: number; xmax: number; ymin: number; ymax: number } } | null = null
        host.addEventListener("input", () => {
            committed = (host as unknown as { value: { layer: string; index: number; payload: { xmin: number; xmax: number; ymin: number; ymax: number } } }).value
        })
        // BR corner is image (600,600) == client (300,300); drag to image (800,800) == client (400,400)
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 300, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 400, bubbles: true }))
        expect(box.getAttribute("x")).toBe("200")        // TL anchor unchanged
        expect(box.getAttribute("y")).toBe("200")
        expect(box.getAttribute("width")).toBe("600")    // 800 - 200
        expect(box.getAttribute("height")).toBe("600")
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 400, clientY: 400, bubbles: true }))
        // TL anchor (200,200), BR dragged to (800,800); viewport 1200x800
        expect(committed!.payload.xmin).toBeCloseTo(10 * 200 / 1200)
        expect(committed!.payload.xmax).toBeCloseTo(10 * 800 / 1200)
        expect(committed!.payload.ymin).toBeCloseTo(0)    // image y 800 → data 100*(1-800/800)=0
        expect(committed!.payload.ymax).toBeCloseTo(75)   // image y 200 → data 100*(1-200/800)=75
    })

    it("resize flips past the anchor and clamps to the viewport", () => {
        const { host, script } = setup()
        mount(script, roiManifest)
        const surface = shadowOf(host).querySelector(".surface") as HTMLElement
        const box = shadowOf(host).querySelectorAll("rect")[0] as SVGRectElement
        // grab BR corner image (600,600)==client (300,300); anchor = TL (200,200)
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 300, bubbles: true }))
        // drag PAST the TL anchor to image (100,100)==client (50,50): box flips, stays non-degenerate
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 50, bubbles: true }))
        expect(box.getAttribute("x")).toBe("100")        // min(200, 100)
        expect(box.getAttribute("y")).toBe("100")
        expect(box.getAttribute("width")).toBe("100")    // |100 - 200|
        expect(box.getAttribute("height")).toBe("100")
        // drag beyond the viewport image (1400,1000)==client (700,500): clamps to (1200,800)
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 700, clientY: 500, bubbles: true }))
        expect(box.getAttribute("x")).toBe("200")        // min(200, 1200)
        expect(box.getAttribute("width")).toBe("1000")   // |1200 - 200|
        expect(box.getAttribute("height")).toBe("600")   // |800 - 200|
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 700, clientY: 500, bubbles: true }))
    })

    const boxSelectManifest: Manifest = {
        width: 1200, height: 800, scaling: 2,
        transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
            viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
        layers: [
            // three points (image px); box [200,600]×[200,600] encloses the first two
            { id: "pts", kind: "circles", geometry: [300, 300, 10, 500, 500, 10, 900, 700, 10],
                payloads: [{ i: 0 }, { i: 1 }, { i: 2 }], axis: "ax1", events: ["click", "hover"] },
            { id: "roi", kind: "roi", axis: "ax1", events: ["drag"], payloads: [],
                selects: "pts", geometry: { x: 200, y: 200, w: 400, h: 400, handle: 16 } },
        ],
    }

    it("box-select over points emits a Vector envelope of contained points + highlights them", () => {
        const { host, script } = setup()
        mount(script, boxSelectManifest)
        const shadow = shadowOf(host)
        const surface = shadow.querySelector(".surface") as HTMLElement
        let committed: { items: { layer: string; index: number }[] } | null = null
        host.addEventListener("input", () => {
            committed = (host as unknown as { value: { items: { layer: string; index: number }[] } }).value
        })
        // grab the box interior (image 400,400 = client 200,200), release without moving → emit current enclosure
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 200, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 200, clientY: 200, bubbles: true }))
        expect(committed!.items.map((e) => e.index)).toEqual([0, 1])
        expect(committed!.items.every((e) => e.layer === "pts")).toBe(true)
        // two persistent selection highlights drawn
        expect(shadow.querySelector("g.sel")!.children.length).toBe(2)
    })

    it("box-select with nothing enclosed emits an empty items envelope", () => {
        const { host, script } = setup()
        mount(script, boxSelectManifest)
        const shadow = shadowOf(host)
        const surface = shadow.querySelector(".surface") as HTMLElement
        const box = shadow.querySelectorAll("rect")[0] as SVGRectElement
        let committed: { items: unknown[] } | null = null
        host.addEventListener("input", () => {
            committed = (host as unknown as { value: { items: unknown[] } }).value
        })
        // move the box up so it encloses no point: grab interior, drag origin up-left out of the cluster
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 200, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 350, clientY: 50, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 350, clientY: 50, bubbles: true }))
        expect(box).toBeTruthy()
        expect(committed!.items).toEqual([])
    })

    const gridSelectManifest: Manifest = {
        width: 1200, height: 800, scaling: 2,
        transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
            viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
        layers: [
            { id: "img", kind: "grid", axis: "ax1", events: ["hover"], payloads: [],
                geometry: { xedges: [0, 200, 400, 600], yedges: [0, 200, 400, 600], ncols: 3, nrows: 3 } },
            { id: "roi", kind: "roi", axis: "ax1", events: ["drag"], payloads: [],
                selects: "img", geometry: { x: 100, y: 100, w: 300, h: 300, handle: 16 } },
        ],
    }

    it("box-select over a grid emits a single region (cell indices + data bounds)", () => {
        const { host, script } = setup()
        mount(script, gridSelectManifest)
        const surface = shadowOf(host).querySelector(".surface") as HTMLElement
        let committed: { items: { layer: string; index: number; payload: Record<string, number> }[] } | null = null
        host.addEventListener("input", () => {
            committed = (host as unknown as { value: typeof committed }).value
        })
        // box is image [100,400]×[100,400]; grab interior (image 250,250 = client 125,125), release
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 125, clientY: 125, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 125, clientY: 125, bubbles: true }))
        expect(committed!.items.length).toBe(1)
        const r = committed!.items[0].payload
        expect([r.i0, r.i1, r.j0, r.j1]).toEqual([0, 1, 0, 1])    // cells covered by [100,400]
        expect(r.xmin).toBeCloseTo(10 * 100 / 1200)
        expect(r.xmax).toBeCloseTo(10 * 400 / 1200)
        expect(r.ymin).toBeCloseTo(50)                            // image y 400 → 100*(1-400/800)
        expect(r.ymax).toBeCloseTo(87.5)                          // image y 100 → 100*(1-100/800)
    })
})

// M2.3 tooltip glue in showTip: tipStyle application + the template / auto-table / suppress branches.
// (template.test.ts covers the escape/format logic in isolation; this locks the mount-level wiring.)
describe("tooltips (mount/showTip)", () => {
    // one circles layer at image-px (600,400) r=20 — hovered at client (300,200) since scale = 2
    const tipManifest = (extra: Partial<HitLayer>, tipStyle?: Record<string, string>): Manifest => ({
        width: 1200, height: 800, scaling: 2, transforms: {},
        layers: [{ id: "pts", kind: "circles", geometry: [600, 400, 20], payloads: [{ name: "Tokyo" }], axis: "ax1", events: ["click", "hover"], ...extra }],
        ...(tipStyle ? { tipStyle } : {}),
    })
    const hoverMarker = (shadow: ShadowRoot) =>
        (shadow.querySelector(".surface") as HTMLElement)
            .dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 200, bubbles: true }))

    it("applies tipStyle custom properties to the shadow host", () => {
        const { host, script } = setup()
        mount(script, tipManifest({}, { "--holo-tip-bg": "rgb(1,2,3)" }))
        expect((host.lastElementChild as HTMLElement).style.getPropertyValue("--holo-tip-bg")).toBe("rgb(1,2,3)")
    })

    it("renders a template tooltip as HTML on hover (markup live, data escaped)", () => {
        const { host, script } = setup()
        mount(script, tipManifest({ template: ["<b>", { f: "name" }, "</b>"], payloads: [{ name: "<x>" }] }))
        const shadow = shadowOf(host)
        const tip = shadow.querySelector(".holo-tip") as HTMLElement
        hoverMarker(shadow)
        expect(tip.style.display).toBe("block")
        expect(tip.innerHTML).toBe("<b>&lt;x&gt;</b>")   // the <b> stays live; the payload value is escaped
    })

    it("renders the auto-table default when no template is set", () => {
        const { host, script } = setup()
        mount(script, tipManifest({}))
        const shadow = shadowOf(host)
        const tip = shadow.querySelector(".holo-tip") as HTMLElement
        hoverMarker(shadow)
        expect(tip.style.display).toBe("block")
        expect(tip.innerHTML).toContain("holo-tip-row")
        expect(tip.innerHTML).toContain("Tokyo")
    })

    it("suppresses the tooltip when tooltip === false", () => {
        const { host, script } = setup()
        mount(script, tipManifest({ tooltip: false }))
        const shadow = shadowOf(host)
        const tip = shadow.querySelector(".holo-tip") as HTMLElement
        hoverMarker(shadow)
        expect(tip.style.display).toBe("none")
    })
})
