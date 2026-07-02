// WGL context-lifecycle measurement (LOCAL tool — deliberately not wired into CI): drives a
// PlutoUI slider through N kernel re-renders of a :webgl holo widget and counts WebGL context
// creations vs webglcontextlost events. Asserts the property docs/perf-findings.md
// §"WGL context lifecycle" records: LIVE contexts stay at 1 across the sweep, because
// WGLMakie's check_screen disposes any context whose canvas left the DOM (re-run and delete
// alike). Re-run on a WGLMakie major bump; if upstream drops that disposal, this notices.
// Not CI: a through-Pluto job is the flake-prone kind, and the property is upstream-owned.
//
//   julia test/e2e/serve.jl 1234 &   # poll http://127.0.0.1:1234 for 200
//   (cd test/e2e && npm install && node ctx_growth.mjs http://127.0.0.1:1234 "$PWD/ctxgrowth_notebook.jl")
import { chromium } from "playwright";

const [base, notebook] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
let failed = null;
try {
  const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC" });
  // Count WebGL context CREATIONS (getContext returns the same object for repeat calls on one
  // canvas — only count first-time creations per canvas) before any page script runs.
  await context.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    window.__glCanvases = new WeakSet();
    window.__glCreated = 0;
    window.__glLost = 0;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const ctx = orig.call(this, type, ...args);
      if (ctx && String(type).startsWith("webgl") && !window.__glCanvases.has(this)) {
        window.__glCanvases.add(this);
        window.__glCreated += 1;
        this.addEventListener("webglcontextlost", () => { window.__glLost += 1; });
      }
      return ctx;
    };
  });
  const page = await context.newPage();
  page.on("console", (m) => { if (/too many.*webgl|context lost|removing WGL context/i.test(m.text())) console.error("BROWSER:", m.text()); });
  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.error("phase: notebook opened");

  const deadline = Date.now() + 1500000;
  let ready = false, tick = 0;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const runBtn = [...document.querySelectorAll("button, a")].find((b) => /run notebook code/i.test(b.innerText || b.title || ""));
      if (runBtn) runBtn.click();
      const host = document.querySelector(".ip-host");
      let surface = false;
      if (host) { let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; }); surface = !!(sr && sr.querySelector(".surface")); }
      return {
        busy: document.querySelectorAll("pluto-cell.running, pluto-cell.queued").length,
        errored: document.querySelectorAll("pluto-cell.errored").length,
        surface, bondout: !!document.querySelector("#bondout"),
      };
    });
    if (st.errored) throw new Error(`notebook has ${st.errored} errored cell(s)`);
    if (!st.busy && st.surface && st.bondout) { ready = true; break; }
    if (tick % 30 === 0) console.error(`  …waiting [${tick}s] busy=${st.busy} surface=${st.surface}`);
    tick++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error("timed out waiting for widget");
  console.error("phase: widget mounted — sweeping slider");

  const before = await page.evaluate(() => ({
    created: window.__glCreated,
    canvases: document.querySelectorAll("canvas.holo-webgl-base").length,
    cellId: document.querySelector(".ip-host")?.closest("pluto-cell")?.id ?? null,
  }));
  console.error("baseline before sweep:", JSON.stringify(before));
  // Vacuous-pass guard: if no WebGL context was created by mount, the widget rendered down some
  // non-GL path and this tool is measuring nothing — FAIL, don't report a hollow LIVE=0 success.
  if (before.created < 1 || before.canvases < 1) {
    throw new Error(`no WebGL context at baseline (created=${before.created}, canvases=${before.canvases}) — widget did not take the :webgl path; measurement is vacuous`);
  }

  let cellIdStable = before.cellId !== null;

  // Sweep: drive the PlutoUI slider through 5 NEW positions (PlutoUI range inputs are
  // index-based — min/step/max are indices, the bond transform maps them to values), and
  // detect each re-render by the bondout text CHANGING (it embeds az=…).
  const STEPS = 5;
  for (let s = 1; s <= STEPS; s++) {
    const beforeTxt = await page.evaluate(() => document.querySelector("#bondout")?.innerText ?? "");
    const moved = await page.evaluate(() => {
      const slider = document.querySelector('pluto-cell input[type="range"]');
      if (!slider) return null;
      const min = Number(slider.min), max = Number(slider.max), stepSz = Number(slider.step) || 1;
      let v = Number(slider.value) + stepSz;           // strictly next position → guaranteed change
      if (v > max) v = min;
      slider.value = String(v);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return slider.value;
    });
    if (moved === null) throw new Error("slider input not found");
    let ok = false;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const t = await page.evaluate(() => document.querySelector("#bondout")?.innerText ?? "");
      if (t !== beforeTxt && t.length) { ok = true; break; }
    }
    if (!ok) throw new Error(`slider step ${s} (idx ${moved}): bondout never changed from ${JSON.stringify(beforeTxt)}`);
    await new Promise((r) => setTimeout(r, 500));   // let check_screen's next RAF tick run
    const st = await page.evaluate(() => ({
      created: window.__glCreated, lost: window.__glLost, live: window.__glCreated - window.__glLost,
      canvases: document.querySelectorAll("canvas.holo-webgl-base").length,
      cellId: document.querySelector(".ip-host")?.closest("pluto-cell")?.id ?? null,
    }));
    if (st.cellId !== before.cellId) cellIdStable = false;   // stability, not mere presence
    console.error(`after step ${s} (az=${moved}):`, JSON.stringify(st));
  }

  const after = await page.evaluate(() => ({ created: window.__glCreated, lost: window.__glLost, canvases: document.querySelectorAll("canvas.holo-webgl-base").length }));
  const live = after.created - after.lost;
  if (after.created < STEPS + 1) throw new Error(`only ${after.created} contexts created across ${STEPS} re-renders + mount — re-renders did not exercise the GL path; measurement is vacuous`);
  if (live !== 1) throw new Error(`LIVE contexts = ${live} after the sweep (expected exactly 1) — ${live > 1 ? 'the upstream check_screen disposal is gone' : 'the resident context was disposed spuriously'} (see perf-findings §"WGL context lifecycle")`);

  // DELETE half — measured, not inferred: delete the holo cell via Pluto's UI and assert the
  // last context is disposed (live → 0). Best-effort: Pluto's delete UI may change; report
  // delete_measured=false rather than fail if the controls aren't found.
  let deleteMeasured = false;
  const deleted = await page.evaluate((cellId) => {
    const cell = document.getElementById(cellId);
    if (!cell) return "no-cell";
    const open = cell.querySelector("button.delete_cell") ||
      [...cell.querySelectorAll("button")].find((b) => /delete/i.test(b.title || b.ariaLabel || ""));
    if (open) { open.click(); return "clicked"; }
    return "no-button";
  }, before.cellId);
  if (deleted === "clicked") {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const st = await page.evaluate(() => ({ live: window.__glCreated - window.__glLost, canvases: document.querySelectorAll("canvas.holo-webgl-base").length }));
      if (st.live === 0 && st.canvases === 0) { deleteMeasured = true; break; }
    }
    if (!deleteMeasured) throw new Error("cell deleted but the context was never disposed (live never reached 0) — the delete half of the disposal claim FAILED");
  } else {
    console.error(`delete step skipped (${deleted}) — delete disposal stays mechanism-inferred this run`);
  }

  console.log(`RESULT created=${after.created} lost=${after.lost} LIVE=${live} canvases_in_dom=${after.canvases} steps=${STEPS} cellid_stable=${cellIdStable} delete_measured=${deleteMeasured}`);
} catch (e) {
  failed = e;
} finally {
  await browser.close();
}
if (failed) { console.error("BASELINE SPIKE FAIL:", failed.message); process.exit(1); }
