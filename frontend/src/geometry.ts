// Pure hit-test math — no DOM. All coordinates are image pixels. Unit-tested in test/geometry.test.ts.
import type { AxisTransform, GridGeometry, Hit, HitLayer, Manifest } from "./types"

const HIT_TOL = 4 // px slack for circles/rects
const SEG_TOL = 8 // px slack for segments/polylines

export function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
    const dx = x1 - x0
    const dy = y1 - y0
    const len2 = dx * dx + dy * dy
    let t = len2 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

// even-odd point-in-polygon; ring is a flat [x,y,…]
export function pointInPolygon(px: number, py: number, ring: number[]): boolean {
    let inside = false
    const n = ring.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = ring[2 * i], yi = ring[2 * i + 1]
        const xj = ring[2 * j], yj = ring[2 * j + 1]
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
}

// index of the bin containing v in a monotonic (asc or desc) edge array; -1 if outside
export function findBin(edges: number[], v: number): number {
    for (let k = 0; k < edges.length - 1; k++) {
        const a = edges[k], b = edges[k + 1]
        if (v >= Math.min(a, b) && v <= Math.max(a, b)) return k
    }
    return -1
}

// invert image-px → data coords via an axis transform
export function invertAxis(t: AxisTransform, px: number, py: number): { x: number | string; y: number | string } {
    const [vx, vy, vw, vh] = t.viewport
    let fx = (px - vx) / vw
    if (t.xreversed) fx = 1 - fx
    let fy = 1 - (py - vy) / vh
    if (t.yreversed) fy = 1 - fy
    return { x: mapAxis(t.xlims, t.xscale, fx, t.xcats), y: mapAxis(t.ylims, t.yscale, fy, t.ycats) }
}

function mapAxis(lims: [number, number], scale: string, f: number, cats?: string[] | null): number | string {
    let v: number
    if (scale === "log10" || scale === "log") {
        const a = Math.log10(lims[0]), b = Math.log10(lims[1])
        v = Math.pow(10, a + f * (b - a))
    } else {
        v = lims[0] + f * (lims[1] - lims[0])
    }
    if (cats && cats.length) {
        const i = Math.max(0, Math.min(cats.length - 1, Math.round(v) - 1)) // Makie categoricals sit at 1..n
        return cats[i]
    }
    return v
}

// hit-test one layer at (px,py); null if no element under the point
export function hitLayer(layer: HitLayer, px: number, py: number): Omit<Hit, "layer"> | null {
    const g = layer.geometry
    switch (layer.kind) {
        case "circles": {
            const a = g as number[]
            for (let k = 0; k < a.length / 3; k++) {
                const cx = a[3 * k], cy = a[3 * k + 1], r = a[3 * k + 2]
                if ((px - cx) ** 2 + (py - cy) ** 2 <= (r + HIT_TOL) ** 2) return { index: k, geom: ["circle", cx, cy, r] }
            }
            return null
        }
        case "rects": {
            const a = g as number[]
            for (let k = 0; k < a.length / 4; k++) {
                const cx = a[4 * k], cy = a[4 * k + 1], w = a[4 * k + 2], h = a[4 * k + 3]
                if (Math.abs(px - cx) <= w / 2 && Math.abs(py - cy) <= h / 2) return { index: k, geom: ["rect", cx, cy, w, h] }
            }
            return null
        }
        case "polyline": {
            const a = g as number[]
            let best = -1, bd = Infinity
            for (let k = 0; k < a.length / 2 - 1; k++) {
                const x0 = a[2 * k], y0 = a[2 * k + 1], x1 = a[2 * k + 2], y1 = a[2 * k + 3]
                if (Number.isNaN(x0) || Number.isNaN(x1)) continue
                const d = distToSegment(px, py, x0, y0, x1, y1)
                if (d < bd) { bd = d; best = k }
            }
            if (bd <= SEG_TOL) return { index: best, geom: ["seg", a[2 * best], a[2 * best + 1], a[2 * best + 2], a[2 * best + 3]] }
            return null
        }
        case "segments": {
            const a = g as number[]
            let best = -1, bd = Infinity
            for (let k = 0; k < a.length / 4; k++) {
                const d = distToSegment(px, py, a[4 * k], a[4 * k + 1], a[4 * k + 2], a[4 * k + 3])
                if (d < bd) { bd = d; best = k }
            }
            if (bd <= SEG_TOL) return { index: best, geom: ["seg", a[4 * best], a[4 * best + 1], a[4 * best + 2], a[4 * best + 3]] }
            return null
        }
        case "polygons": {
            const rings = g as number[][]
            for (let k = 0; k < rings.length; k++) if (pointInPolygon(px, py, rings[k])) return { index: k, geom: ["poly", rings[k]] }
            return null
        }
        case "grid": {
            const gg = g as GridGeometry
            const i = findBin(gg.xedges, px), j = findBin(gg.yedges, py)
            if (i < 0 || j < 0) return null
            const idx = j * gg.ncols + i
            return {
                index: idx,
                grid: [i, j, gg.values[idx]],
                geom: ["rect", (gg.xedges[i] + gg.xedges[i + 1]) / 2, (gg.yedges[j] + gg.yedges[j + 1]) / 2,
                    Math.abs(gg.xedges[i + 1] - gg.xedges[i]), Math.abs(gg.yedges[j + 1] - gg.yedges[j])],
            }
        }
        case "axis":
            return { index: -1, axis: layer.axis }
    }
}

// first layer (in manifest order) with a hit for the given event; null if none
export function hitTest(manifest: Manifest, px: number, py: number, event: string): Hit | null {
    for (const layer of manifest.layers) {
        if (!layer.events.includes(event)) continue
        const h = hitLayer(layer, px, py)
        if (h) return { layer, ...h }
    }
    return null
}

// the @bind payload for a hit (single-select)
export function resolvePayload(hit: Hit, manifest: Manifest, px: number, py: number): unknown {
    if (hit.axis) return invertAxis(manifest.transforms[hit.axis], px, py)
    if (hit.grid) return { i: hit.grid[0], j: hit.grid[1], value: hit.grid[2] }
    return hit.layer.payloads[hit.index]
}
