import { describe, it, expect, afterEach } from "vitest"
import { mount } from "../src/overlay"

// index.ts is the bundle's entry point: it self-installs `window.Holo = { mount }` on import
// (CLAUDE.md: "inject the esbuild IIFE unconditionally — wrapping it in if(!window.Holo){…}
// installs {} not {mount}"). This locks that the installed object actually carries `mount`.
describe("index entry point", () => {
    afterEach(() => {
        delete (globalThis as unknown as { Holo?: unknown }).Holo
    })

    it("installs window.Holo = { mount } on import, and mount is the real overlay mount", async () => {
        const mod = await import("../src/index")
        const installed = (globalThis as unknown as { Holo?: { mount?: unknown } }).Holo
        expect(installed).toBeTruthy()
        expect(installed!.mount).toBe(mount)
        expect(mod.mount).toBe(mount)
    })
})
