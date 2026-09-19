// @vitest-environment happy-dom
// Legend `links`: hovering/focusing a HitLayer element whose `links[index]` names other layers
// draws the selected recipe (wash/ring) for every element of those layers into a dedicated
// g.link group, distinct from g.sel (persistent `selected=`) and g.hi (the single hover ring).
import { describe, it, expect } from "vitest"
import { mount } from "../src/overlay"
import type { Manifest } from "../src/types"

function setup(manifest: Manifest) {
    const host = document.createElement("div")
    const img = document.createElement("img")
    img.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
    const script = document.createElement("script")
    host.append(img, script)
    document.body.append(host)
    mount(script, manifest)
    const shadow = (host.lastElementChild as HTMLElement).shadowRoot!
    const surface = shadow.querySelector(".surface") as HTMLElement
    return { host, surface, shadow }
}

// display scale = manifest.width(1200) / base rect width(600) = 2, throughout.
const move = (surface: HTMLElement, clientX: number, clientY: number) =>
    surface.dispatchEvent(new PointerEvent("pointermove", { clientX, clientY, bubbles: true }))

const linkGroupSize = (shadow: ShadowRoot) => shadow.querySelectorAll("g.link > *").length

describe("legend links: hover", () => {
    // legend rect 0 (links to "pts"): image [80,120]x[90,110] -> client center (50,50)
    // legend rect 1 (links: []):      image [80,120]x[130,150] -> client center (50,70)
    const manifest: Manifest = {
        width: 1200, height: 800, scaling: 2, transforms: {},
        layers: [
            {
                id: "legend", kind: "rects", axis: "ax1", events: ["click", "hover"],
                geometry: [100, 100, 40, 20, 100, 140, 40, 20],
                payloads: [{ name: "a" }, { name: "b" }],
                links: [["pts"], []],
            },
            {
                id: "pts", kind: "circles", axis: "ax1", events: ["hover"],
                geometry: [600, 400, 20, 620, 420, 20, 640, 440, 20],
                payloads: [{}, {}, {}],
            },
        ],
    }

    it("hovering a linked legend element draws the selected recipe for every element of the target layer", () => {
        const { surface, shadow } = setup(manifest)
        move(surface, 50, 50)
        expect(linkGroupSize(shadow)).toBe(3) // "pts" has 3 circles
    })

    it("hovering a non-linked legend element (links: []) draws nothing in the link group", () => {
        const { surface, shadow } = setup(manifest)
        move(surface, 50, 70)
        expect(linkGroupSize(shadow)).toBe(0)
    })

    it("moving off any element clears the link group after the fade", async () => {
        const { surface, shadow } = setup(manifest)
        move(surface, 50, 50)
        expect(linkGroupSize(shadow)).toBe(3)
        surface.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }))
        // immediately after leave: fading out (masque-leave), not yet removed
        const stillThere = shadow.querySelectorAll("g.link > *")
        expect(stillThere.length).toBe(3)
        for (const el of stillThere) expect(el.classList.contains("masque-leave")).toBe(true)
        await new Promise((r) => setTimeout(r, 150))
        expect(linkGroupSize(shadow)).toBe(0)
    })

    it("g.sel (persistent selected=) is untouched by legend hover", () => {
        const selManifest: Manifest = {
            ...manifest,
            layers: [
                manifest.layers[0],
                manifest.layers[1],
                {
                    id: "other", kind: "circles", axis: "ax1", events: ["hover"],
                    geometry: [900, 700, 15],
                    payloads: [{}],
                    selected: [0],
                },
            ],
        }
        const { surface, shadow } = setup(selManifest)
        expect(shadow.querySelector("g.sel")!.children.length).toBe(1)
        move(surface, 50, 50) // hover the linked legend entry
        expect(linkGroupSize(shadow)).toBe(3)
        expect(shadow.querySelector("g.sel")!.children.length).toBe(1) // untouched
    })
})

describe("legend links: no links field at all (ordinary layer) draws nothing", () => {
    const manifest: Manifest = {
        width: 1200, height: 800, scaling: 2, transforms: {},
        layers: [
            { id: "pts", kind: "circles", axis: "ax1", events: ["hover"], geometry: [600, 400, 20], payloads: [{}] },
        ],
    }

    it("hovering an element on a layer with no `links` property draws nothing", () => {
        const { surface, shadow } = setup(manifest)
        move(surface, 300, 200)
        expect(linkGroupSize(shadow)).toBe(0)
    })
})

describe("legend links: keyboard focus", () => {
    // legend rects layer is FOCUSABLE_KINDS-eligible (rects) — Tab/arrow nav reaches it directly.
    const manifest: Manifest = {
        width: 1200, height: 800, scaling: 2, transforms: {},
        layers: [
            {
                id: "legend", kind: "rects", axis: "ax1", events: ["click", "hover"],
                geometry: [100, 100, 40, 20],
                payloads: [{}],
                links: [["pts"]],
            },
            {
                id: "pts", kind: "circles", axis: "ax1", events: ["hover"],
                geometry: [600, 400, 20, 620, 420, 20],
                payloads: [{}, {}],
            },
        ],
    }

    const down = (surface: HTMLElement, key: string) =>
        surface.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))

    it("keyboard-focusing a linked legend element shows the same linked highlight as hover", () => {
        const { surface, shadow } = setup(manifest)
        surface.focus()
        down(surface, "ArrowRight") // -> legend[0], the only focusable element
        expect(linkGroupSize(shadow)).toBe(2)
    })

    it("blurring/moving focus away clears the linked highlight (after the fade)", async () => {
        const { surface, shadow } = setup(manifest)
        surface.focus()
        down(surface, "ArrowRight")
        expect(linkGroupSize(shadow)).toBe(2)
        down(surface, "Escape")
        await new Promise((r) => setTimeout(r, 150))
        expect(linkGroupSize(shadow)).toBe(0)
    })
})

describe("legend links: fan-out across kinds", () => {
    // legend rect at image [80,120]x[90,110] -> client center (50,50); links to a circles layer
    // (2 elements) AND a polyline layer (3 vertices -> 2 segments) — both must draw.
    const manifest: Manifest = {
        width: 1200, height: 800, scaling: 2, transforms: {},
        layers: [
            {
                id: "legend", kind: "rects", axis: "ax1", events: ["hover"],
                geometry: [100, 100, 40, 20],
                payloads: [{}],
                links: [["circ", "poly"]],
            },
            {
                id: "circ", kind: "circles", axis: "ax1", events: ["hover"],
                geometry: [600, 400, 20, 620, 420, 20],
                payloads: [{}, {}],
            },
            {
                id: "poly", kind: "polyline", axis: "ax1", events: ["hover"],
                geometry: [0, 0, 50, 50, 100, 100],
                payloads: [{}, {}],
            },
        ],
    }

    it("draws linked elements from both a circles and a polyline target layer", () => {
        const { surface, shadow } = setup(manifest)
        move(surface, 50, 50)
        // 2 circles + 2 polyline segments (a 3-vertex polyline is 2 segments); an open kind
        // (segments/polyline) in "selected" mode is a ring (highlight.ts's makeRing) — a <g>
        // wrapping two <line>s — rather than a bare <line>, so each still counts as one
        // top-level g.link child.
        expect(linkGroupSize(shadow)).toBe(4)
        const tags = [...shadow.querySelectorAll("g.link > *")].map((el) => el.tagName.toLowerCase())
        expect(tags.filter((t) => t === "circle").length).toBe(2)
        expect(tags.filter((t) => t === "g").length).toBe(2)
    })
})
