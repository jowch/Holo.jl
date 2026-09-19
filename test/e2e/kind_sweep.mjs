// Agent kind-sweep live-verify (LOCAL — not CI). Drives docs/dev/live-interaction-checklist.md
// — interaction AND visual — across every interactable kind on one backend.
// A 2-plot kitchen-sink is not enough. polish_verify.mjs is the required visual-chrome
// sibling (fade + prefers-color-scheme). This file asserts fade / no-pulse per kind
// and prefers-color-scheme once (scatter).
//
//   node kind_sweep.mjs <base-url> <notebook-abs-path> <cairo|webgl> [artifact-dir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  assertNoAlertRed, assertNoTeal, assertWash, assertRing, assertHoverRecipe, assertCircleR,
  assertRemountStable, assertLeaveFade, assertTooltipColorScheme,
  meanLuminance, assertTintApplied,
} from "./visual_assert.mjs";

// Kinds whose hover draws a masque-hi masque-hover fill tint (closed shapes) get the
// screenshot-based tint-applied check below; :grid (heatmap/image) hits a "rect" geom_ too
// (geometry.ts's grid case), so its hover is closed/filled the same as circles/rects/polygons.
const TINT_CHECK_KEYS = new Set(["scatter", "scatter_dark", "barplot", "heatmap", "poly"]);

const [base, notebook, backend, artifactDirArg] = process.argv.slice(2);
if (!base || !notebook || !backend) {
  console.error("usage: node kind_sweep.mjs <base-url> <notebook> <cairo|webgl> [artifact-dir]");
  process.exit(2);
}
const artifactDir = artifactDirArg || process.env.E2E_ARTIFACT_DIR || null;
if (artifactDir) mkdirSync(artifactDir, { recursive: true });
const consoleLog = [];

const SHIM_LEAK = /\b(?:Bonito|comm)\.\w+ is not a function/;
const ALLOWED = [/Bonito\.decode_binary is not a function/, /Bonito\.fetch_binary is not a function/];

function hitPoint(layer, index) {
  const k = layer.kind, g = layer.geometry;
  if (k === "circles") {
    return { x: g[3 * index], y: g[3 * index + 1], r: g[3 * index + 2] };
  }
  if (k === "rects") {
    return { x: g[4 * index], y: g[4 * index + 1], w: g[4 * index + 2], h: g[4 * index + 3] };
  }
  if (k === "segments") {
    return {
      x: (g[4 * index] + g[4 * index + 2]) / 2,
      y: (g[4 * index + 1] + g[4 * index + 3]) / 2,
      x1: g[4 * index], y1: g[4 * index + 1], x2: g[4 * index + 2], y2: g[4 * index + 3],
    };
  }
  if (k === "polyline") {
    return {
      x: (g[2 * index] + g[2 * index + 2]) / 2,
      y: (g[2 * index + 1] + g[2 * index + 3]) / 2,
      x1: g[2 * index], y1: g[2 * index + 1], x2: g[2 * index + 2], y2: g[2 * index + 3],
    };
  }
  if (k === "polygons") {
    const ring = g[index];
    let sx = 0, sy = 0, n = ring.length / 2;
    for (let i = 0; i < ring.length; i += 2) { sx += ring[i]; sy += ring[i + 1]; }
    return { x: sx / n, y: sy / n, ring };
  }
  if (k === "grid") {
    const ncols = g.ncols;
    const i = index % ncols, j = Math.floor(index / ncols);
    return {
      x: (g.xedges[i] + g.xedges[i + 1]) / 2,
      y: (g.yedges[j] + g.yedges[j + 1]) / 2,
    };
  }
  if (k === "threshold") {
    const [s0, s1] = g.span;
    return g.orientation === "h"
      ? { x: (s0 + s1) / 2, y: g.pos, x1: s0, y1: g.pos, x2: s1, y2: g.pos }
      : { x: g.pos, y: (s0 + s1) / 2, x1: g.pos, y1: s0, x2: g.pos, y2: s1 };
  }
  if (k === "roi" || k === "view") {
    return { x: g.x + g.w / 2, y: g.y + g.h / 2, w: g.w, h: g.h };
  }
  throw new Error(`no hitPoint for kind=${k}`);
}

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
    viewport: { width: 1100, height: 1400 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
  });
  page = await context.newPage();
  page.on("pageerror", (e) => {
    const shim = SHIM_LEAK.test(e.message);
    const benign = shim && ALLOWED.some((re) => re.test(e.message));
    if (!benign) unexpected.push(e.message);
    console.error(benign ? "PAGEERROR (known-benign):" : "PAGEERROR:", e.message);
  });
  // On :webgl, WGLMakie/Bonito can keep tearing down and rebuilding canvas contexts
  // ("removing WGL context, canvas is not in the DOM anymore!") for a while after Pluto's own
  // cell-busy signal clears — seen in CI (not reproduced locally) as an instant, fade-less hi
  // clear: the churn wipes a host's overlay group between our hover check and the following
  // leave check. Require a quiet window with no such message before calling the page ready.
  let lastWglChurnAt = 0;
  const WGL_CHURN_RE = /removing WGL context/;
  const WGL_QUIET_MS = 3000;
  page.on("console", (m) => {
    const text = m.text();
    consoleLog.push(`[${m.type()}] ${text}`);
    if (WGL_CHURN_RE.test(text)) lastWglChurnAt = Date.now();
  });

  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const deadline = Date.now() + 1500000;
  let ready = false, tick = 0;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      // Click the "Run notebook code" safe-preview banner exactly once per page: it can stay
      // in the DOM (just visually superseded) for the whole first-open precompile, and a
      // repeated click on an already-running notebook re-triggers Pluto's reactive run,
      // interrupting the in-flight cell (surfaces as InterruptException under slow/contended
      // precompilation — seen when Cairo and WGL open concurrently on a loaded box).
      const runBtn = [...document.querySelectorAll("button, a")].find((b) => /run notebook code/i.test(b.innerText || b.title || ""));
      if (runBtn && !window.__masqueClickedRun) { runBtn.click(); window.__masqueClickedRun = true; }
      const hosts = [...document.querySelectorAll(".ip-host")];
      let surfaces = 0;
      for (const h of hosts) {
        let sr = null; h.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
        if (sr && sr.querySelector(".surface")) surfaces++;
      }
      let meta = null;
      try { meta = JSON.parse(document.querySelector("#kind_meta")?.textContent || ""); } catch { meta = null; }
      return {
        busy: document.querySelectorAll("pluto-cell.running, pluto-cell.queued").length,
        errored: document.querySelectorAll("pluto-cell.errored").length,
        hosts: hosts.length, surfaces,
        metaN: Array.isArray(meta) ? meta.length : 0,
        backend: document.querySelector("#kind_backend")?.textContent?.trim() || "",
        errText: [...document.querySelectorAll("pluto-cell.errored")].map((c) => c.innerText).slice(0, 1).join(""),
        title: document.title,
        url: location.href,
      };
    });
    if (st.errored) throw new Error(`${backend} errored: ${st.errText.slice(0, 500)}`);
    const wglQuiet = !lastWglChurnAt || (Date.now() - lastWglChurnAt) > WGL_QUIET_MS;
    if (!st.busy && st.metaN >= 14 && st.surfaces >= st.metaN && wglQuiet) { ready = true; break; }
    if (tick % 20 === 0) {
      console.error(`  …${backend} [${tick}s] busy=${st.busy} hosts=${st.hosts} surfaces=${st.surfaces} meta=${st.metaN} wglQuiet=${wglQuiet} title=${JSON.stringify(st.title || "")} url=${st.url || ""}`);
    }
    tick++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error(`${backend} timed out waiting for kind-sweep widgets`);
  console.error(`phase: widgets mounted (${backend})`);
  // Diagnostic only (not an assertion): reports whether MASQUE_DEV_ENV propagated from serve.jl
  // into Pluto's notebook worker process, so a CI job log shows which Pkg path the run took.
  const usedDevEnv = await page.evaluate(() => document.querySelector("#kind_env")?.textContent?.trim());
  console.error(`MASQUE_DEV_ENV propagated to notebook worker: ${usedDevEnv === "true" ? "yes" : usedDevEnv === "false" ? "no (portable path taken)" : "unknown (#kind_env missing)"}`);

  const meta = await page.evaluate(() => JSON.parse(document.querySelector("#kind_meta").textContent));
  const pageBackend = await page.evaluate(() => document.querySelector("#kind_backend")?.textContent?.trim());
  if (pageBackend && pageBackend !== backend) {
    throw new Error(`notebook backend ${pageBackend} != requested ${backend}`);
  }

  const shadowOf = (key) => page.evaluate((k) => {
    const span = document.querySelector(`#coords_${k}`);
    if (!span) return null;
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    if (!host) return null;
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    return { ok: !!(sr && sr.querySelector(".surface")) };
  }, key);

  const inspect = (key) => page.evaluate((k) => {
    const span = document.querySelector(`#coords_${k}`);
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const baseEl = host.querySelector("img, canvas");
    // Two overlay svgs, same box/viewBox: svg.masque-blend (mix-blend-mode on the svg element
    // itself — Firefox only honours it on a top-level svg, not nested SVG content, so there is
    // no per-element wrapper) holds the default blend-tint hover/wash; svg.masque-plain holds
    // ROI/threshold, the selected-seg ring, and any explicit-`hoverstyle` highlight.
    const svgBlend = sr.querySelector("svg.masque-blend");
    const svgPlain = sr.querySelector("svg.masque-plain");
    const bb = baseEl.getBoundingClientRect();
    const hb = host.getBoundingClientRect();
    const sbBlend = svgBlend.getBoundingClientRect(), sbPlain = svgPlain.getBoundingClientRect();
    const kidsOf = (svg, blended) => [...(svg?.querySelector("g.sel")?.children ?? [])].map((el) => {
      if (el.tagName.toLowerCase() === "g") {
        return {
          kind: "ring",
          lines: [...el.querySelectorAll("line")].map((ln) => {
            const cs = getComputedStyle(ln);
            return {
              className: ln.getAttribute("class"), stroke: cs.stroke, fill: cs.fill, fillOpacity: cs.fillOpacity,
              width: ln.getAttribute("stroke-width"), opacity: ln.getAttribute("stroke-opacity"),
              x1: ln.getAttribute("x1"), y1: ln.getAttribute("y1"),
              x2: ln.getAttribute("x2"), y2: ln.getAttribute("y2"),
            };
          }),
        };
      }
      const cs = getComputedStyle(el);
      return {
        kind: "closed", tag: el.tagName.toLowerCase(),
        className: el.getAttribute("class"), stroke: cs.stroke, fill: cs.fill, fillOpacity: cs.fillOpacity,
        width: el.getAttribute("stroke-width"),
        blend: blended ? getComputedStyle(svg).mixBlendMode : null,
        r: el.getAttribute("r"), cx: el.getAttribute("cx"), cy: el.getAttribute("cy"),
        x: el.getAttribute("x"), y: el.getAttribute("y"),
        w: el.getAttribute("width"), h: el.getAttribute("height"),
        points: el.getAttribute("points"),
      };
    });
    const kids = [...kidsOf(svgBlend, true), ...kidsOf(svgPlain, false)];
    return {
      baseTag: baseEl.tagName.toLowerCase(),
      host: { w: hb.width, h: hb.height },
      base: { w: bb.width, h: bb.height, x: bb.x, y: bb.y },
      svgBlend: { w: sbBlend.width, h: sbBlend.height, x: sbBlend.x, y: sbBlend.y },
      svgPlain: { w: sbPlain.width, h: sbPlain.height, x: sbPlain.x, y: sbPlain.y },
      kids,
      sel: (svgBlend.querySelector("g.sel")?.children.length ?? 0) + (svgPlain.querySelector("g.sel")?.children.length ?? 0),
      hi: (svgBlend.querySelector("g.hi")?.children.length ?? 0) + (svgPlain.querySelector("g.hi")?.children.length ?? 0),
    };
  }, key);

  const layersOf = (key) => page.evaluate((k) => JSON.parse(document.querySelector(`#coords_${k}`).textContent), key);
  const findLayer = (layers, spec) => {
    const L = layers.find((l) => l.id === spec.layerId) || layers.find((l) => l.kind === spec.layerKind);
    if (!L) throw new Error(`${spec.key}: no layer ${spec.layerId}/${spec.layerKind} in ${layers.map((l) => l.id + ":" + l.kind)}`);
    return L;
  };

  const dispatchAt = async (key, x, y, type) => page.evaluate(([k, ix, iy, typ]) => {
    const span = document.querySelector(`#coords_${k}`);
    const hosts = [...document.querySelectorAll(".ip-host")];
    const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const b = host.querySelector("img, canvas").getBoundingClientRect();
    const outW = sr.querySelector("svg.masque-blend").viewBox.baseVal.width;
    const s = b.width / outW;
    const cx = b.left + ix * s, cy = b.top + iy * s;
    const o = { bubbles: true, composed: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const surface = sr.querySelector(".surface");
    surface.dispatchEvent(new PointerEvent(typ === "click" ? "pointermove" : typ, o));
    if (typ === "click") {
      surface.dispatchEvent(new PointerEvent("pointerdown", o));
      surface.dispatchEvent(new PointerEvent("pointerup", o));
      surface.dispatchEvent(new MouseEvent("click", o));
    }
    const tip = sr.querySelector(".masque-tip");
    // Bare shape in g.hi — svg.masque-blend for the default blend-tint recipe, svg.masque-plain
    // for an explicit `hoverstyle` (no wrapper either way, unlike the retired nested-wrapper
    // design). At most one of the two has a g.hi child for a given hit.
    const svgBlend = sr.querySelector("svg.masque-blend"), svgPlain = sr.querySelector("svg.masque-plain");
    const hiBlend = svgBlend?.querySelector("g.hi")?.firstElementChild;
    const hiPlain = svgPlain?.querySelector("g.hi")?.firstElementChild;
    const hi = hiBlend || hiPlain;
    const hiCs = hi ? getComputedStyle(hi) : null;
    return {
      show: tip?.classList.contains("show"),
      text: (tip?.innerText || "").replace(/\s+/g, " ").trim(),
      hi: hi ? {
        tag: hi.tagName.toLowerCase(),
        className: hi.getAttribute("class"),
        fill: hiCs.fill, stroke: hiCs.stroke, fillOpacity: hiCs.fillOpacity,
        width: hi.getAttribute("stroke-width"),
        opacity: hi.getAttribute("stroke-opacity"),
        blend: hi === hiBlend ? getComputedStyle(svgBlend).mixBlendMode : null,
        r: hi.getAttribute("r"), cx: hi.getAttribute("cx"), cy: hi.getAttribute("cy"),
        x1: hi.getAttribute("x1"), y1: hi.getAttribute("y1"),
        x2: hi.getAttribute("x2"), y2: hi.getAttribute("y2"),
      } : null,
      sel: (svgBlend?.querySelector("g.sel")?.children.length ?? 0) + (svgPlain?.querySelector("g.sel")?.children.length ?? 0),
    };
  }, [key, x, y, type]);

  const textOf = (sel) => page.evaluate((q) => document.querySelector(q)?.innerText ?? "", sel);

  // A ~24x24 css-px page.screenshot() clip centred on an image-space point — used by the
  // tint-applied check to sample real pixels before/after the hover blend-tint applies (a page
  // screenshot, not a canvas readback, so it works on both Cairo <img> and WGL <canvas>).
  const clipShot = async (key, ix, iy, size = 24) => {
    const pt = await page.evaluate(([k, x, y]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      host.scrollIntoView({ block: "center", inline: "nearest" });
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const b = host.querySelector("img, canvas").getBoundingClientRect();
      const outW = sr.querySelector("svg.masque-blend").viewBox.baseVal.width;
      const s = b.width / outW;
      return { x: b.left + x * s, y: b.top + y * s };
    }, [key, ix, iy]);
    return page.screenshot({ clip: { x: pt.x - size / 2, y: pt.y - size / 2, width: size, height: size } });
  };

  const drag = async (key, x0, y0, x1, y1, shift = false) => {
    const a = await page.evaluate(([k, ix, iy]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const b = host.querySelector("img, canvas").getBoundingClientRect();
      const outW = sr.querySelector("svg.masque-blend").viewBox.baseVal.width;
      const s = b.width / outW;
      return { cx: b.left + ix * s, cy: b.top + iy * s };
    }, [key, x0, y0]);
    const b = await page.evaluate(([k, ix, iy]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const box = host.querySelector("img, canvas").getBoundingClientRect();
      const outW = sr.querySelector("svg.masque-blend").viewBox.baseVal.width;
      const s = box.width / outW;
      return { cx: box.left + ix * s, cy: box.top + iy * s };
    }, [key, x1, y1]);
    await page.evaluate(([k, ax, ay, bx, by, shift]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const surface = sr.querySelector(".surface");
      // dispatchEvent bypasses hit-testing/capture redirection entirely — it always fires on the
      // element you call it on — so drive move/up on `surface` directly (matching what real pointer
      // capture, set by onDown for an actual user gesture, would route there anyway).
      const pid = { pointerId: 1, pointerType: "mouse", isPrimary: true };
      const down = { bubbles: true, composed: true, cancelable: true, clientX: ax, clientY: ay, shiftKey: shift, ...pid };
      surface.dispatchEvent(new PointerEvent("pointerdown", down));
      for (let t = 0.25; t <= 1.0; t += 0.25) {
        surface.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true, cancelable: true, shiftKey: shift, ...pid,
          clientX: ax + (bx - ax) * t, clientY: ay + (by - ay) * t,
        }));
      }
      surface.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, shiftKey: shift, clientX: bx, clientY: by, ...pid }));
    }, [key, a.cx, a.cy, b.cx, b.cy, shift]);
  };

  const waitChange = async (sel, before, what, tries = 80) => {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const t = await textOf(sel);
      if (t !== before && t.length) return t;
    }
    throw new Error(`${what}: ${sel} never changed from ${JSON.stringify(before)}`);
  };

  const expectBase = backend === "webgl" ? "canvas" : "img";

  for (const spec of meta) {
    const key = spec.key;
    const wantDark = key === "scatter_dark"; // the only dark-figure case in kind_sweep_figures.jl
    const sh = await shadowOf(key);
    if (!sh?.ok) throw new Error(`${key}: overlay surface missing`);
    const m = await inspect(key);
    if (m.baseTag !== expectBase) throw new Error(`${key}: expected ${expectBase}, got ${m.baseTag}`);
    for (const [name, svgBox] of [["masque-blend", m.svgBlend], ["masque-plain", m.svgPlain]]) {
      const dx = Math.abs(svgBox.x - m.base.x), dy = Math.abs(svgBox.y - m.base.y);
      const dw = Math.abs(svgBox.w - m.base.w), dh = Math.abs(svgBox.h - m.base.h);
      if (dx > 2 || dy > 2 || dw > 3 || dh > 3) {
        throw new Error(`${key}: overlay/base offset svg.${name}=${JSON.stringify(svgBox)} base=${JSON.stringify(m.base)}`);
      }
    }
    passed.push(`${key}/overlay-on-base`);

    const layers = await layersOf(key);
    const layer = findLayer(layers, spec);

    if (spec.mode === "drag") {
      const p = hitPoint(layer, 0);
      const before = await textOf(`#out_${key}`);
      const ends = spec.layerKind === "threshold"
        ? [[p.x, p.y - 50], [p.x, p.y + 50]]
        : spec.layerKind === "roi"
          ? (() => {
            const pts = layers.find((l) => l.kind === "circles");
            if (!pts) return [[p.x + (p.w || 40), p.y], [p.x - (p.w || 40), p.y]];
            const a = hitPoint(pts, 0), b = hitPoint(pts, Math.max(0, Math.floor(pts.geometry.length / 3) - 1));
            return [[a.x, a.y], [b.x, b.y]];
          })()
          : [[p.x + 80, p.y], [p.x - 80, p.y]];
      let after = before;
      for (const [x1, y1] of ends) {
        await page.evaluate((k) => {
          const span = document.querySelector(`#coords_${k}`);
          const hosts = [...document.querySelectorAll(".ip-host")];
          const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
          host?.scrollIntoView({ block: "center", inline: "nearest" });
        }, key);
        await drag(key, p.x, p.y, x1, y1, spec.layerKind === "view");
        try {
          after = await waitChange(`#out_${key}`, before, `${key}-drag`, 120);
          break;
        } catch {
          after = before;
        }
      }
      if (after === before) throw new Error(`${key}-drag: #out_${key} never changed from ${JSON.stringify(before)}`);
      const re = spec.layerKind === "view" ? /xmin|xmax|:view/i
        : spec.layerKind === "roi" ? /:roi|InteractionEvent\[/i
        : /:threshold|:thr/i;
      if (!re.test(after)) throw new Error(`${key}-drag: readout mismatch ${JSON.stringify(after).slice(0, 200)}`);
      passed.push(`${key}/drag-bind`);
      console.error(`OK  ${key}/drag — ${after.slice(0, 100)}`);
      continue;
    }

    if (spec.selected === "wash") {
      const wash = m.kids.find((k) => k.kind === "closed");
      assertWash(wash, key, wantDark);
      if (spec.circle) {
        // `hp.r` is whatever geometry the manifest shipped, not a fixed literal here — for
        // `scatter`/`scatter_dark` (markersize=22, built from the Scatter plot object) it's the
        // marker's drawn radius, ≈0.3525·22·2 (px_per_unit) ≈ 15.5 image px, not markersize/2.
        const hp = hitPoint(layer, spec.selectedIndex);
        assertCircleR(wash.r, hp.r, key);
        if (Math.abs(Number(wash.cx) - hp.x) > 0.6 || Math.abs(Number(wash.cy) - hp.y) > 0.6) {
          throw new Error(`${key}: selected not centered cx=${wash.cx},${wash.cy} geom=${hp.x},${hp.y}`);
        }
        passed.push(`${key}/circle-r`);
      }
      if (layer.kind === "rects") {
        const hp = hitPoint(layer, spec.selectedIndex);
        const ex = hp.x - hp.w / 2, ey = hp.y - hp.h / 2;
        if (Math.abs(Number(wash.x) - ex) > 1.2 || Math.abs(Number(wash.y) - ey) > 1.2) {
          throw new Error(`${key}: rect highlight offset ${JSON.stringify(wash)} vs ${JSON.stringify(hp)}`);
        }
      }
      passed.push(`${key}/selected-wash`);
    } else if (spec.selected === "ring") {
      const ring = m.kids.find((k) => k.kind === "ring");
      assertRing(ring, key);
      const hp = hitPoint(layer, spec.selectedIndex);
      const ln = ring.lines[0];
      if (hp.x1 != null && (Math.abs(Number(ln.x1) - hp.x1) > 1.2 || Math.abs(Number(ln.y1) - hp.y1) > 1.2)) {
        throw new Error(`${key}: ring not on segment ${JSON.stringify(ln)} vs ${JSON.stringify(hp)}`);
      }
      passed.push(`${key}/selected-ring`);
    } else if (m.sel !== 0) {
      throw new Error(`${key}: unexpected g.sel=${m.sel} on unsupported kind`);
    }

    const tipHit = (t) => {
      if (!spec.tip) return !!(t && t.show);
      const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
      return !!(t && t.show && norm(t.text).includes(norm(spec.tip)));
    };
    const hoverPt = hitPoint(layer, spec.selectedIndex);
    // Tint-applied (screenshot): the highlight no longer derives its colour from the mark, so
    // the only thing left to prove live is that the blend-mode tint actually darkens (light
    // figure) / lightens (dark figure) the pixels under the mark. Must run on an UNSELECTED
    // point: on a key with a baked `selected` (scatter/scatter_dark/barplot/poly),
    // spec.selectedIndex already carries the persistent wash, and mount.ts appends g.hi after
    // g.sel (hi always paints over sel) — hovering it would swap the stronger wash grey for the
    // deliberately *weaker* hover grey (#666666 vs #8c8c8c, CLAUDE.md), a real lightening on a
    // light figure that has nothing to do with whether the hover tint itself darkens. clickIndex
    // is a different, never-selected element on every TINT_CHECK_KEYS spec that has a `selected`
    // at all; where selected is null (heatmap) selectedIndex is already clean.
    const doTintCheck = TINT_CHECK_KEYS.has(key);
    if (doTintCheck) {
      const tintPt = hitPoint(layer, spec.selected ? spec.clickIndex : spec.selectedIndex);
      const lumBefore = meanLuminance(PNG.sync.read(await clipShot(key, tintPt.x, tintPt.y)));
      await dispatchAt(key, tintPt.x, tintPt.y, "pointermove");
      await new Promise((r) => setTimeout(r, 200)); // let the 80-120ms enter fade settle
      const lumAfter = meanLuminance(PNG.sync.read(await clipShot(key, tintPt.x, tintPt.y)));
      assertTintApplied(lumBefore, lumAfter, wantDark, `${key}/tint-applied`);
      passed.push(`${key}/tint-applied`);
      await page.evaluate((k) => {
        const span = document.querySelector(`#coords_${k}`);
        const hosts = [...document.querySelectorAll(".ip-host")];
        const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
        let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
        sr.querySelector(".surface").dispatchEvent(new PointerEvent("pointerleave", { bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      }, key);
    }

    let tip = null;
    for (let a = 0; a < 8; a++) {
      tip = await dispatchAt(key, hoverPt.x, hoverPt.y, "pointermove");
      if (tipHit(tip)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!tipHit(tip)) throw new Error(`${key}: tooltip ${JSON.stringify(tip)}`);
    // Open (stroke-only, no tint) kinds are line-geometry layers (polyline/segments); every
    // other element-kind layer (circles/rects/polygons/grid) is closed (tint + stroke).
    const closedHover = layer.kind !== "polyline" && layer.kind !== "segments";
    assertHoverRecipe(tip.hi, key, closedHover, wantDark);
    assertNoAlertRed(m.kids, `${key}/sel`);
    assertNoTeal(m.kids, `${key}/sel`);

    const hiStable = await page.evaluate(([k, ix, iy]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const b = host.querySelector("img, canvas").getBoundingClientRect();
      const outW = sr.querySelector("svg.masque-blend").viewBox.baseVal.width;
      const s = b.width / outW;
      const o = {
        bubbles: true, composed: true, cancelable: true,
        clientX: b.left + ix * s, clientY: b.top + iy * s,
        pointerId: 1, pointerType: "mouse", isPrimary: true,
      };
      const surface = sr.querySelector(".surface");
      // Bare shape in g.hi (svg.masque-blend or svg.masque-plain, see dispatchAt above) — no
      // wrapper, so masque-enter/masque-leave live on the node itself.
      const hiOf = () => sr.querySelector("svg.masque-blend g.hi")?.firstElementChild
        || sr.querySelector("svg.masque-plain g.hi")?.firstElementChild;
      surface.dispatchEvent(new PointerEvent("pointermove", o));
      const first = hiOf();
      if (!first) return { ok: false, reason: "no hover node", firstEnter: false };
      surface.dispatchEvent(new PointerEvent("pointermove", {
        ...o, clientX: o.clientX + 1, clientY: o.clientY + 1,
      }));
      const second = hiOf();
      return {
        ok: first === second,
        reason: first === second ? "" : "hover remounted",
        firstEnter: first.classList.contains("masque-enter"),
      };
    }, [key, hoverPt.x, hoverPt.y]);
    assertRemountStable(hiStable, key);
    passed.push(`${key}/no-pulse`);
    if (spec.circle && tip.hi?.r != null) {
      const hp = hitPoint(layer, spec.selectedIndex);
      assertCircleR(tip.hi.r, hp.r, `${key}/hover`);
      if (Math.abs(Number(tip.hi.cx) - hp.x) > 0.6 || Math.abs(Number(tip.hi.cy) - hp.y) > 0.6) {
        throw new Error(`${key}: hover not centered`);
      }
    }
    if (spec.selected && tip.sel < 1) throw new Error(`${key}: g.sel gone during hover`);
    passed.push(`${key}/tooltip`);
    passed.push(`${key}/hover`);

    const fade = await page.evaluate((k) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      sr.querySelector(".surface").dispatchEvent(new PointerEvent("pointerleave", { bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      const hi = sr.querySelector("svg.masque-blend g.hi")?.firstElementChild
        || sr.querySelector("svg.masque-plain g.hi")?.firstElementChild;
      return {
        hi: (sr.querySelector("svg.masque-blend g.hi")?.children.length ?? 0) + (sr.querySelector("svg.masque-plain g.hi")?.children.length ?? 0),
        leaving: !!(hi && hi.classList.contains("masque-leave")),
      };
    }, key);
    assertLeaveFade(fade, key);
    passed.push(`${key}/remount-fade`);
    let afterLeave = await inspect(key);
    for (let a = 0; a < 8 && afterLeave.hi !== 0; a++) {
      await new Promise((r) => setTimeout(r, 25));
      afterLeave = await inspect(key);
    }
    if (afterLeave.hi !== 0) throw new Error(`${key}: g.hi lingered ${afterLeave.hi}`);
    if (spec.selected && afterLeave.sel < 1) throw new Error(`${key}: g.sel dropped on unhover`);
    if (spec.selected) passed.push(`${key}/selected-survives-unhover`);

    let clickIdx = spec.clickIndex;
    const before = await textOf(`#out_${key}`);
    const already = new RegExp(`:${spec.layerId},\\s*${clickIdx}\\b`);
    if (already.test(before) || (spec.layerKind === "grid" && new RegExp(`index[=:]\\s*${clickIdx}\\b`).test(before))) {
      clickIdx = spec.selectedIndex !== clickIdx ? spec.selectedIndex : clickIdx + 1;
    }
    const clickPt = hitPoint(layer, clickIdx);
    let after = before;
    for (let a = 0; a < 3; a++) {
      await dispatchAt(key, clickPt.x, clickPt.y, "click");
      try {
        after = await waitChange(`#out_${key}`, before, `${key}-click`);
        break;
      } catch (e) {
        if (a === 2) throw e;
      }
    }
    const idRe = new RegExp(`:${spec.layerId}|${spec.layerId}`, "i");
    if (!idRe.test(after)) throw new Error(`${key}-click: no layer in ${JSON.stringify(after).slice(0, 220)}`);
    if (spec.layerKind !== "grid") {
      if (!new RegExp(`:${spec.layerId},\\s*${clickIdx}\\b`).test(after)) {
        throw new Error(`${key}-click: expected index ${clickIdx}: ${after.slice(0, 220)}`);
      }
    }
    passed.push(`${key}/click-bind`);
    console.error(`OK  ${key} — ${after.slice(0, 110)}`);
  }

  const lightSpec = meta.find((s) => s.key === "scatter");
  const darkSpec = meta.find((s) => s.key === "scatter_dark");
  if (!lightSpec || !darkSpec) throw new Error("no scatter/scatter_dark spec for tooltip theme");
  {
    const cssKey = lightSpec.key;
    const computedFor = async (which) => {
      const spec = which === "dark" ? darkSpec : lightSpec;
      const layers = await layersOf(spec.key);
      const layer = findLayer(layers, spec);
      const pt = hitPoint(layer, spec.selectedIndex);
      await dispatchAt(spec.key, pt.x, pt.y, "pointermove");
      return page.evaluate((k) => {
        const span = document.querySelector(`#coords_${k}`);
        const hosts = [...document.querySelectorAll(".ip-host")];
        const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
        let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
        const t = sr.querySelector(".masque-tip");
        const cs = getComputedStyle(t);
        return { bg: cs.backgroundColor, color: cs.color, show: t?.classList.contains("show") };
      }, spec.key);
    };
    await assertTooltipColorScheme(page, {
      css: () => page.evaluate((k) => {
        const span = document.querySelector(`#coords_${k}`);
        const hosts = [...document.querySelectorAll(".ip-host")];
        const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
        let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
        return sr.querySelector("style")?.textContent || "";
      }, cssKey),
      computedFor,
    });
    passed.push("tooltip-theme-follows-figure-bg");
  }

  if (unexpected.length) throw new Error(`page errors: ${unexpected.join(" | ")}`);
  passed.push("no-console-errors");
  console.log(`KIND SWEEP OK — ${backend}: ${passed.join(", ")}`);
} catch (e) {
  failed = e;
  // Mirrors the captureFailure shape #67 added to bind_click.mjs: screenshot + DOM dump +
  // console log, so a CI failure ships enough evidence to diagnose without re-running locally.
  if (artifactDir && page) {
    try {
      await page.screenshot({ path: join(artifactDir, `kind_sweep-${backend}-failure.png`), fullPage: true });
      const dump = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        cells: [...document.querySelectorAll("pluto-cell")].map((c) => ({ id: c.id, classes: c.className })),
        hosts: document.querySelectorAll(".ip-host").length,
      }));
      writeFileSync(join(artifactDir, `kind_sweep-${backend}-dom.json`), JSON.stringify(dump, null, 2));
      writeFileSync(join(artifactDir, `kind_sweep-${backend}-console.log`), consoleLog.join("\n"));
      console.error(`artifact: wrote kind_sweep-${backend}-{failure.png,dom.json,console.log} to ${artifactDir}`);
    } catch (e2) {
      console.error("artifact capture failed:", e2.message);
    }
  }
} finally {
  await browser.close();
}
if (failed) {
  console.error(`KIND SWEEP FAIL (${backend}, after ${passed.join(", ")}):`, failed.message);
  process.exit(1);
}
