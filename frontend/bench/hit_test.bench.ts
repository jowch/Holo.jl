// Hit-test microbenchmark for docs/dev/roadmap.md's spatial-acceleration gate: "build a
// spatial index only if a profile shows JS hit-test *specifically* is the bottleneck."
// Times `hitTest` over layers of the sizes the roadmap names, reports median per-call time.
// Run: `npm run bench` (from frontend/) — see docs/dev/perf-findings.md for the recorded numbers.
//
// Reports two numbers per case, because they diverge for circles/rects (early-return on a hit):
//   - "mixed": QUERIES random points over the same canvas the elements are scattered in — this
//     is what a plausible hover trace looks like, but its hit rate rises with density (a 4000²
//     canvas at 200k circles is ~97% hits), so at high N it mostly measures the early-return
//     path, not a scan.
//   - "miss": one query point guaranteed to miss every element (circles/rects never early-return;
//     segments/polyline never early-return regardless). This is the O(n) worst case — the
//     realistic case for hovering empty space on a sparse plot — and the number the roadmap's
//     "hit-test is cheap even at high N" claim should be measured against.
import { hitTest } from "../src/geometry"
import type { HitLayer, Manifest } from "../src/types"

const CANVAS = 4000 // image px, per axis
const QUERIES = 2000
const OFF_CANVAS: [number, number] = [-1e6, -1e6] // outside every element's geometry, every kind

function mulberry32(seed: number): () => number {
    let a = seed
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

type ElementKind = "circles" | "segments" | "polyline" | "rects"

function makeLayer(kind: ElementKind, n: number, rng: () => number): HitLayer {
    const geometry: number[] = []
    if (kind === "circles") {
        for (let k = 0; k < n; k++) geometry.push(rng() * CANVAS, rng() * CANVAS, 3 + rng() * 5)
    } else if (kind === "rects") {
        for (let k = 0; k < n; k++) geometry.push(rng() * CANVAS, rng() * CANVAS, 4 + rng() * 10, 4 + rng() * 10)
    } else if (kind === "segments") {
        for (let k = 0; k < n; k++) {
            const x0 = rng() * CANVAS, y0 = rng() * CANVAS
            geometry.push(x0, y0, x0 + (rng() - 0.5) * 40, y0 + (rng() - 0.5) * 40)
        }
    } else {
        // one connected polyline of n vertices (n-1 segments) — no NaN gaps
        let x = rng() * CANVAS, y = rng() * CANVAS
        geometry.push(x, y)
        for (let k = 1; k < n; k++) {
            x += (rng() - 0.5) * 20; y += (rng() - 0.5) * 20
            geometry.push(x, y)
        }
    }
    return { id: "bench", kind, geometry, payloads: [], axis: "ax1", events: ["hover"] }
}

// A grid of m x m cells spanning the canvas — m=1000 mirrors the 1000x1000-heatmap case
// perf-findings.md's payload discussion names as reachable today.
function makeGridLayer(m: number): HitLayer {
    const xedges = Array.from({ length: m + 1 }, (_, k) => Math.round((k / m) * CANVAS))
    const yedges = Array.from({ length: m + 1 }, (_, k) => Math.round((k / m) * CANVAS))
    return { id: "bench-grid", kind: "grid", geometry: { xedges, yedges, ncols: m, nrows: m }, payloads: [], axis: "ax1", events: ["hover"] }
}

function median(xs: number[]): number {
    const s = xs.slice().sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function timeQueries(manifest: Manifest, points: [number, number][]): { medianUs: number; meanUs: number; hits: number } {
    for (const [px, py] of points) hitTest(manifest, px, py, "hover") // warm up (JIT)
    const samples: number[] = []
    let hits = 0
    for (const [px, py] of points) {
        const t0 = performance.now()
        const h = hitTest(manifest, px, py, "hover")
        samples.push((performance.now() - t0) * 1000) // µs
        if (h) hits++
    }
    const sum = samples.reduce((a, b) => a + b, 0)
    return { medianUs: median(samples), meanUs: sum / samples.length, hits }
}

function runElementCase(kind: ElementKind, n: number) {
    const rng = mulberry32(1000 + n)
    const layer = makeLayer(kind, n, rng)
    const manifest: Manifest = { width: CANVAS, height: CANVAS, scaling: 1, transforms: {}, layers: [layer] }
    const mixedPoints: [number, number][] = Array.from({ length: QUERIES }, () => [rng() * CANVAS, rng() * CANVAS])
    const mixed = timeQueries(manifest, mixedPoints)
    const missPoints: [number, number][] = Array.from({ length: QUERIES }, () => OFF_CANVAS)
    const miss = timeQueries(manifest, missPoints)
    return { kind, n, hitRatePct: (mixed.hits / QUERIES) * 100, mixedMedianUs: mixed.medianUs, missMedianUs: miss.medianUs }
}

function runGridCase(m: number) {
    const layer = makeGridLayer(m)
    const manifest: Manifest = { width: CANVAS, height: CANVAS, scaling: 1, transforms: {}, layers: [layer] }
    const rng = mulberry32(2000 + m)
    const mixedPoints: [number, number][] = Array.from({ length: QUERIES }, () => [rng() * CANVAS, rng() * CANVAS])
    const mixed = timeQueries(manifest, mixedPoints) // every in-canvas point hits some cell
    const missPoints: [number, number][] = Array.from({ length: QUERIES }, () => OFF_CANVAS)
    const miss = timeQueries(manifest, missPoints)
    return { kind: "grid" as const, n: (m + 1) * 2, hitRatePct: (mixed.hits / QUERIES) * 100, mixedMedianUs: mixed.medianUs, missMedianUs: miss.medianUs }
}

const elementCases: { kind: ElementKind; sizes: number[] }[] = [
    { kind: "circles", sizes: [1_000, 10_000, 50_000, 200_000] },
    { kind: "segments", sizes: [1_000, 10_000] },
    { kind: "polyline", sizes: [1_000, 10_000] },
    { kind: "rects", sizes: [1_000, 10_000] },
]
const gridSizes = [100, 1_000] // cells/axis; findBin does one binary search per axis per hover

console.log(`hit-test microbenchmark — canvas ${CANVAS}x${CANVAS}px, ${QUERIES} query points/case (warm-up run discarded)\n`)
console.log(
    "kind".padEnd(10), "N".padStart(8), "mixed hit%".padStart(11),
    "mixed median (us)".padStart(20), "miss median (us)".padStart(19),
)
for (const { kind, sizes } of elementCases) {
    for (const n of sizes) {
        const r = runElementCase(kind, n)
        console.log(
            r.kind.padEnd(10), String(r.n).padStart(8), r.hitRatePct.toFixed(1).padStart(11),
            r.mixedMedianUs.toFixed(2).padStart(20), r.missMedianUs.toFixed(2).padStart(19),
        )
    }
}
for (const m of gridSizes) {
    const r = runGridCase(m)
    console.log(
        `${r.kind} (${m}x${m} edges=${r.n})`.padEnd(10), "".padStart(8), r.hitRatePct.toFixed(1).padStart(11),
        r.mixedMedianUs.toFixed(2).padStart(20), r.missMedianUs.toFixed(2).padStart(19),
    )
}
