import { describe, it, expect } from "vitest"
import { esc, renderTemplate, renderAutoTable } from "../src/template"

describe("esc", () => {
    it("escapes the 5 HTML chars", () => {
        expect(esc(`<img onerror="x" & '`)).toBe("&lt;img onerror=&quot;x&quot; &amp; &#39;")
    })
})

describe("renderTemplate", () => {
    it("keeps literal markup live, escapes data", () => {
        const segs = ["<b>", { f: "name" }, "</b>"]
        expect(renderTemplate(segs, { name: "<script>" })).toBe("<b>&lt;script&gt;</b>")
    })
    it("applies a d3-format spec to numbers", () => {
        expect(renderTemplate([{ f: "pop", spec: "," }], { pop: 37000000 })).toBe("37,000,000")
        expect(renderTemplate([{ f: "r", spec: ".1%" }], { r: 0.123 })).toBe("12.3%")
    })
    it("missing field → empty, bad spec → raw", () => {
        expect(renderTemplate([{ f: "nope" }], { x: 1 })).toBe("")
        expect(renderTemplate([{ f: "v", spec: ".2z" }], { v: 5 })).toBe("5")
    })
})

describe("renderAutoTable", () => {
    it("renders escaped name/value rows", () => {
        const html = renderAutoTable({ city: "Tokyo", n: "<b>" })
        expect(html).toContain("Tokyo")
        expect(html).toContain("&lt;b&gt;")
        expect(html).toContain("holo-tip-row")
    })

    it("renders the text-button payload (; text, index, x, y)", () => {
        const html = renderAutoTable({ text: "Hello", index: 0, x: 1.5, y: 2 })
        expect(html).toContain("text")
        expect(html).toContain("Hello")
        expect(html).toContain("1.5")
    })
})
