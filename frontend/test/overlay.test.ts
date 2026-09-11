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

    it("mounts on a <canvas> base (no naturalWidth) and scales via manifest.width", () => {
        // WebGLBackend's base is a <canvas>, which has no naturalWidth — the overlay must take the
        // image-px scale from manifest.width, not the element's intrinsic size (M3.1, no sizer shim).
        const host = document.createElement("div")
        const canvas = document.createElement("canvas") // canvas.width defaults to 300, deliberately != manifest.width
        canvas.getBoundingClientRect = () =>
            ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
        const script = document.createElement("script")
        host.append(canvas, script)
        document.body.append(host)
        mount(script, manifest)
        const surface = shadowOf(host).querySelector(".surface") as HTMLElement
        let fired = false
        host.addEventListener("input", () => { fired = true })
        // same as the img case: manifest.width 1200 / rect 600 = 2 → client (300,200) hits circle (600,400)
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

    // Factory so each test gets a fresh geometry object — the alias fix (box.g = rg) mutates
    // layer.geometry in-place, which would pollute a shared const across tests.
    const roiManifest = (): Manifest => ({
        width: 1200, height: 800, scaling: 2,
        transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
            viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
        layers: [{ id: "roi", kind: "roi", axis: "ax1", events: ["drag"], payloads: [],
            geometry: { x: 200, y: 200, w: 400, h: 400, handle: 16 } }],
    })

    it("draws an ROI box + 4 handles and commits inverted bounds after a move", () => {
        const { host, script } = setup()
        mount(script, roiManifest())
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
        mount(script, roiManifest())
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
        mount(script, roiManifest())
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

    it("re-grab works at the moved box position (hit-test tracks live geometry)", () => {
        // Regression for: after drag, box.g (live state) diverged from layer.geometry (static manifest
        // copy), so hitLayer hit-tested the original footprint and missed the moved box on re-grab.
        // Fix: box.g is now an alias for the manifest ROIGeometry, keeping them in sync.
        const { host, script } = setup()
        mount(script, roiManifest())
        const shadow = shadowOf(host)
        const surface = shadow.querySelector(".surface") as HTMLElement
        const box = shadow.querySelectorAll("rect")[0] as SVGRectElement
        // roiManifest: box at image [200,600]×[200,600], scaling=2 so client×2=image
        // First drag: grab interior at client(200,200)=image(400,400); move to client(300,200)=image(600,400)
        // ax = 400-200 = 200; new box.g.x = 600-200 = 400 → box now spans image x [400,800]
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 200, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 200, bubbles: true }))
        expect(box.getAttribute("x")).toBe("400")
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 300, clientY: 200, bubbles: true }))
        // Second grab: client(350,200)=image(700,400) is INSIDE the moved box [400,800]×[200,600]
        // but OUTSIDE the original [200,600]×[200,600] — so hit only lands if live geometry is used
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 350, clientY: 200, bubbles: true }))
        // Move to client(400,200)=image(800,400); ax=700-400=300; new box.g.x=max(0,min(800,800-300))=500
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 200, bubbles: true }))
        // Second drag registered → box moved again (x went from 400 to 500)
        expect(box.getAttribute("x")).toBe("500")
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 400, clientY: 200, bubbles: true }))
    })

    // Factory so each test gets a fresh geometry object — drag mutates geometry in-place.
    const boxSelectManifest = (): Manifest => ({
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
    })

    it("box-select over points emits a Vector envelope of contained points + highlights them", () => {
        const { host, script } = setup()
        mount(script, boxSelectManifest())
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
        mount(script, boxSelectManifest())
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

    it("corner-resize of a selects-ROI recomputes the selection", () => {
        const { host, script } = setup()
        mount(script, boxSelectManifest())
        const shadow = shadowOf(host)
        const surface = shadow.querySelector(".surface") as HTMLElement
        let committed: { items: { index: number }[] } | null = null
        host.addEventListener("input", () => { committed = (host as unknown as { value: typeof committed }).value })
        // grab the BR corner (image 600,600 = client 300,300; anchor = TL 200,200) and drag it out to
        // image (950,750) = client (475,375), enclosing all three points ([200,950]×[200,750])
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 300, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 475, clientY: 375, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 475, clientY: 375, bubbles: true }))
        expect(committed!.items.map((e) => e.index)).toEqual([0, 1, 2])
        expect(shadow.querySelector("g.sel")!.children.length).toBe(3)
    })

    it("box-select containing a single point emits a one-element envelope", () => {
        const { host, script } = setup()
        mount(script, boxSelectManifest())
        const shadow = shadowOf(host)
        const surface = shadow.querySelector(".surface") as HTMLElement
        let committed: { items: { index: number }[] } | null = null
        host.addEventListener("input", () => { committed = (host as unknown as { value: typeof committed }).value })
        // move the box origin to image (50,50) ([50,450]²) so only the first point (300,300) is inside
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 200, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 125, clientY: 125, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 125, clientY: 125, bubbles: true }))
        expect(committed!.items.map((e) => e.index)).toEqual([0])
        expect(shadow.querySelector("g.sel")!.children.length).toBe(1)
    })

    // Factory so each test gets a fresh geometry object — drag mutates geometry in-place.
    const gridSelectManifest = (): Manifest => ({
        width: 1200, height: 800, scaling: 2,
        transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
            viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
        layers: [
            { id: "img", kind: "grid", axis: "ax1", events: ["hover"], payloads: [],
                geometry: { xedges: [0, 200, 400, 600], yedges: [0, 200, 400, 600], ncols: 3, nrows: 3 } },
            { id: "roi", kind: "roi", axis: "ax1", events: ["drag"], payloads: [],
                selects: "img", geometry: { x: 100, y: 100, w: 300, h: 300, handle: 16 } },
        ],
    })

    it("box-select over a grid emits a single region (cell indices + data bounds)", () => {
        const { host, script } = setup()
        mount(script, gridSelectManifest())
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
        expect(tip.classList.contains("show")).toBe(true)
        expect(tip.innerHTML).toBe("<b>&lt;x&gt;</b>")   // the <b> stays live; the payload value is escaped
    })

    it("renders the auto-table default when no template is set", () => {
        const { host, script } = setup()
        mount(script, tipManifest({}))
        const shadow = shadowOf(host)
        const tip = shadow.querySelector(".holo-tip") as HTMLElement
        hoverMarker(shadow)
        expect(tip.classList.contains("show")).toBe(true)
        expect(tip.innerHTML).toContain("holo-tip-row")
        expect(tip.innerHTML).toContain("Tokyo")
    })

    it("suppresses the tooltip when tooltip === false", () => {
        const { host, script } = setup()
        mount(script, tipManifest({ tooltip: false }))
        const shadow = shadowOf(host)
        const tip = shadow.querySelector(".holo-tip") as HTMLElement
        hoverMarker(shadow)
        expect(tip.classList.contains("show")).toBe(false)
    })

    it("colorbar axis hover shows formatted value not x=undefined", () => {
        const { host, script } = setup()
        // colorbar: axis layer with bounded geometry [200,100,24,400] in image px, valueaxis:"y"
        const cbManifest: Manifest = {
            width: 1200, height: 800, scaling: 2,
            transforms: { cb1: { xlims: [0, 1], ylims: [0, 10], xscale: "identity", yscale: "identity",
                viewport: [200, 100, 24, 400], xreversed: false, yreversed: false, valueaxis: "y" } },
            layers: [{ id: "colorbar", kind: "axis", geometry: [200, 100, 24, 400], payloads: [], axis: "cb1", events: ["hover"] }],
        }
        mount(script, cbManifest)
        const shadow = shadowOf(host)
        const tip = shadow.querySelector(".holo-tip") as HTMLElement
        // client (110,150) → image px (220,300); inside bbox; fy=0.5 → value=5.0; fmt(5)="5.000"
        ;(shadow.querySelector(".surface") as HTMLElement)
            .dispatchEvent(new MouseEvent("mousemove", { clientX: 110, clientY: 150, bubbles: true }))
        expect(tip.classList.contains("show")).toBe(true)
        expect(tip.innerHTML).toBe("5.000")
        expect(tip.innerHTML).not.toContain("undefined")
    })

    it("plain axis hover shows x=… y=… tooltip (no valueaxis)", () => {
        const { host, script } = setup()
        // plain axis: geometry null, transform has no valueaxis → x=/y= tooltip
        const plainManifest: Manifest = {
            width: 1200, height: 800, scaling: 2,
            transforms: { ax1: { xlims: [0, 5], ylims: [0, 5], xscale: "identity", yscale: "identity",
                viewport: [100, 100, 400, 400], xreversed: false, yreversed: false } },
            layers: [{ id: "axis", kind: "axis", geometry: null, payloads: [], axis: "ax1", events: ["hover"] }],
        }
        mount(script, plainManifest)
        const shadow = shadowOf(host)
        const tip = shadow.querySelector(".holo-tip") as HTMLElement
        ;(shadow.querySelector(".surface") as HTMLElement)
            .dispatchEvent(new MouseEvent("mousemove", { clientX: 200, clientY: 200, bubbles: true }))
        expect(tip.classList.contains("show")).toBe(true)
        expect(tip.innerHTML).toContain("x=")
        expect(tip.innerHTML).toContain("y=")
        expect(tip.innerHTML).not.toContain("undefined")
    })

    it("selected= pre-highlights are persistent: all indices drawn, and they survive hover", () => {
        const { host, script } = setup()
        // two circles pre-selected — the view-manip persistence contract: Julia re-derives
        // `selected` each render; the overlay must keep it visible through transient hovers
        const selManifest: Manifest = {
            width: 1200, height: 800, scaling: 2, transforms: {},
            layers: [{
                id: "pts", kind: "circles", geometry: [300, 200, 20, 600, 400, 20, 900, 600, 20],
                payloads: [{ i: 0 }, { i: 1 }, { i: 2 }], axis: "ax1", events: ["click", "hover"],
                selected: [0, 2],
            }],
        }
        mount(script, selManifest)
        const shadow = shadowOf(host)
        const sel = shadow.querySelector("g.sel") as SVGGElement
        expect(sel.children.length).toBe(2)                 // BOTH indices, not just the last
        const surface = shadow.querySelector(".surface") as HTMLElement
        // hover a non-selected element, then empty space (empty space clears g.hi)
        surface.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 200, bubbles: true }))
        surface.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10, bubbles: true }))
        expect(sel.children.length).toBe(2)                 // pre-selection survived the hovers
        expect((shadow.querySelector("g.hi") as SVGGElement).children.length).toBe(0)
    })

    // issue #39: selected= fail-loud on unsupported kinds / OOB (mirror Julia build_manifest)
    it("selected= on segments draws a ring (open-kind fallback)", () => {
        const { host, script } = setup()
        const segs: Manifest = {
            width: 1200, height: 800, scaling: 2, transforms: {},
            layers: [{
                id: "segs", kind: "segments", geometry: [0, 0, 100, 100, 200, 200, 300, 300],
                payloads: [{ i: 0 }, { i: 1 }], axis: "ax1", events: ["click", "hover"],
                selected: [0],
            }],
        }
        mount(script, segs)
        const node = shadowOf(host).querySelector("g.sel")!.firstElementChild as SVGElement
        expect(node.querySelectorAll("line").length).toBe(2)
    })

    it("selected= on grid fails loud at mount", () => {
        const { script } = setup()
        const bad: Manifest = {
            width: 1200, height: 800, scaling: 2, transforms: {},
            layers: [{
                id: "heat", kind: "grid",
                geometry: { xedges: [0, 100, 200], yedges: [0, 100, 200], ncols: 2, nrows: 2 },
                payloads: [], axis: "ax1", events: ["hover"], selected: [0],
            }],
        }
        expect(() => mount(script, bad)).toThrow(/selected/i)
    })

    it("selected= out-of-range index fails loud at mount", () => {
        const { script } = setup()
        const bad: Manifest = {
            width: 1200, height: 800, scaling: 2, transforms: {},
            layers: [{
                id: "pts", kind: "circles", geometry: [300, 200, 20, 600, 400, 20],
                payloads: [{ i: 0 }, { i: 1 }], axis: "ax1", events: ["click", "hover"],
                selected: [2],
            }],
        }
        expect(() => mount(script, bad)).toThrow(/selected|out of range|index/i)
    })

    it("selected= pre-highlights are replaced when a selects-ROI commits (one selection at a time)", () => {
        // mount-time selected= shares g.sel with box-select; ROI drag clears + redraws
        const m: Manifest = {
            width: 1200, height: 800, scaling: 2,
            transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
                viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
            layers: [
                { id: "pts", kind: "circles", geometry: [300, 300, 10, 500, 500, 10, 900, 700, 10],
                    payloads: [{ i: 0 }, { i: 1 }, { i: 2 }], axis: "ax1", events: ["click", "hover"],
                    selected: [2] },  // only the third point pre-highlighted
                { id: "roi", kind: "roi", axis: "ax1", events: ["drag"], payloads: [],
                    selects: "pts", geometry: { x: 200, y: 200, w: 400, h: 400, handle: 16 } },
            ],
        }
        const { host, script } = setup()
        mount(script, m)
        const shadow = shadowOf(host)
        const sel = shadow.querySelector("g.sel") as SVGGElement
        expect(sel.children.length).toBe(1)  // pre-highlight alone
        const surface = shadow.querySelector(".surface") as HTMLElement
        // commit current ROI enclosure (points 0 and 1) — replaces pre-selection of index 2
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 200, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 200, clientY: 200, bubbles: true }))
        expect(sel.children.length).toBe(2)
    })

    it("drag-to-pan commits new limits on mouse-up (commit-on-release)", () => {
        const m: Manifest = {
            width: 1200, height: 800, scaling: 2,
            transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
                viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
            layers: [{ id: "view", kind: "view", axis: "ax1", events: ["drag"], payloads: [],
                geometry: { x: 0, y: 0, w: 1200, h: 800, mode: "pan" } }],
        }
        const { host, script } = setup()
        mount(script, m)
        const surface = shadowOf(host).querySelector(".surface") as HTMLElement
        let committed: { layer: string; payload: { xmin: number; xmax: number; ymin: number; ymax: number } } | null = null
        host.addEventListener("input", () => {
            committed = (host as unknown as { value: typeof committed }).value
        })
        // display scale 2: client Δx=100 → image Δx=200 → 200/1200 of lims = 10/6 ≈ 1.667
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 200, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 200, clientY: 200, bubbles: true }))
        expect(committed).toMatchObject({ layer: "view" })
        expect(committed!.payload.xmin).toBeCloseTo(-10 * 200 / 1200)
        expect(committed!.payload.xmax).toBeCloseTo(10 - 10 * 200 / 1200)
    })

    it("tiny view drag does not commit", () => {
        const m: Manifest = {
            width: 1200, height: 800, scaling: 2,
            transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
                viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
            layers: [{ id: "view", kind: "view", axis: "ax1", events: ["drag"], payloads: [],
                geometry: { x: 0, y: 0, w: 1200, h: 800, mode: "pan" } }],
        }
        const { host, script } = setup()
        mount(script, m)
        const surface = shadowOf(host).querySelector(".surface") as HTMLElement
        let fired = false
        host.addEventListener("input", () => { fired = true })
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 100, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 101, clientY: 100, bubbles: true })) // 2 image-px
        expect(fired).toBe(false)
    })

    it("points+view: hover and click still work over the full-viewport view layer", () => {
        // Regression: :view used to win every drag hitTest and suppress element hover/click.
        const m: Manifest = {
            width: 1200, height: 800, scaling: 2,
            transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
                viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
            layers: [
                { id: "pts", kind: "circles", geometry: [600, 400, 20], payloads: [{ i: 0 }],
                    axis: "ax1", events: ["click", "hover"] },
                { id: "view", kind: "view", axis: "ax1", events: ["drag"], payloads: [],
                    geometry: { x: 0, y: 0, w: 1200, h: 800, mode: "pan" } },
            ],
        }
        const { host, script } = setup()
        mount(script, m)
        const shadow = shadowOf(host)
        const surface = shadow.querySelector(".surface") as HTMLElement
        const tip = shadow.querySelector(".holo-tip") as HTMLElement
        // hover over the point (client 300,200 → image 600,400)
        surface.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 200, bubbles: true }))
        expect(tip.classList.contains("show")).toBe(true)
        expect(surface.classList.contains("hot")).toBe(true)
        // empty area: grab cursor from view, no hover tip
        surface.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 50, bubbles: true }))
        expect(tip.classList.contains("show")).toBe(false)
        expect(surface.classList.contains("grab")).toBe(true)
        // tiny mousedown/up over the point must not swallow the subsequent click
        let clicked: { layer: string; index: number } | null = null
        host.addEventListener("input", () => {
            clicked = (host as unknown as { value: typeof clicked }).value
        })
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 301, clientY: 200, bubbles: true })) // 2 image-px
        surface.dispatchEvent(new MouseEvent("click", { clientX: 300, clientY: 200, bubbles: true }))
        expect(clicked).toMatchObject({ layer: "pts", index: 0 })
    })

    it("drag-to-orbit commits azimuth/elevation; Shift+drag beats ROI", () => {
        const m: Manifest = {
            width: 1200, height: 800, scaling: 2,
            transforms: {
                ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
                    viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false },
                ax3: { xlims: [0, 1], ylims: [0, 1], xscale: "identity", yscale: "identity",
                    viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false, is3d: true },
            },
            layers: [
                { id: "roi", kind: "roi", axis: "ax1", events: ["drag"], payloads: [],
                    geometry: { x: 200, y: 200, w: 400, h: 400, handle: 16 } },
                { id: "view", kind: "view", axis: "ax3", events: ["drag"], payloads: [],
                    geometry: { x: 0, y: 0, w: 1200, h: 800, mode: "orbit", azimuth: 0.4, elevation: 0.5 } },
            ],
        }
        const { host, script } = setup()
        mount(script, m)
        const surface = shadowOf(host).querySelector(".surface") as HTMLElement
        let committed: { layer: string; payload: { azimuth: number; elevation: number } } | null = null
        host.addEventListener("input", () => {
            committed = (host as unknown as { value: typeof committed }).value
        })
        // without Shift: ROI wins over view (layer order)
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 200, clientY: 200, bubbles: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 250, clientY: 200, bubbles: true }))
        expect(committed!.layer).toBe("roi")
        // with Shift: view orbit wins even over ROI interior
        committed = null
        surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 200, clientY: 200, bubbles: true, shiftKey: true }))
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, clientY: 200, bubbles: true, shiftKey: true }))
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 500, clientY: 200, bubbles: true, shiftKey: true }))
        expect(committed!.layer).toBe("view")
        // image Δx = 600; sens = π/1200 → Δaz = −π/2
        expect(committed!.payload.azimuth).toBeCloseTo(0.4 - Math.PI / 2)
        expect(committed!.payload.elevation).toBeCloseTo(0.5)
    })
})

// First overlay visual-polish PR (locked recipes in visual-design.md):
// inspector ink, hover = stroke only, selected = wash / ring, tip motion + edge clamp.
describe("overlay visual polish", () => {
    const ink = "#3A6F7C"
    const wash = "rgba(58, 111, 124, 0.12)"

    it("hover is stroke-only inspector ink (2px, opacity 0.85, fill none)", () => {
        const { host, script } = setup()
        mount(script, manifest)
        const shadow = shadowOf(host)
        const surface = shadow.querySelector(".surface") as HTMLElement
        surface.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 200, bubbles: true }))
        const el = shadow.querySelector("g.hi")!.firstElementChild as SVGElement
        expect(el.tagName.toLowerCase()).toBe("circle")
        expect(el.getAttribute("fill")).toBe("none")
        expect(el.getAttribute("stroke")).toBe(ink)
        expect(el.getAttribute("stroke-width")).toBe("2")
        expect(el.getAttribute("stroke-opacity")).toBe("0.85")
    })

    it("selected closed geometry gets a wash fill + 2.5px stroke", () => {
        const { host, script } = setup()
        mount(script, {
            width: 1200, height: 800, scaling: 2, transforms: {},
            layers: [{
                id: "pts", kind: "circles", geometry: [300, 200, 20],
                payloads: [{ i: 0 }], axis: "ax1", events: ["click", "hover"], selected: [0],
            }],
        })
        const el = shadowOf(host).querySelector("g.sel")!.firstElementChild as SVGElement
        expect(el.tagName.toLowerCase()).toBe("circle")
        expect(el.getAttribute("fill")).toBe(wash)
        expect(el.getAttribute("stroke")).toBe(ink)
        expect(el.getAttribute("stroke-width")).toBe("2.5")
        expect(el.getAttribute("stroke-opacity") ?? "1").toBe("1")
    })

    it("selected open geometry gets a ring (inner 2px + outer ~4px, fill none)", () => {
        const { host, script } = setup()
        mount(script, {
            width: 1200, height: 800, scaling: 2, transforms: {},
            layers: [{
                id: "segs", kind: "segments", geometry: [100, 100, 400, 200],
                payloads: [{ i: 0 }], axis: "ax1", events: ["click", "hover"], selected: [0],
            }],
        })
        const node = shadowOf(host).querySelector("g.sel")!.firstElementChild as SVGElement
        const lines = node.tagName.toLowerCase() === "g"
            ? [...node.querySelectorAll("line")]
            : [node]
        expect(lines.length).toBe(2)
        expect(lines.every((ln) => ln.getAttribute("fill") === "none")).toBe(true)
        expect(lines.every((ln) => ln.getAttribute("stroke") === ink)).toBe(true)
        const widths = lines.map((ln) => ln.getAttribute("stroke-width")).sort()
        expect(widths).toEqual(["2", "4"])
        const outer = lines.find((ln) => ln.getAttribute("stroke-width") === "4")!
        expect(outer.getAttribute("stroke-opacity")).toBe("0.25")
    })

    it("threshold chrome falls back to inspector ink when style is missing", () => {
        const { host, script } = setup()
        mount(script, {
            width: 1200, height: 800, scaling: 2,
            transforms: { ax1: { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
                viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
            layers: [{ id: "thr", kind: "threshold", axis: "ax1", events: ["drag"], payloads: [],
                geometry: { orientation: "h", pos: 400, span: [0, 1200] } }],
        })
        const line = shadowOf(host).querySelector("line") as SVGLineElement
        expect(line.getAttribute("stroke")).toBe(ink)
    })

    it("tooltip show/hide uses a class so opacity can fade", () => {
        const { host, script } = setup()
        mount(script, manifest)
        const shadow = shadowOf(host)
        const tip = shadow.querySelector(".holo-tip") as HTMLElement
        const surface = shadow.querySelector(".surface") as HTMLElement
        expect(tip.classList.contains("show")).toBe(false)
        surface.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 200, bubbles: true }))
        expect(tip.classList.contains("show")).toBe(true)
        surface.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }))
        expect(tip.classList.contains("show")).toBe(false)
    })

    it("overlay CSS honors prefers-reduced-motion", () => {
        const { host, script } = setup()
        mount(script, manifest)
        const css = shadowOf(host).querySelector("style")!.textContent!
        expect(css).toMatch(/prefers-reduced-motion:\s*reduce/)
        expect(css).toMatch(/opacity/)
    })

    it("clamps the tip and flips the caret near the bottom-right edge", () => {
        const { host, script } = setup()
        // axis layer: hover anywhere inside the viewport so we can park the cursor at the edge
        mount(script, {
            width: 1200, height: 800, scaling: 2,
            transforms: { ax1: { xlims: [0, 10], ylims: [0, 10], xscale: "identity", yscale: "identity",
                viewport: [0, 0, 1200, 800], xreversed: false, yreversed: false } },
            layers: [{ id: "axis", kind: "axis", geometry: null, payloads: [], axis: "ax1", events: ["hover"] }],
        })
        const shadow = shadowOf(host)
        const tip = shadow.querySelector(".holo-tip") as HTMLElement
        const surface = shadow.querySelector(".surface") as HTMLElement
        Object.defineProperty(tip, "offsetWidth", { configurable: true, value: 220 })
        Object.defineProperty(tip, "offsetHeight", { configurable: true, value: 80 })
        Object.defineProperty(surface, "clientWidth", { configurable: true, value: 600 })
        Object.defineProperty(surface, "clientHeight", { configurable: true, value: 400 })
        // client (580, 380) is inside the axis viewport and near the 600×400 surface corner
        surface.dispatchEvent(new MouseEvent("mousemove", { clientX: 580, clientY: 380, bubbles: true }))
        expect(tip.classList.contains("show")).toBe(true)
        expect(tip.classList.contains("flip-x")).toBe(true)
        expect(tip.classList.contains("flip-y")).toBe(true)
        const left = parseFloat(tip.style.left)
        const top = parseFloat(tip.style.top)
        expect(left + 220).toBeLessThanOrEqual(600)
        expect(top + 80).toBeLessThanOrEqual(400)
        expect(left).toBeGreaterThanOrEqual(0)
        expect(top).toBeGreaterThanOrEqual(0)
    })
})
