import { defineConfig, coverageConfigDefaults } from "vitest/config"

export default defineConfig({
    test: {
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            // An explicit `exclude` REPLACES vitest's defaults rather than extending them, so
            // spread coverageConfigDefaults.exclude back in (still catches e.g. a future *.d.ts
            // under src/, which `include` alone wouldn't stop from being scanned).
            // types.ts is type/interface declarations only (no runtime code) — v8 reports it
            // as 0% executable statements, which just dilutes the real number.
            exclude: [...coverageConfigDefaults.exclude, "../assets/**", "src/types.ts"],
            reporter: ["lcov"],
        },
    },
})
