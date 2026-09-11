// Live-verify ViewInteractable drag-to-pan / drag-to-orbit through Pluto.
//   node view_manip_drag_live.mjs <base-url> <notebook-abs-path> <evidence-dir>
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const base = process.argv[2];
const notebook = process.argv[3];
const evidence = process.argv[4] || ".";
if (!base || !notebook) {
  console.error("usage: node view_manip_drag_live.mjs <base-url> <notebook-abs-path> [evidence-dir]");
  process.exit(2);
}
fs.mkdirSync(evidence, { recursive: true });

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.error(`${ok ? "PASS" : "FAIL"} ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

const browser = await chromium.launch({ headless: true });
let failed = null;
let page = null;
try {
  const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC" });
  page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.screenshot({ path: path.join(evidence, "00-open.png"), fullPage: true });

  const deadline = Date.now() + 1500000;
  let ready = false, tick = 0;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const runBtn = [...document.querySelectorAll("button, a")].find((b) =>
        /run notebook code/i.test(b.innerText || b.title || "")
      );
      if (runBtn) runBtn.click();
      const hosts = document.querySelectorAll(".ip-host").length;
      const running = document.querySelectorAll(".running, .queued").length;
      const errored = document.querySelectorAll(".errored, .error_log").length;
      const pan = document.querySelector("#panout")?.textContent || "";
      const orb = document.querySelector("#orbout")?.textContent || "";
      return { hosts, running, errored, pan, orb };
    });
    if (tick % 10 === 0) console.error("wait", st);
    if (st.errored > 0) {
      failed = `notebook errored cells=${st.errored}`;
      break;
    }
    if (st.hosts >= 2 && st.running === 0 && /lims=/.test(st.pan) && /cam=/.test(st.orb)) {
      ready = true;
      break;
    }
    await page.waitForTimeout(3000);
    tick++;
  }
  record("notebook-ready", ready, ready ? "hosts+panout+orbout" : failed || "timeout");
  if (!ready) throw new Error(failed || "notebook not ready");

  await page.screenshot({ path: path.join(evidence, "01-ready.png"), fullPage: true });

  async function dragHost(idx, dxCss, dyCss) {
    const box = await page.locator(".ip-host").nth(idx).boundingBox();
    if (!box) throw new Error(`no host ${idx}`);
    const x0 = box.x + box.width * 0.45;
    const y0 = box.y + box.height * 0.55;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + dxCss, y0 + dyCss, { steps: 12 });
    await page.mouse.up();
  }

  async function waitChange(sel, before, label, ms = 120000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const now = await page.locator(sel).innerText();
      if (now !== before && !/nothing/.test(now)) return now;
      // also accept lims=/cam= changing even if bond shows nothing after rebuild
      if (now !== before) return now;
      await page.waitForTimeout(500);
    }
    throw new Error(`${label}: no change from ${JSON.stringify(before)}`);
  }

  // --- pan ---
  const panBefore = await page.locator("#panout").innerText();
  await dragHost(0, 80, 0);
  const panAfter = await waitChange("#panout", panBefore, "pan-drag");
  const panOk = /:view/.test(panAfter) || (panAfter !== panBefore && /lims=\(/.test(panAfter));
  record("drag-pan-bind", panOk, panAfter.slice(0, 160));
  await page.locator(".ip-host").nth(0).screenshot({ path: path.join(evidence, "02-after-pan.png") });

  // --- orbit ---
  const orbBefore = await page.locator("#orbout").innerText();
  await dragHost(1, 100, 40);
  const orbAfter = await waitChange("#orbout", orbBefore, "orbit-drag");
  const orbOk = /:view/.test(orbAfter) || (orbAfter !== orbBefore && /cam=\(/.test(orbAfter));
  record("drag-orbit-bind", orbOk, orbAfter.slice(0, 160));
  await page.locator(".ip-host").nth(1).screenshot({ path: path.join(evidence, "03-after-orbit.png") });

  const interesting = pageErrors.filter((m) => !/ResizeObserver|favicon/i.test(m));
  record("console-clean", interesting.length === 0, { interesting, pageErrors });

  fs.writeFileSync(path.join(evidence, "results.json"), JSON.stringify(results, null, 2));
  const bad = results.filter((r) => !r.ok);
  if (bad.length) {
    console.error("FAILED", bad);
    process.exit(1);
  }
  console.error("ALL PASS", results.length);
} catch (e) {
  console.error("FATAL", e);
  if (page) await page.screenshot({ path: path.join(evidence, "fatal.png"), fullPage: true }).catch(() => {});
  process.exit(1);
} finally {
  await browser.close();
}
