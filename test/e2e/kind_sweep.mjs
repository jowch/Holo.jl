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
  assertNoAlertRed, assertNoTeal, assertWash, assertRing, assertHoverRecipe, assertNoHighlight,
  assertCircleR, assertRemountStable, assertLeaveFade, assertTooltipColorScheme,
  meanLuminance, assertTintApplied,
} from "./visual_assert.mjs";

// Kinds whose hover draws a masque-hi masque-fillshape tint (closed shapes) get the
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
    // THREE sibling overlay svgs, same box/viewBox: svg.masque-fill (mix-blend-mode:
    // color-dodge — the brightening half) and svg.masque-edge (multiply/screen — the darkening
    // half) together draw a closed mark's hover/selected highlight as two identical-geometry
    // shapes, one per svg; svg.masque-plain (no blend) holds ROI/threshold, the selected-open
    // ring, and any explicit-`hoverstyle` highlight. Firefox only honours `mix-blend-mode` on a
    // top-level svg, not nested SVG content, which is why each is its own sibling svg rather
    // than a per-element wrapper.
    const svgFill = sr.querySelector("svg.masque-fill");
    const svgEdge = sr.querySelector("svg.masque-edge");
    const svgPlain = sr.querySelector("svg.masque-plain");
    const bb = baseEl.getBoundingClientRect();
    const hb = host.getBoundingClientRect();
    const sbFill = svgFill.getBoundingClientRect(), sbEdge = svgEdge.getBoundingClientRect(), sbPlain = svgPlain.getBoundingClientRect();
    const kidsOf = (svg, layerName) => [...(svg?.querySelector("g.sel")?.children ?? [])].map((el) => {
      if (el.tagName.toLowerCase() === "g") {
        return {
          layer: layerName, kind: "ring",
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
        layer: layerName, kind: "closed", tag: el.tagName.toLowerCase(),
        className: el.getAttribute("class"), stroke: cs.stroke, fill: cs.fill, fillOpacity: cs.fillOpacity,
        width: el.getAttribute("stroke-width"),
        blend: layerName === "plain" ? null : getComputedStyle(svg).mixBlendMode,
        r: el.getAttribute("r"), cx: el.getAttribute("cx"), cy: el.getAttribute("cy"),
        x: el.getAttribute("x"), y: el.getAttribute("y"),
        w: el.getAttribute("width"), h: el.getAttribute("height"),
        points: el.getAttribute("points"),
      };
    });
    const kids = [...kidsOf(svgFill, "fill"), ...kidsOf(svgEdge, "edge"), ...kidsOf(svgPlain, "plain")];
    const count = (sel) => (svgFill.querySelector(sel)?.children.length ?? 0)
      + (svgEdge.querySelector(sel)?.children.length ?? 0)
      + (svgPlain.querySelector(sel)?.children.length ?? 0);
    return {
      baseTag: baseEl.tagName.toLowerCase(),
      host: { w: hb.width, h: hb.height },
      base: { w: bb.width, h: bb.height, x: bb.x, y: bb.y },
      svgFill: { w: sbFill.width, h: sbFill.height, x: sbFill.x, y: sbFill.y },
      svgEdge: { w: sbEdge.width, h: sbEdge.height, x: sbEdge.x, y: sbEdge.y },
      svgPlain: { w: sbPlain.width, h: sbPlain.height, x: sbPlain.x, y: sbPlain.y },
      kids,
      sel: count("g.sel"),
      hi: count("g.hi"),
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
    const outW = sr.querySelector("svg.masque-plain").viewBox.baseVal.width;
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
    // Bare shape in g.hi — svg.masque-fill (fill half) + svg.masque-edge (edge half) for the
    // default split-blend recipe, svg.masque-plain for an explicit `hoverstyle` (no wrapper
    // either way). At most one of {fill|edge} vs. plain is populated for a given hit; an open
    // seg or an already-selected mark can leave fill/edge both empty.
    const svgFill = sr.querySelector("svg.masque-fill"), svgEdge = sr.querySelector("svg.masque-edge"), svgPlain = sr.querySelector("svg.masque-plain");
    const capture = (svg, layerName) => {
      const el = svg?.querySelector("g.hi")?.firstElementChild;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        layer: layerName, tag: el.tagName.toLowerCase(), className: el.getAttribute("class"),
        fill: cs.fill, stroke: cs.stroke, fillOpacity: cs.fillOpacity,
        width: el.getAttribute("stroke-width"), opacity: el.getAttribute("stroke-opacity"),
        blend: layerName === "plain" ? null : getComputedStyle(svg).mixBlendMode,
        r: el.getAttribute("r"), cx: el.getAttribute("cx"), cy: el.getAttribute("cy"),
        x1: el.getAttribute("x1"), y1: el.getAttribute("y1"), x2: el.getAttribute("x2"), y2: el.getAttribute("y2"),
      };
    };
    return {
      show: tip?.classList.contains("show"),
      text: (tip?.innerText || "").replace(/\s+/g, " ").trim(),
      hi: { fill: capture(svgFill, "fill"), edge: capture(svgEdge, "edge"), plain: capture(svgPlain, "plain") },
      sel: (svgFill?.querySelector("g.sel")?.children.length ?? 0)
        + (svgEdge?.querySelector("g.sel")?.children.length ?? 0)
        + (svgPlain?.querySelector("g.sel")?.children.length ?? 0),
    };
  }, [key, x, y, type]);

  const textOf = (sel) => page.evaluate((q) => document.querySelector(q)?.innerText ?? "", sel);

  // A small css-px page.screenshot() clip centred on an image-space point — used by the
  // tint-applied check to sample real pixels before/after the hover blend applies (a page
  // screenshot, not a canvas readback, so it works on both Cairo <img> and WGL <canvas>).
  // Default size is small (8) so the box stays inside the mark's interior, off the darkening
  // edge stroke — scatter's drawn r is ≈15.5 image px ≈7.75 css px at the usual px_per_unit 2.
  const clipShot = async (key, ix, iy, size = 8) => {
    const pt = await page.evaluate(([k, x, y]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      host.scrollIntoView({ block: "center", inline: "nearest" });
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const b = host.querySelector("img, canvas").getBoundingClientRect();
      const outW = sr.querySelector("svg.masque-plain").viewBox.baseVal.width;
      const s = b.width / outW;
      return { x: b.left + x * s, y: b.top + y * s };
    }, [key, ix, iy]);
    return page.screenshot({ clip: { x: pt.x - size / 2, y: pt.y - size / 2, width: size, height: size } });
  };

  // A HitLayer's `colors` manifest field is a plain "rgb(r,g,b)" string when every element
  // shares one resolvable colour (scatter/scatter_dark's `color=`, and a legend link target with
  // a resolvable colour) — parse it to the luminance the mark's own interior must read at, before
  // any hover tint. A `colors` palette dict (per-index categorical) or an absent field (barplot,
  // poly, heatmap today) isn't parsed here; callers treat a null return as "no expectation".
  const rawColorLuminance = (colors) => {
    if (typeof colors !== "string") return null;
    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(colors);
    if (!m) return null;
    return 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]);
  };
  // Resolve the colour a TINT_CHECK_KEYS spot check must expect: `colors` whenever it's a
  // parseable "rgb(r,g,b)" string, else `spec.tintColor` — a colour BAKED once into
  // kind_sweep_figures.jl's `kind_sweep_meta()` from an actual CairoMakie raster sample at the
  // manifest's own projected element centre (barplot/heatmap/poly have no resolvable `colors` at
  // all). `??` alone would be wrong here: a `{palette, index}` per-index dict is non-null but
  // unparseable, so the check has to be "does rawColorLuminance actually parse it", not bare
  // nullness.
  const expectedColorFor = (colors, tintColor) => (typeof colors === "string" ? colors : (tintColor ?? null));
  const RAW_COLOR_TOLERANCE = 20; // margin for AA/rim bleed inside the small clip box, tight enough to catch a stale/blank frame

  // A WGL <canvas>'s compositor frame isn't guaranteed fresh the first time a host is scrolled
  // into view for a page.screenshot() clip (Cairo's baked <img> has no such gap) — seen in CI as
  // a `tint-applied` false negative: the very first clipShot() on a given host (always the
  // "before" sample of a case with no earlier screenshot-based check on it, e.g. a legend link
  // target reached only after a long scroll) returned a stale/blank frame that stayed constant
  // across repeats — a plain "retry until two reads agree" loop would exit on that SAME wrong
  // reading, since a stuck frame is trivially self-consistent. When `expectLum` is available
  // (from `rawColorLuminance`, resolved via `expectedColorFor` so a kind with no resolvable
  // `colors` still gets one from its baked `spec.tintColor`), retry until the reading actually
  // matches it instead; only fall back to inter-frame stability (no expectation to check against)
  // when neither is available. Every `TINT_CHECK_KEYS` key now asserts a non-null `expectLum`
  // before this is ever called (see the `doTintCheck` block below), so that fallback can no
  // longer be the only guard for those checks.
  const stableClipShot = async (key, ix, iy, { size = 8, retries = 6, tol = 1.5, expectLum = null } = {}) => {
    let prevLum = null, buf = null;
    for (let i = 0; i < retries; i++) {
      buf = await clipShot(key, ix, iy, size);
      const lum = meanLuminance(PNG.sync.read(buf));
      if (expectLum !== null) {
        if (Math.abs(lum - expectLum) <= RAW_COLOR_TOLERANCE) return buf;
      } else if (prevLum !== null && Math.abs(lum - prevLum) < tol) {
        return buf;
      }
      prevLum = lum;
      await new Promise((r) => setTimeout(r, 150));
    }
    return buf;
  };

  const assertRawColorMatch = (lumBefore, colors, where) => {
    const expected = rawColorLuminance(colors);
    if (expected === null) return;
    if (Math.abs(lumBefore - expected) > RAW_COLOR_TOLERANCE) {
      throw new Error(
        `${where}: lumBefore=${lumBefore.toFixed(1)} doesn't match the mark's own resolved colour ${colors} ` +
        `(expected luminance ≈${expected.toFixed(1)}) — the clip likely sampled a stale/blank frame, not the mark`,
      );
    }
  };

  const drag = async (key, x0, y0, x1, y1, shift = false) => {
    const a = await page.evaluate(([k, ix, iy]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const b = host.querySelector("img, canvas").getBoundingClientRect();
      const outW = sr.querySelector("svg.masque-plain").viewBox.baseVal.width;
      const s = b.width / outW;
      return { cx: b.left + ix * s, cy: b.top + iy * s };
    }, [key, x0, y0]);
    const b = await page.evaluate(([k, ix, iy]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const box = host.querySelector("img, canvas").getBoundingClientRect();
      const outW = sr.querySelector("svg.masque-plain").viewBox.baseVal.width;
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
    for (const [name, svgBox] of [["masque-fill", m.svgFill], ["masque-edge", m.svgEdge], ["masque-plain", m.svgPlain]]) {
      const dx = Math.abs(svgBox.x - m.base.x), dy = Math.abs(svgBox.y - m.base.y);
      const dw = Math.abs(svgBox.w - m.base.w), dh = Math.abs(svgBox.h - m.base.h);
      if (dx > 2 || dy > 2 || dw > 3 || dh > 3) {
        throw new Error(`${key}: overlay/base offset svg.${name}=${JSON.stringify(svgBox)} base=${JSON.stringify(m.base)}`);
      }
    }
    passed.push(`${key}/overlay-on-base`);

    const layers = await layersOf(key);
    const layer = findLayer(layers, spec);

    // Regression check for the `build_manifest` precedence fix (src/render.jl ~line 259):
    // a `LegendInteractable` layer drawn over filled plot geometry must sort BEFORE that
    // geometry's layer in the manifest, or the frontend's first-match `hitTest` gives every
    // contested pixel to the plot underneath instead of the legend.
    if (spec.overlapsGrid) {
      const gridLayer = layers.find((l) => l.id === spec.overlapsGrid);
      if (!gridLayer) throw new Error(`${key}: no grid layer "${spec.overlapsGrid}" in manifest`);
      const legendIdx = layers.indexOf(layer);
      const gridIdx = layers.indexOf(gridLayer);
      if (!(legendIdx < gridIdx)) {
        throw new Error(`${key}: legend layer index ${legendIdx} not before grid layer "${spec.overlapsGrid}" index ${gridIdx}`);
      }
      // Prove the test is meaningful: the pixel the generic hover/click checks below use must
      // genuinely fall inside BOTH layers' claimed geometry, not just two non-overlapping boxes.
      const hp = hitPoint(layer, spec.selectedIndex);
      const g = gridLayer.geometry;
      // Pixel space: xedges/yedges keep their original edge order, which can be descending
      // (top-left-origin, y-flipped projection) — sort before treating as [min, max].
      const xs = [g.xedges[0], g.xedges.at(-1)].sort((a, b) => a - b);
      const ys = [g.yedges[0], g.yedges.at(-1)].sort((a, b) => a - b);
      const inGrid = hp.x >= xs[0] && hp.x <= xs[1] && hp.y >= ys[0] && hp.y <= ys[1];
      if (!inGrid) {
        throw new Error(`${key}: legend test pixel ${JSON.stringify(hp)} not inside grid extent x[${xs}] y[${ys}]`);
      }
      passed.push(`${key}/legend-precedence-order`);
      passed.push(`${key}/legend-precedence-pixel-contested`);
    }

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
      const wash = {
        fill: m.kids.find((k) => k.layer === "fill" && k.kind === "closed"),
        edge: m.kids.find((k) => k.layer === "edge" && k.kind === "closed"),
        plain: m.kids.find((k) => k.layer === "plain" && k.kind === "closed"),
      };
      assertWash(wash, key, wantDark);
      if (spec.circle) {
        // `hp.r` is whatever geometry the manifest shipped, not a fixed literal here — for
        // `scatter`/`scatter_dark` (markersize=22, built from the Scatter plot object) it's the
        // marker's drawn radius, ≈0.3525·22·2 (px_per_unit) ≈ 15.5 image px, not markersize/2.
        // The fill and edge shapes are identical geometry — check both.
        const hp = hitPoint(layer, spec.selectedIndex);
        for (const shape of [wash.fill, wash.edge].filter(Boolean)) {
          assertCircleR(shape.r, hp.r, `${key}/${shape.layer}`);
          if (Math.abs(Number(shape.cx) - hp.x) > 0.6 || Math.abs(Number(shape.cy) - hp.y) > 0.6) {
            throw new Error(`${key}: selected not centered (${shape.layer}) cx=${shape.cx},${shape.cy} geom=${hp.x},${hp.y}`);
          }
        }
        passed.push(`${key}/circle-r`);
      }
      if (layer.kind === "rects") {
        const hp = hitPoint(layer, spec.selectedIndex);
        const ex = hp.x - hp.w / 2, ey = hp.y - hp.h / 2;
        for (const shape of [wash.fill, wash.edge].filter(Boolean)) {
          if (Math.abs(Number(shape.x) - ex) > 1.2 || Math.abs(Number(shape.y) - ey) > 1.2) {
            throw new Error(`${key}: rect highlight offset (${shape.layer}) ${JSON.stringify(shape)} vs ${JSON.stringify(hp)}`);
          }
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

    const hoverIndex = spec.hoverIndex;
    const hoverTip = spec.hoverTip;
    const tipHit = (t) => {
      if (!hoverTip) return !!(t && t.show);
      const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
      return !!(t && t.show && norm(t.text).includes(norm(hoverTip)));
    };
    const hoverPt = hitPoint(layer, hoverIndex);
    // Tint-applied (screenshot): the interior of the mark must get BRIGHTER on hover on every
    // figure (the fill layer's color-dodge can only raise luminance) — the only thing left to
    // prove live, since neither the fill nor the edge colour derives from the mark any more.
    // Must run on an UNSELECTED point (`tintIndex` if the spec sets one — heatmap needs a
    // brighter cell than its baked `selectedIndex`'s darkest-viridis one — else `clickIndex` on
    // a key with a baked `selected`, since `selectedIndex` already carries the persistent wash;
    // where `selected` is null, `selectedIndex` is already clean).
    const doTintCheck = TINT_CHECK_KEYS.has(key);
    if (doTintCheck) {
      const tintIndex = spec.tintIndex ?? (spec.selected ? spec.clickIndex : spec.selectedIndex);
      const tintPt = hitPoint(layer, tintIndex);
      const expectColor = expectedColorFor(layer.colors, spec.tintColor);
      const expectLum = rawColorLuminance(expectColor);
      // Sanity check: every TINT_CHECK_KEYS key must resolve a real expectation, or stableClipShot
      // silently falls back to its "two reads agree" loop — trivially satisfied by a stuck/stale
      // frame (see stableClipShot's own comment above) — and the whole point of this check is lost.
      if (expectLum === null) {
        throw new Error(
          `${key}/tint-applied: no expectation to check against ` +
          `(layer.colors=${JSON.stringify(layer.colors)}, spec.tintColor=${JSON.stringify(spec.tintColor)}) — ` +
          `give this kind a resolvable \`colors\` or bake a \`tintColor\` in kind_sweep_figures.jl`,
        );
      }
      const lumBefore = meanLuminance(PNG.sync.read(
        await stableClipShot(key, tintPt.x, tintPt.y, { expectLum }),
      ));
      assertRawColorMatch(lumBefore, expectColor, `${key}/tint-applied`);
      await dispatchAt(key, tintPt.x, tintPt.y, "pointermove");
      await new Promise((r) => setTimeout(r, 200)); // let the 80-120ms enter fade settle
      const lumAfter = meanLuminance(PNG.sync.read(await stableClipShot(key, tintPt.x, tintPt.y)));
      assertTintApplied(lumBefore, lumAfter, `${key}/tint-applied`);
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
    // Open (edge-only, no fill shape) kinds are line-geometry layers (polyline/segments); every
    // other element-kind layer (circles/rects/polygons/grid) is closed (fill + edge).
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
      const outW = sr.querySelector("svg.masque-plain").viewBox.baseVal.width;
      const s = b.width / outW;
      const o = {
        bubbles: true, composed: true, cancelable: true,
        clientX: b.left + ix * s, clientY: b.top + iy * s,
        pointerId: 1, pointerType: "mouse", isPrimary: true,
      };
      const surface = sr.querySelector(".surface");
      // Bare shape in g.hi (fill/edge/plain — see dispatchAt above) — no wrapper, so
      // masque-enter/masque-leave live on the node itself. Any populated layer proves stability.
      const hiOf = () => sr.querySelector("svg.masque-fill g.hi")?.firstElementChild
        || sr.querySelector("svg.masque-edge g.hi")?.firstElementChild
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
    if (spec.circle) {
      const hp = hitPoint(layer, hoverIndex);
      for (const shape of [tip.hi.fill, tip.hi.edge].filter(Boolean)) {
        assertCircleR(shape.r, hp.r, `${key}/hover-${shape.layer}`);
        if (Math.abs(Number(shape.cx) - hp.x) > 0.6 || Math.abs(Number(shape.cy) - hp.y) > 0.6) {
          throw new Error(`${key}: hover not centered (${shape.layer})`);
        }
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
      const hi = sr.querySelector("svg.masque-fill g.hi")?.firstElementChild
        || sr.querySelector("svg.masque-edge g.hi")?.firstElementChild
        || sr.querySelector("svg.masque-plain g.hi")?.firstElementChild;
      return {
        hi: (sr.querySelector("svg.masque-fill g.hi")?.children.length ?? 0)
          + (sr.querySelector("svg.masque-edge g.hi")?.children.length ?? 0)
          + (sr.querySelector("svg.masque-plain g.hi")?.children.length ?? 0),
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
    // `InteractionEvent` has no custom `show`, so `repr(ev)` is Julia's default positional
    // struct print: `InteractionEvent(:legend, 0, …)` — the ":<layerId>," prefix pins which
    // layer actually won the hit-test. Belt-and-suspenders on top of the index regex above:
    // this fails loud specifically on "resolved to the wrong layer", not just "wrong index".
    if (spec.overlapsGrid && new RegExp(`:${spec.overlapsGrid},\\s*\\d+\\b`).test(after)) {
      throw new Error(`${key}-click: bond resolved to grid layer "${spec.overlapsGrid}", not legend: ${after.slice(0, 220)}`);
    }
    console.error(`OK  ${key} — ${after.slice(0, 110)}`);

    // A legend entry's linked highlight (HitLayer.links) draws the SELECTED recipe for every
    // element of the target layer(s) into g.link — distinct from g.sel/g.hi. Generic: skipped
    // for every spec except the one(s) that carry a "links" meta key.
    if (spec.links) {
      // g.link exists in ALL THREE sibling svgs (mount.ts's `linkGroup` — fill_/edge_/plain_,
      // same as g.sel/g.hi), and `drawLink` fans a SELECTED-recipe element into whichever
      // group(s) each hit's geometry calls for (closed -> fill+edge pair, open -> plain-only
      // ring) — mirror `inspect()`'s existing `kidsOf` fan-out (tagged `layer: "fill"|"edge"|
      // "plain"`) instead of reading a single `g.link` (which would only ever see svg.masque-
      // fill's group, in DOM order first, and be empty for any ring-only case).
      const linkInspect = (k) => page.evaluate((kk) => {
        const span = document.querySelector(`#coords_${kk}`);
        const hosts = [...document.querySelectorAll(".ip-host")];
        const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
        let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
        const svgFill = sr.querySelector("svg.masque-fill"), svgEdge = sr.querySelector("svg.masque-edge"), svgPlain = sr.querySelector("svg.masque-plain");
        const kidsOf = (svg, layerName) => [...(svg?.querySelector("g.link")?.children ?? [])].map((el) => {
          if (el.tagName.toLowerCase() === "g") {
            return {
              layer: layerName, kind: "ring",
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
            layer: layerName, kind: "closed", tag: el.tagName.toLowerCase(),
            className: el.getAttribute("class"), stroke: cs.stroke, fill: cs.fill, fillOpacity: cs.fillOpacity,
            width: el.getAttribute("stroke-width"),
            blend: layerName === "plain" ? null : getComputedStyle(svg).mixBlendMode,
            r: el.getAttribute("r"), cx: el.getAttribute("cx"), cy: el.getAttribute("cy"),
          };
        });
        const kFill = kidsOf(svgFill, "fill"), kEdge = kidsOf(svgEdge, "edge"), kPlain = kidsOf(svgPlain, "plain");
        const kids = [...kFill, ...kEdge, ...kPlain];
        // Element count: a closed target draws fill+edge PAIRS (count once via fill), an open
        // target draws a single plain ring per element — same convention as layerElementCount.
        const count = kFill.filter((x) => x.kind === "closed").length + kPlain.filter((x) => x.kind === "ring").length;
        const sel = (svgFill?.querySelector("g.sel")?.children.length ?? 0)
          + (svgEdge?.querySelector("g.sel")?.children.length ?? 0)
          + (svgPlain?.querySelector("g.sel")?.children.length ?? 0);
        const firstPopulated = [svgFill, svgEdge, svgPlain]
          .map((svg) => svg?.querySelector("g.link"))
          .find((g) => g && g.children.length > 0);
        const leaving = firstPopulated ? firstPopulated.firstElementChild.classList.contains("masque-leave") : null;
        return { count, kids, sel, leaving };
      }, k);

      const layerElementCount = (l) => {
        const g = l.geometry;
        if (l.kind === "circles") return g.length / 3;
        if (l.kind === "rects") return g.length / 4;
        if (l.kind === "segments") return g.length / 4;
        if (l.kind === "polyline") return Math.max(0, g.length / 2 - 1);
        if (l.kind === "polygons") return g.length;
        throw new Error(`layerElementCount: unhandled kind ${l.kind}`);
      };

      for (const c of spec.links.cases) {
        const targetIds = (layer.links && layer.links[c.index]) || [];
        if (!targetIds.length) throw new Error(`${key}/links[${c.index}]: legend entry "${c.label}" has no links`);
        const hp = hitPoint(layer, c.index);
        // Geometry: the first linked element must sit ON the plotted mark, not beside it.
        const tl0 = layers.find((l) => l.id === targetIds[0]);
        if (!tl0) throw new Error(`${key}/links[${c.index}]: target layer ${targetIds[0]} missing from manifest`);
        const hp0 = hitPoint(tl0, 0);

        // Visibility (screenshot-based, closed/circles targets only): DOM shape alone can't
        // catch a z-order or blend surprise that leaves the nodes present but invisible — same
        // method as the TINT_CHECK_KEYS block above (`color-dodge` against the near-black fill
        // source can only raise luminance). Sampled BEFORE this case's hover dispatch below.
        let lumBefore = null;
        if (tl0.kind === "circles") {
          const expectColor = expectedColorFor(tl0.colors, spec.tintColor);
          lumBefore = meanLuminance(PNG.sync.read(
            await stableClipShot(key, hp0.x, hp0.y, { expectLum: rawColorLuminance(expectColor) }),
          ));
          assertRawColorMatch(lumBefore, expectColor, `${key}/links[${c.index}]/tint-applied`);
        }

        const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
        let t = null;
        for (let a = 0; a < 8; a++) {
          t = await dispatchAt(key, hp.x, hp.y, "pointermove");
          if (t?.show && norm(t.text).includes(norm(c.label))) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        if (!t?.show || !norm(t.text).includes(norm(c.label))) {
          throw new Error(`${key}/links[${c.index}]: tooltip ${JSON.stringify(t)} (want "${c.label}")`);
        }
        assertHoverRecipe(t.hi, `${key}/links[${c.index}]/legend-row-hover`);

        const li = await linkInspect(key);
        let expected = 0;
        for (const tid of targetIds) {
          const tl = layers.find((l) => l.id === tid);
          if (!tl) throw new Error(`${key}/links[${c.index}]: target layer ${tid} missing from manifest`);
          expected += layerElementCount(tl);
        }
        if (li.count !== expected) {
          throw new Error(`${key}/links[${c.index}]: g.link has ${li.count} elements, want ${expected} (targets ${JSON.stringify(targetIds)})`);
        }
        if (li.sel !== 0) throw new Error(`${key}/links[${c.index}]: g.sel changed during legend hover (${li.sel})`);

        if (tl0.kind === "circles") {
          const wash = {
            fill: li.kids.find((kk) => kk.layer === "fill" && kk.kind === "closed"),
            edge: li.kids.find((kk) => kk.layer === "edge" && kk.kind === "closed"),
            plain: li.kids.find((kk) => kk.layer === "plain" && kk.kind === "closed"),
          };
          assertWash(wash, `${key}/links[${c.index}]/wash`, wantDark);
          const circleKid = wash.fill || wash.edge;
          if (!circleKid) throw new Error(`${key}/links[${c.index}]: no circle in g.link`);
          if (Math.abs(Number(circleKid.cx) - hp0.x) > 0.6 || Math.abs(Number(circleKid.cy) - hp0.y) > 0.6) {
            throw new Error(`${key}/links[${c.index}]: link circle off-mark ${JSON.stringify(circleKid)} vs ${JSON.stringify(hp0)}`);
          }
          assertCircleR(circleKid.r, hp0.r, `${key}/links[${c.index}]/circle-r`);
          await new Promise((r) => setTimeout(r, 200)); // let the 80-120ms enter fade settle
          const lumAfter = meanLuminance(PNG.sync.read(await stableClipShot(key, hp0.x, hp0.y)));
          assertTintApplied(lumBefore, lumAfter, `${key}/links[${c.index}]/tint-applied`);
          passed.push(`${key}/links[${c.index}]/tint-applied`);
        } else if (tl0.kind === "polyline" || tl0.kind === "segments") {
          const ringKid = li.kids.find((kk) => kk.layer === "plain" && kk.kind === "ring");
          if (!ringKid) throw new Error(`${key}/links[${c.index}]: no ring in g.link`);
          assertRing(ringKid, `${key}/links[${c.index}]/ring`);
          const ln = ringKid.lines[0];
          if (Math.abs(Number(ln.x1) - hp0.x1) > 1.2 || Math.abs(Number(ln.y1) - hp0.y1) > 1.2) {
            throw new Error(`${key}/links[${c.index}]: link ring off-mark ${JSON.stringify(ln)} vs ${JSON.stringify(hp0)}`);
          }
        }
        passed.push(`${key}/links[${c.index}]`);
      }

      // Moving off the last-hovered legend entry fades g.link (not an instant clear), same
      // contract as g.hi — fanned across all three svgs, same reasoning as linkInspect above.
      const fadeLink = await page.evaluate((k) => {
        const span = document.querySelector(`#coords_${k}`);
        const hosts = [...document.querySelectorAll(".ip-host")];
        const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
        let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
        sr.querySelector(".surface").dispatchEvent(new PointerEvent("pointerleave", { bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true }));
        const groups = ["svg.masque-fill", "svg.masque-edge", "svg.masque-plain"].map((sel) => sr.querySelector(sel)?.querySelector("g.link"));
        const count = groups.reduce((n, g) => n + (g?.children.length ?? 0), 0);
        const firstPopulated = groups.find((g) => g && g.children.length > 0);
        return { count, leaving: !!(firstPopulated && firstPopulated.firstElementChild.classList.contains("masque-leave")) };
      }, key);
      if (fadeLink.count === 0) throw new Error(`${key}/links: cleared instantly (no remount fade)`);
      if (!fadeLink.leaving) throw new Error(`${key}/links: leave did not apply masque-leave`);
      let afterLinkLeave = await linkInspect(key);
      for (let a = 0; a < 8 && afterLinkLeave.count !== 0; a++) {
        await new Promise((r) => setTimeout(r, 25));
        afterLinkLeave = await linkInspect(key);
      }
      if (afterLinkLeave.count !== 0) throw new Error(`${key}/links: g.link lingered ${afterLinkLeave.count}`);
      passed.push(`${key}/links-fade`);

      // The click-bind assertion above already confirmed index==clickIdx; here confirm the
      // bond's payload actually carries label/targets (not just the index).
      const clickTargets = (layer.links && layer.links[clickIdx]) || [];
      if (!clickTargets.length || !clickTargets.every((tid) => new RegExp(tid, "i").test(after))) {
        throw new Error(`${key}/links: click payload missing targets ${JSON.stringify(clickTargets)}: ${after.slice(0, 220)}`);
      }
      if (spec.tip && !new RegExp(spec.tip, "i").test(after)) {
        throw new Error(`${key}/links: click payload missing label "${spec.tip}": ${after.slice(0, 220)}`);
      }
      passed.push(`${key}/links-click-payload`);
    }
  }

  // Hover-on-selected is a no-op: hovering scatter's baked-selected element (index 1, "beta")
  // must draw NO highlight at all (fill and edge both empty) — the mark keeps its opaque
  // selected wash instead, since a 1.5px hover stroke over the 2px selected stroke would read as
  // *weaker*, not stronger. The tooltip and `@bind` still work for that hit; only the highlight
  // is skipped.
  {
    const spec = meta.find((s) => s.key === "scatter");
    const layers = await layersOf("scatter");
    const layer = findLayer(layers, spec);
    const selPt = hitPoint(layer, spec.selectedIndex);
    let noop = null;
    for (let a = 0; a < 8; a++) {
      noop = await dispatchAt("scatter", selPt.x, selPt.y, "pointermove");
      if (noop.show && /beta/i.test(noop.text)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!noop.show || !/beta/i.test(noop.text)) throw new Error(`scatter/hover-on-selected: tooltip ${JSON.stringify(noop)}`);
    assertNoHighlight(noop.hi, "scatter/hover-on-selected");
    if (noop.sel < 1) throw new Error("scatter/hover-on-selected: g.sel missing while hovering the selected mark");
    passed.push("scatter/hover-on-selected-noop");
    await page.evaluate(() => {
      const span = document.querySelector("#coords_scatter");
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      sr.querySelector(".surface").dispatchEvent(new PointerEvent("pointerleave", { bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    });
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
