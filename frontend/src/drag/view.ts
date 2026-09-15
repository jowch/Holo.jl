import { panLimits, orbitAngles } from "../geometry"
import { fmt, VIEW_MIN_PX } from "../state"
import type { Drag } from "../state"
import type { AxisTransform, ViewGeometry } from "../types"

export { VIEW_MIN_PX }

export function begin(id: string, g: ViewGeometry, t: AxisTransform, x0: number, y0: number, pointerId: number): Drag {
    return { kind: "view", id, g, t, x0, y0, pointerId }
}

export function tip(d: Extract<Drag, { kind: "view" }>, p: { x: number; y: number }): string {
    if (d.g.mode === "orbit") {
        const o = orbitAngles(d.g, d.x0, d.y0, p.x, p.y)
        return `az=${fmt(o.azimuth)} el=${fmt(o.elevation)}`
    }
    const lim = panLimits(d.t, d.x0, d.y0, p.x, p.y)
    return `x:[${fmt(lim.xmin)}, ${fmt(lim.xmax)}] y:[${fmt(lim.ymin)}, ${fmt(lim.ymax)}]`
}

// :view micro-drags (below VIEW_MIN_PX) intentionally skip commit — don't swallow the
// synthesized click that follows, so co-mounted click layers still fire.
export function end(d: Extract<Drag, { kind: "view" }>, p: { x: number; y: number }): { layer: string; index: number; payload: unknown } | undefined {
    const dist = Math.hypot(p.x - d.x0, p.y - d.y0)
    if (dist < VIEW_MIN_PX) return undefined
    const payload = d.g.mode === "orbit" ? orbitAngles(d.g, d.x0, d.y0, p.x, p.y) : panLimits(d.t, d.x0, d.y0, p.x, p.y)
    return { layer: d.id, index: 0, payload }
}
