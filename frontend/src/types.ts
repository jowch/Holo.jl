// Mirrors the Julia structs in src/interactables.jl / src/backend.jl; keep in sync.
export type Kind =
    | "circles"   // geometry: [cx,cy,r, …]
    | "polyline"  // geometry: [x,y, …]  (NaN = gap); segment i = (v[i], v[i+1])
    | "segments"  // geometry: [x0,y0,x1,y1, …]  disjoint pairs
    | "rects"     // geometry: [cx,cy,w,h, …]
    | "grid"      // geometry: GridGeometry  (compact; edges not N rects)
    | "polygons"  // geometry: number[][]  rings, even-odd fill rule
    | "axis"      // geometry: null  — continuous, rides the axis transform
    | "threshold" // geometry: ThresholdGeometry — a draggable h/v line; value computed via AxisTransform on drag
    | "roi"       // geometry: ROIGeometry — a draggable+resizable rect; bounds computed via AxisTransform
    | "view"      // geometry: ViewGeometry — drag-to-pan (2D) / drag-to-orbit (Axis3); commit on mouse-up

export interface GridGeometry {
    xedges: number[]
    yedges: number[]
    ncols: number
    nrows: number
    values?: number[] // row-major: values[j*ncols + i]; absent when dropped for sub-pixel cells (Julia GRID_VALUES_MIN_SCREEN_PX)
}

export interface ThresholdGeometry {
    orientation: "h" | "v"
    pos: number            // image-px coordinate of the line (y if "h", x if "v")
    span: [number, number] // image-px extent along the axis viewport
}

export interface ROIGeometry {
    x: number      // image-px rect, top-left origin
    y: number
    w: number
    h: number
    handle: number // corner-handle half-size, image px
}

export interface ViewGeometry {
    x: number      // axis viewport bbox, image px
    y: number
    w: number
    h: number
    mode: "pan" | "orbit"
    azimuth?: number    // radians; orbit only (current Axis3 camera)
    elevation?: number  // radians; orbit only
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
    valueaxis?: "x" | "y" | null // 1-D colorbar readout: which axis carries the value; absent/null = 2-D {x,y}
    is3d?: boolean // lims are degenerate; Julia validate() rejects inversion consumers on is3d, so invertAxis is never reached with one
    ispolar?: boolean // continuous θ/r inversion not yet shipped to JS; Julia validate() rejects inversion consumers the same way as is3d
}

export interface LayerStyle {
    stroke: string
    width: number
}

export type TemplateSegment = string | { f: string; spec?: string }

export interface HitLayer {
    id: string
    kind: Kind
    geometry: number[] | number[][] | GridGeometry | ThresholdGeometry | ROIGeometry | ViewGeometry | null
    payloads: unknown[]
    axis: string
    events: string[] // "click" | "hover" | "drag"
    style?: LayerStyle
    tol?: number // :segments/:polyline hit-test slack, image px; absent → geometry.ts's SEG_TOL fallback
    template?: TemplateSegment[] // masque"..." parsed once per layer; $() fields fill from payloads[]
    tooltip?: false              // explicit suppress; absent + no template → auto name/value table
    selected?: number[] // element indices to draw pre-highlighted on mount
    selects?: string   // id of the target layer this ROI selects; absent → bounds-ROI (no multi-select)
    // Per-element linked highlight (e.g. a Legend entry): ids of OTHER layers this element
    // highlights with the selected recipe on hover/focus; [] or absent-per-element = no link.
    // Julia guarantees every referenced id exists and has a kind in SELECTED_KINDS.
    links?: string[][]
    label?: string     // screen-reader announcement prefix, e.g. "Scatter, element 3 of 10: …"; absent → no prefix
    // Per-element tooltip accent colour: one CSS colour string (uniform across the layer), or a
    // shared palette + one 0-based palette index per element (colormapped/categorical data).
    // Absent → no accent (unresolvable or not attempted for this plot kind).
    colors?: string | { palette: string[]; index: number[] }
    // Bond value shape: selects-ROI mouse-up ships { items: [...] }; single-click / bounds-ROI
    // ships { layer, index, payload } directly.
}

export interface Manifest {
    width: number
    height: number
    scaling: number
    layers: HitLayer[]
    transforms: Record<string, AxisTransform>
    tipStyle?: Record<string, string> // figure-level --masque-tip-* custom properties
    background?: string // the figure's background colour (CSS string) — drives the tooltip's light/dark theme
}

// `layer`/`index` are excluded from the trailing-underscore mangle convention (see
// frontend-delivery.md): they're read back out into the `@bind` payload's `layer`/`index`
// keys throughout bond.ts/drag/*.ts, and keeping the names identical there makes that
// pass-through visible at the call site. `geom_`/`grid_`/`axis_`/`roiPart_` never leave the
// frontend, so esbuild's `mangleProps: /_$/` shortens them in the bundle.
export interface Hit {
    layer: HitLayer
    index: number // -1 for axis (continuous)
    geom_?: unknown[] // shape descriptor for highlight drawing
    grid_?: [number, number, number?] // [i, j, value]; value absent when values[] was dropped
    axis_?: string // transform id, for continuous inversion
    roiPart_?: { corner?: number; edge?: "n" | "s" | "w" | "e"; move?: boolean } // which sub-part of an :roi a drag grabbed
}

// One entry in keyboard.ts's flat, manifest-order nav list — element-indexed kinds only
// (circles/rects/polygons/segments/polyline; grid/axis/threshold/roi/view excluded, see
// keyboard.ts's FOCUSABLE_KINDS for why). A polyline's NaN-gap "segments" (Julia's gap
// sentinel — see geometry.ts's hitLayer, which the mouse path already skips) never get a
// FocusRef at all. `index_` is the raw hitLayerByIndex/geometry index (used to resolve the
// Hit); `ordinal_`/`layerTotal_` are the 1-based position/count among this layer's FOCUSABLE
// elements only, announced to the user ("element `ordinal_` of `layerTotal_`") — not the same
// as `index_`/layerNElements(layer) once a layer has any skipped gaps. FocusRef never crosses
// the Julia/DOM boundary, so every field takes the trailing-underscore mangle suffix.
export interface FocusRef {
    layer_: HitLayer
    index_: number
    ordinal_: number
    layerTotal_: number
}
