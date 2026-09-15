import { panLimits, orbitAngles } from "../geometry"
import { fmt, VIEW_MIN_PX } from "../state"
import type { Drag } from "../state"
import type { AxisTransform, ViewGeometry } from "../types"

export { VIEW_MIN_PX }

export function begin(id: string, g: ViewGeometry, t: AxisTransform, x0: number, y0: number, pointerId: number): Drag {
    return { kind: "view", id_: id, g_: g, t_: t, x0_: x0, y0_: y0, pointerId_: pointerId }
}

export function tip(d: Extract<Drag, { kind: "view" }>, p: { x: number; y: number }): string {
    if (d.g_.mode === "orbit") {
        const o = orbitAngles(d.g_, d.x0_, d.y0_, p.x, p.y)
        return `az=${fmt(o.azimuth)} el=${fmt(o.elevation)}`
    }
    const lim = panLimits(d.t_, d.x0_, d.y0_, p.x, p.y)
    return `x:[${fmt(lim.xmin)}, ${fmt(lim.xmax)}] y:[${fmt(lim.ymin)}, ${fmt(lim.ymax)}]`
}

// :view micro-drags (below VIEW_MIN_PX) intentionally skip commit — don't swallow the
// synthesized click that follows, so co-mounted click layers still fire.
export function end(d: Extract<Drag, { kind: "view" }>, p: { x: number; y: number }): { layer: string; index: number; payload: unknown } | undefined {
    const dist = Math.hypot(p.x - d.x0_, p.y - d.y0_)
    if (dist < VIEW_MIN_PX) return undefined
    const payload = d.g_.mode === "orbit" ? orbitAngles(d.g_, d.x0_, d.y0_, p.x, p.y) : panLimits(d.t_, d.x0_, d.y0_, p.x, p.y)
    return { layer: d.id_, index: 0, payload }
}
