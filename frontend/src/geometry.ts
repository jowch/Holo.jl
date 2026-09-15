// All coordinates here are image pixels.
import type { AxisTransform, GridGeometry, Hit, HitLayer, Manifest, ThresholdGeometry, ROIGeometry, ViewGeometry } from "./types"

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

// index of the bin containing v in a monotonic (asc or desc) edge array; -1 if outside.
// Binary search over edges.length-1 bins (O(log n)) — grid layers can have ~1000 edges per
// axis and this runs twice per hover. On a value that sits exactly on an interior edge, the
// bin bracketed by [edges[k], edges[k+1]] on the smaller-k side wins (matches the linear scan
// this replaces, which tested bins in increasing k order with inclusive comparisons on both
// ends and returned the first match).
//
// Precondition: `edges` is finite and monotonic (asc or desc) — Julia's `RectInteractable`
// enforces this before a `:grid` layer ever ships (monotonicity at construction; finiteness
// of the *projected* edges at `hitlayers` time, since a log-scale axis can turn a finite data
// edge into a non-finite pixel one). Under that precondition this is byte-identical to the old
// linear scan for every input, incl. duplicate edges and points exactly on an edge (pinned by
// a property test, `geometry.test.ts`). Outside the precondition (a NaN edge from a
// hand-built `HitLayer` that bypassed `RectInteractable`) this only guards the two endpoints —
// an interior NaN can still pick a bogus bin — so it's a defense-in-depth fallback, not a
// second guarantee.
export function findBin(edges: number[], v: number): number {
    const n = edges.length
    if (n < 2 || Number.isNaN(v) || !Number.isFinite(edges[0]) || !Number.isFinite(edges[n - 1])) return -1
    const ascending = edges[n - 1] > edges[0]
    if (ascending) {
        if (v < edges[0] || v > edges[n - 1]) return -1
    } else {
        if (v > edges[0] || v < edges[n - 1]) return -1
    }
    let lo = 0, hi = n - 2
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        const bracketsOrBefore = ascending ? v <= edges[mid + 1] : v >= edges[mid + 1]
        if (bracketsOrBefore) hi = mid
        else lo = mid + 1
    }
    return lo
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
                if ((px - cx) ** 2 + (py - cy) ** 2 <= (r + HIT_TOL) ** 2) return { index: k, geom_: ["circle", cx, cy, r] }
            }
            return null
        }
        case "rects": {
            const a = g as number[]
            for (let k = 0; k < a.length / 4; k++) {
                const cx = a[4 * k], cy = a[4 * k + 1], w = a[4 * k + 2], h = a[4 * k + 3]
                if (Math.abs(px - cx) <= w / 2 && Math.abs(py - cy) <= h / 2) return { index: k, geom_: ["rect", cx, cy, w, h] }
            }
            return null
        }
        case "polyline": {
            const a = g as number[]
            const tol = layer.tol ?? SEG_TOL
            let best = -1, bd = Infinity
            for (let k = 0; k < a.length / 2 - 1; k++) {
                const x0 = a[2 * k], y0 = a[2 * k + 1], x1 = a[2 * k + 2], y1 = a[2 * k + 3]
                if (Number.isNaN(x0) || Number.isNaN(x1)) continue
                const d = distToSegment(px, py, x0, y0, x1, y1)
                if (d < bd) { bd = d; best = k }
            }
            if (bd <= tol) return { index: best, geom_: ["seg", a[2 * best], a[2 * best + 1], a[2 * best + 2], a[2 * best + 3]] }
            return null
        }
        case "segments": {
            const a = g as number[]
            const tol = layer.tol ?? SEG_TOL
            let best = -1, bd = Infinity
            for (let k = 0; k < a.length / 4; k++) {
                const d = distToSegment(px, py, a[4 * k], a[4 * k + 1], a[4 * k + 2], a[4 * k + 3])
                if (d < bd) { bd = d; best = k }
            }
            if (bd <= tol) return { index: best, geom_: ["seg", a[4 * best], a[4 * best + 1], a[4 * best + 2], a[4 * best + 3]] }
            return null
        }
        case "polygons": {
            const rings = g as number[][]
            for (let k = 0; k < rings.length; k++) if (pointInPolygon(px, py, rings[k])) return { index: k, geom_: ["poly", rings[k]] }
            return null
        }
        case "grid": {
            const gg = g as GridGeometry
            const i = findBin(gg.xedges, px), j = findBin(gg.yedges, py)
            if (i < 0 || j < 0) return null
            const idx = j * gg.ncols + i
            return {
                index: idx,
                grid_: [i, j, gg.values?.[idx]],
                geom_: ["rect", (gg.xedges[i] + gg.xedges[i + 1]) / 2, (gg.yedges[j] + gg.yedges[j + 1]) / 2,
                    Math.abs(gg.xedges[i + 1] - gg.xedges[i]), Math.abs(gg.yedges[j + 1] - gg.yedges[j])],
            }
        }
        case "threshold": {
            const tg = g as ThresholdGeometry
            const [lo, hi] = tg.span
            const x0 = tg.orientation === "h" ? lo : tg.pos
            const y0 = tg.orientation === "h" ? tg.pos : lo
            const x1 = tg.orientation === "h" ? hi : tg.pos
            const y1 = tg.orientation === "h" ? tg.pos : hi
            if (distToSegment(px, py, x0, y0, x1, y1) <= SEG_TOL) return { index: 0, geom_: ["seg", x0, y0, x1, y1] }
            return null
        }
        case "roi": {
            const rg = g as ROIGeometry
            const corners: [number, number][] = [[rg.x, rg.y], [rg.x + rg.w, rg.y], [rg.x + rg.w, rg.y + rg.h], [rg.x, rg.y + rg.h]]
            for (let k = 0; k < 4; k++) {
                if (Math.abs(px - corners[k][0]) <= rg.handle && Math.abs(py - corners[k][1]) <= rg.handle) return { index: 0, roiPart_: { corner: k } }
            }
            if (px >= rg.x && px <= rg.x + rg.w && py >= rg.y && py <= rg.y + rg.h) return { index: 0, roiPart_: { move: true } }
            return null
        }
        case "axis": {
            if (g && Array.isArray(g) && g.length === 4) {
                const [x, y, w, h] = g as number[]
                if (px < x || px > x + w || py < y || py > y + h) return null // bounded (colorbar)
            }
            return { index: -1, axis_: layer.axis } // catch-all when no bbox (AxisInteractable)
        }
        case "view": {
            const vg = g as ViewGeometry
            if (px < vg.x || px > vg.x + vg.w || py < vg.y || py > vg.y + vg.h) return null
            return { index: 0 }
        }
    }
}

// Shift axis limits by a fractional viewport delta (grab pan). Works for identity + log scales.
export function shiftLims(lims: [number, number], scale: string, df: number): [number, number] {
    if (scale === "log10" || scale === "log") {
        const a = Math.log10(lims[0]), b = Math.log10(lims[1]), w = b - a
        return [Math.pow(10, a - df * w), Math.pow(10, b - df * w)]
    }
    const w = lims[1] - lims[0]
    return [lims[0] - df * w, lims[1] - df * w]
}

/** 2D pan: keep the point under the cursor fixed → shift lims opposite the drag (fractional). */
export function panLimits(
    t: AxisTransform, x0: number, y0: number, x1: number, y1: number,
): { xmin: number; xmax: number; ymin: number; ymax: number } {
    const [vx, vy, vw, vh] = t.viewport
    let fx0 = (x0 - vx) / vw, fx1 = (x1 - vx) / vw
    let fy0 = 1 - (y0 - vy) / vh, fy1 = 1 - (y1 - vy) / vh
    if (t.xreversed) { fx0 = 1 - fx0; fx1 = 1 - fx1 }
    if (t.yreversed) { fy0 = 1 - fy0; fy1 = 1 - fy1 }
    const [xmin, xmax] = shiftLims(t.xlims, t.xscale, fx1 - fx0)
    const [ymin, ymax] = shiftLims(t.ylims, t.yscale, fy1 - fy0)
    return { xmin, xmax, ymin, ymax }
}

/** Axis3 orbit: pixel Δ → azimuth/elevation (radians). Elevation clamped away from ±π/2. */
export function orbitAngles(
    g: ViewGeometry, x0: number, y0: number, x1: number, y1: number,
): { azimuth: number; elevation: number } {
    const sens = Math.PI / Math.max(1, g.w)
    const az0 = g.azimuth ?? 0
    const el0 = g.elevation ?? 0
    const az = az0 - (x1 - x0) * sens
    const elMax = Math.PI / 2 - 0.01
    const el = Math.max(-elMax, Math.min(elMax, el0 + (y1 - y0) * sens))
    return { azimuth: az, elevation: el }
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
    if (hit.axis_) {
        const t = manifest.transforms[hit.axis_]
        const inv = invertAxis(t, px, py)
        return t.valueaxis ? { value: inv[t.valueaxis] } : inv
    }
    if (hit.grid_) return hit.grid_[2] === undefined ? { i: hit.grid_[0], j: hit.grid_[1] } : { i: hit.grid_[0], j: hit.grid_[1], value: hit.grid_[2] }
    return hit.layer.payloads[hit.index]
}
