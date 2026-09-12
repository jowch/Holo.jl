// Overlay visual-fidelity driver (LOCAL — not CI). Required by
// docs/live-interaction-checklist.md together with kind_sweep.mjs.
// Runs on the kind-sweep notebooks. Asserts wash/ring/halo/overlay-pin,
// remount fade / no pulse, steel-teal (not #ff3b30), and Pluto/OS
// prefers-color-scheme (official Pluto has no notebook toggle).
//
//   node polish_verify.mjs <base-url> <notebook-abs-path> <cairo|webgl>
import { chromium } from "playwright";
import {
  assertNoAlertRed, assertWash, assertRing, assertHoverRecipe,
  assertRemountStable, assertLeaveFade, assertTooltipColorScheme,
} from "./visual_assert.mjs";

const [base, notebook, backend] = process.argv.slice(2);
if (!base || !notebook || !backend) {
  console.error("usage: node polish_verify.mjs <base-url> <notebook> <cairo|webgl>");
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
    viewport: { width: 1000, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
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
        scatter: !!document.querySelector("#coords_scatter"),
        lines: !!document.querySelector("#coords_lines"),
        dark: !!document.querySelector("#coords_scatter_dark"),
        errText: [...document.querySelectorAll("pluto-cell.errored")].map((c) => c.innerText).slice(0, 1).join(""),
      };
    });
    if (st.errored) throw new Error(`${backend} errored: ${st.errText.slice(0, 400)}`);
    if (!st.busy && st.surfaces >= 2 && st.scatter && st.lines) { ready = true; break; }
    if (tick % 20 === 0) console.error(`  …${backend} [${tick}s] busy=${st.busy} hosts=${st.hosts} surfaces=${st.surfaces}`);
    tick++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error(`${backend} timed out`);

  const inspect = (key) => page.evaluate((k) => {
    const span = document.querySelector(`#coords_${k}`);
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const baseEl = host.querySelector("img, canvas");
    const svg = sr.querySelector("svg");
    const hb = host.getBoundingClientRect(), bb = baseEl.getBoundingClientRect(), sb = svg.getBoundingClientRect();
    const kids = [...(sr.querySelector("g.sel")?.children ?? [])].map((el) => {
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
      css: sr.querySelector("style")?.textContent || "",
    };
  }, key);

  const layersOf = (key) => page.evaluate((k) => JSON.parse(document.querySelector(`#coords_${k}`).innerText), key);

  const hoverAt = (key, x, y) => page.evaluate(([k, ix, iy]) => {
    const span = document.querySelector(`#coords_${k}`);
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
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
    const cs = t ? getComputedStyle(t) : null;
    return {
      show: t?.classList.contains("show"), text: t?.innerText ?? "",
      bg: cs?.backgroundColor, color: cs?.color,
      hi: hi ? {
        fill: hi.getAttribute("fill"), stroke: hi.getAttribute("stroke"),
        width: hi.getAttribute("stroke-width"), opacity: hi.getAttribute("stroke-opacity"),
        r: hi.getAttribute("r"), enter: hi.classList.contains("holo-enter"),
      } : null,
      sel: sr.querySelector("g.sel")?.children.length ?? 0,
    };
  }, [key, x, y]);

  const expectBase = backend === "webgl" ? "canvas" : "img";
  const pin = (m, key) => {
    if (m.baseTag !== expectBase) throw new Error(`${key}: expected ${expectBase}, got ${m.baseTag}`);
    const dx = Math.abs(m.svg.x - m.base.x), dy = Math.abs(m.svg.y - m.base.y);
    const dw = Math.abs(m.svg.w - m.base.w), dh = Math.abs(m.svg.h - m.base.h);
    if (dx > 1.5 || dy > 1.5 || dw > 2 || dh > 2) {
      throw new Error(`${key}: overlay/base offset svg=${JSON.stringify(m.svg)} base=${JSON.stringify(m.base)}`);
    }
  };

  const scatter = await inspect("scatter");
  pin(scatter, "scatter");
  passed.push(`base-${scatter.baseTag}`);
  passed.push("overlay-on-base");
  assertNoAlertRed(scatter.css, "overlay-css");
  assertNoAlertRed(scatter.kids, "scatter/sel");

  const wash = scatter.kids.find((k) => k.kind === "closed");
  assertWash(wash, "scatter");
  passed.push("selected-wash");

  const pts = (await layersOf("scatter")).find((l) => l.kind === "circles");
  const rGeom = pts.geometry[5]; // selectedIndex 1 → r at 3*1+2
  if (String(Number(wash.r)) !== String(rGeom + 2)) {
    throw new Error(`halo r=${wash.r} geom r=${rGeom} (want r+2)`);
  }
  passed.push("halo-r+2");

  const lines = await inspect("lines");
  pin(lines, "lines");
  const ring = lines.kids.find((k) => k.kind === "ring");
  assertRing(ring, "lines");
  passed.push("selected-ring");

  const darkReady = await page.evaluate(() => !!document.querySelector("#coords_scatter_dark"));
  if (darkReady) {
    const dark = await inspect("scatter_dark");
    pin(dark, "scatter_dark");
    const dwash = dark.kids.find((k) => k.kind === "closed");
    assertWash(dwash, "scatter_dark");
    assertNoAlertRed(dark.kids, "scatter_dark");
    passed.push("dark-figure-wash");
  }

  const hx = pts.geometry[3], hy = pts.geometry[4];
  let tip = null;
  for (let a = 0; a < 8; a++) {
    tip = await hoverAt("scatter", hx, hy);
    if (tip.show && /beta/i.test(tip.text) && tip.hi) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!tip?.show || !/beta/i.test(tip.text)) throw new Error(`tooltip ${JSON.stringify(tip)}`);
  assertHoverRecipe(tip.hi, "scatter");
  if (tip.sel < 1) throw new Error("g.sel gone during hover");
  passed.push("tooltip");
  passed.push("hover-distinct");

  const hiStable = await page.evaluate(([ix, iy]) => {
    const span = document.querySelector("#coords_scatter");
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const first = sr.querySelector("g.hi")?.firstElementChild;
    if (!first) return { ok: false, reason: "no hover node", firstEnter: false };
    const b = host.querySelector("img, canvas").getBoundingClientRect();
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
    const s = b.width / outW;
    const o = { bubbles: true, composed: true, cancelable: true, clientX: b.left + ix * s, clientY: b.top + iy * s };
    sr.querySelector(".surface").dispatchEvent(new MouseEvent("mousemove", o));
    const second = sr.querySelector("g.hi")?.firstElementChild;
    return {
      ok: first === second,
      reason: first === second ? "" : "hover remounted",
      firstEnter: first.classList.contains("holo-enter"),
    };
  }, [hx, hy]);
  assertRemountStable(hiStable, "scatter");
  passed.push("no-pulse");

  const fade = await page.evaluate(() => {
    const span = document.querySelector("#coords_scatter");
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    sr.querySelector(".surface").dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    const hi = sr.querySelector("g.hi")?.firstElementChild;
    return {
      hi: sr.querySelector("g.hi")?.children.length ?? 0,
      leaving: !!(hi && hi.classList.contains("holo-leave")),
      sel: sr.querySelector("g.sel")?.children.length ?? 0,
    };
  });
  assertLeaveFade(fade, "scatter");
  if (fade.sel < 1) throw new Error(`g.sel dropped on unhover: ${JSON.stringify(fade)}`);
  passed.push("remount-fade");
  passed.push("selected-survives-unhover");

  await assertTooltipColorScheme(page, {
    css: () => inspect("scatter").then((m) => m.css),
    computed: async () => {
      const t = await hoverAt("scatter", hx, hy);
      return { bg: t.bg, color: t.color };
    },
  });
  passed.push("prefers-color-scheme");

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
