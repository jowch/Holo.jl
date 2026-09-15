import { defineConfig } from "vitest/config"

export default defineConfig({
    test: {
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            // types.ts is type/interface declarations only (no runtime code) — v8 reports it
            // as 0% executable statements, which just dilutes the real number.
            exclude: ["../assets/**", "src/types.ts"],
            reporter: ["lcov"],
        },
    },
})
