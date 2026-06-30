// Builds the committed, self-contained shim bundle. CI is the sole author of assets/holo-webgl.js.
// ESM (not the IIFE overlay.js uses): the widget HTML imports it as a module —
// `import(blobUrl).then(({ mountWebGL }) => …)`. The runtime `import(wglBundleUrl)` of WGLMakie's
// bundle is a non-literal specifier, so esbuild leaves it as a dynamic import (warns; kept as-is).
import { build } from "esbuild"

await build({
    entryPoints: ["src/holo-webgl.ts"],
    bundle: true,
    format: "esm",
    target: "es2020",
    outfile: "../assets/holo-webgl.js",
    minify: true,
    legalComments: "none",
    banner: { js: "/* HoloWGL :webgl shim — generated from HoloWGL/frontend/src by esbuild. Do not edit. */" },
})

console.log("built ../assets/holo-webgl.js")
