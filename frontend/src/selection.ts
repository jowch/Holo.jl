import { findBin, invertAxis } from "./geometry"
import type { AxisTransform, GridGeometry, Hit, HitLayer, Manifest } from "./types"

// Bond item shape emitted per contained element in a selects-ROI { items: SelectionItem[] }
export type SelectionItem = { layer: string; index: number; payload: unknown }
export type SelectionResult = { items: SelectionItem[]; hits: Hit[] }

// [lo,hi] pixel span over an edge array → inclusive cell-index range clamped to the grid, or null if no overlap.
export function cellRange(edges: number[], lo: number, hi: number): [number, number] | null {
    const gmin = Math.min(edges[0], edges[edges.length - 1]), gmax = Math.max(edges[0], edges[edges.length - 1])
    const clo = Math.max(lo, gmin), chi = Math.min(hi, gmax)
    if (chi < clo) return null
    const a = findBin(edges, clo), b = findBin(edges, chi)
    if (a < 0 || b < 0) return null
    return [Math.min(a, b), Math.max(a, b)]
}

// Box pixel-rect → contained items + highlight hits, dispatched by target kind.
export function computeSelection(
    box: { x: number; y: number; w: number; h: number },
    target: HitLayer,
    t: AxisTransform
): SelectionResult {
    const xlo = box.x, xhi = box.x + box.w, ylo = box.y, yhi = box.y + box.h
    if (target.kind === "circles" && Array.isArray(target.geometry)) {
        const a = target.geometry as number[]
        const items: SelectionItem[] = [], hits: Hit[] = []
        for (let k = 0; k < Math.floor(a.length / 3); k++) {
            const cx = a[3 * k], cy = a[3 * k + 1]
            if (cx >= xlo && cx <= xhi && cy >= ylo && cy <= yhi) {
                items.push({ layer: target.id, index: k, payload: target.payloads[k] })
                hits.push({ layer: target, index: k, geom_: ["circle", cx, cy, a[3 * k + 2]] })
            }
        }
        return { items, hits }
    }
    if (target.kind === "grid") {
        const gg = target.geometry as GridGeometry
        const ci = cellRange(gg.xedges, xlo, xhi), cj = cellRange(gg.yedges, ylo, yhi)
        if (!ci || !cj) return { items: [], hits: [] }
        const [i0, i1] = ci, [j0, j1] = cj
        // i0..j1 are cell indices clamped to the grid; xmin..ymax are the unclamped drawn-box
        // bounds — the two differ when the box overhangs the grid.
        const a = invertAxis(t, xlo, ylo), b = invertAxis(t, xhi, yhi)
        const ax = a.x as number, bx = b.x as number, ay = a.y as number, by = b.y as number
        const payload = {
            i0, i1, j0, j1,
            xmin: Math.min(ax, bx), xmax: Math.max(ax, bx),
            ymin: Math.min(ay, by), ymax: Math.max(ay, by),
        }
        const rx0 = gg.xedges[i0], rx1 = gg.xedges[i1 + 1], ry0 = gg.yedges[j0], ry1 = gg.yedges[j1 + 1]
        // "rectfill", not "rect": this block sits beside the continuous ROI outline the user is
        // actually dragging, so it must not draw its own stroke on top of/next to that outline
        // (a stroked rect here reads as two overlapping boxes with parallel edges after release —
        // see highlight.ts's makeHiElement). An element-indexed :rects selection (selects on a
        // rects-kind target, or `selected=`) keeps its stroke; only this cell-block union rect
        // — which exists only because a grid target isn't itself element-selectable — is fill-only.
        const hits: Hit[] = [{ layer: target, index: 0,
            geom_: ["rectfill", (rx0 + rx1) / 2, (ry0 + ry1) / 2, Math.abs(rx1 - rx0), Math.abs(ry1 - ry0)] }]
        return { items: [{ layer: target.id, index: 0, payload }], hits }
    }
    return { items: [], hits: [] } // unsupported target kind
}

// Kinds that can be drawn as a persistent pre-highlight (mirrors Julia `_SELECTED_KINDS`).
// Open kinds (segments / polyline) use the selected-ring recipe; closed kinds use the wash.
const SELECTED_KINDS = new Set(["circles", "rects", "polygons", "segments", "polyline"])

export function layerNElements(layer: HitLayer): number {
    const g = layer.geometry
    if (layer.kind === "circles" && Array.isArray(g)) return Math.floor((g as number[]).length / 3)
    if (layer.kind === "rects" && Array.isArray(g)) return Math.floor((g as number[]).length / 4)
    if (layer.kind === "polygons" && Array.isArray(g)) return (g as number[][]).length
    if (layer.kind === "segments" && Array.isArray(g)) return Math.floor((g as number[]).length / 4)
    if (layer.kind === "polyline" && Array.isArray(g)) return Math.max(0, Math.floor((g as number[]).length / 2) - 1)
    if (layer.kind === "grid" && g && typeof g === "object" && "ncols" in (g as object)) {
        const gg = g as GridGeometry
        return gg.ncols * gg.nrows
    }
    return 0
}

// Fail loud on unsupported kinds / OOB indices — defense in depth for a stale manifest, since
// Julia `build_manifest` validates the same thing.
export function hitLayerByIndex(layer: HitLayer, index: number): Omit<Hit, "layer"> {
    if (!SELECTED_KINDS.has(layer.kind)) {
        throw new Error(
            `selected: layer ${layer.id} has kind ${layer.kind}, which does not support pre-highlight ` +
                `(supported: circles, rects, polygons, segments, polyline)`,
        )
    }
    const n = layerNElements(layer)
    if (index < 0 || index >= n) {
        throw new Error(
            `selected: layer ${layer.id} index ${index} out of range for ${n} elements` +
                (n > 0 ? ` (valid: 0:${n - 1})` : ""),
        )
    }
    const g = layer.geometry
    if (layer.kind === "circles" && Array.isArray(g)) {
        const a = g as number[]
        return { index, geom_: ["circle", a[3 * index], a[3 * index + 1], a[3 * index + 2]] }
    }
    if (layer.kind === "rects" && Array.isArray(g)) {
        const a = g as number[]
        return { index, geom_: ["rect", a[4 * index], a[4 * index + 1], a[4 * index + 2], a[4 * index + 3]] }
    }
    if (layer.kind === "segments" && Array.isArray(g)) {
        const a = g as number[]
        return { index, geom_: ["seg", a[4 * index], a[4 * index + 1], a[4 * index + 2], a[4 * index + 3]] }
    }
    if (layer.kind === "polyline" && Array.isArray(g)) {
        const a = g as number[]
        return { index, geom_: ["seg", a[2 * index], a[2 * index + 1], a[2 * index + 2], a[2 * index + 3]] }
    }
    // polygons (only remaining closed SELECTED_KINDS entry)
    return { index, geom_: ["poly", (g as number[][])[index]] }
}

// A :polyline's flat [x,y,…] vertex array uses NaN as Julia's gap sentinel (interactables.jl's
// `_q`) — geometry.ts's hitLayer already skips a segment with either endpoint NaN for mouse
// hover/click (`Number.isNaN(x0) || Number.isNaN(x1)`, checked on x only since a real gap
// always carries through both coordinates of the same vertex). Shared by keyboard.ts's
// buildFocusable and hitsForLayer below, so neither draws/announces/highlights a segment the
// mouse can never reach.
export function isGapSegment(layer: HitLayer, k: number): boolean {
    const a = layer.geometry as number[]
    return Number.isNaN(a[2 * k]) || Number.isNaN(a[2 * k + 2])
}

// Every element of a layer as a Hit, for the "highlight the whole target layer" case (a legend
// entry's `links`) — same building blocks (layerNElements + hitLayerByIndex) mount.ts uses for
// `selected=`. A :polyline's NaN-gap segments are skipped, same as buildFocusable.
export function hitsForLayer(layer: HitLayer): Hit[] {
    const n = layerNElements(layer)
    const hits: Hit[] = []
    for (let i = 0; i < n; i++) {
        if (layer.kind === "polyline" && isGapSegment(layer, i)) continue
        hits.push({ layer, ...hitLayerByIndex(layer, i) })
    }
    return hits
}

// The linked-highlight fan-out for one legend element: every element of every layer named in
// `layer.links[index]`, flattened into one Hit[] for drawLink. Julia guarantees each id exists
// and names a SELECTED_KINDS layer, so hitsForLayer never throws here; a missing id (a stale
// manifest) degrades to skipping that target rather than throwing.
export function linkedHits(manifest: Manifest, layer: HitLayer, index: number): Hit[] {
    const ids = layer.links?.[index]
    if (!ids || !ids.length) return []
    const hits: Hit[] = []
    for (const id of ids) {
        const target = manifest.layers.find((l) => l.id === id)
        if (target) hits.push(...hitsForLayer(target))
    }
    return hits
}
