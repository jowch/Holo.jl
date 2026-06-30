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
  // Explicit locale/timezone: GitHub runners have a minimal locale, so Pluto's frontend hits
  // "Incorrect locale information provided" from a V8 Intl call and never bootstraps (blank page).
  const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC" });
  const page = await context.newPage();
  // Surface browser-side failures (e.g. a WebSocket that can't reach the kernel) in the CI log.
  page.on("pageerror", (e) => console.error("PAGEERROR:", e.message));
  page.on("requestfailed", (r) => console.error("REQFAIL:", r.url(), r.failure()?.errorText));
  // /open?path= loads the notebook and redirects to /edit?id=…. Use domcontentloaded, not "load":
  // the Pluto SPA holds connections open, so the load event can lag past the nav timeout.
  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.error("phase: notebook opened");

  // One poll loop drives both: exit safe preview AND wait for the widget. Click "Run notebook
  // code" WHENEVER it appears (best-effort — Pluto may render the toolbar slowly, or auto-run
  // with no button at all), and finish as soon as the widget + readout are present. Manual loop
  // throughout: waitForFunction's explicit timeout is unreliable in this env (silently caps at
  // its 30s default), and a hard "button must appear" gate is exactly what broke CI.
  const deadline = Date.now() + 1500000;   // cold: env cell devs Holo+HoloWGL + precompiles Makie/WGLMakie (first CI run ~10min+), under the 40-min job cap
  let ready = false, ranClicked = false, tick = 0;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const runBtn = [...document.querySelectorAll("button, a")].find((b) => /run notebook code/i.test(b.innerText || b.title || ""));
      if (runBtn) runBtn.click();
      // overlay fully mounted = its shadow `.surface` exists (guards against clicking mid-mount)
      const host = document.querySelector(".ip-host");
      let surface = false;
      if (host) { let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; }); surface = !!(sr && sr.querySelector(".surface")); }
      return {
        clickedRun: !!runBtn,
        nCells: document.querySelectorAll("pluto-cell").length,
        busy: document.querySelectorAll("pluto-cell.running, pluto-cell.queued").length,
        errored: document.querySelectorAll("pluto-cell.errored").length,
        host: !!host, surface,
        bondout: !!document.querySelector("#bondout"),
        buttons: [...document.querySelectorAll("button, a")].map((b) => (b.innerText || b.title || "").trim()).filter(Boolean).slice(0, 8),
        title: document.title,
      };
    });
    if (st.clickedRun && !ranClicked) { ranClicked = true; console.error("phase: exited safe preview (Run notebook code)"); }
    if (st.errored) throw new Error(`notebook has ${st.errored} errored cell(s)`);
    if (!st.busy && st.surface && st.bondout) { ready = true; break; }
    if (tick % 30 === 0) console.error(`  …waiting [${tick}s] cells=${st.nCells} busy=${st.busy} runBtn=${st.clickedRun} host=${st.host} surface=${st.surface} bondout=${st.bondout} title=${JSON.stringify(st.title)} buttons=${JSON.stringify(st.buttons)}`);
    tick++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error("timed out waiting for cells to finish / widget to mount");
  console.error("phase: cells ran, widget mounted — clicking marker");

  const result = await page.evaluate(async () => {
    const host = document.querySelector(".ip-host");
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const surface = sr.querySelector(".surface");
    const b = host.getBoundingClientRect();
    // Marker 0's image-px position in the manifest, for the notebook's fixed scatter(1:5,(1:5).^2).
    // (The live manifest ships into the overlay's closure via published_to_js — not exposed on the
    // page — so unlike the static E2E we can't read it back; it's pinned to the committed figure.)
    // The CSS scale (image-px → on-screen CSS-px) IS derived at runtime: the overlay's SVG viewBox
    // is `0 0 manifest.width manifest.height`, so viewBox.width == out_w — no sizer to read anymore.
    const MARKER0 = { x: 113, y: 500 };
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
    const scale = host.clientWidth / outW;   // == display_css / out_w
    const o = { bubbles: true, composed: true, cancelable: true, clientX: b.x + MARKER0.x * scale, clientY: b.y + MARKER0.y * scale, pointerId: 1, pointerType: "mouse", isPrimary: true };
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
    throw new Error(`bond did not round-trip through Pluto: #bondout stayed "${result.before}" after click — the kernel never re-ran the readout cell (Pluto bond broken), or the click missed marker 0 (figure/MARKER0 drift)`);
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
