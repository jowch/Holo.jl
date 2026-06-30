// Real-browser E2E for the :webgl @bind round-trip. Loads the self-contained widget page
// (test/e2e/make_page.jl), clicks scatter marker 0 in a real headless Chromium, and asserts the
// overlay emits the correct bond value — host.value = {layer, index, payload} + an `input` event
// (the Pluto @bind contract, overlay.ts:273-274). This is the BROWSER half a unit test can't
// reach (real overlay JS, real shadow-DOM hit-test, real click on the :webgl sizer base); the
// Julia half (runtests.jl "@bind round-trip contract") asserts transform_value rebuilds the
// InteractionEvent from that same value. It deliberately stops at bond emission — the
// click→kernel→re-render mile is generic Pluto machinery, not HoloWGL code.
//
// The WebGL canvas may fail to init in headless (no GPU) — that's expected and irrelevant: the
// overlay mounts on the transparent SVG sizer, independent of the canvas pixels.
//
//   node click.mjs <artifact-dir>   (dir holds page.html + expected.json from make_page.jl)

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: node click.mjs <artifact-dir>"); process.exit(2); }
const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
const pageHtml = readFileSync(join(dir, "page.html"));

// The page inlines everything (scene/manifest/bundle/shim as JSON → blob URLs), so the only
// asset fetched is page.html itself. Serve it over http to avoid file:// module-import quirks.
const server = createServer((_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(pageHtml);
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/page.html`;

const browser = await chromium.launch({ headless: true });
let failed = null;
try {
  const page = await browser.newPage();
  await page.goto(url);

  // Wait for the overlay to mount on the sizer (not the WebGL canvas): host + a loaded sizer
  // <img> (naturalWidth = manifest out_w) + the overlay's shadow `.surface`.
  await page.waitForFunction(() => {
    const host = document.querySelector(".ip-host");
    const img = host?.querySelector("img.holo-webgl-sizer");
    if (!img || !img.naturalWidth) return false;
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    return !!(sr && sr.querySelector(".surface"));
  }, { timeout: 20000 });

  const got = await page.evaluate(async (exp) => {
    const host = document.querySelector(".ip-host");
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const surface = sr.querySelector(".surface");
    let captured = null;
    host.addEventListener("input", () => { captured = host.value; });
    const b = host.getBoundingClientRect();
    const o = { bubbles: true, composed: true, cancelable: true,
      clientX: b.x + exp.cssX, clientY: b.y + exp.cssY,
      pointerId: 1, pointerType: "mouse", isPrimary: true };
    surface.dispatchEvent(new PointerEvent("pointermove", o));
    surface.dispatchEvent(new PointerEvent("pointerdown", o));
    surface.dispatchEvent(new PointerEvent("pointerup", o));
    surface.dispatchEvent(new MouseEvent("click", o));
    await new Promise((r) => setTimeout(r, 100));
    return captured;
  }, expected);

  if (!got) throw new Error("no bond value emitted on click (host.value never set / no input event)");
  // Persist the REAL emitted host.value so verify_capture.jl can feed it through the actual
  // Julia transform_value — closing the emit→consume seam empirically (not at a synthesized shape).
  writeFileSync(join(dir, "captured.json"), JSON.stringify(got));
  if (got.layer !== expected.layer || got.index !== expected.index) {
    throw new Error(`bond mismatch: got ${JSON.stringify(got)}, expected layer=${expected.layer} index=${expected.index}`);
  }
  console.log("E2E OK — click round-tripped bond value:", JSON.stringify(got));
} catch (e) {
  failed = e;
} finally {
  await browser.close();
  server.close();
}
if (failed) { console.error("E2E FAIL:", failed.message); process.exit(1); }
