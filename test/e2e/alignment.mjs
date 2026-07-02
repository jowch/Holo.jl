// WS-3D canvas-alignment check (LOCAL tool — deliberately not wired into CI): does build-time
// `Makie.project` land where WGLMakie's GPU actually draws on an Axis3 canvas? Loads page3d.html
// with GL-capable Chromium (SwiftShader software GL), screenshots the live canvas, and asserts a
// red marker pixel at EVERY build-time projected marker center from expected3d.json (markersPx).
// A blank canvas FAILS (GL-init failure can't pass vacuously) — which is exactly why this stays a
// local tool: headless GL in CI is a flake source, and the bond-level Axis3 coverage already runs
// in CI via click.mjs. Re-run this when a change could move the 3D projection ↔ canvas relation
// (camera handling, ppu, viewport math, WGLMakie bumps). First run 2026-07-02: 0.0 px on all
// markers — recorded in docs/perf-findings.md §"Axis3 projection hinge spike".
//
//   julia --project=. test/e2e/make_page.jl /tmp/e2e && (cd test/e2e && npm install && node alignment.mjs /tmp/e2e)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const dir = process.argv[2];
if (!dir) { console.error("usage: node alignment.mjs <artifact-dir>"); process.exit(2); }
const expected = JSON.parse(readFileSync(join(dir, "expected3d.json"), "utf8"));
const pageHtml = readFileSync(join(dir, "page3d.html"));

const server = createServer((_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(pageHtml);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/page3d.html`;

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
let failed = null;
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(url);
  await page.waitForSelector("canvas.holo-webgl-base", { timeout: 20000 });
  await page.waitForTimeout(6000); // let the WGL scene actually draw (SwiftShader is slow)

  const meta = await page.evaluate(() => {
    const host = document.querySelector(".ip-host");
    const canvas = host.querySelector("canvas.holo-webgl-base");
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const svg = sr?.querySelector("svg");
    return {
      cssW: canvas.clientWidth, cssH: canvas.clientHeight,
      imgW: svg ? svg.viewBox.baseVal.width : null,
      imgH: svg ? svg.viewBox.baseVal.height : null,
    };
  });
  if (!meta.imgW) throw new Error("overlay svg not found — cannot derive image-px scale");

  const canvas = page.locator("canvas.holo-webgl-base");
  const shot = PNG.sync.read(await canvas.screenshot());
  const rx = shot.width / meta.imgW, ry = shot.height / meta.imgH;

  const isRed = (x, y) => {
    if (x < 0 || y < 0 || x >= shot.width || y >= shot.height) return false;
    const i = (y * shot.width + x) * 4;
    const [r, g, b] = [shot.data[i], shot.data[i + 1], shot.data[i + 2]];
    return r > 150 && g < 110 && b < 110;
  };
  // blank-canvas guard: GL may fail to init headless — that must FAIL, not pass vacuously
  let nonWhite = 0;
  for (let i = 0; i < shot.data.length; i += 4) {
    if (shot.data[i] < 240 || shot.data[i + 1] < 240 || shot.data[i + 2] < 240) nonWhite++;
  }
  if (nonWhite < 100) throw new Error(`canvas appears blank (${nonWhite} non-white px) — GL did not render; alignment unverifiable`);

  const TOL = 4; // css px search radius around each projected center (nearest-first, so dist is the real offset)
  const results = expected.markersPx.map((m, k) => {
    const cx = Math.round(m.x * rx), cy = Math.round(m.y * ry);
    let hit = null;
    outer: for (let rad = 0; rad <= TOL; rad++)
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++)
          if (Math.max(Math.abs(dx), Math.abs(dy)) === rad && isRed(cx + dx, cy + dy)) { hit = Math.hypot(dx, dy); break outer; }
    return { k, cx, cy, dist: hit, centerRed: isRed(cx, cy) };
  });
  for (const r of results) {
    if (r.dist === null) throw new Error(`marker ${r.k}: no red pixel within ${TOL}px of projected center (${r.cx},${r.cy}) — canvas draws elsewhere (alignment FAIL)`);
  }
  console.log("ALIGNMENT OK —",
    results.map((r) => `m${r.k}@(${r.cx},${r.cy}) nearest=${r.dist.toFixed(1)}px centerRed=${r.centerRed}`).join("  "));
} catch (e) {
  failed = e;
} finally {
  await browser.close();
  server.close();
}
if (failed) { console.error("ALIGNMENT FAIL:", failed.message); process.exit(1); }
