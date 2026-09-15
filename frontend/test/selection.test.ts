import { describe, it, expect } from "vitest"
import { layerNElements } from "../src/selection"
import type { HitLayer } from "../src/types"

// layerNElements' other kind branches (circles/rects/polygons/segments/polyline) are exercised
// indirectly via overlay.test.ts's `selected=` pre-highlight cases (through hitLayerByIndex,
// which gates on SELECTED_KINDS before calling in). :grid is not in SELECTED_KINDS — that path
// never reaches this branch — so it needs a direct call to cover.
describe("layerNElements", () => {
    it("computes a grid layer's element count as ncols * nrows", () => {
        const layer: HitLayer = {
            id: "hm", kind: "grid", axis: "ax1", events: ["hover"], payloads: [],
            geometry: { xedges: [0, 1, 2], yedges: [0, 1, 2, 3], ncols: 2, nrows: 3 },
        }
        expect(layerNElements(layer)).toBe(6)
    })
})
