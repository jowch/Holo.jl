// README demo recorder — drives docs/dev/readme-demo/notebook.jl in headless Chromium and
// captures a frame sequence of a hover → tooltip → click → @bind round-trip, for assembly into
// docs/src/assets/demo.gif. Run from test/e2e (playwright 1.49.1 lives in its node_modules):
//
//   node ../../docs/dev/readme-demo/record.mjs <base-url> <notebook-abs-path> <frames-dir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [base, notebook, framesDir] = process.argv.slice(2);
if (!base || !notebook || !framesDir) {
  console.error("usage: node record.mjs <base-url> <notebook-abs-path> <frames-dir>");
  process.exit(2);
}
mkdirSync(framesDir, { recursive: true });

// Pluto keys a running notebook session by its file path, so re-opening the SAME path reuses the
// prior run's live kernel — including its @bind value. A second recording against the canonical
// path would inherit `pick` already set from an earlier click (confirmed: it silently produced a
// GIF that showed "selected" from frame 1, with no actual before/after transition). Open a
// throwaway copy each run instead, so Pluto always spins up a fresh kernel and `pick` starts at
// `nothing`. Safe because notebook.jl's env-activation cell only uses `@__DIR__`-relative paths
// in the no-MASQUE_DEV_ENV fallback branch, which isn't taken when MASQUE_DEV_ENV is set.
const runNotebook = join(tmpdir(), `masque-readme-demo-${Date.now()}-${process.pid}.jl`);
copyFileSync(notebook, runNotebook);
console.error(`fresh-kernel copy: ${notebook} -> ${runNotebook}`);

// Must match the cell UUIDs in notebook.jl.
const ID_BIND = "d1000000-0000-0000-0000-000000000003";
const ID_OUT = "d1000000-0000-0000-0000-000000000004";
const ID_COORDS = "d1000000-0000-0000-0000-000000000005";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHIM_LEAK = /\b(?:Bonito|comm)\.\w+ is not a function/;
const ALLOWED = [/Bonito\.decode_binary is not a function/, /Bonito\.fetch_binary is not a function/];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const unexpected = [];
const consoleLog = [];
let failed = null;
let context, page;
try {
  context = await browser.newContext({
    locale: "en-US", timezoneId: "UTC",
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
  });
  page = await context.newPage();
  page.on("pageerror", (e) => {
    const shim = SHIM_LEAK.test(e.message);
    const benign = shim && ALLOWED.some((re) => re.test(e.message));
    if (!benign) unexpected.push(e.message);
    console.error(benign ? "PAGEERROR (known-benign):" : "PAGEERROR:", e.message);
  });
  page.on("console", (m) => consoleLog.push(`[${m.type()}] ${m.text()}`));

  console.error(`opening ${runNotebook} …`);
  const t0open = Date.now();
  await page.goto(`${base}/open?path=${encodeURIComponent(runNotebook)}`, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Readiness: poll DOM state (never grep Pluto's log — it doesn't reliably flush).
  const deadline = Date.now() + 20 * 60 * 1000;
  let ready = false, tick = 0;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const runBtn = [...document.querySelectorAll("button, a")].find((b) => /run notebook code/i.test(b.innerText || b.title || ""));
      if (runBtn) runBtn.click();
      const hosts = [...document.querySelectorAll(".ip-host")];
      let surfaces = 0;
      for (const h of hosts) {
        let sr = null; h.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
        if (sr && sr.querySelector(".surface")) surfaces++;
      }
      let coordsOk = false;
      try {
        const arr = JSON.parse(document.querySelector("#coords")?.textContent || "");
        coordsOk = Array.isArray(arr) && arr.length >= 1;
      } catch { coordsOk = false; }
      return {
        busy: document.querySelectorAll("pluto-cell.running, pluto-cell.queued").length,
        errored: document.querySelectorAll("pluto-cell.errored").length,
        errText: [...document.querySelectorAll("pluto-cell.errored")].map((c) => c.innerText).slice(0, 1).join(""),
        hosts: hosts.length, surfaces, coordsOk,
        title: document.title,
      };
    });
    if (st.errored) throw new Error(`notebook errored: ${st.errText.slice(0, 800)}`);
    if (!st.busy && st.hosts >= 1 && st.surfaces >= st.hosts && st.coordsOk) { ready = true; break; }
    if (tick % 20 === 0) {
      console.error(`  …[${tick}s] busy=${st.busy} hosts=${st.hosts} surfaces=${st.surfaces} coordsOk=${st.coordsOk} title=${JSON.stringify(st.title)}`);
    }
    tick++;
    await sleep(1000);
  }
  if (!ready) throw new Error("timed out waiting for the widget to mount");
  const readySecs = ((Date.now() - t0open) / 1000).toFixed(1);
  console.error(`phase: widget mounted after ${readySecs}s`);

  // Hide Pluto chrome; keep only the @bind cell (code shown) and the output cell below it.
  await page.addStyleTag({
    content: `
      header, footer, pluto-helpbox, nav { display: none !important; }
      pluto-cell:not(#${ID_BIND}):not(#${ID_OUT}) { display: none !important; }
      pluto-shoulder, .add_cell_commands, .foldcode, .runcell, .cell_folder { display: none !important; }
      pluto-input-container > button { display: none !important; }
      body { background: white !important; }
      pluto-cell { margin: 0 !important; }
    `,
  });

  // Fake cursor: headless Chromium renders no OS pointer.
  await page.evaluate(() => {
    const c = document.createElement("div");
    c.id = "__fake_cursor";
    c.style.cssText = "position:fixed;left:0;top:0;width:16px;height:16px;z-index:2147483647;pointer-events:none;transform:translate(-2px,-2px);";
    c.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1 L1 13 L4.5 10.2 L6.8 15 L9 14 L6.7 9.2 L11 9 Z" fill="black" stroke="white" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(c);
    document.addEventListener("mousemove", (e) => {
      c.style.left = `${e.clientX}px`;
      c.style.top = `${e.clientY}px`;
    }, true);
  });

  // Scroll the @bind cell to the top of the viewport.
  await page.evaluate((id) => {
    document.getElementById(id)?.scrollIntoView({ block: "start", inline: "nearest" });
  }, ID_BIND);
  await sleep(300);

  const rect = await page.evaluate(([bindId, outId]) => {
    const nb = document.querySelector("pluto-notebook") || document.querySelector("main") || document.body;
    const nbRect = nb.getBoundingClientRect();
    const r1 = document.getElementById(bindId).getBoundingClientRect();
    const r2 = document.getElementById(outId).getBoundingClientRect();
    return {
      left: nbRect.left, width: nbRect.width,
      top: Math.min(r1.top, r2.top), bottom: Math.max(r1.bottom, r2.bottom),
    };
  }, [ID_BIND, ID_OUT]);
  const margin = 16;
  const clip = {
    x: Math.max(0, Math.round(rect.left - margin)),
    y: Math.max(0, Math.round(rect.top - margin)),
    width: Math.round(rect.width + 2 * margin),
    height: Math.round(rect.bottom - rect.top + 2 * margin),
  };
  console.error(`clip: ${JSON.stringify(clip)}`);

  // Geometry: the single :circles layer's centers, in image px.
  const layers = await page.evaluate(() => JSON.parse(document.querySelector("#coords").textContent));
  const circles = layers.find((l) => l.kind === "circles");
  if (!circles) throw new Error(`no circles layer in ${JSON.stringify(layers)}`);
  const g = circles.geometry;
  const n = g.length / 3;
  const centers = Array.from({ length: n }, (_, i) => ({ x: g[3 * i], y: g[3 * i + 1], r: g[3 * i + 2] }));

  const toCss = (ix, iy) => page.evaluate(([x, y]) => {
    const host = document.querySelector(".ip-host");
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const b = host.querySelector("img, canvas").getBoundingClientRect();
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
    const s = b.width / outW;
    return { x: b.left + x * s, y: b.top + y * s };
  }, [ix, iy]);

  // Pick a blank spot: an image corner (in real image px, not axis px) farthest from every marker.
  const imgSize = await page.evaluate(() => {
    const host = document.querySelector(".ip-host");
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const vb = sr.querySelector("svg").viewBox.baseVal;
    return { w: vb.width, h: vb.height };
  });
  const inset = 15;
  const candidates = [
    { x: inset, y: inset }, { x: imgSize.w - inset, y: inset },
    { x: inset, y: imgSize.h - inset }, { x: imgSize.w - inset, y: imgSize.h - inset },
    { x: imgSize.w / 2, y: imgSize.h - inset },
  ];
  const minDist = (p) => Math.min(...centers.map((c) => Math.hypot(c.x - p.x, c.y - p.y)));
  const blank = candidates.reduce((best, p) => (minDist(p) > minDist(best) ? p : best), candidates[0]);
  if (minDist(blank) < 40) console.error(`WARN: blank spot only ${minDist(blank).toFixed(1)}px from nearest marker`);

  // A / B / C: three cities, spread across the plot. Click lands on C.
  const idxA = 0, idxB = 5, idxC = 3;
  const [ptA, ptB, ptC, ptOff] = await Promise.all([
    toCss(centers[idxA].x, centers[idxA].y),
    toCss(centers[idxB].x, centers[idxB].y),
    toCss(centers[idxC].x, centers[idxC].y),
    toCss(blank.x, blank.y),
  ]);

  const shadowSel = () => page.evaluate(() => {
    const host = document.querySelector(".ip-host");
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const t = sr.querySelector(".masque-tip");
    return { show: !!(t && t.classList.contains("show")), text: (t?.innerText || "").replace(/\s+/g, " ").trim() };
  });
  const outText = () => page.evaluate((id) => document.getElementById(id)?.innerText || "", ID_OUT);

  let cur = { x: ptOff.x, y: ptOff.y };
  await page.mouse.move(cur.x, cur.y);

  const moveTo = async (target, durationMs, steps = 20) => {
    const start = { ...cur };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = start.x + (target.x - start.x) * t;
      const y = start.y + (target.y - start.y) * t;
      await page.mouse.move(x, y);
      await sleep(durationMs / steps);
    }
    cur = { ...target };
  };

  // Frame capture runs concurrently with the interaction timeline.
  const frames = [];
  const t0 = Date.now();
  let done = false;
  const captureLoop = async () => {
    let i = 0;
    while (!done) {
      const started = Date.now();
      const path = join(framesDir, `frame_${String(i).padStart(4, "0")}.png`);
      await page.screenshot({ path, clip });
      frames.push({ file: path, t: started - t0 });
      i++;
      const elapsed = Date.now() - started;
      const budget = 1000 / 15;
      if (elapsed < budget) await sleep(budget - elapsed);
    }
    // one final frame so the last hold has full duration in the timeline
    const path = join(framesDir, `frame_${String(i).padStart(4, "0")}.png`);
    await page.screenshot({ path, clip });
    frames.push({ file: path, t: Date.now() - t0 });
  };

  const assertTip = async (label, cityFrag) => {
    const tip = await shadowSel();
    if (!tip.show || !tip.text.toLowerCase().includes(cityFrag.toLowerCase())) {
      throw new Error(`${label}: tooltip not showing "${cityFrag}" — got ${JSON.stringify(tip)}`);
    }
    console.error(`OK  tooltip@${label}: ${JSON.stringify(tip.text)}`);
  };

  const timeline = async () => {
    await sleep(400); // still, cursor at blank spot
    await moveTo(ptA, 450, 18);
    await sleep(150); // let the hover settle before asserting
    await assertTip("A", "Tokyo");
    await sleep(800);
    await moveTo(ptB, 450, 18);
    await sleep(150);
    await assertTip("B", "Cairo");
    await sleep(800);
    await moveTo(ptC, 450, 18);
    await sleep(150);
    await assertTip("C", "São Paulo");
    await sleep(350);
    const before = await outText();
    await page.mouse.down();
    await sleep(40);
    await page.mouse.up();
    // wait for the kernel round-trip to update the bound output cell
    let after = before;
    for (let a = 0; a < 40; a++) {
      after = await outText();
      if (after !== before && /selected/i.test(after)) break;
      await sleep(100);
    }
    if (!/selected/i.test(after) || !/são paulo/i.test(after)) {
      throw new Error(`click: output cell didn't update — before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    }
    console.error(`OK  click-bind: ${JSON.stringify(after)}`);
    await sleep(1100);
    await moveTo(ptOff, 450, 18);
    const tipAfterLeave = await shadowSel();
    if (tipAfterLeave.show) console.error(`WARN: tooltip still showing after leaving: ${JSON.stringify(tipAfterLeave)}`);
    await sleep(1200);
    done = true;
  };

  await Promise.all([captureLoop(), timeline()]);

  writeFileSync(join(framesDir, "timestamps.json"), JSON.stringify(frames, null, 2));
  console.error(`captured ${frames.length} frames over ${(frames.at(-1).t / 1000).toFixed(2)}s`);

  if (unexpected.length) throw new Error(`page errors: ${unexpected.join(" | ")}`);
  console.log(`RECORD OK — ${frames.length} frames, ready in ${readySecs}s`);
} catch (e) {
  failed = e;
  if (page) {
    try {
      await page.screenshot({ path: join(framesDir, "..", "failure.png"), fullPage: true });
      writeFileSync(join(framesDir, "..", "console.log"), consoleLog.join("\n"));
    } catch (e2) {
      console.error("artifact capture failed:", e2.message);
    }
  }
} finally {
  await browser.close();
  try {
    rmSync(runNotebook, { force: true });
  } catch { /* best-effort tmp cleanup */ }
}
if (failed) {
  console.error("RECORD FAIL:", failed.message);
  process.exit(1);
}
