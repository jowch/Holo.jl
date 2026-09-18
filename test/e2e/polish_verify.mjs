// Overlay visual-fidelity driver (LOCAL — not CI). Required by
// docs/dev/live-interaction-checklist.md together with kind_sweep.mjs.
// Runs on the kind-sweep notebooks. Asserts wash/ring/hover (tint + flush stroke)/overlay-pin,
// remount fade / no pulse, mark-derived (not fixed steel-teal, not #ff3b30) ink, a Cairo-only
// flush-radius pixel check, and Pluto/OS prefers-color-scheme (official Pluto has no notebook
// toggle).
//
//   node polish_verify.mjs <base-url> <notebook-abs-path> <cairo|webgl> [artifact-dir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNoAlertRed, assertNoTeal, assertWash, assertRing, assertHoverRecipe, assertCircleR,
  assertRemountStable, assertLeaveFade, assertTooltipColorScheme, assertCaretAtAnchor,
  assertMarkDerivedInk, colorLightness,
} from "./visual_assert.mjs";

const [base, notebook, backend, artifactDirArg] = process.argv.slice(2);
if (!base || !notebook || !backend) {
  console.error("usage: node polish_verify.mjs <base-url> <notebook> <cairo|webgl> [artifact-dir]");
  process.exit(2);
}
const artifactDir = artifactDirArg || process.env.E2E_ARTIFACT_DIR || null;
if (artifactDir) mkdirSync(artifactDir, { recursive: true });
const consoleLog = [];

const SHIM_LEAK = /\b(?:Bonito|comm)\.\w+ is not a function/;
const ALLOWED = [/Bonito\.decode_binary is not a function/, /Bonito\.fetch_binary is not a function/];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const passed = [];
const unexpected = [];
let failed = null;
let context, page;
try {
  context = await browser.newContext({
    locale: "en-US", timezoneId: "UTC",
    viewport: { width: 1000, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  page = await context.newPage();
  page.on("pageerror", (e) => {
    const shim = SHIM_LEAK.test(e.message);
    const benign = shim && ALLOWED.some((re) => re.test(e.message));
    if (!benign) unexpected.push(e.message);
    console.error(benign ? "PAGEERROR (known-benign):" : "PAGEERROR:", e.message);
  });
  // See kind_sweep.mjs: on :webgl, WGLMakie/Bonito canvas-context churn can outlast Pluto's
  // own cell-busy signal and wipe a host's overlay group mid-check. Require a quiet window.
  let lastWglChurnAt = 0;
  const WGL_CHURN_RE = /removing WGL context/;
  const WGL_QUIET_MS = 3000;
  page.on("console", (m) => {
    const text = m.text();
    consoleLog.push(`[${m.type()}] ${text}`);
    if (WGL_CHURN_RE.test(text)) lastWglChurnAt = Date.now();
  });

  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const deadline = Date.now() + 900000;
  let ready = false, tick = 0;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      // See kind_sweep.mjs: click the safe-preview banner exactly once — a repeated click on
      // an already-running notebook re-triggers Pluto's reactive run and can interrupt the
      // in-flight cell (InterruptException) under slow/contended first-open precompilation.
      const runBtn = [...document.querySelectorAll("button, a")].find((b) => /run notebook code/i.test(b.innerText || b.title || ""));
      if (runBtn && !window.__masqueClickedRun) { runBtn.click(); window.__masqueClickedRun = true; }
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
    const wglQuiet = !lastWglChurnAt || (Date.now() - lastWglChurnAt) > WGL_QUIET_MS;
    if (!st.busy && st.surfaces >= 3 && st.scatter && st.lines && st.dark && wglQuiet) { ready = true; break; }
    if (tick % 20 === 0) console.error(`  …${backend} [${tick}s] busy=${st.busy} hosts=${st.hosts} surfaces=${st.surfaces} wglQuiet=${wglQuiet}`);
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
          lines: [...el.querySelectorAll("line")].map((ln) => {
            const cs = getComputedStyle(ln);
            return {
              className: ln.getAttribute("class"), stroke: cs.stroke, fill: cs.fill, fillOpacity: cs.fillOpacity,
              width: ln.getAttribute("stroke-width"), opacity: ln.getAttribute("stroke-opacity"),
            };
          }),
        };
      }
      const cs = getComputedStyle(el);
      return {
        kind: "closed", tag: el.tagName.toLowerCase(),
        className: el.getAttribute("class"), stroke: cs.stroke, fill: cs.fill, fillOpacity: cs.fillOpacity,
        width: el.getAttribute("stroke-width"), r: el.getAttribute("r"),
        cx: el.getAttribute("cx"), cy: el.getAttribute("cy"),
        mark: el.style.getPropertyValue("--masque-mark"),
      };
    });
    return {
      baseTag: baseEl.tagName.toLowerCase(),
      host: { w: hb.width, h: hb.height },
      base: { w: bb.width, h: bb.height, x: bb.x, y: bb.y },
      svg: { w: sb.width, h: sb.height, x: sb.x, y: sb.y },
      kids,
      css: sr.querySelector("style")?.textContent || "",
      hi: sr.querySelector("g.hi")?.children.length ?? 0,
      sel: sr.querySelector("g.sel")?.children.length ?? 0,
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
    sr.querySelector(".surface").dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, composed: true, cancelable: true,
      clientX: b.left + ix * s, clientY: b.top + iy * s,
      pointerId: 1, pointerType: "mouse", isPrimary: true,
    }));
    const t = sr.querySelector(".masque-tip");
    const hi = sr.querySelector("g.hi")?.firstElementChild;
    const cs = t ? getComputedStyle(t) : null;
    const hiCs = hi ? getComputedStyle(hi) : null;
    return {
      show: t?.classList.contains("show"), text: t?.innerText ?? "",
      bg: cs?.backgroundColor, color: cs?.color,
      hi: hi ? {
        className: hi.getAttribute("class"),
        fill: hiCs.fill, stroke: hiCs.stroke, fillOpacity: hiCs.fillOpacity,
        width: hi.getAttribute("stroke-width"), opacity: hi.getAttribute("stroke-opacity"),
        r: hi.getAttribute("r"), enter: hi.classList.contains("masque-enter"),
        mark: hi.style.getPropertyValue("--masque-mark"),
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
  assertNoTeal(scatter.css, "overlay-css");
  assertNoTeal(scatter.kids, "scatter/sel");

  const wash = scatter.kids.find((k) => k.kind === "closed");
  assertWash(wash, "scatter");
  passed.push("selected-wash");

  const pts = (await layersOf("scatter")).find((l) => l.kind === "circles");
  // `rGeom` is whatever geometry the manifest shipped, not a fixed literal — the scatter
  // notebook's markersize=22 built from the Scatter plot object, so this is the marker's drawn
  // radius, ≈0.3525·22·2 (px_per_unit) ≈ 15.5 image px, not the old markersize/2.
  const rGeom = pts.geometry[5]; // selectedIndex 1 → r at 3*1+2
  assertCircleR(wash.r, rGeom, "scatter/selected");
  passed.push("circle-r");

  // Flush-radius pixel test (Cairo only — the base is an <img>; a WGL <canvas> readback isn't
  // reliable across GPU/driver combos, so this only proves the recipe where it can be proven).
  // Confirms the highlight `r` sits ON the marker's drawn edge, not offset from it: sample the
  // rendered marker (not the SVG overlay — the highlight is unhit/unhovered here) at r+3 (just
  // outside) and r-3 (just inside) along +x from its centre. r+3 must read as the figure
  // background (near-white — the scatter notebook uses the default white Figure background);
  // r-3 must read as the marker's own (non-background) colour.
  if (backend === "cairo") {
    const scx = pts.geometry[3], scy = pts.geometry[4]; // element 1 ("beta"), same point as hx/hy below
    const flush = await page.evaluate(([k, cx, cy, r]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      const img = host.querySelector("img");
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const sample = (x, y) => {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      };
      return { outside: sample(cx + r + 3, cy), inside: sample(cx + r - 3, cy) };
    }, ["scatter", scx, scy, Number(rGeom)]);
    const isBg = (p) => p.r > 240 && p.g > 240 && p.b > 240;
    if (!isBg(flush.outside)) {
      throw new Error(`scatter/flush-radius: pixel at r+3 not figure background ${JSON.stringify(flush.outside)}`);
    }
    if (isBg(flush.inside)) {
      throw new Error(`scatter/flush-radius: pixel at r-3 is background — marker not flush with r ${JSON.stringify(flush.inside)}`);
    }
    passed.push("flush-radius");
  } else {
    passed.push("flush-radius-skipped-webgl"); // canvas readback of a WGL <canvas> isn't reliable
  }

  const lines = await inspect("lines");
  pin(lines, "lines");
  const ring = lines.kids.find((k) => k.kind === "ring");
  assertRing(ring, "lines");
  passed.push("selected-ring");

  const dark = await inspect("scatter_dark");
  pin(dark, "scatter_dark");
  const dwash = dark.kids.find((k) => k.kind === "closed");
  assertWash(dwash, "scatter_dark");
  assertNoAlertRed(dark.kids, "scatter_dark");
  assertNoTeal(dark.kids, "scatter_dark");
  passed.push("dark-figure-wash");

  const hx = pts.geometry[3], hy = pts.geometry[4];
  let tip = null;
  for (let a = 0; a < 8; a++) {
    tip = await hoverAt("scatter", hx, hy);
    if (tip.show && /beta/i.test(tip.text) && tip.hi) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!tip?.show || !/beta/i.test(tip.text)) throw new Error(`tooltip ${JSON.stringify(tip)}`);
  assertHoverRecipe(tip.hi, "scatter", true); // scatter is a closed (circle) mark: tint + stroke
  if (tip.sel < 1) throw new Error("g.sel gone during hover");
  passed.push("tooltip");
  passed.push("hover-distinct");

  // Caret apex vs. anchor: a real-layout check (calc()/border-box math no jsdom/happy-dom unit
  // test can do) that the "caret on the anchor" contract actually holds on screen, not just that
  // --masque-caret-x was assigned some value. hx/hy is element 1's circle centre, i.e. exactly its
  // anchor (anchorFor's circle case) — so the anchor's page-space x is the same b.left+hx*s the
  // hover itself was dispatched at.
  const caret = await page.evaluate(([ix]) => {
    const span = document.querySelector("#coords_scatter");
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const b = host.querySelector("img, canvas").getBoundingClientRect();
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
    const s = b.width / outW;
    const t = sr.querySelector(".masque-tip");
    const tipRect = t.getBoundingClientRect();
    const tipBorderLeft = parseFloat(getComputedStyle(t).borderLeftWidth);
    const before = getComputedStyle(t, "::before");
    const pseudoLeft = parseFloat(before.left);
    const pseudoBorderLeft = parseFloat(before.borderLeftWidth);
    const apexX = tipRect.left + tipBorderLeft + pseudoLeft + pseudoBorderLeft;
    return { apexX, anchorX: b.left + ix * s };
  }, [hx]);
  assertCaretAtAnchor(caret.apexX, caret.anchorX, "scatter/caret");
  passed.push("caret-at-anchor");

  const hiStable = await page.evaluate(([ix, iy]) => {
    const span = document.querySelector("#coords_scatter");
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const b = host.querySelector("img, canvas").getBoundingClientRect();
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
    const s = b.width / outW;
    const o = {
      bubbles: true, composed: true, cancelable: true, clientX: b.left + ix * s, clientY: b.top + iy * s,
      pointerId: 1, pointerType: "mouse", isPrimary: true,
    };
    const surface = sr.querySelector(".surface");
    surface.dispatchEvent(new PointerEvent("pointermove", o));
    const first = sr.querySelector("g.hi")?.firstElementChild;
    if (!first) return { ok: false, reason: "no hover node", firstEnter: false };
    surface.dispatchEvent(new PointerEvent("pointermove", {
      ...o, clientX: o.clientX + 1, clientY: o.clientY + 1,
    }));
    const second = sr.querySelector("g.hi")?.firstElementChild;
    return {
      ok: first === second,
      reason: first === second ? "" : "hover remounted",
      firstEnter: first.classList.contains("masque-enter"),
    };
  }, [hx, hy]);
  assertRemountStable(hiStable, "scatter");
  passed.push("no-pulse");

  const fade = await page.evaluate(() => {
    const span = document.querySelector("#coords_scatter");
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    sr.querySelector(".surface").dispatchEvent(new PointerEvent("pointerleave", { bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    const hi = sr.querySelector("g.hi")?.firstElementChild;
    return {
      hi: sr.querySelector("g.hi")?.children.length ?? 0,
      leaving: !!(hi && hi.classList.contains("masque-leave")),
      sel: sr.querySelector("g.sel")?.children.length ?? 0,
    };
  });
  assertLeaveFade(fade, "scatter");
  if (fade.sel < 1) throw new Error(`g.sel dropped on unhover: ${JSON.stringify(fade)}`);
  passed.push("remount-fade");
  let afterLeave = await inspect("scatter");
  for (let a = 0; a < 8 && afterLeave.hi !== 0; a++) {
    await new Promise((r) => setTimeout(r, 25));
    afterLeave = await inspect("scatter");
  }
  if (afterLeave.hi !== 0) throw new Error(`g.hi lingered ${afterLeave.hi}`);
  if (afterLeave.sel < 1) throw new Error("g.sel dropped after fade");
  passed.push("selected-survives-unhover");

  const darkPts = (await layersOf("scatter_dark")).find((l) => l.kind === "circles");
  const dhx = darkPts.geometry[3], dhy = darkPts.geometry[4];

  // Mark-colour derivation (the point of this change): scatter/scatter_dark resolve `colors`
  // (from scatter!'s color=), so the hover stroke must be that mark colour mixed toward the
  // ink — darker on the light figure, lighter on the dark one.
  const markLightness = async (mark) => colorLightness(await page.evaluate((m) => {
    const tmp = document.createElement("span");
    tmp.style.color = m;
    document.body.appendChild(tmp);
    const c = getComputedStyle(tmp).color;
    tmp.remove();
    return c;
  }, mark));
  assertMarkDerivedInk(colorLightness(tip.hi.stroke), await markLightness(tip.hi.mark), true, "scatter/mark-ink");
  const darkTip = await hoverAt("scatter_dark", dhx, dhy);
  assertMarkDerivedInk(colorLightness(darkTip.hi.stroke), await markLightness(darkTip.hi.mark), false, "scatter_dark/mark-ink");
  passed.push("mark-ink");

  await assertTooltipColorScheme(page, {
    css: () => inspect("scatter").then((m) => m.css),
    computedFor: async (which) => {
      const t = which === "dark" ? await hoverAt("scatter_dark", dhx, dhy) : await hoverAt("scatter", hx, hy);
      return { bg: t.bg, color: t.color };
    },
  });
  passed.push("tooltip-theme-follows-figure-bg");

  if (unexpected.length) throw new Error(`page errors: ${unexpected.join(" | ")}`);
  passed.push("no-console-errors");

  console.log(`POLISH VERIFY OK — ${backend}: ${passed.join(", ")}`);
} catch (e) {
  failed = e;
  // Mirrors the captureFailure shape #67 added to bind_click.mjs: screenshot + DOM dump +
  // console log, so a CI failure ships enough evidence to diagnose without re-running locally.
  if (artifactDir && page) {
    try {
      await page.screenshot({ path: join(artifactDir, `polish_verify-${backend}-failure.png`), fullPage: true });
      const dump = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        cells: [...document.querySelectorAll("pluto-cell")].map((c) => ({ id: c.id, classes: c.className })),
        hosts: document.querySelectorAll(".ip-host").length,
      }));
      writeFileSync(join(artifactDir, `polish_verify-${backend}-dom.json`), JSON.stringify(dump, null, 2));
      writeFileSync(join(artifactDir, `polish_verify-${backend}-console.log`), consoleLog.join("\n"));
      console.error(`artifact: wrote polish_verify-${backend}-{failure.png,dom.json,console.log} to ${artifactDir}`);
    } catch (e2) {
      console.error("artifact capture failed:", e2.message);
    }
  }
} finally {
  await browser.close();
}
if (failed) {
  console.error(`POLISH VERIFY FAIL (${backend}, after ${passed.join(", ")}):`, failed.message);
  process.exit(1);
}
