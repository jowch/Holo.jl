// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { rewrap, obs, makeBonitoShim, mountWebGL } from "../src/wgl-shim"

// rewrap is the JS half of the 4-rule scene contract — it must decode exactly what `_plain`
// in ext/MasqueWGLMakieExt.jl emits. These lock that cross-language contract (previously
// untested; the version-coupling guard covers the WGLMakie seam, not this).
describe("rewrap — the _plain 4-rule decode", () => {
    it("scalars and strings pass through", () => {
        expect(rewrap(5)).toBe(5)
        expect(rewrap("delta")).toBe("delta")
        expect(rewrap(true)).toBe(true)
        expect(rewrap(null)).toBe(null)
    })

    it("{__t__,d} → the matching TypedArray (each tag _plain emits)", () => {
        const f = rewrap({ __t__: "f32", d: [1, 2, 3] })
        expect(f).toBeInstanceOf(Float32Array)
        expect(Array.from(f)).toEqual([1, 2, 3])
        expect(rewrap({ __t__: "i32", d: [-1, 2] })).toBeInstanceOf(Int32Array)
        expect(rewrap({ __t__: "u32", d: [1, 2] })).toBeInstanceOf(Uint32Array)
        expect(rewrap({ __t__: "u8", d: [255, 0] })).toBeInstanceOf(Uint8Array)
    })

    it("{array,size} recurses: inner array becomes a TypedArray, size stays plain", () => {
        const r = rewrap({ array: { __t__: "f32", d: [1, 2, 3, 4] }, size: [2, 2] })
        expect(r.array).toBeInstanceOf(Float32Array)
        expect(Array.from(r.array)).toEqual([1, 2, 3, 4])
        expect(r.size).toEqual([2, 2]) // plain number array (Int64 size vec — not a __t__ tag)
    })

    it("{__obs__} → an observable shim holding the (recursively rewrapped) value", () => {
        const o = rewrap({ __obs__: { __t__: "f32", d: [7, 8] } })
        expect(o.value).toBeInstanceOf(Float32Array)
        expect(Array.from(o.value)).toEqual([7, 8])
        expect(typeof o.on).toBe("function")
        expect(typeof o.notify).toBe("function")
    })

    it("plain dicts recurse; arrays map element-wise (mixed tags)", () => {
        const r = rewrap({ a: { __t__: "u8", d: [1] }, b: "x", c: [{ __t__: "f32", d: [2] }, 3] })
        expect(r.a).toBeInstanceOf(Uint8Array)
        expect(r.b).toBe("x")
        expect(r.c[0]).toBeInstanceOf(Float32Array)
        expect(r.c[1]).toBe(3)
    })
})

describe("obs — the observable shim", () => {
    it("holds the initial value", () => {
        expect(obs(42).value).toBe(42)
    })
    it("notify(v) updates value and fires every callback", () => {
        const o = obs(0)
        const seen: number[] = []
        o.on((v) => seen.push(v as number))
        o.on((v) => seen.push((v as number) * 10))
        o.notify(5)
        expect(o.value).toBe(5)
        expect(seen).toEqual([5, 50])
    })
    it("notify() with no arg keeps value but still fires", () => {
        const o = obs("a")
        let fired = false
        o.on(() => { fired = true })
        o.notify()
        expect(o.value).toBe("a")
        expect(fired).toBe(true)
    })
})

describe("makeBonitoShim — the no-server Bonito stand-in", () => {
    it("can_send_to_julia is true (WGLMakie gates observable updates on it)", () => {
        expect(makeBonitoShim().can_send_to_julia()).toBe(true)
    })
    it("throttle_function is identity", () => {
        const f = () => 1
        expect(makeBonitoShim().throttle_function(f)).toBe(f)
    })
    it("lock_loading runs f immediately, and tolerates no f", () => {
        let ran = false
        makeBonitoShim().lock_loading(() => { ran = true })
        expect(ran).toBe(true)
        expect(() => makeBonitoShim().lock_loading()).not.toThrow()
    })
    it("ConnStub: send/notify/on are no-ops, on returns an unsubscribe fn, _ConnStub is constructible", () => {
        const B = makeBonitoShim()
        const c = new B._ConnStub()
        expect(() => { c.send(); c.notify() }).not.toThrow()
        expect(typeof c.on()).toBe("function")
        expect(c).toBeInstanceOf(B.Connection)
    })
    it("Connection.send_error logs to console.error with the error's stack when present", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})
        const B = makeBonitoShim()
        const err = new Error("boom")
        B.Connection.send_error("context msg", err)
        expect(spy).toHaveBeenCalledWith("[masque-wgl]", "context msg", err.stack)
        spy.mockRestore()
    })
    it("Connection.send_error falls back to the raw value when it has no stack", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})
        const B = makeBonitoShim()
        B.Connection.send_error("context msg", "plain string error")
        expect(spy).toHaveBeenCalledWith("[masque-wgl]", "context msg", "plain string error")
        spy.mockRestore()
    })
    it("Connection.send_warning exists, is callable, and logs at warn level without throwing", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
        const B = makeBonitoShim()
        expect(typeof B.Connection.send_warning).toBe("function")
        // real call shape from WGLMakie's on_shader_error: a single formatted string, no error object
        expect(() => B.Connection.send_warning("THREE.WebGLProgram: Shader Error")).not.toThrow()
        expect(spy).toHaveBeenCalledWith("[masque-wgl]", "THREE.WebGLProgram: Shader Error")
        spy.mockRestore()
    })
})

describe("mountWebGL", () => {
    // `import(/* @vite-ignore */ url)` in mountWebGL bypasses vite's module graph and hits
    // Node's native ESM loader directly, which only accepts file:/data: schemes — a vite-node
    // http: URL (e.g. from import.meta.url under the dev server) is rejected. A data: URL with
    // the fixture source inlined sidesteps module resolution entirely.
    // Not `new URL(relative, import.meta.url)`: this file runs under `@vitest-environment
    // happy-dom`, which shadows the global `URL` with its own polyfill — one that resolves a
    // relative path against a `file:` base as if the base were `http://localhost:3000`
    // (verified: `new URL("./x", "file:///…")` here yields `http://localhost:3000/x`).
    // `fileURLToPath` on the plain `import.meta.url` string sidesteps that constructor entirely.
    const fixtureSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-wgl-bundle.mjs"), "utf8")
    const bundleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(fixtureSrc)}`

    afterEach(() => {
        delete (window as unknown as { Bonito?: unknown }).Bonito
    })

    it("imports the bundle, installs window.Bonito, and forwards args to setup_scene_init", async () => {
        const canvas = document.createElement("canvas")
        const wrapper = document.createElement("div")
        wrapper.appendChild(canvas)
        const scene = { __obs__: { __t__: "f32", d: [1, 2] } }
        const result = await mountWebGL({ canvas, wglBundleUrl: bundleUrl, scene, width: 640, height: 480, pxPerUnit: 3 })

        expect((window as unknown as { Bonito?: { can_send_to_julia?: () => boolean } }).Bonito).toBeTruthy()
        expect((window as unknown as { Bonito: { can_send_to_julia: () => boolean } }).Bonito.can_send_to_julia()).toBe(true)

        const [passedWrapper, passedCanvas, w, h, resizeTo, ppu, one, realSize, canvasWidth, sceneObs] = result.WGL.lastCall
        expect(passedWrapper).toBe(wrapper)
        expect(passedCanvas).toBe(canvas)
        expect(w).toBe(640)
        expect(h).toBe(480)
        expect(resizeTo).toBeNull()
        expect(ppu).toBe(3)
        expect(one).toBe(1)
        expect(realSize.value).toEqual([640, 480])
        expect(canvasWidth.value).toEqual([640, 480])
        // sceneObs is mountWebGL's own obs() wrapper around the already-rewrapped scene, so its
        // .value is the inner Obs (from the {__obs__} tag), whose own .value is the TypedArray.
        expect(sceneObs.value.value).toBeInstanceOf(Float32Array)
        expect(Array.from(sceneObs.value.value as Float32Array)).toEqual([1, 2])

        // returned scene is the same rewrapped object passed through
        expect(result.scene.value).toBeInstanceOf(Float32Array)
    })

    it("defaults pxPerUnit to 2 when omitted", async () => {
        const canvas = document.createElement("canvas")
        document.createElement("div").appendChild(canvas)
        const result = await mountWebGL({ canvas, wglBundleUrl: bundleUrl, scene: {}, width: 100, height: 50 })
        expect(result.WGL.lastCall[5]).toBe(2)
    })

    it("sizes the canvas to fill its container via CSS after WGL's own sizing", async () => {
        const canvas = document.createElement("canvas")
        document.createElement("div").appendChild(canvas)
        await mountWebGL({ canvas, wglBundleUrl: bundleUrl, scene: {}, width: 100, height: 50 })
        expect(canvas.style.width).toBe("100%")
        expect(canvas.style.height).toBe("auto")
    })
})
