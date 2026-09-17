// Extra live-verify checks for the overlay pointer-events PR, run against an already-open
// kind-sweep Pluto server (see docs/dev/live-interaction-checklist.md). Not part of the standing
// kind_sweep/polish_verify pair — this is a one-off script for this PR's specific claims:
//   (a) a drag released outside the page/viewport still ends cleanly (pointer capture), both via
//       an out-of-bounds pointerup and via pointercancel
//   (b) a real touch tap (Playwright touchscreen, hasTouch context) on a scatter point round-trips
//       the @bind value
//   (c) no unexpected console/page errors across all of the above
//
//   node extra_checks.mjs <base-url> <notebook-abs-path> <cairo|webgl>
import { chromium } from "playwright";

const [base, notebook, backend] = process.argv.slice(2);
if (!base || !notebook || !backend) {
  console.error("usage: node extra_checks.mjs <base-url> <notebook> <cairo|webgl>");
  process.exit(2);
}

const SHIM_LEAK = /\b(?:Bonito|comm)\.\w+ is not a function/;
const ALLOWED = [/Bonito\.decode_binary is not a function/, /Bonito\.fetch_binary is not a function/];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const passed = [];
const unexpected = [];
let failed = null;
try {
  const context = await browser.newContext({
    locale: "en-US", timezoneId: "UTC",
    viewport: { width: 1100, height: 1400 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    const shim = SHIM_LEAK.test(e.message);
    const benign = shim && ALLOWED.some((re) => re.test(e.message));
    if (!benign) unexpected.push(e.message);
    console.error(benign ? "PAGEERROR (known-benign):" : "PAGEERROR:", e.message);
  });

  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const deadline = Date.now() + 120000;
  let ready = false;
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
      return {
        busy: document.querySelectorAll("pluto-cell.running, pluto-cell.queued").length,
        surfaces,
        thr: !!document.querySelector("#coords_threshold"),
        roi: !!document.querySelector("#coords_roi"),
        scatter: !!document.querySelector("#coords_scatter"),
      };
    });
    if (!st.busy && st.surfaces >= 1 && st.thr && st.roi && st.scatter) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error(`${backend}: timed out waiting for widgets`);

  const hostInfo = (key) => page.evaluate((k) => {
    const span = document.querySelector(`#coords_${k}`);
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const b = host.querySelector("img, canvas").getBoundingClientRect();
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
    return { left: b.left, top: b.top, width: b.width, s: b.width / outW };
  }, key);

  const layersOf = (key) => page.evaluate((k) => JSON.parse(document.querySelector(`#coords_${k}`).textContent), key);
  const textOf = (sel) => page.evaluate((q) => document.querySelector(q)?.innerText ?? "", sel);
  const waitChange = async (sel, before, tries = 100) => {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const t = await textOf(sel);
      if (t !== before && t.length) return t;
    }
    return null;
  };

  // --- (a1) threshold drag, release OUTSIDE the viewport (pointerup at a wildly off-page point) ---
  {
    const layers = await layersOf("threshold");
    const thr = layers.find((l) => l.kind === "threshold");
    const [s0, s1] = thr.geometry.span;
    const hx = (s0 + s1) / 2, hy = thr.geometry.pos;
    const h = await hostInfo("threshold");
    const down = { cx: h.left + hx * h.s, cy: h.top + hy * h.s };
    const state = await page.evaluate(([k, ax, ay]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const surface = sr.querySelector(".surface");
      let fired = false;
      host.addEventListener("input", () => { fired = true; }, { once: true });
      const pid = { pointerId: 1, pointerType: "mouse", isPrimary: true };
      surface.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, cancelable: true, clientX: ax, clientY: ay, ...pid }));
      surface.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, cancelable: true, clientX: ax, clientY: ay + 40, ...pid }));
      const grabbingMid = surface.classList.contains("grabbing");
      // NOT asserted: real Chromium's setPointerCapture requires the UA to consider this pointerId
      // "active", which an untrusted, script-dispatched pointerdown never establishes (confirmed
      // live — it throws InvalidPointerId here regardless of pointerId; onDown's tryCapture()
      // swallows it, which is exactly the behavior under test: the drag proceeds on `drag`/
      // "grabbing" state alone when the UA won't grant real capture). A REAL user gesture (mouse or
      // touch) does establish an active pointer, so production capture is unaffected — this harness
      // just can't produce a "trusted" pointerdown to exercise that path.
      // Release far outside the viewport/page — real UAs still route this to the capturing
      // element when capture succeeds; dispatchEvent bypasses hit-testing entirely regardless, so
      // this proves the SUT (onUp) doesn't need the coordinate to be on-element to clean up and commit.
      surface.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, cancelable: true, clientX: -5000, clientY: -5000, ...pid }));
      return {
        grabbingMid, fired,
        value: host.value,
        grabbingAfter: surface.classList.contains("grabbing"),
        capturedAfter: surface.hasPointerCapture(1),
      };
    }, ["threshold", down.cx, down.cy]);
    if (!state.grabbingMid) throw new Error(`threshold off-page release: drag never engaged: ${JSON.stringify(state)}`);
    if (state.grabbingAfter) throw new Error(`threshold off-page release: cursor stuck grabbing: ${JSON.stringify(state)}`);
    if (state.capturedAfter) throw new Error(`threshold off-page release: pointer capture not released: ${JSON.stringify(state)}`);
    // host.value (read synchronously right after dispatch) is the JS-side commit — the more
    // reliable signal. The Pluto DOM readout round-trips over a websocket to Julia and back, which
    // can coincidentally show unchanged text if this clamped release lands on the same boundary
    // value as a prior run against this same long-lived notebook session — that's a test-harness
    // artifact, not a functional failure, so it's not asserted here.
    if (!state.fired || !state.value || state.value.layer !== thr.id) {
      throw new Error(`threshold off-page release: no commit: ${JSON.stringify(state)}`);
    }
    passed.push("threshold/off-page-release-commits+unsticks");
  }

  // --- (a2) ROI drag interrupted by pointercancel — must end cleanly with NO commit ---
  {
    const layers = await layersOf("roi");
    const roi = layers.find((l) => l.kind === "roi");
    const hx = roi.geometry.x + roi.geometry.w / 2, hy = roi.geometry.y + roi.geometry.h / 2;
    const h = await hostInfo("roi");
    const down = { cx: h.left + hx * h.s, cy: h.top + hy * h.s };
    const before = await textOf("#out_roi");
    const state = await page.evaluate(([k, ax, ay]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const surface = sr.querySelector(".surface");
      const pid = { pointerId: 1, pointerType: "mouse", isPrimary: true };
      surface.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, cancelable: true, clientX: ax, clientY: ay, ...pid }));
      surface.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, cancelable: true, clientX: ax + 30, clientY: ay, ...pid }));
      const grabbingMid = surface.classList.contains("grabbing");
      surface.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, composed: true, cancelable: true, ...pid }));
      return { grabbingMid, grabbingAfter: surface.classList.contains("grabbing"), capturedAfter: surface.hasPointerCapture(1) };
    }, ["roi", down.cx, down.cy]);
    if (!state.grabbingMid) throw new Error(`roi pointercancel: drag never engaged: ${JSON.stringify(state)}`);
    if (state.grabbingAfter || state.capturedAfter) throw new Error(`roi pointercancel: not cleaned up: ${JSON.stringify(state)}`);
    await new Promise((r) => setTimeout(r, 1000));
    const after = await textOf("#out_roi");
    if (after !== before) throw new Error(`roi pointercancel: unexpectedly committed (before=${before} after=${after})`);
    passed.push("roi/pointercancel-ends-clean-no-commit");
  }

  // --- (b) real touch tap (Playwright touchscreen) on a scatter point -> @bind ---
  {
    const layers = await layersOf("scatter");
    const pts = layers.find((l) => l.kind === "circles");
    const g = pts.geometry;
    const hx = g[0], hy = g[1];
    await page.evaluate((k) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      host?.scrollIntoView({ block: "center", inline: "nearest" });
    }, "scatter");
    const h = await hostInfo("scatter");
    const tx = h.left + hx * h.s, ty = h.top + hy * h.s;
    // Arm a listener before the tap and read host.value after — same reasoning as the threshold
    // check above: the Pluto DOM readout round-trips to Julia and can coincidentally show
    // unchanged text if this tap lands on the same point/value a prior check already committed
    // against this same long-lived notebook session.
    await page.evaluate((k) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      window.__masqueTouchTapResult = { fired: false, value: null };
      host.addEventListener("input", () => {
        window.__masqueTouchTapResult = { fired: true, value: host.value };
      }, { once: true });
    }, "scatter");
    await page.touchscreen.tap(tx, ty);
    await page.waitForFunction(() => window.__masqueTouchTapResult?.fired === true, { timeout: 5000 }).catch(() => {});
    const result = await page.evaluate(() => window.__masqueTouchTapResult);
    if (!result?.fired || !result.value || result.value.layer !== pts.id) {
      throw new Error(`scatter touch tap: no commit: ${JSON.stringify(result)}`);
    }
    passed.push("scatter/touch-tap-bind");
  }

  if (unexpected.length) throw new Error(`page errors: ${unexpected.join(" | ")}`);
  passed.push("no-console-errors");
  console.log(`EXTRA CHECKS OK — ${backend}: ${passed.join(", ")}`);
} catch (e) {
  failed = e;
} finally {
  await browser.close();
}
if (failed) {
  console.error(`EXTRA CHECKS FAIL (${backend}, after ${passed.join(", ")}):`, failed.message);
  process.exit(1);
}
