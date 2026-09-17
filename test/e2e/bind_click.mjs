// THROUGH-PLUTO @bind E2E. Drives a live headless Pluto kernel (serve.jl) in real Chromium:
// open the notebook, exit safe preview, click scatter marker 0, and assert the bond round-trips
// THROUGH Pluto — the kernel re-runs the readout cell so #bondout flips from "BOND=nothing" to
// the InteractionEvent. This is the mile the static E2E (click.mjs) skips: Pluto/APD bond
// transport + reactive re-render, not just the overlay's emit. Verified locally against a real
// kernel (06-30): click -> BOND=Masque.InteractionEvent(:scatter, 0, …).
//
// Readiness is split on purpose (de-flake):
//   1. layout — host/base have non-zero width (MARKER0 scale isn't 0)
//   2. overlay emit — host.value set on click (same signal click.mjs asserts)
//   3. Pluto round-trip — #bondout flips (only after emit; longer patience; no re-clicks)
// Failures name which mile broke instead of the ambiguous "bond stayed nothing".
//
// Mile 3 has flaked under CI load (PRs #57/#60/#61/#65/#66: emit always succeeds, #bondout
// never flips within budget, ~35 no-op "input" re-fires). Two load-bearing responses to that,
// both evidence-based (see docs on the PR, not guessed):
//   - The retry uses a DIFFERENT marker (index 1, not 0) — re-firing "input" on an UNCHANGED
//     host.value is exactly what CI evidence shows doing nothing for a full 180s window; a
//     retry that reproduces the same value would just be re-running the same non-fix. This
//     isn't about Pluto deduplicating equal bond values (checked Pluto 0.20.28's source:
//     Bond.js fires on every "input" unconditionally, and RunBonds.jl's equality skip only
//     gates the very first value) — it forces a genuinely new value through, in case something
//     on either side is coalescing unchanged ones for a reason the CI evidence doesn't reveal.
//   - Mile 3 now tracks whether ANY cell ever went busy after emit (`sawCellActivity`), so a
//     future timeout's error message says whether the kernel picked up the bond at all
//     (slow-but-progressing) or never did (a different failure class) instead of leaving both
//     indistinguishable behind "#bondout stayed nothing".
//
//   node bind_click.mjs <base-url> <notebook-abs-path> [artifact-dir]

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2];
const notebook = process.argv[3];
const artifactDir = process.argv[4] || process.env.E2E_ARTIFACT_DIR || null;
if (!base || !notebook) { console.error("usage: node bind_click.mjs <base-url> <notebook-abs-path> [artifact-dir]"); process.exit(2); }
if (artifactDir) mkdirSync(artifactDir, { recursive: true });

// Marker image-px positions for the notebook's fixed scatter(1:5, (1:5).^2), Figure(size=(400,300)).
// Verified against a live `masque(fig)` manifest for the same figure (index -> [x,y,r] geometry
// triplet); MARKER0 matches the value this file has pinned since #31.
const MARKERS = [
  { x: 113, y: 500 }, // index 0
  { x: 269, y: 444 }, // index 1 — the retry target (a genuinely new value, not a re-fire of the old one)
];
const PLUTO_MS = 300000; // 5 min per attempt — generous vs. the observed ~90-180s CI stalls,
                         // still leaves the 40-min job cap plenty of room after two attempts.

let browser, context, page;
let failed = null;
try {
  browser = await chromium.launch({ headless: true });
  // Explicit locale/timezone: GitHub runners have a minimal locale, so Pluto's frontend hits
  // "Incorrect locale information provided" from a V8 Intl call and never bootstraps (blank page).
  context = await browser.newContext({ locale: "en-US", timezoneId: "UTC" });
  page = await context.newPage();
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
  const mountDeadline = Date.now() + 1500000;   // cold: env cell devs Masque + adds WGLMakie + precompiles Makie/WGLMakie (first CI run ~10min+), under the 40-min job cap
  let ready = false, ranClicked = false, tick = 0;
  while (Date.now() < mountDeadline) {
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

  // Runs mile 2 (overlay emit) + mile 3 (Pluto round-trip) for one marker. Returns a result
  // object; never throws — the caller decides whether a mile-3 timeout is worth a retry.
  const attempt = async (marker) => page.evaluate(async ({ marker, PLUTO_MS }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const host = document.querySelector(".ip-host");
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const surface = sr.querySelector(".surface");
    // The CSS scale (image-px → on-screen CSS-px) IS derived at runtime: the overlay's SVG viewBox
    // is `0 0 manifest.width manifest.height`, so viewBox.width == out_w — no sizer to read anymore.
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
    const clickOpts = () => {
      // Scale through the BASE (img/canvas), not the host — they can disagree on WGL/DPR.
      const base = host.querySelector("img, canvas");
      const b = base.getBoundingClientRect();
      const scale = b.width / outW;
      return {
        bubbles: true, composed: true, cancelable: true,
        clientX: b.x + marker.x * scale, clientY: b.y + marker.y * scale,
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
    // Best-effort mile-3 diagnostics: not a proof of "bond listener attached" (Pluto exposes no
    // such DOM flag — checked frontend/common/Bond.js and components/CellOutput.js), but enough
    // to tell a future timeout's error message whether the kernel ever picked up the bond at all.
    const cellState = () => ({
      busy: document.querySelectorAll("pluto-cell.running, pluto-cell.queued").length,
      errored: document.querySelectorAll("pluto-cell.errored").length,
      disconnected: document.querySelector("pluto-editor")?.classList.contains("disconnected") ?? null,
      bondNodes: document.querySelectorAll("bond").length,
    });

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
          return { before, after, emitAttempt: attempt, emitted: host.value, plutoMs: 0, inputRefires: 0, sawCellActivity: false, lastState: cellState(), error: null };
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
      return { before, after: before, emitAttempt: -1, emitted: null, plutoMs: 0, sawCellActivity: false, lastState: cellState(), error: "no_emit" };
    }

    // --- Mile 3: Pluto round-trip. Do NOT re-click — more clicks race cell remounts. ----------
    // CI evidence (PR #47 run 1, and PRs #57/#60/#61/#65/#66): emit succeeds immediately, but
    // #bondout stays nothing for the full window — so the flake is Pluto bond/WS/kernel lag, not
    // the hit-test. Re-dispatch `input` periodically WITHOUT changing host.value: Bond re-reads
    // .value on each input, recovering a late-attached listener without remounting the widget.
    // (CI evidence across 5+ occurrences: this re-fire alone has never once recovered the bond
    // within budget — kept anyway since it's free and harmless, but don't rely on it; the actual
    // recovery mechanism is the caller's different-marker retry.)
    const plutoStart = Date.now();
    let after = before;
    let inputRefires = 0;
    let sawCellActivity = false;
    let lastState = cellState();
    while (Date.now() - plutoStart < PLUTO_MS) {
      after = bondText(before);
      if (after !== before) {
        return { before, after, emitAttempt, emitted, plutoMs: Date.now() - plutoStart, inputRefires, sawCellActivity, lastState, error: null };
      }
      lastState = cellState();
      if (lastState.busy > 0) sawCellActivity = true;
      // Every ~5s, nudge Pluto in case the first input landed before the bond was subscribed.
      if ((Date.now() - plutoStart) > 0 && ((Date.now() - plutoStart) / 5000 | 0) > inputRefires) {
        host.dispatchEvent(new CustomEvent("input"));
        inputRefires++;
      }
      await sleep(200);
    }
    return { before, after, emitAttempt, emitted, plutoMs: Date.now() - plutoStart, inputRefires, sawCellActivity, lastState, error: "no_pluto" };
  }, { marker, PLUTO_MS });

  const describeResult = (r) => `sawCellActivity=${r.sawCellActivity} lastState=${JSON.stringify(r.lastState)} inputRefires=${r.inputRefires}`;

  let result = await attempt(MARKERS[0]);
  let clickedIndex = 0;

  // Shim leak first: a leak that also breaks rendering would otherwise surface as the downstream
  // "bond did not round-trip" symptom, hiding the root cause. Check before deciding to retry.
  if (unexpectedErrors.length) {
    throw new Error(`shim leak — missing window.Bonito/comm method(s): ${[...new Set(unexpectedErrors)].join(" | ")}`);
  }

  if (result.error === "no_pluto") {
    console.error(`WARNING: mile 3 (Pluto round-trip) timed out after ${result.plutoMs}ms on marker 0 — ${describeResult(result)}`);
    if (artifactDir) await captureFailure("attempt1-no-pluto");
    console.error("RETRY: clicking a DIFFERENT marker (index 1, a genuinely new value) and waiting again.");
    result = await attempt(MARKERS[1]);
    clickedIndex = 1;
    // Re-check for a shim leak that first appeared during the retry — checked only once, after
    // attempt 1, this would otherwise lose its root-cause label behind whatever error the retry
    // itself produces (no_pluto / unexpected readout).
    if (unexpectedErrors.length) {
      throw new Error(`shim leak — missing window.Bonito/comm method(s): ${[...new Set(unexpectedErrors)].join(" | ")}`);
    }
  }

  if (result.error === "no_emit") {
    throw new Error(`overlay never emitted on click (host.value unset after retries) — click missed marker ${clickedIndex} or hit-test failed; #bondout still "${result.before}"`);
  }
  if (result.error === "no_pluto") {
    if (artifactDir) await captureFailure("attempt2-no-pluto");
    throw new Error(`overlay emitted ${JSON.stringify(result.emitted)} but Pluto never re-ran readout on EITHER attempt (marker 0, then marker 1): #bondout stayed "${result.before}" — ${describeResult(result)}`);
  }
  // Read the index straight out of the readout rather than asserting `clickedIndex` outright:
  // after a retry, attempt 1's own (merely late) round-trip can land during attempt 2's wait
  // window — #bondout then flips to marker 0's value even though marker 1 was clicked last.
  // That's still a genuine, successful `@bind` round-trip (the exact "kernel is slow, not stuck"
  // case this PR exists to tolerate). But this widened acceptance only makes sense once a retry
  // has actually happened — on the plain happy path (no retry, clickedIndex still 0) a landed
  // index of 1 can only mean a hit-test/scale regression mapped marker 0's click onto marker 1's
  // payload, which must still fail loud, not pass silently.
  const landedMatch = /InteractionEvent\(:scatter, (\d+)/.exec(result.after);
  const landedIndex = landedMatch ? Number(landedMatch[1]) : null;
  const validIndices = clickedIndex === 1 ? [0, 1] : [0];
  if (!validIndices.includes(landedIndex)) {
    throw new Error(`unexpected readout after click on marker ${clickedIndex}: "${result.after}"`);
  }
  if (result.emitAttempt > 0) {
    console.error(`WARNING: overlay emitted only on click attempt ${result.emitAttempt} (0-based) — first click(s) missed or host not yet hittable. If this warns every run, investigate MARKER positions / layout.`);
  }
  if (landedIndex !== clickedIndex) {
    console.error(`NOTE: clicked marker ${clickedIndex} but the readout shows marker ${landedIndex} — attempt 1's round-trip was merely late and landed during the retry's wait window. Treating as a genuine pass, not a failure.`);
  } else if (clickedIndex !== 0) {
    console.error(`NOTE: bond only round-tripped after the retry (marker ${clickedIndex}) — mile 3 is flaky under load even though this run ultimately passed. Investigate if this becomes frequent.`);
  }
  console.log(`THROUGH-PLUTO E2E OK (marker ${clickedIndex}, landed ${landedIndex}, emit attempt ${result.emitAttempt}, pluto ${result.plutoMs}ms, inputRefires ${result.inputRefires}) —`, result.before, "->", result.after);

  // On-failure artifact capture: a screenshot + a DOM/cell-state dump, so a future occurrence of
  // this flake in CI ships enough evidence to diagnose without re-running the job locally.
  async function captureFailure(label) {
    try {
      await page.screenshot({ path: join(artifactDir, `${label}.png`), fullPage: true });
      const dump = await page.evaluate(() => ({
        title: document.title,
        bondout: document.querySelector("#bondout")?.innerText ?? null,
        cells: [...document.querySelectorAll("pluto-cell")].map((c) => ({
          id: c.id, classes: c.className,
        })),
        disconnected: document.querySelector("pluto-editor")?.classList.contains("disconnected") ?? null,
        hostHTML: document.querySelector(".ip-host")?.outerHTML?.slice(0, 2000) ?? null,
      }));
      writeFileSync(join(artifactDir, `${label}.json`), JSON.stringify(dump, null, 2));
      console.error(`artifact: wrote ${label}.png / ${label}.json to ${artifactDir}`);
    } catch (e) {
      console.error(`artifact capture failed (${label}):`, e.message);
    }
  }
} catch (e) {
  failed = e;
  if (artifactDir && page) {
    try {
      await page.screenshot({ path: join(artifactDir, "failure.png"), fullPage: true });
      writeFileSync(join(artifactDir, "failure.txt"), String(e?.stack || e));
      console.error(`artifact: wrote failure.png / failure.txt to ${artifactDir}`);
    } catch (e2) {
      console.error("artifact capture failed:", e2.message);
    }
  }
} finally {
  if (browser) await browser.close();
}
if (failed) { console.error("THROUGH-PLUTO E2E FAIL:", failed.message); process.exit(1); }
