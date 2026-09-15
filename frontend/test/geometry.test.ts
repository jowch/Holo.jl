import { describe, it, expect } from "vitest"
import {
    distToSegment, pointInPolygon, findBin, invertAxis, hitLayer, hitTest, resolvePayload, panLimits, orbitAngles,
    anchorFor, computeAnchoredPlacement,
} from "../src/geometry"
import type { AxisTransform, Hit, HitLayer, Manifest } from "../src/types"

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
    it("findBin on an interior edge picks the smaller-index bin (both directions)", () => {
        // v==10 brackets bin0=[0,10] and bin1=[10,20]; the old linear scan tested bins in
        // increasing k order with inclusive comparisons on both ends, so bin0 won first.
        expect(findBin([0, 10, 20, 30], 10)).toBe(0)
        expect(findBin([0, 10, 20, 30], 20)).toBe(1)
        // same convention holds for descending edges (image-space y)
        expect(findBin([30, 20, 10, 0], 20)).toBe(0)
        expect(findBin([30, 20, 10, 0], 10)).toBe(1)
    })
    it("findBin: exactly on the outer edges is in range, one step beyond is not", () => {
        expect(findBin([0, 10, 20], 0)).toBe(0)
        expect(findBin([0, 10, 20], 20)).toBe(1)
        expect(findBin([0, 10, 20], -0.001)).toBe(-1)
        expect(findBin([0, 10, 20], 20.001)).toBe(-1)
        expect(findBin([20, 10, 0], 20)).toBe(0)
        expect(findBin([20, 10, 0], 0)).toBe(1)
    })
    it("findBin: NaN query point never hits", () => {
        expect(findBin([0, 10, 20, 30], NaN)).toBe(-1)
    })
    it("findBin: fewer than 2 edges has no bins", () => {
        expect(findBin([], 5)).toBe(-1)
        expect(findBin([5], 5)).toBe(-1)
    })
    it("findBin: duplicate edges (sub-pixel grid, edges collapse under Int quantization)", () => {
        // Holo quantizes edges to Int pixels; a grid with more columns than screen px produces
        // duplicate adjacent edges on the wire. Equivalence with the old linear scan holds here
        // (verified against the linear oracle below), including the zero-width bin[1]=[5,5].
        expect(findBin([0, 5, 5, 10], 3)).toBe(0)
        expect(findBin([0, 5, 5, 10], 5)).toBe(0) // ties still prefer the smaller-index bin
        expect(findBin([0, 5, 5, 10], 7)).toBe(2)
        expect(findBin([10, 5, 5, 0], 3)).toBe(2)
        expect(findBin([10, 5, 5, 0], 7)).toBe(0)
        expect(findBin([5, 5, 5], 5)).toBe(0)
        expect(findBin([5, 5, 5], 4)).toBe(-1)
        expect(findBin([5, 5], 5)).toBe(0)
    })
    it("findBin: a NaN endpoint is a documented, endpoint-only guard — not full oracle equivalence", () => {
        // Precondition (see the findBin doc comment): finite, monotonic edges. Julia's
        // RectInteractable enforces this before a :grid layer ships, so these inputs aren't
        // reachable from it — this pins the defense-in-depth fallback for a hand-built HitLayer
        // that skips that validation, so a future change can't silently regress it to a bogus
        // hit. The guard fires whenever edges[0] or edges[n-1] is non-finite, so all three
        // inputs below return -1 — but only the first matches the old linear scan's answer.
        // The other two are genuine divergences the guard doesn't paper over: [0,10,NaN] has a
        // real bin at v=5 (old scan returns 0 — the NaN only poisons the bin touching it, and v
        // never reaches that bin), and [NaN,10,20] has a real bin at v=15 for the same reason
        // (old scan returns 1). Both are only reachable via a hand-built HitLayer.
        expect(findBin([NaN, NaN, NaN], 5)).toBe(-1) // matches old (-1)
        expect(findBin([0, 10, NaN], 5)).toBe(-1) // diverges from old (0)
        expect(findBin([NaN, 10, 20], 15)).toBe(-1) // diverges from old (1)
    })
})

describe("findBin: binary search matches the old linear scan (oracle)", () => {
    // The oracle is the pre-optimization implementation this replaces: scan bins in increasing
    // k order, inclusive on both ends, return the first match. Kept here (not in src/) purely
    // as a reference for the property comparison below.
    function findBinLinear(edges: number[], v: number): number {
        for (let k = 0; k < edges.length - 1; k++) {
            const a = edges[k], b = edges[k + 1]
            if (v >= Math.min(a, b) && v <= Math.max(a, b)) return k
        }
        return -1
    }

    // Deterministic PRNG (mulberry32) so failures are reproducible without a fixed fixture list.
    function mulberry32(seed: number): () => number {
        let a = seed
        return () => {
            a |= 0; a = (a + 0x6D2B79F5) | 0
            let t = Math.imul(a ^ (a >>> 15), 1 | a)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    }

    it("agrees with the linear oracle over random monotonic edges and query points", () => {
        const rng = mulberry32(20260914)
        for (let trial = 0; trial < 500; trial++) {
            const n = 2 + Math.floor(rng() * 30) // 2..31 edges → 1..30 bins
            const ascending = rng() < 0.5
            // Non-decreasing, occasionally with duplicate adjacent edges (~30% of gaps) — Int
            // quantization of a sub-pixel grid collapses edges on the wire (see the dedicated
            // duplicate-edge unit test above); a plain "always distinct" generator would never
            // exercise that.
            const raw = Array.from({ length: n }, () => rng() * 1000)
            raw.sort((a, b) => a - b)
            for (let k = 1; k < raw.length; k++) {
                if (raw[k] < raw[k - 1]) raw[k] = raw[k - 1]
                else if (raw[k] === raw[k - 1]) { /* keep: exercise the duplicate-edge path */ }
                else if (rng() < 0.3) raw[k] = raw[k - 1] // force an occasional duplicate
            }
            const edges = ascending ? raw : raw.slice().reverse()

            // exercise: random points spanning well outside both ends, at every edge exactly
            // (the tie case), and at bin midpoints.
            const queries: number[] = [edges[0] - 50, edges[n - 1] + 50]
            for (const e of edges) queries.push(e)
            for (let k = 0; k < n - 1; k++) queries.push((edges[k] + edges[k + 1]) / 2)
            for (let q = 0; q < 20; q++) queries.push(edges[0] + (edges[n - 1] - edges[0]) * rng() * 1.4 - (edges[n - 1] - edges[0]) * 0.2)

            for (const v of queries) {
                expect(findBin(edges, v)).toBe(findBinLinear(edges, v))
            }
        }
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
    it("log (non-10) scale is treated the same as log10", () => {
        const t: AxisTransform = { ...linear, xlims: [1, 1000], xscale: "log" }
        expect(invertAxis(t, 100, 0).x).toBeCloseTo(31.6227, 2)
    })
    it("categorical x returns a label", () => {
        const t: AxisTransform = { ...linear, xlims: [1, 3], xcats: ["a", "b", "c"] }
        expect(invertAxis(t, 0, 200).x).toBe("a")
        expect(invertAxis(t, 200, 200).x).toBe("c")
    })
    it("reversed x flips the fraction before mapping to data", () => {
        const t: AxisTransform = { ...linear, xreversed: true }
        // left edge (px=0) would normally map to xmin=0; reversed maps it to xmax=10
        expect(invertAxis(t, 0, 200).x).toBeCloseTo(10)
        expect(invertAxis(t, 200, 200).x).toBeCloseTo(0)
    })
    it("reversed y flips the fraction before mapping to data", () => {
        const t: AxisTransform = { ...linear, yreversed: true }
        // top edge (py=0) normally maps to ymax=100 (fy=1); reversed maps it to ymin=0
        expect(invertAxis(t, 100, 0).y).toBeCloseTo(0)
        expect(invertAxis(t, 100, 400).y).toBeCloseTo(100)
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
    it("circle tolerance boundary: exactly r+HIT_TOL hits, one px beyond misses", () => {
        // HIT_TOL = 4px slack; r=10 → hit radius 14
        const one: HitLayer = { ...circles, geometry: [0, 0, 10] }
        expect(hitLayer(one, 14, 0)).not.toBeNull()
        expect(hitLayer(one, 15, 0)).toBeNull()
    })
    it("zero-radius circle still hits at its own tolerance ring, misses beyond it", () => {
        const zero: HitLayer = { ...circles, geometry: [50, 50, 0] }
        expect(hitLayer(zero, 50, 50)).not.toBeNull()   // dead center
        expect(hitLayer(zero, 54, 50)).not.toBeNull()   // within HIT_TOL
        expect(hitLayer(zero, 55, 50)).toBeNull()       // just beyond
    })
    it("non-finite circle coordinates never match (no crash)", () => {
        const nan: HitLayer = { ...circles, geometry: [NaN, NaN, 10] }
        expect(hitLayer(nan, 0, 0)).toBeNull()
    })
    it("rects hit-test: inside the half-extents hits, outside misses", () => {
        const rects: HitLayer = { id: "bars", kind: "rects", geometry: [100, 100, 40, 20], payloads: [{ i: 0 }], axis: "ax1", events: ["click"] }
        expect(hitLayer(rects, 100, 100)).toMatchObject({ index: 0 })
        expect(hitLayer(rects, 119, 109)).toMatchObject({ index: 0 }) // just inside half-extents (20,10)
        expect(hitLayer(rects, 121, 100)).toBeNull()                  // just outside half-width
        expect(hitLayer(rects, 500, 500)).toBeNull()
    })
    it("polyline: nearest segment wins, NaN vertices create a gap that's skipped, tolerance applies", () => {
        // three sub-lines: [0,0]-[10,0], a NaN gap, [20,0]-[30,0], another gap, [40,0]-[50,10]
        const pl: HitLayer = {
            id: "line", kind: "polyline", axis: "ax1", events: ["hover"], payloads: [],
            geometry: [0, 0, 10, 0, NaN, NaN, 20, 0, 30, 0, NaN, NaN, 40, 0, 50, 10],
        }
        // near the first sub-segment
        expect(hitLayer(pl, 5, 1)).toMatchObject({ index: 0 })
        // near the second sub-segment (index 3, after the NaN-bounded segments are skipped)
        expect(hitLayer(pl, 25, 1)).toMatchObject({ index: 3 })
        // far from every real segment → miss (the NaN-adjacent virtual segments must not match)
        expect(hitLayer(pl, 15, 20)).toBeNull()
        // beyond SEG_TOL (8px) from the nearest real segment
        expect(hitLayer(pl, 5, 20)).toBeNull()
    })
    it("segments: nearest of several disjoint segments wins; non-finite endpoints just don't match", () => {
        const segs: HitLayer = {
            id: "segs", kind: "segments", axis: "ax1", events: ["hover"], payloads: [],
            geometry: [0, 0, 10, 0, 100, 100, 110, 100],
        }
        expect(hitLayer(segs, 5, 1)).toMatchObject({ index: 0 })
        expect(hitLayer(segs, 105, 101)).toMatchObject({ index: 1 })
        expect(hitLayer(segs, 50, 50)).toBeNull() // equidistant-ish but beyond tolerance either way
        const nanSegs: HitLayer = { ...segs, geometry: [NaN, NaN, NaN, NaN, 5, 0, 15, 0] }
        expect(hitLayer(nanSegs, 10, 2)).toMatchObject({ index: 1 }) // NaN segment never wins, no crash
    })
    it("polygons: even-odd hit-tests each ring independently, first containing ring wins", () => {
        const square = [0, 0, 10, 0, 10, 10, 0, 10]
        const triangle = [20, 0, 30, 0, 25, 10]
        const polys: HitLayer = { id: "polys", kind: "polygons", axis: "ax1", events: ["click"], payloads: [{ i: 0 }, { i: 1 }],
            geometry: [square, triangle] }
        expect(hitLayer(polys, 5, 5)).toMatchObject({ index: 0 })
        expect(hitLayer(polys, 25, 3)).toMatchObject({ index: 1 })
        expect(hitLayer(polys, 100, 100)).toBeNull()
    })
    it("polygons: an even-odd ring with a bridged hole excludes the hole's interior", () => {
        // Outer 0..10 square, bridged out-and-back to an inner 3..7 hole: the bridge edge is
        // traversed twice (there and back), so its ray-crossings cancel and even-odd only "sees"
        // the outer boundary XOR the hole boundary — the hole's interior reads as outside.
        const ring = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0, 3, 3, 7, 3, 7, 7, 3, 7, 3, 3, 0, 0]
        expect(pointInPolygon(5, 5, ring)).toBe(false)   // inside the hole → excluded
        expect(pointInPolygon(1, 1, ring)).toBe(true)    // in the annulus between hole and outer edge
        expect(pointInPolygon(20, 20, ring)).toBe(false) // outside entirely
    })
    it("empty layer geometry never hits", () => {
        const emptyCircles: HitLayer = { id: "pts", kind: "circles", geometry: [], payloads: [], axis: "ax1", events: ["hover"] }
        expect(hitLayer(emptyCircles, 0, 0)).toBeNull()
        const emptyPolys: HitLayer = { id: "polys", kind: "polygons", geometry: [], payloads: [], axis: "ax1", events: ["hover"] }
        expect(hitLayer(emptyPolys, 0, 0)).toBeNull()
    })
    it("grid inverts pixel to (i,j) + value", () => {
        const grid: HitLayer = { id: "hm", kind: "grid", axis: "ax1", events: ["hover"], payloads: [],
            geometry: { xedges: [0, 10, 20], yedges: [0, 10, 20], ncols: 2, nrows: 2, values: [11, 12, 21, 22] } }
        const h = hitLayer(grid, 15, 5)
        expect(h?.grid_).toEqual([1, 0, 12]) // i=1, j=0, values[0*2+1]
    })
    it("grid misses outside every bin on either axis", () => {
        const grid: HitLayer = { id: "hm", kind: "grid", axis: "ax1", events: ["hover"], payloads: [],
            geometry: { xedges: [0, 10, 20], yedges: [0, 10, 20], ncols: 2, nrows: 2, values: [11, 12, 21, 22] } }
        expect(hitLayer(grid, 99, 5)).toBeNull()  // x outside every bin
        expect(hitLayer(grid, 5, 99)).toBeNull()  // y outside every bin
    })
    it("grid still hits (i,j) when values[] was dropped", () => {
        const grid: HitLayer = { id: "hm", kind: "grid", axis: "ax1", events: ["hover"], payloads: [],
            geometry: { xedges: [0, 10, 20], yedges: [0, 10, 20], ncols: 2, nrows: 2 } } // no values
        const h = hitLayer(grid, 15, 5)
        expect(h?.grid_).toEqual([1, 0, undefined]) // index found; value absent, no crash
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
    it("resolvePayload omits value entirely when values[] was dropped", () => {
        const grid: HitLayer = { id: "hm", kind: "grid", axis: "ax1", events: ["click"], payloads: [],
            geometry: { xedges: [0, 10, 20], yedges: [0, 10, 20], ncols: 2, nrows: 2 } } // no values
        const m: Manifest = { width: 20, height: 20, scaling: 1, transforms: {}, layers: [grid] }
        const hit = hitTest(m, 15, 5, "click")!
        const pl = resolvePayload(hit, m, 15, 5)
        expect(pl).toEqual({ i: 1, j: 0 }) // {i,j} only — no `value` key, not value:undefined
        expect("value" in (pl as object)).toBe(false)
    })
    it("resolvePayload includes value when values[] is present", () => {
        const grid: HitLayer = { id: "hm", kind: "grid", axis: "ax1", events: ["click"], payloads: [],
            geometry: { xedges: [0, 10, 20], yedges: [0, 10, 20], ncols: 2, nrows: 2, values: [11, 12, 21, 22] } }
        const m: Manifest = { width: 20, height: 20, scaling: 1, transforms: {}, layers: [grid] }
        const hit = hitTest(m, 15, 5, "click")!
        expect(resolvePayload(hit, m, 15, 5)).toEqual({ i: 1, j: 0, value: 12 })
    })
})

describe("segments/polyline per-layer tol", () => {
    const seg: HitLayer = { id: "segs", kind: "segments", geometry: [0, 0, 100, 0], payloads: [{}], axis: "ax1", events: ["hover"] }
    it("a per-layer tol overrides SEG_TOL in both directions (tighter and looser)", () => {
        // 6px from the line: outside a tight custom tol=2, but inside a loose custom
        // tol=20 — both bracket the default SEG_TOL=8, so this only passes if `tol` is
        // actually read from the layer instead of falling back to SEG_TOL.
        const tight = { ...seg, tol: 2 }
        const loose = { ...seg, tol: 20 }
        expect(hitLayer(tight, 50, 6)).toBeNull()          // 6px > tol=2
        expect(hitLayer(loose, 50, 6)).toMatchObject({ index: 0 }) // 6px <= tol=20
    })
    it("missing tol falls back to SEG_TOL", () => {
        expect(hitLayer(seg, 50, 7)).toMatchObject({ index: 0 })  // 7px <= SEG_TOL=8
        expect(hitLayer(seg, 50, 9)).toBeNull()                   // 9px > SEG_TOL=8
    })
    it("polyline honors the same per-layer tol", () => {
        const line: HitLayer = { ...seg, kind: "polyline", geometry: [0, 0, 100, 0], tol: 3 }
        expect(hitLayer(line, 50, 2)).toMatchObject({ index: 0 }) // 2px <= tol=3
        expect(hitLayer(line, 50, 5)).toBeNull()                  // 5px > tol=3
    })
})

describe("threshold hit-test", () => {
    const h: HitLayer = { id: "thr", kind: "threshold", axis: "ax1", events: ["drag"], payloads: [],
        geometry: { orientation: "h", pos: 100, span: [0, 200] } }
    it("hits within SEG_TOL of a horizontal line, misses beyond", () => {
        expect(hitLayer(h, 50, 102)).toMatchObject({ index: 0 })       // 2px ≤ 8
        expect(hitLayer(h, 50, 120)).toBeNull()                        // 20px
        expect(hitLayer(h, 50, 100)?.geom_).toEqual(["seg", 0, 100, 200, 100])
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
    it("corners take precedence, then edges, then interior, else miss", () => {
        expect(hitLayer(roi, 100, 50)).toMatchObject({ roiPart_: { corner: 0 } })   // TL
        expect(hitLayer(roi, 300, 170)).toMatchObject({ roiPart_: { corner: 2 } })  // BR (x+w, y+h)
        expect(hitLayer(roi, 200, 50)).toMatchObject({ roiPart_: { edge: "n" } })   // top midpoint
        expect(hitLayer(roi, 200, 170)).toMatchObject({ roiPart_: { edge: "s" } })  // bottom midpoint
        expect(hitLayer(roi, 100, 110)).toMatchObject({ roiPart_: { edge: "w" } })  // left midpoint
        expect(hitLayer(roi, 300, 110)).toMatchObject({ roiPart_: { edge: "e" } })  // right midpoint
        expect(hitLayer(roi, 200, 110)).toMatchObject({ roiPart_: { move: true } }) // interior
        expect(hitLayer(roi, 50, 50)).toBeNull()                                    // outside
    })
    it("hit area is >= 2x the drawn handle half-size, floored at 6px, and never below the drawn glyph", () => {
        const tiny: HitLayer = { ...roi, geometry: { x: 100, y: 50, w: 200, h: 120, handle: 1 } }
        // handle=1 → drawn half-size 1px, but the hit half-size floors at 6px
        expect(hitLayer(tiny, 100, 56)).toMatchObject({ roiPart_: { corner: 0 } }) // 6px from the TL corner
        expect(hitLayer(tiny, 100, 40)).toBeNull() // 10px away (and outside the box entirely) → miss
    })
    it("on a small ROI where corner and edge hit boxes overlap, the corner wins (checked first)", () => {
        // 20x20 ROI with handle=8 → hit half-size 16px; corner (0,0) and edge midpoints (10,0)/(0,10)
        // are all within 16px of each other, so a point roughly between them must still resolve
        // to the two-axis corner drag, not a one-axis edge drag.
        const small: HitLayer = { id: "roi", kind: "roi", axis: "ax1", events: ["drag"], payloads: [],
            geometry: { x: 0, y: 0, w: 20, h: 20, handle: 8 } }
        expect(hitLayer(small, 3, 3)).toMatchObject({ roiPart_: { corner: 0 } })
    })
})

describe("view pan / orbit math", () => {
    const t: AxisTransform = {
        xlims: [0, 10], ylims: [0, 100], xscale: "identity", yscale: "identity",
        viewport: [0, 0, 1000, 500], xreversed: false, yreversed: false,
    }
    it("panLimits shifts lims opposite the drag (grab metaphor)", () => {
        // drag right by 100 image-px (= 0.1 of viewport) → xlims move left by 1
        const lim = panLimits(t, 100, 250, 200, 250)
        expect(lim.xmin).toBeCloseTo(-1)
        expect(lim.xmax).toBeCloseTo(9)
        expect(lim.ymin).toBeCloseTo(0)
        expect(lim.ymax).toBeCloseTo(100)
    })
    it("panLimits respects log scales in fractional space", () => {
        const logT: AxisTransform = { ...t, xlims: [1, 100], xscale: "log10" }
        const lim = panLimits(logT, 0, 250, 500, 250) // half viewport → one decade
        expect(lim.xmin).toBeCloseTo(0.1, 6)
        expect(lim.xmax).toBeCloseTo(10, 6)
    })
    it("panLimits on a reversed axis flips the drag direction back", () => {
        const revT: AxisTransform = { ...t, xreversed: true, yreversed: true }
        const rev = panLimits(revT, 100, 100, 200, 300)
        expect(rev.xmin).toBeCloseTo(1)
        expect(rev.xmax).toBeCloseTo(11)
        expect(rev.ymin).toBeCloseTo(-40)
        expect(rev.ymax).toBeCloseTo(60)
    })
    it("orbitAngles maps dx/dy to azimuth/elevation and clamps elevation", () => {
        const g = { x: 0, y: 0, w: 1000, h: 500, mode: "orbit" as const, azimuth: 1.0, elevation: 0.5 }
        const o = orbitAngles(g, 0, 0, 1000, 0) // full-width drag right → −π azimuth
        expect(o.azimuth).toBeCloseTo(1.0 - Math.PI)
        expect(o.elevation).toBeCloseTo(0.5)
        const clamped = orbitAngles(g, 0, 0, 0, 1e6)
        expect(clamped.elevation).toBeLessThan(Math.PI / 2)
        expect(clamped.elevation).toBeGreaterThan(-Math.PI / 2)
    })
    it("orbitAngles defaults azimuth/elevation to 0 when the geometry omits them", () => {
        const g = { x: 0, y: 0, w: 1000, h: 500, mode: "orbit" as const }
        const o = orbitAngles(g, 0, 0, 1000, 0)
        expect(o.azimuth).toBeCloseTo(0 - Math.PI)
        expect(o.elevation).toBeCloseTo(0)
    })
    it("view hit-test is the viewport bbox", () => {
        const layer: HitLayer = {
            id: "view", kind: "view", axis: "ax1", events: ["drag"], payloads: [],
            geometry: { x: 100, y: 50, w: 200, h: 120, mode: "pan" },
        }
        expect(hitLayer(layer, 150, 100)).toMatchObject({ index: 0 })
        expect(hitLayer(layer, 10, 10)).toBeNull()
    })
})

describe("colorbar axis hit-test", () => {
    const bar: HitLayer = { id: "colorbar", kind: "axis", geometry: [100, 50, 12, 200], payloads: [], axis: "cb1", events: ["hover", "click"] }
    const cbT: AxisTransform = { xlims: [0, 1], ylims: [0, 10], xscale: "identity", yscale: "identity", viewport: [100, 50, 12, 200], xreversed: false, yreversed: false, valueaxis: "y" }
    const manifest = { transforms: { cb1: cbT } } as unknown as Manifest

    it("bounded axis hit: inside bbox hits, outside misses", () => {
        expect(hitLayer(bar, 106, 150)).not.toBeNull()          // inside the bar
        expect(hitLayer(bar, 300, 150)).toBeNull()              // outside → no hit
    })
    it("unbounded axis (no geometry) is a catch-all", () => {
        const axisLayer: HitLayer = { ...bar, id: "axis", geometry: null, axis: "ax1" }
        expect(hitLayer(axisLayer, 999, 999)).not.toBeNull()
    })
    it("valueaxis payload returns a scalar value", () => {
        const hit = { layer: bar, index: -1, axis_: "cb1" }
        const p = resolvePayload(hit as any, manifest, 106, 150) as { value: number }
        // py=150 is the vertical midpoint (viewport y=50..250) → fy=0.5 → value=5 on ylims [0,10]
        expect(p.value).toBeCloseTo(5, 6)
    })
})

describe("anchorFor: mark-anchored tooltip placement", () => {
    const layer = (kind: HitLayer["kind"]): HitLayer =>
        ({ id: "l", kind, axis: "ax1", events: ["hover"], payloads: [], geometry: null })

    it("circle: anchor at centre, top edge above by r", () => {
        const hit: Hit = { layer: layer("circles"), index: 0, geom_: ["circle", 50, 60, 10] }
        expect(anchorFor(hit, { x: 50, y: 60 })).toEqual({ x: 50, y: 60, top: 50 })
    })
    it("rect (bar): anchor at top-centre — already its own top edge", () => {
        const hit: Hit = { layer: layer("rects"), index: 0, geom_: ["rect", 100, 200, 40, 80] }
        expect(anchorFor(hit, { x: 100, y: 200 })).toEqual({ x: 100, y: 160, top: 160 }) // cy(200) - h/2(40)
    })
    it("grid cell reuses the rect rule (hitLayer reports a cell as a rect geom)", () => {
        const hit: Hit = { layer: layer("grid"), index: 0, geom_: ["rect", 15, 25, 10, 10], grid_: [0, 0, 5] }
        expect(anchorFor(hit, { x: 15, y: 25 })).toEqual({ x: 15, y: 20, top: 20 })
    })
    it("segment: nearest point on the segment to the cursor — the tooltip slides along the line", () => {
        const hit: Hit = { layer: layer("segments"), index: 0, geom_: ["seg", 0, 0, 100, 0] }
        expect(anchorFor(hit, { x: 30, y: 5 })).toEqual({ x: 30, y: 0, top: 0 }) // projects onto the line
        expect(anchorFor(hit, { x: -20, y: 0 })).toEqual({ x: 0, y: 0, top: 0 }) // clamped to the endpoint
    })
    it("segment with no cursor (keyboard focus): falls back to the midpoint", () => {
        const hit: Hit = { layer: layer("polyline"), index: 0, geom_: ["seg", 0, 0, 100, 100] }
        expect(anchorFor(hit, null)).toEqual({ x: 50, y: 50, top: 50 })
    })
    it("polygon: centroid when it lies inside the polygon", () => {
        const hit: Hit = { layer: layer("polygons"), index: 0, geom_: ["poly", [0, 0, 10, 0, 10, 10, 0, 10]] }
        expect(anchorFor(hit, { x: 3, y: 3 })).toEqual({ x: 5, y: 5, top: 5 })
    })
    it("polygon: cursor point when the vertex-mean centroid falls outside (e.g. a concave notch)", () => {
        // a "C"-shaped ring with a rectangular notch cut into x:[3,10] y:[3,7] on the right side —
        // the vertex-mean centroid sits inside that notch, i.e. outside the polygon.
        const ring = [0, 0, 10, 0, 10, 3, 3, 3, 3, 7, 10, 7, 10, 10, 0, 10]
        expect(pointInPolygon(5.75, 5, ring)).toBe(false) // confirms the fixture's premise
        const hit: Hit = { layer: layer("polygons"), index: 0, geom_: ["poly", ring] }
        expect(anchorFor(hit, { x: 1, y: 5 })).toEqual({ x: 1, y: 5, top: 5 })
    })
    it("axis/threshold/roi/view: cursor-following, never anchored to geom (checked by layer.kind first)", () => {
        for (const kind of ["axis", "threshold", "roi", "view"] as const) {
            // geom tagged "seg" deliberately — same shape as :segments/:threshold — to prove the
            // kind check runs before any geom-tag dispatch.
            const hit: Hit = { layer: layer(kind), index: 0, geom_: ["seg", 0, 0, 100, 100] }
            expect(anchorFor(hit, { x: 42, y: 17 })).toEqual({ x: 42, y: 17, top: 17 })
        }
    })
})

describe("computeAnchoredPlacement", () => {
    it("default: box centred on the anchor, placed above the mark's top edge with a 10px gap", () => {
        const p = computeAnchoredPlacement({ x: 100, y: 100, top: 80 }, 60, 20, 400, 300)
        expect(p.left).toBe(70)   // 100 - 60/2
        expect(p.top).toBe(50)    // 80 - 10 (gap) - 20 (height)
        expect(p.caretX).toBe(30) // centred: anchor.x - left
        expect(p.below).toBe(false)
    })
    it("flips below the mark when the box would clip the surface's top edge", () => {
        const p = computeAnchoredPlacement({ x: 100, y: 20, top: 10 }, 60, 20, 400, 300)
        // above would need top = 10 - 10 - 20 = -20 (< the 8px edge gap) → flips below;
        // bottom = y + (y - top) = 30; below-top = 30 + 10 (gap) = 40
        expect(p.top).toBe(40)
        expect(p.below).toBe(true)
    })
    it("shifts the box inside the surface and moves the caret to stay over the anchor, near a side", () => {
        const p = computeAnchoredPlacement({ x: 5, y: 100, top: 80 }, 60, 20, 400, 300)
        expect(p.left).toBe(8) // edge-gap clamp (unclamped left would be 5 - 30 = -25)
        expect(p.caretX).toBe(6) // clamped to the caret's own min inset, not the literal x-left(-3)
    })
})
