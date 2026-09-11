// THROUGH-PLUTO @bind E2E. Drives a live headless Pluto kernel (serve.jl) in real Chromium:
// open the notebook, exit safe preview, click scatter marker 0, and assert the bond round-trips
// THROUGH Pluto — the kernel re-runs the readout cell so #bondout flips from "BOND=nothing" to
// the InteractionEvent. This is the mile the static E2E (click.mjs) skips: Pluto/APD bond
// transport + reactive re-render, not just the overlay's emit. Verified locally against a real
// kernel (06-30): click -> BOND=Holo.InteractionEvent(:scatter, 0, …).
//
// Readiness is split on purpose (de-flake):
//   1. layout — host/base have non-zero width (MARKER0 scale isn't 0)
//   2. overlay emit — host.value set on click (same signal click.mjs asserts)
//   3. Pluto round-trip — #bondout flips (only after emit; longer patience; no re-clicks)
// Failures name which mile broke instead of the ambiguous "bond stayed nothing".
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
      // overlay fully mounted = its shadow `.surface` exists (guards against clicking mid-mount).
      // mount() is sync: seeing .surface from another turn means listeners are already wired.
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
  console.error("phase: cells ran, widget mounted — waiting for layout");

  // Layout gate: MARKER0 → CSS-px uses host.clientWidth; a zero-width host makes every click miss.
  {
    const layoutDeadline = Date.now() + 10000;
    let laidOut = false;
    while (Date.now() < layoutDeadline) {
      laidOut = await page.evaluate(() => {
        const host = document.querySelector(".ip-host");
        const base = host?.querySelector("img, canvas");
        return !!(host && base && host.clientWidth > 0 && base.getBoundingClientRect().width > 0);
      });
      if (laidOut) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!laidOut) throw new Error("host/base never laid out (clientWidth/rect width still 0 after 10s)");
  }
  console.error("phase: layout ready — overlay emit, then Pluto round-trip");

  const result = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const host = document.querySelector(".ip-host");
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const surface = sr.querySelector(".surface");
    // Marker 0's image-px position in the manifest, for the notebook's fixed scatter(1:5,(1:5).^2).
    // (The live manifest ships into the overlay's closure via published_to_js — not exposed on the
    // page — so unlike the static E2E we can't read it back; it's pinned to the committed figure.)
    // The CSS scale (image-px → on-screen CSS-px) IS derived at runtime: the overlay's SVG viewBox
    // is `0 0 manifest.width manifest.height`, so viewBox.width == out_w — no sizer to read anymore.
    const MARKER0 = { x: 113, y: 500 };
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
    const clickOpts = () => {
      // Scale through the BASE (img/canvas), not the host — they can disagree on WGL/DPR.
      const base = host.querySelector("img, canvas");
      const b = base.getBoundingClientRect();
      const scale = b.width / outW;
      return {
        bubbles: true, composed: true, cancelable: true,
        clientX: b.x + MARKER0.x * scale, clientY: b.y + MARKER0.y * scale,
        pointerId: 1, pointerType: "mouse", isPrimary: true,
      };
    };
    const dispatchClick = () => {
      const o = clickOpts();
      surface.dispatchEvent(new PointerEvent("pointermove", o));
      surface.dispatchEvent(new PointerEvent("pointerdown", o));
      surface.dispatchEvent(new PointerEvent("pointerup", o));
      surface.dispatchEvent(new MouseEvent("click", o));
    };
    const bondText = (fallback) => document.querySelector("#bondout")?.innerText ?? fallback;

    const before = document.querySelector("#bondout").innerText;
    // --- Mile 2: overlay emit (host.value). Retries OK — same marker is idempotent. -----------
    // onClick sets host.value synchronously on hit; a miss leaves it null (mount init).
    let emitAttempt = -1;
    let emitted = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      dispatchClick();
      // Sync path usually wins immediately; short poll covers any deferred handler.
      for (let i = 0; i < 10; i++) {
        const after = bondText(before);
        if (after !== before) {
          // Pluto already flipped — rare but treat as full success (emit implied).
          return { before, after, emitAttempt: attempt, emitted: host.value, plutoMs: 0, inputRefires: 0, error: null };
        }
        if (host.value != null) {
          emitted = host.value;
          emitAttempt = attempt;
          break;
        }
        await sleep(50);
      }
      if (emitted != null) break;
    }
    if (emitted == null) {
      return { before, after: before, emitAttempt: -1, emitted: null, plutoMs: 0, inputRefires: 0, error: "no_emit" };
    }

    // --- Mile 3: Pluto round-trip. Do NOT re-click — more clicks race cell remounts. ----------
    // CI evidence (PR #47 run 1): emit succeeded immediately, but #bondout stayed nothing for a
    // full ~90s — so the flake is Pluto bond/WS/kernel lag (or a missed first `input`), not the
    // hit-test. Re-dispatch `input` periodically WITHOUT changing host.value: Bond re-reads
    // .value on each input, recovering a late-attached listener without remounting the widget.
    const plutoStart = Date.now();
    const PLUTO_MS = 180000; // 3 min — still well under the 40-min job cap after precompile
    let after = before;
    let inputRefires = 0;
    while (Date.now() - plutoStart < PLUTO_MS) {
      after = bondText(before);
      if (after !== before) {
        return { before, after, emitAttempt, emitted, plutoMs: Date.now() - plutoStart, inputRefires, error: null };
      }
      // Every ~5s, nudge Pluto in case the first input landed before the bond was subscribed.
      if ((Date.now() - plutoStart) > 0 && ((Date.now() - plutoStart) / 5000 | 0) > inputRefires) {
        host.dispatchEvent(new CustomEvent("input"));
        inputRefires++;
      }
      await sleep(200);
    }
    return { before, after, emitAttempt, emitted, plutoMs: Date.now() - plutoStart, inputRefires, error: "no_pluto" };
  });

  // Check the shim leak FIRST: a leak that also breaks rendering would otherwise surface as the
  // downstream "bond did not round-trip" symptom, hiding the root cause.
  if (unexpectedErrors.length) {
    throw new Error(`shim leak — missing window.Bonito/comm method(s): ${[...new Set(unexpectedErrors)].join(" | ")}`);
  }
  if (result.error === "no_emit") {
    throw new Error(`overlay never emitted on click (host.value unset after retries) — click missed marker 0 or hit-test failed; #bondout still "${result.before}"`);
  }
  if (result.error === "no_pluto") {
    throw new Error(`overlay emitted ${JSON.stringify(result.emitted)} but Pluto never re-ran readout: #bondout stayed "${result.before}" for ${result.plutoMs}ms after emit (${result.inputRefires} input re-fires)`);
  }
  if (!/InteractionEvent\(:scatter, 0/.test(result.after)) {
    throw new Error(`unexpected readout after click: "${result.after}"`);
  }
  if (result.emitAttempt > 0) {
    console.error(`WARNING: overlay emitted only on click attempt ${result.emitAttempt} (0-based) — first click(s) missed or host not yet hittable. If this warns every run, investigate MARKER0 / layout.`);
  }
  console.log(`THROUGH-PLUTO E2E OK (emit attempt ${result.emitAttempt}, pluto ${result.plutoMs}ms, inputRefires ${result.inputRefires}) —`, result.before, "->", result.after);
} catch (e) {
  failed = e;
} finally {
  await browser.close();
}
if (failed) { console.error("THROUGH-PLUTO E2E FAIL:", failed.message); process.exit(1); }
