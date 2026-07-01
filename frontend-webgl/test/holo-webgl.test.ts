import { describe, it, expect } from "vitest"
import { rewrap, obs, makeBonitoShim } from "../src/holo-webgl"

// rewrap is the JS half of the 4-rule scene contract — it must decode exactly what `_plain`
// in src/HoloWGL.jl emits. These lock that cross-language contract (previously untested; the
// version-coupling guard covers the WGLMakie seam, not this).
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
})
