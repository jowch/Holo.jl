// Agent kind-sweep live-verify (LOCAL — not CI). Drives docs/live-interaction-checklist.md
// — interaction AND visual — across every interactable kind on one backend.
// A 2-plot kitchen-sink is not enough. polish_verify.mjs is the required visual-chrome
// sibling (fade + prefers-color-scheme). This file asserts fade / no-pulse per kind
// and prefers-color-scheme once (scatter).
//
//   node kind_sweep.mjs <base-url> <notebook-abs-path> <cairo|webgl>
import { chromium } from "playwright";
import {
  assertNoAlertRed, assertWash, assertRing, assertHoverRecipe,
  assertRemountStable, assertLeaveFade, assertTooltipColorScheme,
} from "./visual_assert.mjs";

const [base, notebook, backend] = process.argv.slice(2);
if (!base || !notebook || !backend) {
  console.error("usage: node kind_sweep.mjs <base-url> <notebook> <cairo|webgl>");
  process.exit(2);
}

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
try {
  const context = await browser.newContext({
    locale: "en-US", timezoneId: "UTC",
    viewport: { width: 1100, height: 1400 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    const shim = SHIM_LEAK.test(e.message);
    const benign = shim && ALLOWED.some((re) => re.test(e.message));
    if (!benign) unexpected.push(e.message);
    console.error(benign ? "PAGEERROR (known-benign):" : "PAGEERROR:", e.message);
  });

  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const deadline = Date.now() + 1500000;
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
    if (!st.busy && st.metaN >= 14 && st.surfaces >= st.metaN) { ready = true; break; }
    if (tick % 20 === 0) {
      console.error(`  …${backend} [${tick}s] busy=${st.busy} hosts=${st.hosts} surfaces=${st.surfaces} meta=${st.metaN} title=${JSON.stringify(st.title || "")} url=${st.url || ""}`);
    }
    tick++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error(`${backend} timed out waiting for kind-sweep widgets`);
  console.error(`phase: widgets mounted (${backend})`);

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
    const svg = sr.querySelector("svg");
    const hb = host.getBoundingClientRect(), bb = baseEl.getBoundingClientRect(), sb = svg.getBoundingClientRect();
    const kids = [...(sr.querySelector("g.sel")?.children ?? [])].map((el) => {
      if (el.tagName.toLowerCase() === "g") {
        return {
          kind: "ring",
          lines: [...el.querySelectorAll("line")].map((ln) => ({
            fill: ln.getAttribute("fill"), stroke: ln.getAttribute("stroke"),
            width: ln.getAttribute("stroke-width"), opacity: ln.getAttribute("stroke-opacity"),
            x1: ln.getAttribute("x1"), y1: ln.getAttribute("y1"),
            x2: ln.getAttribute("x2"), y2: ln.getAttribute("y2"),
          })),
        };
      }
      return {
        kind: "closed", tag: el.tagName.toLowerCase(),
        fill: el.getAttribute("fill"), stroke: el.getAttribute("stroke"),
        width: el.getAttribute("stroke-width"),
        r: el.getAttribute("r"), cx: el.getAttribute("cx"), cy: el.getAttribute("cy"),
        x: el.getAttribute("x"), y: el.getAttribute("y"),
        w: el.getAttribute("width"), h: el.getAttribute("height"),
        points: el.getAttribute("points"),
      };
    });
    return {
      baseTag: baseEl.tagName.toLowerCase(),
      host: { w: hb.width, h: hb.height },
      base: { w: bb.width, h: bb.height, x: bb.x, y: bb.y },
      svg: { w: sb.width, h: sb.height, x: sb.x, y: sb.y },
      kids,
      sel: sr.querySelector("g.sel")?.children.length ?? 0,
      hi: sr.querySelector("g.hi")?.children.length ?? 0,
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
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
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
    const tip = sr.querySelector(".holo-tip");
    const hi = sr.querySelector("g.hi")?.firstElementChild;
    return {
      show: tip?.classList.contains("show"),
      text: (tip?.innerText || "").replace(/\s+/g, " ").trim(),
      hi: hi ? {
        tag: hi.tagName.toLowerCase(),
        fill: hi.getAttribute("fill"),
        stroke: hi.getAttribute("stroke"),
        width: hi.getAttribute("stroke-width"),
        opacity: hi.getAttribute("stroke-opacity"),
        r: hi.getAttribute("r"), cx: hi.getAttribute("cx"), cy: hi.getAttribute("cy"),
        x1: hi.getAttribute("x1"), y1: hi.getAttribute("y1"),
        x2: hi.getAttribute("x2"), y2: hi.getAttribute("y2"),
      } : null,
      sel: sr.querySelector("g.sel")?.children.length ?? 0,
    };
  }, [key, x, y, type]);

  const textOf = (sel) => page.evaluate((q) => document.querySelector(q)?.innerText ?? "", sel);

  const drag = async (key, x0, y0, x1, y1, shift = false) => {
    const a = await page.evaluate(([k, ix, iy]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const b = host.querySelector("img, canvas").getBoundingClientRect();
      const outW = sr.querySelector("svg").viewBox.baseVal.width;
      const s = b.width / outW;
      return { cx: b.left + ix * s, cy: b.top + iy * s };
    }, [key, x0, y0]);
    const b = await page.evaluate(([k, ix, iy]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const box = host.querySelector("img, canvas").getBoundingClientRect();
      const outW = sr.querySelector("svg").viewBox.baseVal.width;
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
    const sh = await shadowOf(key);
    if (!sh?.ok) throw new Error(`${key}: overlay surface missing`);
    const m = await inspect(key);
    if (m.baseTag !== expectBase) throw new Error(`${key}: expected ${expectBase}, got ${m.baseTag}`);
    const dx = Math.abs(m.svg.x - m.base.x), dy = Math.abs(m.svg.y - m.base.y);
    const dw = Math.abs(m.svg.w - m.base.w), dh = Math.abs(m.svg.h - m.base.h);
    if (dx > 2 || dy > 2 || dw > 3 || dh > 3) {
      throw new Error(`${key}: overlay/base offset svg=${JSON.stringify(m.svg)} base=${JSON.stringify(m.base)}`);
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
      assertWash(wash, key);
      if (spec.halo) {
        const hp = hitPoint(layer, spec.selectedIndex);
        if (String(Number(wash.r)) !== String(hp.r + 2)) {
          throw new Error(`${key}: halo r=${wash.r} geom r=${hp.r} (want r+2)`);
        }
        if (Math.abs(Number(wash.cx) - hp.x) > 0.6 || Math.abs(Number(wash.cy) - hp.y) > 0.6) {
          throw new Error(`${key}: selected not centered cx=${wash.cx},${wash.cy} geom=${hp.x},${hp.y}`);
        }
        passed.push(`${key}/halo-r+2`);
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
    let tip = null;
    for (let a = 0; a < 8; a++) {
      tip = await dispatchAt(key, hoverPt.x, hoverPt.y, "pointermove");
      if (tipHit(tip)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!tipHit(tip)) throw new Error(`${key}: tooltip ${JSON.stringify(tip)}`);
    assertHoverRecipe(tip.hi, key);
    assertNoAlertRed(m.kids, `${key}/sel`);
    const hiStable = await page.evaluate(([k, ix, iy]) => {
      const span = document.querySelector(`#coords_${k}`);
      const hosts = [...document.querySelectorAll(".ip-host")];
      const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const b = host.querySelector("img, canvas").getBoundingClientRect();
      const outW = sr.querySelector("svg").viewBox.baseVal.width;
      const s = b.width / outW;
      const o = {
        bubbles: true, composed: true, cancelable: true,
        clientX: b.left + ix * s, clientY: b.top + iy * s,
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
        firstEnter: first.classList.contains("holo-enter"),
      };
    }, [key, hoverPt.x, hoverPt.y]);
    assertRemountStable(hiStable, key);
    passed.push(`${key}/no-pulse`);
    if (spec.halo && tip.hi?.r != null) {
      const hp = hitPoint(layer, spec.selectedIndex);
      if (String(Number(tip.hi.r)) !== String(hp.r + 2)) {
        throw new Error(`${key}: hover halo r=${tip.hi.r} want ${hp.r + 2}`);
      }
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
      const hi = sr.querySelector("g.hi")?.firstElementChild;
      return {
        hi: sr.querySelector("g.hi")?.children.length ?? 0,
        leaving: !!(hi && hi.classList.contains("holo-leave")),
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

  const schemeSpec = meta.find((s) => s.key === "scatter") || meta.find((s) => s.mode === "element");
  if (!schemeSpec) throw new Error("no scatter/element spec for prefers-color-scheme");
  {
    const slayers = await layersOf(schemeSpec.key);
    const slayer = findLayer(slayers, schemeSpec);
    const spt = hitPoint(slayer, schemeSpec.selectedIndex);
    await assertTooltipColorScheme(page, {
      css: () => page.evaluate((k) => {
        const span = document.querySelector(`#coords_${k}`);
        const hosts = [...document.querySelectorAll(".ip-host")];
        const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
        let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
        return sr.querySelector("style")?.textContent || "";
      }, schemeSpec.key),
      computed: async () => {
        await dispatchAt(schemeSpec.key, spt.x, spt.y, "pointermove");
        return page.evaluate((k) => {
          const span = document.querySelector(`#coords_${k}`);
          const hosts = [...document.querySelectorAll(".ip-host")];
          const host = hosts.filter((h) => (h.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
          let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
          const t = sr.querySelector(".holo-tip");
          const cs = getComputedStyle(t);
          return { bg: cs.backgroundColor, color: cs.color, show: t?.classList.contains("show") };
        }, schemeSpec.key);
      },
    });
    passed.push("prefers-color-scheme");
  }

  if (unexpected.length) throw new Error(`page errors: ${unexpected.join(" | ")}`);
  passed.push("no-console-errors");
  console.log(`KIND SWEEP OK — ${backend}: ${passed.join(", ")}`);
} catch (e) {
  failed = e;
} finally {
  await browser.close();
}
if (failed) {
  console.error(`KIND SWEEP FAIL (${backend}, after ${passed.join(", ")}):`, failed.message);
  process.exit(1);
}
