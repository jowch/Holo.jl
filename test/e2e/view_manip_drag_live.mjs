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
      const errored = [...document.querySelectorAll("pluto-cell.errored, .errored")].filter((e) =>
        /Cyclic reference/i.test(e.innerText || "")
      ).length;
      const pan = document.querySelector("#panout")?.textContent || "";
      const orb = document.querySelector("#orbout")?.textContent || "";
      return { hosts, running, errored, pan, orb };
    });
    if (tick % 10 === 0) console.error("wait", st);
    // Don't abort on transient cycle errors from a stale notebook session — wait for
    // a clean ready state (hosts + readouts, zero cyclic errors, idle).
    if (st.hosts >= 2 && st.running === 0 && st.errored === 0 && /lims=/.test(st.pan) && /cam=/.test(st.orb)) {
      ready = true;
      break;
    }
    if (st.errored > 0 && st.running === 0 && tick > 5) {
      failed = `notebook errored cells=${st.errored}`;
    }
    await page.waitForTimeout(3000);
    tick++;
  }
  record("notebook-ready", ready, ready ? "hosts+panout+orbout" : failed || "timeout");
  if (!ready) throw new Error(failed || "notebook not ready");

  await page.screenshot({ path: path.join(evidence, "01-ready.png"), fullPage: true });

  async function hostNear(sel) {
    return page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return -1;
      const hosts = [...document.querySelectorAll(".ip-host")];
      let best = -1, bestDist = Infinity;
      const er = el.getBoundingClientRect();
      for (let i = 0; i < hosts.length; i++) {
        const hr = hosts[i].getBoundingClientRect();
        const dy = Math.abs(hr.bottom - er.top);
        const dx = Math.abs(hr.left - er.left);
        const d = dy + dx * 0.01;
        if (d < bestDist) { bestDist = d; best = i; }
      }
      // Prefer the host *above* the readout (drag surface), not the committed view below.
      // Walk hosts whose bottom is above the readout top.
      let above = -1, aboveDist = Infinity;
      for (let i = 0; i < hosts.length; i++) {
        const hr = hosts[i].getBoundingClientRect();
        if (hr.bottom <= er.top + 8) {
          const d = er.top - hr.bottom;
          if (d < aboveDist) { aboveDist = d; above = i; }
        }
      }
      return above >= 0 ? above : best;
    }, sel);
  }

  async function dragHost(idx, dxCss, dyCss) {
    const ok = await page.evaluate(([i, dx, dy]) => {
      const host = [...document.querySelectorAll(".ip-host")][i];
      if (!host) return false;
      let sr = null;
      host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const surface = sr?.querySelector(".surface");
      const media = host.querySelector("img, canvas");
      if (!surface || !media) return false;
      const b = media.getBoundingClientRect();
      const ax = b.x + b.width * 0.45, ay = b.y + b.height * 0.55;
      const bx = ax + dx, by = ay + dy;
      surface.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, cancelable: true, clientX: ax, clientY: ay }));
      for (let t = 0.25; t <= 1.0; t += 0.25) {
        window.dispatchEvent(new MouseEvent("mousemove", {
          bubbles: true, cancelable: true,
          clientX: ax + (bx - ax) * t, clientY: ay + (by - ay) * t,
        }));
      }
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: bx, clientY: by }));
      return true;
    }, [idx, dxCss, dyCss]);
    if (!ok) throw new Error(`dragHost(${idx}) failed — no surface`);
  }

  async function waitChange(sel, before, label, ms = 120000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const now = await page.locator(sel).innerText();
      if (now !== before) return now;
      await page.waitForTimeout(500);
    }
    throw new Error(`${label}: no change from ${JSON.stringify(before)}`);
  }

  // --- pan (drag surface above #panout) ---
  const panIdx = await hostNear("#panout");
  record("pan-host-index", panIdx >= 0, { panIdx });
  const panBefore = await page.locator("#panout").innerText();
  await dragHost(panIdx, 80, 0);
  const panAfter = await waitChange("#panout", panBefore, "pan-drag");
  const panOk = /:view/.test(panAfter) || /InteractionEvent/.test(panAfter);
  record("drag-pan-bind", panOk, panAfter.slice(0, 160));
  await page.locator(".ip-host").nth(panIdx).screenshot({ path: path.join(evidence, "02-after-pan.png") });

  // --- orbit ---
  const orbIdx = await hostNear("#orbout");
  record("orbit-host-index", orbIdx >= 0, { orbIdx });
  const orbBefore = await page.locator("#orbout").innerText();
  await dragHost(orbIdx, 100, 40);
  const orbAfter = await waitChange("#orbout", orbBefore, "orbit-drag");
  const orbOk = /:view/.test(orbAfter) || /InteractionEvent/.test(orbAfter);
  record("drag-orbit-bind", orbOk, orbAfter.slice(0, 160));
  await page.locator(".ip-host").nth(orbIdx).screenshot({ path: path.join(evidence, "03-after-orbit.png") });

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
