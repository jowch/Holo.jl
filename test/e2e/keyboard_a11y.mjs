// Agent live-verify for keyboard navigation + ARIA. Drives the same kind_sweep_{cairo,webgl}.jl
// notebook kind_sweep.mjs/polish_verify.mjs use, but exercises the keyboard path: Tab-reachable
// focus, arrow/Home/End/PageUp/PageDown navigation, Enter's bond round-trip, Escape, Tab-away
// clearing focus, the live region, and that :grid stays out of the focus list.
//
//   node keyboard_a11y.mjs <base-url> <notebook-abs-path> <cairo|webgl> [artifact-dir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [base, notebook, backend, artifactDirArg] = process.argv.slice(2);
if (!base || !notebook || !backend) {
  console.error("usage: node keyboard_a11y.mjs <base-url> <notebook> <cairo|webgl> [artifact-dir]");
  process.exit(2);
}
const artifactDir = artifactDirArg || process.env.E2E_ARTIFACT_DIR || null;
if (artifactDir) mkdirSync(artifactDir, { recursive: true });
const consoleLog = [];

const SHIM_LEAK = /\b(?:Bonito|comm)\.\w+ is not a function/;
const ALLOWED = [/Bonito\.decode_binary is not a function/, /Bonito\.fetch_binary is not a function/];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const passed = [];
const unexpected = [];
let failed = null;
let page;
try {
  const context = await browser.newContext({
    locale: "en-US", timezoneId: "UTC",
    viewport: { width: 1100, height: 1400 },
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

  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const deadline = Date.now() + 1500000;
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
      let meta = null;
      try { meta = JSON.parse(document.querySelector("#kind_meta")?.textContent || ""); } catch { meta = null; }
      return {
        busy: document.querySelectorAll("pluto-cell.running, pluto-cell.queued").length,
        errored: document.querySelectorAll("pluto-cell.errored").length,
        hosts: hosts.length, surfaces, metaN: Array.isArray(meta) ? meta.length : 0,
        errText: [...document.querySelectorAll("pluto-cell.errored")].map((c) => c.innerText).slice(0, 1).join(""),
      };
    });
    if (st.errored) throw new Error(`${backend} errored: ${st.errText.slice(0, 500)}`);
    if (!st.busy && st.metaN >= 14 && st.surfaces >= st.metaN) { ready = true; break; }
    if (tick % 20 === 0) console.error(`  …${backend} [${tick}s] busy=${st.busy} surfaces=${st.surfaces} meta=${st.metaN}`);
    tick++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error(`${backend} timed out waiting for kind-sweep widgets`);
  console.error(`phase: widgets mounted (${backend})`);

  const layersOf = (key) => page.evaluate((k) => JSON.parse(document.querySelector(`#coords_${k}`).textContent), key);
  const textOf = (sel) => page.evaluate((q) => document.querySelector(q)?.innerText ?? "", sel);

  // Element handle for the shadow-root .surface of a given kind-sweep case, resolved the same
  // way kind_sweep.mjs does (coords_<key> span's DOM position -> nearest preceding .ip-host).
  const surfaceHandle = (key) => page.evaluateHandle((k) => {
    const span = document.querySelector(`#coords_${k}`);
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    return sr.querySelector(".surface");
  }, key);

  const state = (key) => page.evaluate((k) => {
    const span = document.querySelector(`#coords_${k}`);
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const hi = sr.querySelector("g.hi > *");
    const live = sr.querySelector('[aria-live="polite"]');
    return {
      focused: sr.activeElement === sr.querySelector(".surface"),
      ring: hi ? { tag: hi.tagName.toLowerCase(), leaving: hi.classList.contains("holo-leave") } : null,
      liveText: live?.textContent ?? "",
      tipShown: sr.querySelector(".holo-tip")?.classList.contains("show") ?? false,
    };
  }, key);

  // Element count per kind, matching selection.ts's layerNElements — used to pick an Enter
  // target index guaranteed to differ from whatever this layer's bond value already holds
  // (this notebook session is shared across kind_sweep.mjs/polish_verify.mjs, which already
  // click some of these layers; Pluto skips re-running a bond's dependent cell when the new
  // value equals the old one, so re-clicking the SAME index would look like a silent failure).
  const elementCount = (layer) => {
    const g = layer.geometry;
    if (layer.kind === "circles") return g.length / 3;
    if (layer.kind === "rects") return g.length / 4;
    if (layer.kind === "polygons") return g.length;
    throw new Error(`elementCount: unhandled kind ${layer.kind}`);
  };

  for (const key of ["scatter", "barplot", "poly"]) {
    const layers = await layersOf(key);
    const layer = layers[0];
    const n = elementCount(layer);
    const surface = await surfaceHandle(key);

    await surface.focus();
    let s = await state(key);
    if (!s.focused) throw new Error(`${key}: surface.focus() did not set DOM focus (tabindex missing?)`);
    passed.push(`${key}/focusable`);

    await page.keyboard.press("ArrowRight");
    s = await state(key);
    if (!s.ring) throw new Error(`${key}: ArrowRight drew no ring`);
    if (!s.tipShown) throw new Error(`${key}: ArrowRight showed no tooltip`);
    passed.push(`${key}/arrow-ring+tip`);

    await page.waitForTimeout(250); // live-region debounce (150ms) + margin
    s = await state(key);
    if (!/element 1 of \d+/.test(s.liveText)) throw new Error(`${key}: live region text unexpected: ${JSON.stringify(s.liveText)}`);
    passed.push(`${key}/live-region`);

    const before = await textOf(`#out_${key}`);
    const beforeIdxMatch = new RegExp(`:${layer.id},\\s*(\\d+)\\b`).exec(before);
    const beforeIdx = beforeIdxMatch ? Number(beforeIdxMatch[1]) : -1;
    const target = (beforeIdx + 1) % n; // guaranteed != beforeIdx as long as n > 1
    // We're at index 0 (one ArrowRight, above) — walk to `target`.
    for (let i = 0; i < target; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    let after = before;
    for (let i = 0; i < 40 && after === before; i++) { await page.waitForTimeout(100); after = await textOf(`#out_${key}`); }
    if (after === before) throw new Error(`${key}: Enter never updated #out_${key} (target index ${target}, was ${beforeIdx})`);
    const idRe = new RegExp(`:${layer.id}|${layer.id}`, "i");
    if (!idRe.test(after)) throw new Error(`${key}: Enter bond value missing layer id: ${after.slice(0, 200)}`);
    if (!new RegExp(`:${layer.id},\\s*${target}\\b`).test(after)) {
      throw new Error(`${key}: Enter bond value expected index ${target}: ${after.slice(0, 200)}`);
    }
    passed.push(`${key}/enter-bind`);

    await page.keyboard.press("Escape");
    s = await state(key);
    if (s.focused) throw new Error(`${key}: Escape did not blur the surface`);
    if (s.ring && !s.ring.leaving) throw new Error(`${key}: Escape left a non-fading ring`);
    passed.push(`${key}/escape`);
  }

  // Tab-away (not just Escape) must clear keyboard focus — the case mount.ts's `focusout`
  // listener exists for: leaving the surface any other way (Tab onward, a click elsewhere)
  // must not leave the ring/tooltip pinned to the last-focused element indefinitely.
  {
    const key = "scatter";
    const surface = await surfaceHandle(key);
    await surface.focus();
    await page.keyboard.press("ArrowRight");
    let s = await state(key);
    if (!s.ring) throw new Error(`${key}: ArrowRight (tab-away setup) drew no ring`);
    await page.keyboard.press("Tab");
    s = await state(key);
    if (s.focused) throw new Error(`${key}: Tab did not move DOM focus off the surface`);
    if (s.ring && !s.ring.leaving) throw new Error(`${key}: Tab-away left a non-fading ring`);
    passed.push(`${key}/tab-away-clears-focus`);
  }

  // :grid (heatmap) must never enter the focus list — arrowing must draw nothing.
  {
    const surface = await surfaceHandle("heatmap");
    await surface.focus();
    await page.keyboard.press("ArrowRight");
    const s = await state("heatmap");
    if (s.ring) throw new Error("heatmap: :grid unexpectedly focusable (ring drawn)");
    passed.push("grid-excluded");
  }

  if (unexpected.length) throw new Error(`page errors: ${unexpected.join(" | ")}`);
  passed.push("no-console-errors");
  console.log(`KEYBOARD A11Y OK — ${backend}: ${passed.join(", ")}`);
} catch (e) {
  failed = e;
  // Mirrors the captureFailure shape kind_sweep.mjs/polish_verify.mjs use: screenshot + DOM
  // dump + console log, so a CI failure ships enough evidence to diagnose without re-running.
  if (artifactDir && page) {
    try {
      await page.screenshot({ path: join(artifactDir, `keyboard_a11y-${backend}-failure.png`), fullPage: true });
      const dump = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        cells: [...document.querySelectorAll("pluto-cell")].map((c) => ({ id: c.id, classes: c.className })),
        hosts: document.querySelectorAll(".ip-host").length,
        activeElement: document.activeElement?.tagName,
      }));
      writeFileSync(join(artifactDir, `keyboard_a11y-${backend}-dom.json`), JSON.stringify(dump, null, 2));
      writeFileSync(join(artifactDir, `keyboard_a11y-${backend}-console.log`), consoleLog.join("\n"));
      console.error(`artifact: wrote keyboard_a11y-${backend}-{failure.png,dom.json,console.log} to ${artifactDir}`);
    } catch (e2) {
      console.error("artifact capture failed:", e2.message);
    }
  }
} finally {
  await browser.close();
}
if (failed) {
  console.error(`KEYBOARD A11Y FAIL (${backend}, after ${passed.join(", ")}):`, failed.message);
  process.exit(1);
}
