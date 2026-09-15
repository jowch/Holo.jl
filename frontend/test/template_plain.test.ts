// Direct unit coverage for template.ts's plain-text renderers (keyboard.ts's live-region
// content) — the integration path is also exercised through mount() in keyboard.test.ts, but
// these hit the branches directly: empty/non-object/object payloads, entity un-escaping, and
// the tooltip-suppressed / template short-circuits in plainTextForHit.
import { describe, it, expect } from "vitest"
import { renderAutoTablePlain, stripToPlain, plainTextForHit } from "../src/template"
import type { Hit, HitLayer } from "../src/types"

const layer = (overrides: Partial<HitLayer> = {}): HitLayer => ({
    id: "l", kind: "circles", geometry: [], payloads: [{ name: "A & B" }], axis: "ax1",
    events: ["click", "hover"], ...overrides,
})

describe("renderAutoTablePlain", () => {
    it("returns empty string for null/undefined payload", () => {
        expect(renderAutoTablePlain(null)).toBe("")
        expect(renderAutoTablePlain(undefined)).toBe("")
    })

    it("stringifies a non-object payload directly", () => {
        expect(renderAutoTablePlain(42)).toBe("42")
        expect(renderAutoTablePlain("hi")).toBe("hi")
    })

    it("joins object entries as 'key value' pairs, comma-separated, unescaped", () => {
        expect(renderAutoTablePlain({ x: 1, y: 4 })).toBe("x 1, y 4")
        expect(renderAutoTablePlain({ label: "A & B" })).toBe("label A & B") // no HTML escaping needed here
    })
})

describe("stripToPlain", () => {
    it("removes tags and un-escapes the OWASP five-entity set", () => {
        expect(stripToPlain("<b>A &amp; B</b>")).toBe("A & B")
        expect(stripToPlain("&lt;div&gt; &quot;x&quot; &#39;y&#39;")).toBe("<div> \"x\" 'y'")
    })

    it("is a no-op on plain text with no tags or entities", () => {
        expect(stripToPlain("plain text")).toBe("plain text")
    })

    it("inserts a separator between adjacent tags instead of running words together", () => {
        // A bare tag-strip would produce "x: 1y: 2" — the two rows run together with no space.
        expect(stripToPlain("<div>x: 1</div><div>y: 2</div>")).toBe("x: 1 y: 2")
    })
})

describe("plainTextForHit", () => {
    it("returns '' when tooltip is suppressed", () => {
        const hit: Hit = { layer: layer({ tooltip: false }), index: 0 }
        expect(plainTextForHit(hit)).toBe("")
    })

    it("renders the auto-table for a plain (non-template) layer", () => {
        const hit: Hit = { layer: layer(), index: 0 }
        expect(plainTextForHit(hit)).toBe("name A & B")
    })

    it("strips and un-escapes a template layer's rendered HTML", () => {
        const hit: Hit = {
            layer: layer({ template: ["<b>", { f: "name" }, "</b>"] }),
            index: 0,
        }
        expect(plainTextForHit(hit)).toBe("A & B")
    })
})
