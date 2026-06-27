// @vitest-environment happy-dom
import { describe, it, expect } from "vitest"
import { mount } from "../src/overlay"
import type { Manifest } from "../src/types"

// build a light-DOM host (img + script) like the Julia widget emits, with layout mocked
function setup() {
    const host = document.createElement("div")
    const img = document.createElement("img")
    Object.defineProperty(img, "naturalWidth", { value: 1200 })
    img.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
    const script = document.createElement("script")
    host.append(img, script)
    document.body.append(host)
    return { host, img, script }
}

const manifest: Manifest = {
    width: 1200, height: 800, scaling: 2, transforms: {},
    layers: [{ id: "pts", kind: "circles", geometry: [600, 400, 20], payloads: [{ i: 0 }], axis: "ax1", events: ["click", "hover"] }],
}

const shadowOf = (host: HTMLElement) => (host.lastElementChild as HTMLElement).shadowRoot!

describe("mount", () => {
    it("builds a shadow overlay and round-trips a click to host.value", () => {
        const { host, script } = setup()
        mount(script, manifest)
        const shadow = shadowOf(host)
        expect(shadow.querySelector("svg")).toBeTruthy()
        const surface = shadow.querySelector(".surface") as HTMLElement
        let fired = false
        host.addEventListener("input", () => { fired = true })
        // circle center image-px (600,400); display scale = 1200/600 = 2 → client (300,200)
        surface.dispatchEvent(new MouseEvent("click", { clientX: 300, clientY: 200, bubbles: true }))
        expect(fired).toBe(true)
        expect((host as unknown as { value: { layer: string; index: number } }).value).toMatchObject({ layer: "pts", index: 0 })
    })

    it("click on empty space is a no-op (no round-trip)", () => {
        const { host, script } = setup()
        mount(script, manifest)
        const surface = shadowOf(host).querySelector(".surface") as HTMLElement
        let fired = false
        host.addEventListener("input", () => { fired = true })
        surface.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true }))
        expect(fired).toBe(false)
    })

    it("removes the shadow host on invalidation", async () => {
        const { host, script } = setup()
        let resolve!: () => void
        const inval = new Promise<void>((r) => { resolve = r })
        mount(script, manifest, inval)
        expect(host.lastElementChild?.tagName).toBe("DIV") // shadow host present
        resolve()
        await inval
        await Promise.resolve()
        expect(host.lastElementChild?.tagName).toBe("SCRIPT") // shadow host gone, script remains
    })
})
