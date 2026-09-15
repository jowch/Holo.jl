import { invertAxis } from "../geometry"
import { computeSelection } from "../selection"
import { SVG_NS, DEFAULT_STYLE, drawSelection } from "../highlight"
import { clampX, clampY, fmt } from "../state"
import type { Drag, OverlayState, ROIBox } from "../state"
import type { HitLayer, Manifest, ROIGeometry } from "../types"

// --- draggable + resizable ROI boxes (Tier 0) ---
export function setROI(box: ROIBox): void {
    const { x, y, w, h } = box.g_
    box.rect_.setAttribute("x", String(x)); box.rect_.setAttribute("y", String(y))
    box.rect_.setAttribute("width", String(w)); box.rect_.setAttribute("height", String(h))
    const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    for (let k = 0; k < 4; k++) {
        box.handles_[k].setAttribute("x", String(corners[k][0] - box.handle_))
        box.handles_[k].setAttribute("y", String(corners[k][1] - box.handle_))
        box.handles_[k].setAttribute("width", String(2 * box.handle_))
        box.handles_[k].setAttribute("height", String(2 * box.handle_))
    }
}

export function roiBounds(box: ROIBox): { xmin: number; xmax: number; ymin: number; ymax: number } {
    const a = invertAxis(box.t_, box.g_.x, box.g_.y), b = invertAxis(box.t_, box.g_.x + box.g_.w, box.g_.y + box.g_.h)
    const ax = a.x as number, bx = b.x as number, ay = a.y as number, by = b.y as number
    return { xmin: Math.min(ax, bx), xmax: Math.max(ax, bx), ymin: Math.min(ay, by), ymax: Math.max(ay, by) }
}

export function buildROIBoxes(manifest: Manifest, svg: SVGSVGElement): Map<string, ROIBox> {
    const roiBoxes = new Map<string, ROIBox>()
    for (const layer of manifest.layers) {
        if (layer.kind !== "roi") continue
        const rg = layer.geometry as ROIGeometry
        const st = layer.style ?? DEFAULT_STYLE
        const rect = document.createElementNS(SVG_NS, "rect")
        rect.setAttribute("fill", "none"); rect.setAttribute("stroke", st.stroke)
        rect.setAttribute("stroke-width", String(st.width)); rect.setAttribute("vector-effect", "non-scaling-stroke")
        svg.appendChild(rect)
        const handles: SVGRectElement[] = []
        for (let k = 0; k < 4; k++) {
            const hdl = document.createElementNS(SVG_NS, "rect")
            hdl.setAttribute("fill", st.stroke)
            svg.appendChild(hdl); handles.push(hdl)
        }
        // box.g_ aliases the manifest ROIGeometry so drag mutations stay visible to hitLayer,
        // which reads layer.geometry directly. `target_` is resolved once here, not per mousedown;
        // undefined when this ROI has no `selects` (bounds-only).
        const target = layer.selects ? (manifest.layers.find((l) => l.id === layer.selects) as HitLayer | undefined) : undefined
        const box: ROIBox = { rect_: rect, handles_: handles, g_: rg, handle_: rg.handle, t_: manifest.transforms[layer.axis], target_: target }
        setROI(box)
        roiBoxes.set(layer.id, box)
    }
    return roiBoxes
}

export function begin(id: string, box: ROIBox, mode: { corner: number } | { move: true }, ax: number, ay: number, pointerId: number): Drag {
    return { kind: "roi", id_: id, box_: box, mode_: mode, ax_: ax, ay_: ay, target_: box.target_, pointerId_: pointerId }
}

export function move(d: Extract<Drag, { kind: "roi" }>, state: OverlayState, selGroup: SVGGElement, manifest: Manifest, p: { x: number; y: number }): string {
    const box = d.box_, [vx, vy, vw, vh] = box.t_.viewport
    if ("move" in d.mode_) {
        box.g_.x = Math.max(vx, Math.min(vx + vw - box.g_.w, p.x - d.ax_))
        box.g_.y = Math.max(vy, Math.min(vy + vh - box.g_.h, p.y - d.ay_))
    } else {
        const cx = clampX(box.t_, p.x), cy = clampY(box.t_, p.y)
        box.g_.x = Math.min(d.ax_, cx); box.g_.y = Math.min(d.ay_, cy)
        box.g_.w = Math.abs(cx - d.ax_); box.g_.h = Math.abs(cy - d.ay_)
    }
    setROI(box)
    if (d.target_) {
        const sel = computeSelection(box.g_, d.target_, manifest.transforms[d.target_.axis])
        drawSelection(state, selGroup, sel.hits)
        return `${sel.items.length} selected`
    }
    const b = roiBounds(box)
    return `x:[${fmt(b.xmin)}, ${fmt(b.xmax)}] y:[${fmt(b.ymin)}, ${fmt(b.ymax)}]`
}

export function end(
    d: Extract<Drag, { kind: "roi" }>,
    state: OverlayState,
    selGroup: SVGGElement,
    manifest: Manifest
): { items: unknown[] } | { layer: string; index: number; payload: unknown } {
    if (d.target_) {
        const sel = computeSelection(d.box_.g_, d.target_, manifest.transforms[d.target_.axis])
        drawSelection(state, selGroup, sel.hits)
        return { items: sel.items }
    }
    return { layer: d.id_, index: 0, payload: roiBounds(d.box_) }
}
