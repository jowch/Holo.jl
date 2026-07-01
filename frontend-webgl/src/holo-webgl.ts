// HoloWGL :webgl bootstrap — renders a serialize_scene payload with NO Bonito runtime and
// NO server. Imports WGLMakie's own bundle (version-matched, three.js inlined) and feeds it
// through a tiny shim. Validated by the spikes (full 2D+3D fidelity, animation hook).
//
// Usage (from the Holo widget HTML, mount===:webgl):
//   import { mountWebGL } from "./holo-webgl.js";
//   mountWebGL({ canvas, wglBundleUrl, scene: published, width, height, pxPerUnit });
//
// `scene` is the published_to_js payload from HoloWGLMakieExt.scene_payload (the 4-rule
// encoding); `rewrap` is the JS half of that contract — it mirrors `_plain` in
// ext/HoloWGLMakieExt.jl, so the two must stay in sync (the unit tests lock it).

// functional observable shim: stores callbacks, notify() runs them -> the animation hook
export interface Obs<T = unknown> {
    value: T
    on(f: (v: T) => void): () => void
    notify(nv?: T): void
}

export function obs<T>(v: T): Obs<T> {
    const cbs: ((v: T) => void)[] = []
    return {
        value: v,
        on(f) { cbs.push(f); return () => {} },
        notify(nv?: T) { if (nv !== undefined) this.value = nv; cbs.forEach((f) => f(this.value)) },
    }
}

// --- the ENTIRE -bonito shim --------------------------------------------------
export function makeBonitoShim() {
    // notify() is the comm pushing a value TO Julia; we have no server, so swallow it (same
    // reason send() is a no-op). Without it WGLMakie throws "comm.notify is not a function".
    class ConnStub {
        send() {}
        notify() {}
        on() { return () => {} }
        static send_error = (msg: string, e: unknown) =>
            console.error("[holo-wgl]", msg, (e && (e as Error).stack) || e)
    }
    return {
        // MUST be true: WGLMakie gates observable updates on this. comm.send is a no-op, so
        // client-side updates (camera/uniform animation) fire without any server (spike finding).
        can_send_to_julia: () => true,
        throttle_function: (f: unknown) => f,
        // Real Bonito enqueues f on a concurrency-1 lock (serializes object-freeing across
        // sessions). We have no sessions/server, so run it immediately — same effect, no queue.
        lock_loading: (f?: () => void) => { if (f) f() },
        Connection: ConnStub,
        _ConnStub: ConnStub,
    }
}

const TA = { f32: Float32Array, i32: Int32Array, u32: Uint32Array, u8: Uint8Array } as const
type TKey = keyof typeof TA

// rebuild the structures WGLMakie's deserialize expects from the 4-rule tags
export function rewrap(x: any): any {
    if (x && typeof x === "object" && !Array.isArray(x)) {
        if ("__obs__" in x) return obs(rewrap(x.__obs__))    // Observable shim
        if ("__t__" in x) return new TA[x.__t__ as TKey](x.d) // 1-D TypedArray
        const o: Record<string, unknown> = {}
        for (const k in x) o[k] = rewrap(x[k])               // {array,size} recurse; nested dicts
        return o
    }
    if (Array.isArray(x)) return x.map(rewrap)
    return x
}

export interface MountArgs {
    canvas: HTMLCanvasElement
    wglBundleUrl: string
    scene: unknown
    width: number
    height: number
    pxPerUnit?: number
}

export async function mountWebGL({ canvas, wglBundleUrl, scene, width, height, pxPerUnit = 2 }: MountArgs) {
    const WGL = await import(/* @vite-ignore */ wglBundleUrl)
    ;(window as any).Bonito = makeBonitoShim()    // WGLMakie reads window.Bonito globals
    const wrapper = canvas.parentElement
    const sceneObj = rewrap(scene)
    WGL.setup_scene_init(
        wrapper, canvas,
        width, height,
        null,                  // resize_to (fixed size -> overlay alignment holds)
        pxPerUnit, 1,
        obs([width, height]),  // real_size
        obs([width, height]),  // canvas_width
        obs(sceneObj),         // scene_serialized (.value set -> immediate init)
        new ((window as any).Bonito._ConnStub)(),
        30,                    // framerate
        obs(false),            // done_init
    )
    // Return WGL so an animation driver can do BOTH tiers without re-importing:
    //  - uniforms/camera: find the live observable in `scene` and .notify(v)
    //  - data (positions): WGL.find_plots([uuid])[0].geometry.attributes.wgl_positions
    //      .array.set(frame); attr.needsUpdate = true;   (smooth, no Julia round-trip)
    return { scene: sceneObj, WGL }
}
