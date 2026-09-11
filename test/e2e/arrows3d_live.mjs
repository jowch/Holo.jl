// Live-verify Arrows3D on Cairo or WebGL through Pluto.
//   node arrows3d_live.mjs <base-url> <notebook-abs-path> <evidence-dir>
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const base = process.argv[2];
const notebook = process.argv[3];
const evidence = process.argv[4] || ".";
if (!base || !notebook) {
  console.error("usage: node arrows3d_live.mjs <base-url> <notebook-abs-path> [evidence-dir]");
  process.exit(2);
}
fs.mkdirSync(evidence, { recursive: true });

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.error(`${ok ? "PASS" : "FAIL"} ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

function readMids() {
  // Prefer data-json (survives display:none / innerText quirks); fall back to textContent.
  const el = document.querySelector("#mids");
  if (!el) throw new Error("#mids missing");
  const raw = el.getAttribute("data-json") || el.textContent || "";
  const mids = JSON.parse(raw.trim());
  if (!Array.isArray(mids) || !mids.length) throw new Error(`bad mids: ${raw.slice(0, 120)}`);
  return mids;
}

const browser = await chromium.launch({ headless: true });
let failed = null;
try {
  const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.screenshot({ path: path.join(evidence, "00-open.png"), fullPage: true });

  const deadline = Date.now() + 1500000;
  let ready = false, tick = 0, lastSt = null;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const runBtn = [...document.querySelectorAll("button, a")].find((b) =>
        /run notebook code/i.test(b.innerText || b.title || "")
      );
      if (runBtn) runBtn.click();
      const host = document.querySelector(".ip-host");
      let surface = false;
      if (host) {
        let sr = null;
        host.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot) sr = el.shadowRoot;
        });
        surface = !!(sr && sr.querySelector(".surface"));
      }
      const midEl = document.querySelector("#mids");
      const midRaw = midEl
        ? (midEl.getAttribute("data-json") || midEl.textContent || "").trim()
        : "";
      let midsOk = false;
      try {
        const m = JSON.parse(midRaw);
        midsOk = Array.isArray(m) && m.length > 0 && Array.isArray(m[0]);
      } catch (_) {}
      return {
        nCells: document.querySelectorAll("pluto-cell").length,
        busy: document.querySelectorAll("pluto-cell.running, pluto-cell.queued").length,
        errored: document.querySelectorAll("pluto-cell.errored").length,
        host: !!host,
        surface,
        bondout: !!document.querySelector("#bondout"),
        midsOk,
        midRaw: midRaw.slice(0, 80),
        backend: document.querySelector("#backend")?.textContent?.trim() || "",
        errText: [...document.querySelectorAll("pluto-cell.errored")]
          .map((c) => c.innerText)
          .join(" | ")
          .slice(0, 400),
      };
    });
    lastSt = st;
    if (st.errored) throw new Error(`notebook has ${st.errored} errored cell(s): ${st.errText}`);
    if (!st.busy && st.surface && st.bondout && st.midsOk) {
      ready = true;
      record("notebook-ready", true, { backend: st.backend, cells: st.nCells, midRaw: st.midRaw });
      break;
    }
    if (tick % 30 === 0) console.error(`  …waiting [${tick}s]`, st);
    tick++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error(`timed out waiting for widget; last=${JSON.stringify(lastSt)}`);
  await page.screenshot({ path: path.join(evidence, "01-ready.png") });

  const hover = await page.evaluate(async () => {
    const host = document.querySelector(".ip-host");
    let sr = null;
    host.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) sr = el.shadowRoot;
    });
    const surface = sr.querySelector(".surface");
    const midEl = document.querySelector("#mids");
    const mids = JSON.parse((midEl.getAttribute("data-json") || midEl.textContent || "").trim());
    const [mx, my] = mids[0];
    const media = host.querySelector("img, canvas");
    const b = media.getBoundingClientRect();
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
    const scale = b.width / outW;
    const o = {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: b.x + mx * scale,
      clientY: b.y + my * scale,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    };
    let tipText = "", tipVisible = false;
    for (let a = 0; a < 8; a++) {
      surface.dispatchEvent(new PointerEvent("pointermove", o));
      surface.dispatchEvent(new MouseEvent("mousemove", o));
      await new Promise((r) => setTimeout(r, 200));
      const tip = sr.querySelector(".holo-tip");
      tipText = tip ? (tip.innerText || tip.textContent || "").replace(/\s+/g, " ").trim() : "";
      tipVisible = !!(tip && tipText.length > 0 && getComputedStyle(tip).display !== "none");
      if (tipVisible) break;
    }
    return { tipText, tipVisible, mx, my, scale };
  });
  await page.screenshot({ path: path.join(evidence, "02-hover.png") });
  const tipOk =
    hover.tipVisible &&
    (/index/i.test(hover.tipText) || /\bu\b/i.test(hover.tipText) || /\bx\b/i.test(hover.tipText));
  record("hover-tooltip", tipOk, hover);

  const click = await page.evaluate(async () => {
    const host = document.querySelector(".ip-host");
    let sr = null;
    host.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) sr = el.shadowRoot;
    });
    const surface = sr.querySelector(".surface");
    const midEl = document.querySelector("#mids");
    const mids = JSON.parse((midEl.getAttribute("data-json") || midEl.textContent || "").trim());
    const [mx, my] = mids[0];
    const media = host.querySelector("img, canvas");
    const b = media.getBoundingClientRect();
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
    const scale = b.width / outW;
    const o = {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: b.x + mx * scale,
      clientY: b.y + my * scale,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    };
    const before = document.querySelector("#bondout").textContent;
    let after = before, won = -1;
    retry: for (let attempt = 0; attempt < 3; attempt++) {
      surface.dispatchEvent(new PointerEvent("pointermove", o));
      surface.dispatchEvent(new PointerEvent("pointerdown", o));
      surface.dispatchEvent(new PointerEvent("pointerup", o));
      surface.dispatchEvent(new MouseEvent("click", o));
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 200));
        after = document.querySelector("#bondout")?.textContent ?? before;
        if (after !== before) {
          won = attempt;
          break retry;
        }
      }
    }
    const hi = sr.querySelectorAll("g.hi > *").length;
    return { before, after, attempt: won, hi };
  });
  await page.screenshot({ path: path.join(evidence, "03-click.png") });
  const bondOk =
    click.after !== click.before &&
    /arrows3d/i.test(click.after) &&
    (/\b0\b/.test(click.after) || /index\s*=\s*0/.test(click.after));
  record("click-bind", bondOk, click);

  const interesting = pageErrors.filter(
    (m) => !/ResizeObserver|Bonito\.(decode|fetch)_binary|Incorrect locale/.test(m)
  );
  record("console-clean", interesting.length === 0, interesting);

  await page.screenshot({ path: path.join(evidence, "99-final.png") });
} catch (e) {
  failed = e;
  console.error("LIVE-VERIFY FAIL:", e.message);
} finally {
  await browser.close();
}

const summary = {
  results,
  failed: failed && String(failed.message),
  pass: !failed && results.length > 0 && results.every((r) => r.ok),
};
fs.writeFileSync(path.join(evidence, "results.json"), JSON.stringify(summary, null, 2));
if (!summary.pass) process.exit(1);
console.log("ARROWS3D LIVE-VERIFY OK");
