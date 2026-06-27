// Builds the committed, self-contained bundle. CI is the sole author of assets/overlay.js.
import { build } from "esbuild"

await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "iife", // self-installing IIFE; Julia injects it unconditionally (idempotent)
    target: "es2020",
    outfile: "../assets/overlay.js",
    minify: true,
    legalComments: "none",
    banner: { js: "/* Holo.jl overlay — generated from frontend/src by esbuild. Do not edit. */" },
})

console.log("built ../assets/overlay.js")
