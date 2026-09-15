import { describe, it, expect, vi } from "vitest"
import { esc, renderTemplate, renderAutoTable } from "../src/template"

// d3-format's own specs never throw once parsed (a bad spec throws at parse time, already
// covered above) — so exercising applySpec's *second* try/catch (the formatter call itself
// throwing) needs a formatter that parses fine but throws on invocation.
vi.mock("d3-format", async (importOriginal) => {
    const actual = await importOriginal<typeof import("d3-format")>()
    return {
        ...actual,
        format: (spec: string) => (spec === "__throw_on_call__" ? () => { throw new Error("boom") } : actual.format(spec)),
    }
})

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
    it("non-finite numeric values skip formatting and fall back to plain escaping", () => {
        expect(renderTemplate([{ f: "v", spec: "," }], { v: NaN })).toBe("NaN")
        expect(renderTemplate([{ f: "v", spec: "," }], { v: Infinity })).toBe("Infinity")
        expect(renderTemplate([{ f: "v", spec: "," }], { v: -Infinity })).toBe("-Infinity")
    })
    it("caches a spec formatter across repeated fields (bad and good spec both reused)", () => {
        // second use of the same bad spec must hit the cached fallback (still catches, no throw)
        expect(renderTemplate([{ f: "a", spec: ".2z" }, " ", { f: "b", spec: ".2z" }], { a: 1, b: 2 })).toBe("1 2")
        expect(renderTemplate([{ f: "a", spec: "," }, " ", { f: "b", spec: "," }], { a: 1000, b: 2000 })).toBe("1,000 2,000")
    })
    it("a payload that isn't an object (or is null/undefined) renders every field as missing", () => {
        expect(renderTemplate([{ f: "x" }, "!"], "just a string")).toBe("!")
        expect(renderTemplate([{ f: "x" }, "!"], null)).toBe("!")
        expect(renderTemplate([{ f: "x" }, "!"], 42)).toBe("!")
    })
    it("a value with no spec that isn't a string is still escaped via String()", () => {
        expect(renderTemplate([{ f: "obj" }], { obj: { a: 1 } })).toBe(esc(String({ a: 1 })))
    })
    it("a spec that parses fine but throws when invoked falls back to plain escaping", () => {
        expect(renderTemplate([{ f: "v", spec: "__throw_on_call__" }], { v: 5 })).toBe("5")
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
    it("null/undefined payload renders nothing", () => {
        expect(renderAutoTable(null)).toBe("")
        expect(renderAutoTable(undefined)).toBe("")
    })
    it("a non-object payload (scalar) is escaped directly, not tabulated", () => {
        expect(renderAutoTable(42)).toBe("42")
        expect(renderAutoTable("<b>raw</b>")).toBe("&lt;b&gt;raw&lt;/b&gt;")
    })
    it("a nested object value stringifies via String() and is escaped", () => {
        const html = renderAutoTable({ point: { x: 1, y: 2 } })
        expect(html).toContain(esc(String({ x: 1, y: 2 })))
    })
})
