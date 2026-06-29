import { describe, it, expect } from "vitest"
import { distToSegment, pointInPolygon, findBin, invertAxis, hitLayer, hitTest, resolvePayload } from "../src/geometry"
import type { AxisTransform, HitLayer, Manifest } from "../src/types"

describe("primitives", () => {
    it("distToSegment", () => {
        expect(distToSegment(0, 5, 0, 0, 10, 0)).toBeCloseTo(5)
        expect(distToSegment(-3, 0, 0, 0, 10, 0)).toBeCloseTo(3) // clamps to endpoint
    })
    it("pointInPolygon (even-odd square)", () => {
        const sq = [0, 0, 10, 0, 10, 10, 0, 10]
        expect(pointInPolygon(5, 5, sq)).toBe(true)
        expect(pointInPolygon(15, 5, sq)).toBe(false)
    })
    it("findBin asc + desc", () => {
        expect(findBin([0, 10, 20, 30], 12)).toBe(1)
        expect(findBin([30, 20, 10, 0], 12)).toBe(1) // descending (image y)
        expect(findBin([0, 10], 99)).toBe(-1)
    })
})

describe("invertAxis", () => {
    const linear: AxisTransform = { xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
        viewport: [0, 0, 200, 400], xreversed: false, yreversed: false }
    it("linear maps viewport center to mid-data", () => {
        const v = invertAxis(linear, 100, 200)
        expect(v.x).toBeCloseTo(5)
        expect(v.y).toBeCloseTo(50) // y flips: image-mid → data-mid
    })
    it("log scale", () => {
        const t: AxisTransform = { ...linear, xlims: [1, 1000], xscale: "log10" }
        expect(invertAxis(t, 100, 0).x).toBeCloseTo(31.6227, 2) // 10^1.5
    })
    it("categorical x returns a label", () => {
        const t: AxisTransform = { ...linear, xlims: [1, 3], xcats: ["a", "b", "c"] }
        expect(invertAxis(t, 0, 200).x).toBe("a")
        expect(invertAxis(t, 200, 200).x).toBe("c")
    })
})

describe("hitLayer + hitTest", () => {
    const circles: HitLayer = { id: "pts", kind: "circles", geometry: [100, 100, 10, 300, 300, 10],
        payloads: [{ i: 0 }, { i: 1 }], axis: "ax1", events: ["click", "hover"] }
    it("hits a circle, misses empty space", () => {
        expect(hitLayer(circles, 100, 100)?.index).toBe(0)
        expect(hitLayer(circles, 305, 300)?.index).toBe(1) // within radius+tol
        expect(hitLayer(circles, 500, 500)).toBeNull()
    })
    it("grid inverts pixel to (i,j) + value", () => {
        const grid: HitLayer = { id: "hm", kind: "grid", axis: "ax1", events: ["hover"], payloads: [],
            geometry: { xedges: [0, 10, 20], yedges: [0, 10, 20], ncols: 2, nrows: 2, values: [11, 12, 21, 22] } }
        const h = hitLayer(grid, 15, 5)
        expect(h?.grid).toEqual([1, 0, 12]) // i=1, j=0, values[0*2+1]
    })
    it("hitTest respects the event filter and manifest order", () => {
        const m: Manifest = { width: 400, height: 400, scaling: 2, transforms: {},
            layers: [{ ...circles, events: ["hover"] }] }
        expect(hitTest(m, 100, 100, "hover")?.layer.id).toBe("pts")
        expect(hitTest(m, 100, 100, "click")).toBeNull() // not a click layer
    })
    it("resolvePayload returns the element payload", () => {
        const m: Manifest = { width: 400, height: 400, scaling: 2, transforms: {}, layers: [circles] }
        const hit = hitTest(m, 300, 300, "click")!
        expect(resolvePayload(hit, m, 300, 300)).toEqual({ i: 1 })
    })
})

describe("threshold hit-test", () => {
    const h: HitLayer = { id: "thr", kind: "threshold", axis: "ax1", events: ["drag"], payloads: [],
        geometry: { orientation: "h", pos: 100, span: [0, 200] } }
    it("hits within SEG_TOL of a horizontal line, misses beyond", () => {
        expect(hitLayer(h, 50, 102)).toMatchObject({ index: 0 })       // 2px ≤ 8
        expect(hitLayer(h, 50, 120)).toBeNull()                        // 20px
        expect(hitLayer(h, 50, 100)?.geom).toEqual(["seg", 0, 100, 200, 100])
    })
    it("vertical line hits along x", () => {
        const v: HitLayer = { ...h, geometry: { orientation: "v", pos: 80, span: [0, 400] } }
        expect(hitLayer(v, 83, 200)).toMatchObject({ index: 0 })
        expect(hitLayer(v, 130, 200)).toBeNull()
    })
})

describe("roi hit-test", () => {
    const roi: HitLayer = { id: "roi", kind: "roi", axis: "ax1", events: ["drag"], payloads: [],
        geometry: { x: 100, y: 50, w: 200, h: 120, handle: 8 } }
    it("corners take precedence, then interior, else miss", () => {
        expect(hitLayer(roi, 100, 50)).toMatchObject({ roiPart: { corner: 0 } })   // TL
        expect(hitLayer(roi, 300, 170)).toMatchObject({ roiPart: { corner: 2 } })  // BR (x+w, y+h)
        expect(hitLayer(roi, 200, 110)).toMatchObject({ roiPart: { move: true } }) // interior
        expect(hitLayer(roi, 50, 50)).toBeNull()                                    // outside
    })
})
