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
  // Shim-leak guard, scoped to the leak SIGNATURE so it can't flake on unrelated browser noise.
  // A missing window.Bonito.*/comm.* method surfaces as "Bonito.X is not a function" / "comm.X
  // is not a function" (the lock_loading/notify gaps this PR fixed). We FAIL only on that — not on
  // arbitrary headless-Chromium/Pluto-SPA errors (ResizeObserver loops, transient WebSocket
  // teardown), which would otherwise make a ~10-min E2E flaky. Two binary-codec methods are
  // knowingly left unstubbed (no Bonito server → no binary messages arrive), so they're tolerated.
  // If a real Bonito binary path is ever wired in, DROP this allowlist — a genuine
  // decode_binary/fetch_binary "is not a function" would otherwise be masked.
  const SHIM_LEAK = /\b(?:Bonito|comm)\.\w+ is not a function/;
  const ALLOWED_PAGEERRORS = [
    /Bonito\.decode_binary is not a function/,
    /Bonito\.fetch_binary is not a function/,
  ];
  const unexpectedErrors = [];
  // Surface browser-side failures (e.g. a WebSocket that can't reach the kernel) in the CI log.
  page.on("pageerror", (e) => {
    const isShim = SHIM_LEAK.test(e.message);
    const benign = isShim && ALLOWED_PAGEERRORS.some((re) => re.test(e.message));
    const leak = isShim && !benign;
    console.error(leak ? "PAGEERROR (shim leak):" : benign ? "PAGEERROR (known-benign):" : "PAGEERROR:", e.message);
    if (leak) unexpectedErrors.push(e.message);
  });
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
  const deadline = Date.now() + 1500000;   // cold: env cell devs Holo + adds WGLMakie + precompiles Makie/WGLMakie (first CI run ~10min+), under the 40-min job cap
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
    let after = before, won = -1;
    // Retry the click, don't dispatch-once-and-hope: the through-Pluto round-trip is flaky (verified
    // 2026-07-01 — PR #30 red twice on this, green on re-run, code untouched). A single dispatch can
    // race the overlay's listener wiring, and the reactive round-trip (emit → WS → kernel re-run →
    // WS → DOM) can outlast one wait window on a loaded runner. Re-clicking the SAME marker is
    // idempotent (:scatter, 0 either way), so retrying is a pure robustness win — ~30s total patience.
    // `before` is captured ONCE and every read compares to it, so a late DOM flip from an earlier
    // attempt's click is still caught by a later attempt's poll: effective patience is the full ~30s,
    // NOT a hard 10s ceiling per round-trip. `won` records which attempt flipped the bond — 0 ⇒ healthy
    // first click (slow round-trip); ≥1 ⇒ the first click(s) were dropped, which for a real user is a
    // dropped click (the readiness gate only checks `.surface` EXISTS, not that listeners are wired).
    retry: for (let attempt = 0; attempt < 3; attempt++) {
      surface.dispatchEvent(new PointerEvent("pointermove", o));
      surface.dispatchEvent(new PointerEvent("pointerdown", o));
      surface.dispatchEvent(new PointerEvent("pointerup", o));
      surface.dispatchEvent(new MouseEvent("click", o));
      for (let i = 0; i < 50; i++) { // ~10s per attempt
        await new Promise((r) => setTimeout(r, 200));
        // Null-safe: the click induces a Pluto re-run of the readout cell, so #bondout is briefly
        // absent while Pluto swaps that cell's output — treat a mid-swap read as "unchanged", keep polling.
        after = document.querySelector("#bondout")?.innerText ?? before;
        if (after !== before) { won = attempt; break retry; }
      }
    }
    return { before, after, attempt: won };
  });

  // Check the shim leak FIRST: a leak that also breaks rendering would otherwise surface as the
  // downstream "bond did not round-trip" symptom, hiding the root cause.
  if (unexpectedErrors.length) {
    throw new Error(`shim leak — missing window.Bonito/comm method(s): ${[...new Set(unexpectedErrors)].join(" | ")}`);
  }
  if (result.after === result.before) {
    throw new Error(`bond did not round-trip through Pluto: #bondout stayed "${result.before}" after click — the kernel never re-ran the readout cell (Pluto bond broken), or the click missed marker 0 (figure/MARKER0 drift)`);
  }
  if (!/InteractionEvent\(:scatter, 0/.test(result.after)) {
    throw new Error(`unexpected readout after click: "${result.after}"`);
  }
  if (result.attempt > 0) {
    console.error(`WARNING: bond round-tripped only on click attempt ${result.attempt} (0-based) — the first click(s) were DROPPED, not merely a slow round-trip. A real user would see a dropped click; suspect an overlay listener-wiring race (the readiness gate checks .surface EXISTS, not that its listeners are attached). If this warns every run, promote to a blocking assertion.`);
  }
  console.log(`THROUGH-PLUTO E2E OK (attempt ${result.attempt}) —`, result.before, "->", result.after);
} catch (e) {
  failed = e;
} finally {
  await browser.close();
}
if (failed) { console.error("THROUGH-PLUTO E2E FAIL:", failed.message); process.exit(1); }
