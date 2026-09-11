// Overlay-chrome smoke (LOCAL — not CI). Wash+ring on one figure. Not sufficient
// live-verify — agents run docs/live-interaction-checklist.md via kind_sweep.mjs.
//
//   node polish_verify.mjs <base-url> <notebook-abs-path> <cairo|webgl>
import { chromium } from "playwright";

const [base, notebook, backend] = process.argv.slice(2);
if (!base || !notebook || !backend) {
  console.error("usage: node polish_verify.mjs <base-url> <notebook> <cairo|webgl>");
  process.exit(2);
}

const INK = "#3A6F7C";
const WASH = "rgba(58, 111, 124, 0.12)";
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
    viewport: { width: 1000, height: 900 },
    deviceScaleFactor: 2, // the DPR that blew host/canvas alignment
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    const shim = SHIM_LEAK.test(e.message);
    const benign = shim && ALLOWED.some((re) => re.test(e.message));
    if (!benign) unexpected.push(e.message);
    console.error(benign ? "PAGEERROR (known-benign):" : "PAGEERROR:", e.message);
  });

  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const deadline = Date.now() + 900000;
  let ready = false, tick = 0;
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
        errored: document.querySelectorAll("pluto-cell.errored").length,
        hosts: hosts.length, surfaces,
        coords: !!document.querySelector("#coords_polish"),
        errText: [...document.querySelectorAll("pluto-cell.errored")].map((c) => c.innerText).slice(0, 1).join(""),
      };
    });
    if (st.errored) throw new Error(`${backend} errored: ${st.errText.slice(0, 400)}`);
    if (!st.busy && st.surfaces >= 1 && st.coords) { ready = true; break; }
    if (tick % 20 === 0) console.error(`  …${backend} [${tick}s] busy=${st.busy} hosts=${st.hosts} surfaces=${st.surfaces}`);
    tick++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error(`${backend} timed out`);

  const hostIdx = await page.evaluate(() => {
    const hosts = [...document.querySelectorAll(".ip-host")];
    return hosts.length - 1;
  });

  const metrics = await page.evaluate((i) => {
    const host = [...document.querySelectorAll(".ip-host")][i];
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const baseEl = host.querySelector("img, canvas");
    const svg = sr.querySelector("svg");
    const hb = host.getBoundingClientRect(), bb = baseEl.getBoundingClientRect(), sb = svg.getBoundingClientRect();
    const kids = [...sr.querySelector("g.sel").children].map((el) => {
      if (el.tagName.toLowerCase() === "g") {
        return {
          kind: "ring",
          lines: [...el.querySelectorAll("line")].map((ln) => ({
            fill: ln.getAttribute("fill"), stroke: ln.getAttribute("stroke"),
            width: ln.getAttribute("stroke-width"), opacity: ln.getAttribute("stroke-opacity"),
          })),
        };
      }
      return {
        kind: "closed", tag: el.tagName.toLowerCase(),
        fill: el.getAttribute("fill"), stroke: el.getAttribute("stroke"),
        width: el.getAttribute("stroke-width"), r: el.getAttribute("r"),
        cx: el.getAttribute("cx"), cy: el.getAttribute("cy"),
      };
    });
    return {
      baseTag: baseEl.tagName.toLowerCase(),
      host: { w: hb.width, h: hb.height },
      base: { w: bb.width, h: bb.height, x: bb.x, y: bb.y },
      svg: { w: sb.width, h: sb.height, x: sb.x, y: sb.y },
      kids,
    };
  }, hostIdx);

  const expectBase = backend === "webgl" ? "canvas" : "img";
  if (metrics.baseTag !== expectBase) throw new Error(`expected ${expectBase}, got ${metrics.baseTag}`);
  passed.push(`base-${metrics.baseTag}`);

  const dx = Math.abs(metrics.svg.x - metrics.base.x);
  const dy = Math.abs(metrics.svg.y - metrics.base.y);
  const dw = Math.abs(metrics.svg.w - metrics.base.w);
  const dh = Math.abs(metrics.svg.h - metrics.base.h);
  if (dx > 1.5 || dy > 1.5 || dw > 2 || dh > 2) {
    throw new Error(`overlay/base offset svg=${JSON.stringify(metrics.svg)} base=${JSON.stringify(metrics.base)}`);
  }
  passed.push("overlay-on-base");

  const wash = metrics.kids.find((k) => k.kind === "closed");
  const ring = metrics.kids.find((k) => k.kind === "ring");
  if (!wash || wash.fill !== WASH || wash.stroke !== INK || wash.width !== "2.5") {
    throw new Error(`wash recipe ${JSON.stringify(wash)}`);
  }
  passed.push("selected-wash");
  if (!ring || ring.lines.length !== 2) throw new Error(`ring ${JSON.stringify(ring)}`);
  const widths = ring.lines.map((l) => l.width).sort().join(",");
  if (widths !== "2,4" || !ring.lines.every((l) => l.fill === "none" && l.stroke === INK)) {
    throw new Error(`ring recipe ${JSON.stringify(ring)}`);
  }
  passed.push("selected-ring");

  const layers = await page.evaluate(() => JSON.parse(document.querySelector("#coords_polish").innerText));
  const pts = layers.find((l) => l.kind === "circles");
  const rGeom = pts.geometry[2];
  if (String(Number(wash.r)) !== String(rGeom + 2)) {
    throw new Error(`halo r=${wash.r} geom r=${rGeom} (want r+2)`);
  }
  passed.push("halo-r+2");

  // unhover: g.sel must remain
  await page.evaluate((i) => {
    const host = [...document.querySelectorAll(".ip-host")][i];
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    sr.querySelector(".surface").dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
  }, hostIdx);
  const afterLeave = await page.evaluate((i) => {
    const host = [...document.querySelectorAll(".ip-host")][i];
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    return {
      sel: sr.querySelector("g.sel")?.children.length ?? 0,
      hi: sr.querySelector("g.hi")?.children.length ?? 0,
    };
  }, hostIdx);
  if (afterLeave.sel < 2) throw new Error(`g.sel dropped on unhover: ${JSON.stringify(afterLeave)}`);
  if (afterLeave.hi !== 0) throw new Error(`g.hi lingered: ${JSON.stringify(afterLeave)}`);
  passed.push("selected-survives-unhover");

  const hx = pts.geometry[3], hy = pts.geometry[4];
  let tip = null;
  for (let a = 0; a < 8; a++) {
    tip = await page.evaluate(([i, ix, iy]) => {
      const host = [...document.querySelectorAll(".ip-host")][i];
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const b = host.querySelector("img, canvas").getBoundingClientRect();
      const outW = sr.querySelector("svg").viewBox.baseVal.width;
      const s = b.width / outW;
      sr.querySelector(".surface").dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true, composed: true, cancelable: true,
        clientX: b.left + ix * s, clientY: b.top + iy * s,
      }));
      const t = sr.querySelector(".holo-tip");
      const hi = sr.querySelector("g.hi")?.firstElementChild;
      return {
        show: t?.classList.contains("show"), text: t?.innerText ?? "",
        hi: hi ? { fill: hi.getAttribute("fill"), width: hi.getAttribute("stroke-width"), opacity: hi.getAttribute("stroke-opacity"), r: hi.getAttribute("r") } : null,
        sel: sr.querySelector("g.sel")?.children.length ?? 0,
      };
    }, [hostIdx, hx, hy]);
    if (tip.show && /beta/i.test(tip.text) && tip.hi) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!tip?.show || !/beta/i.test(tip.text)) throw new Error(`tooltip ${JSON.stringify(tip)}`);
  if (tip.hi.fill !== "none" || tip.hi.width !== "2" || tip.hi.opacity !== "0.85") {
    throw new Error(`hover recipe ${JSON.stringify(tip.hi)}`);
  }
  if (tip.sel < 2) throw new Error("g.sel gone during hover");
  passed.push("tooltip");
  passed.push("hover-distinct");

  if (unexpected.length) throw new Error(`page errors: ${unexpected.join(" | ")}`);
  passed.push("no-console-errors");
  console.log(`POLISH VERIFY OK — ${backend}: ${passed.join(", ")}`);
} catch (e) {
  failed = e;
} finally {
  await browser.close();
}
if (failed) {
  console.error(`POLISH VERIFY FAIL (${backend}, after ${passed.join(", ")}):`, failed.message);
  process.exit(1);
}
