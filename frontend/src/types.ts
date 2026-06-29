// The Julia↔JS contract. Mirrors the Julia structs in src/interactables.jl / src/backend.jl.
// Keep in sync — drift here is the bug class TS exists to catch.

export type Kind =
    | "circles"   // geometry: [cx,cy,r, …]
    | "polyline"  // geometry: [x,y, …]  (NaN = gap); segment i = (v[i], v[i+1])
    | "segments"  // geometry: [x0,y0,x1,y1, …]  disjoint pairs
    | "rects"     // geometry: [cx,cy,w,h, …]
    | "grid"      // geometry: GridGeometry  (compact; edges not N rects)
    | "polygons"  // geometry: number[][]  rings, even-odd fill rule
    | "axis"      // geometry: null  — continuous, rides the axis transform
    | "threshold" // geometry: ThresholdGeometry — a draggable h/v line; value computed via AxisTransform on drag

export interface GridGeometry {
    xedges: number[]
    yedges: number[]
    ncols: number
    nrows: number
    values: number[] // row-major: values[j*ncols + i]
}

export interface ThresholdGeometry {
    orientation: "h" | "v"
    pos: number            // image-px coordinate of the line (y if "h", x if "v")
    span: [number, number] // image-px extent along the axis viewport
}

export interface AxisTransform {
    xlims: [number, number]
    ylims: [number, number]
    xscale: string // "identity" | "log10" | "log" | …
    yscale: string
    viewport: [number, number, number, number] // x,y,w,h image px, top-left origin
    xreversed: boolean
    yreversed: boolean
    xcats?: string[] | null // categorical tick labels, if any
    ycats?: string[] | null
}

export interface LayerStyle {
    stroke: string
    width: number
}

export interface HitLayer {
    id: string
    kind: Kind
    geometry: number[] | number[][] | GridGeometry | ThresholdGeometry | null
    payloads: unknown[]
    axis: string
    events: string[] // "click" | "hover"
    style?: LayerStyle
    tooltips?: (string | null)[]
    selected?: number[] // element indices to draw pre-highlighted on mount
}

export interface Manifest {
    width: number
    height: number
    scaling: number
    layers: HitLayer[]
    transforms: Record<string, AxisTransform>
}

export interface Hit {
    layer: HitLayer
    index: number // -1 for axis (continuous)
    geom?: unknown[] // shape descriptor for highlight drawing
    grid?: [number, number, number] // [i, j, value]
    axis?: string // transform id, for continuous inversion
}
