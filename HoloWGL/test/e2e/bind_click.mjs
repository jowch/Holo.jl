// THROUGH-PLUTO @bind E2E. Drives a live headless Pluto kernel (serve.jl) in real Chromium:
// open the notebook, exit safe preview, click scatter marker 0, and assert the bond round-trips
// THROUGH Pluto — the kernel re-runs the readout cell so #bondout flips from "BOND=nothing" to
// the InteractionEvent. This is the mile the static E2E (click.mjs) skips: Pluto/APD bond
// transport + reactive re-render, not just the overlay's emit. Verified locally against a real
// kernel (06-30): click -> BOND=Holo.InteractionEvent(:scatter, 0, …).
//
//   node bind_click.mjs <base-url> <notebook-abs-path>

import { chromium } from "playwright";

const base = process.argv[2];
const notebook = process.argv[3];
if (!base || !notebook) { console.error("usage: node bind_click.mjs <base-url> <notebook-abs-path>"); process.exit(2); }

const browser = await chromium.launch({ headless: true });
let failed = null;
try {
  const page = await browser.newPage();
  // /open?path= loads the notebook and redirects to /edit?id=…. Use domcontentloaded, not "load":
  // the Pluto SPA holds connections open, so the load event can lag past the nav timeout.
  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.error("phase: notebook opened");

  // Exit Pluto's safe preview so the kernel runs the cells. Poll for the button and click it
  // (manual loops throughout — waitForFunction's explicit timeout is unreliable in this env,
  // silently capping at its 30s default).
  const clickRun = () => page.evaluate(() => {
    const el = [...document.querySelectorAll("button, a")].find((b) => /run notebook code/i.test(b.innerText || b.title || ""));
    if (!el) return false;
    el.click();
    return true;
  });
  const btnDeadline = Date.now() + 90000;
  let clicked = false;
  while (Date.now() < btnDeadline) {
    if (await clickRun()) { clicked = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!clicked) throw new Error("safe-preview 'Run notebook code' button never appeared");
  console.error("phase: clicked Run notebook code — waiting for cells (cold precompile: minutes)");

  // Cells run — the env cell devs Holo+HoloWGL and precompiles the Makie/WGLMakie stack (cold:
  // minutes). Manual poll loop (waitForFunction silently caps at its 30s default here). Ready =
  // widget mounted, readout present, nothing running/errored.
  const deadline = Date.now() + 600000;
  let ready = false;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({
      busy: document.querySelectorAll("pluto-cell.running, pluto-cell.queued").length,
      errored: document.querySelectorAll("pluto-cell.errored").length,
      host: !!document.querySelector(".ip-host"),
      bondout: !!document.querySelector("#bondout"),
    }));
    if (st.errored) throw new Error(`notebook has ${st.errored} errored cell(s)`);
    if (!st.busy && st.host && st.bondout) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error("timed out waiting for cells to finish / widget to mount");
  console.error("phase: cells ran, widget mounted — clicking marker");

  const result = await page.evaluate(async () => {
    const host = document.querySelector(".ip-host");
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const surface = sr.querySelector(".surface");
    const b = host.getBoundingClientRect();
    // marker 0 of the notebook's fixed scatter(1:5,(1:5).^2): image-px (113,500) × 0.5 CSS scale.
    const o = { bubbles: true, composed: true, cancelable: true, clientX: b.x + 56.5, clientY: b.y + 250, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const before = document.querySelector("#bondout").innerText;
    surface.dispatchEvent(new PointerEvent("pointermove", o));
    surface.dispatchEvent(new PointerEvent("pointerdown", o));
    surface.dispatchEvent(new PointerEvent("pointerup", o));
    surface.dispatchEvent(new MouseEvent("click", o));
    // Wait for the kernel to re-run the readout cell through the Pluto bond (reactive round-trip).
    let after = before;
    for (let i = 0; i < 75; i++) { // ~15s
      await new Promise((r) => setTimeout(r, 200));
      after = document.querySelector("#bondout").innerText;
      if (after !== before) break;
    }
    return { before, after };
  });

  if (result.after === result.before) {
    throw new Error(`bond did not round-trip through Pluto: #bondout stayed "${result.before}" after click`);
  }
  if (!/InteractionEvent\(:scatter, 0/.test(result.after)) {
    throw new Error(`unexpected readout after click: "${result.after}"`);
  }
  console.log("THROUGH-PLUTO E2E OK —", result.before, "->", result.after);
} catch (e) {
  failed = e;
} finally {
  await browser.close();
}
if (failed) { console.error("THROUGH-PLUTO E2E FAIL:", failed.message); process.exit(1); }
