// Builds the committed bundles. CI is the sole author of both assets/overlay.js
// (IIFE) and assets/holo-webgl.js (ESM). Two modules, one package — do not
// concatenate: the overlay is a classic <script> IIFE (`window.Holo.mount`);
// the shim is `import(blobUrl).then(({ mountWebGL })` so it can dynamic-import
// WGLMakie's own bundle (non-literal specifier, left as a runtime import).
import { build } from "esbuild"

const target = process.argv[2]

// Trailing-underscore convention (frontend-delivery.md's Bundle row): any property named
// foo_ is frontend-internal and safe to shorten. A quoted property (obj["foo_"]) is never
// mangled by esbuild, so nothing crossing the Julia/Pluto/DOM boundary may end in "_".
const mangleProps = /_$/

async function buildOverlay() {
    await build({
        entryPoints: ["src/index.ts"],
        bundle: true,
        format: "iife", // self-installing IIFE; Julia injects it unconditionally (idempotent)
        target: "es2020",
        outfile: "../assets/overlay.js",
        minify: true,
        mangleProps,
        legalComments: "none",
        banner: { js: "/* Holo.jl overlay — generated from frontend/src by esbuild. Do not edit. */" },
    })
    console.log("built ../assets/overlay.js")
}

async function buildShim() {
    await build({
        entryPoints: ["src/wgl-shim.ts"],
        bundle: true,
        format: "esm",
        target: "es2020",
        outfile: "../assets/holo-webgl.js",
        minify: true,
        mangleProps,
        legalComments: "none",
        banner: { js: "/* Holo :webgl shim — generated from frontend/src by esbuild. Do not edit. */" },
    })
    console.log("built ../assets/holo-webgl.js")
}

if (target === "overlay") {
    await buildOverlay()
} else if (target === "shim") {
    await buildShim()
} else {
    await buildOverlay()
    await buildShim()
}
