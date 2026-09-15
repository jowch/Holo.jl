// Hit-test microbenchmark for docs/dev/roadmap.md's M5 spatial-acceleration gate: "build a
// spatial index only if a profile shows JS hit-test *specifically* is the bottleneck."
// Times `hitTest` over layers of the sizes the roadmap names, reports the median per-call time.
// Run: `npm run bench` (from frontend/) — see docs/dev/perf-findings.md for the recorded numbers.
import { hitTest } from "../src/geometry"
import type { HitLayer, Manifest } from "../src/types"

const CANVAS = 4000 // image px, per axis — large enough that most queries miss (worst case)
const QUERIES = 2000

function mulberry32(seed: number): () => number {
    let a = seed
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function makeLayer(kind: "circles" | "segments" | "polyline" | "rects", n: number, rng: () => number): HitLayer {
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

function median(xs: number[]): number {
    const s = xs.slice().sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function runOne(kind: "circles" | "segments" | "polyline" | "rects", n: number): { medianUs: number; meanUs: number } {
    const rng = mulberry32(1000 + n)
    const layer = makeLayer(kind, n, rng)
    const manifest: Manifest = { width: CANVAS, height: CANVAS, scaling: 1, transforms: {}, layers: [layer] }
    const points: [number, number][] = Array.from({ length: QUERIES }, () => [rng() * CANVAS, rng() * CANVAS])

    // warm up (JIT) before timing
    for (const [px, py] of points) hitTest(manifest, px, py, "hover")

    const samples: number[] = []
    for (const [px, py] of points) {
        const t0 = performance.now()
        hitTest(manifest, px, py, "hover")
        samples.push((performance.now() - t0) * 1000) // µs
    }
    const sum = samples.reduce((a, b) => a + b, 0)
    return { medianUs: median(samples), meanUs: sum / samples.length }
}

const cases: { kind: "circles" | "segments" | "polyline" | "rects"; sizes: number[] }[] = [
    { kind: "circles", sizes: [1_000, 10_000, 50_000, 200_000] },
    { kind: "segments", sizes: [1_000, 10_000] },
    { kind: "polyline", sizes: [1_000, 10_000] },
    { kind: "rects", sizes: [1_000, 10_000] },
]

console.log(`hit-test microbenchmark — canvas ${CANVAS}x${CANVAS}px, ${QUERIES} random query points/case (warm-up run discarded)\n`)
console.log("kind".padEnd(10), "N".padStart(8), "median (us/call)".padStart(20), "mean (us/call)".padStart(18))
for (const { kind, sizes } of cases) {
    for (const n of sizes) {
        const { medianUs, meanUs } = runOne(kind, n)
        console.log(kind.padEnd(10), String(n).padStart(8), medianUs.toFixed(2).padStart(20), meanUs.toFixed(2).padStart(18))
    }
}
