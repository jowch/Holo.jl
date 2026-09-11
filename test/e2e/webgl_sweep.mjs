// :webgl live-verify sweep (LOCAL tool — deliberately not wired into CI): drives every distinct
// overlay code path against the live-canvas backend in a real Pluto kernel, per the standing
// live-verify doctrine (every supported backend — today :cairo and :webgl; this file is the
// :webgl half).
// Covered: template tooltip · auto payload click · grid (i,j)=value readout · colorbar 1-D value
// readout · polygon / region / text clicks · threshold drag commit · whole-axis readout click ·
// selects-ROI box-select drag · selected= pre-highlight on mount.
// Coordinates come from hidden `coords_*` spans the notebook exports from each widget's LIVE
// manifest (examples/webgl_demo.jl `coordspan`) — no duplicated figure math.
// Not CI: through-Pluto jobs are the flake-prone kind; the cell-level notebook already runs in
// the Example notebooks job, and the bond/alignment fundamentals are CI-covered by test/e2e.
//
//   julia test/e2e/serve.jl 1234 &   # poll http://127.0.0.1:1234 for 200
//   (cd test/e2e && npm install && node webgl_sweep.mjs http://127.0.0.1:1234 "$PWD/../../examples/webgl_demo.jl")
import { chromium } from "playwright";

const [base, notebook] = process.argv.slice(2);
if (!base || !notebook) { console.error("usage: node webgl_sweep.mjs <base-url> <notebook-abs-path>"); process.exit(2); }

const browser = await chromium.launch({ headless: true });
let failed = null;
const passed = [];
try {
  const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC" });
  const page = await context.newPage();
  await page.goto(`${base}/open?path=${encodeURIComponent(notebook)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.error("phase: notebook opened");

  const NWIDGETS = 7; // 2d, 3d, tip, grid, poly, thr, sel (document order)
  const deadline = Date.now() + 1800000;
  let ready = false, tick = 0;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const runBtn = [...document.querySelectorAll("button, a")].find((b) => /run notebook code/i.test(b.innerText || b.title || ""));
      if (runBtn) runBtn.click();
      const hosts = [...document.querySelectorAll(".ip-host")];
      const surfaces = hosts.filter((h) => { let sr = null; h.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; }); return sr && sr.querySelector(".surface"); }).length;
      return {
        busy: document.querySelectorAll("pluto-cell.running, pluto-cell.queued").length,
        errored: document.querySelectorAll("pluto-cell.errored").length,
        hosts: hosts.length, surfaces,
        coords: ["tip", "grid", "poly", "thr", "sel"].every((k) => document.querySelector(`#coords_${k}`)),
      };
    });
    if (st.errored) throw new Error(`notebook has ${st.errored} errored cell(s)`);
    if (st.hosts > NWIDGETS) throw new Error(`${st.hosts} widgets for ${NWIDGETS} cells — stale duplicate outputs from a previous attach; restart the Pluto server for a clean session`);
    if (!st.busy && st.hosts === NWIDGETS && st.surfaces === NWIDGETS && st.coords) { ready = true; break; }
    if (tick % 30 === 0) console.error(`  …waiting [${tick}s] busy=${st.busy} hosts=${st.hosts}/${NWIDGETS} surfaces=${st.surfaces}`);
    tick++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error("timed out waiting for widgets/coords");
  console.error("phase: all widgets mounted");

  // ---------- in-page helpers ----------
  const layersOf = (key) => page.evaluate((k) => JSON.parse(document.querySelector(`#coords_${k}`).innerText), key);
  // image-px -> client event opts for widget i
  const mkEvt = (i, x, y) => page.evaluate(([idx, ix, iy]) => {
    const host = [...document.querySelectorAll(".ip-host")][idx];
    let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
    const b = host.querySelector("img, canvas").getBoundingClientRect();
    const outW = sr.querySelector("svg").viewBox.baseVal.width;
    const s = b.width / outW;
    return { cx: b.left + ix * s, cy: b.top + iy * s };
  }, [i, x, y]);
  const hover = async (i, x, y) => {
    const { cx, cy } = await mkEvt(i, x, y);
    return page.evaluate(([idx, cx2, cy2]) => {
      const host = [...document.querySelectorAll(".ip-host")][idx];
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const o = { bubbles: true, composed: true, cancelable: true, clientX: cx2, clientY: cy2 };
      sr.querySelector(".surface").dispatchEvent(new MouseEvent("mousemove", o));
      const tip = sr.querySelector(".holo-tip");
      return tip ? { display: tip.style.display, text: tip.innerText } : null;
    }, [i, cx, cy]);
  };
  const retryHover = async (i, x, y, pred, what) => {
    for (let a = 0; a < 8; a++) {
      const t = await hover(i, x, y);
      if (t && pred(t)) return t;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`${what}: tooltip never matched (last=${JSON.stringify(await hover(i, x, y))})`);
  };
  const click = async (i, x, y) => {
    const { cx, cy } = await mkEvt(i, x, y);
    await page.evaluate(([idx, cx2, cy2]) => {
      const host = [...document.querySelectorAll(".ip-host")][idx];
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const o = { bubbles: true, composed: true, cancelable: true, clientX: cx2, clientY: cy2 };
      const surface = sr.querySelector(".surface");
      surface.dispatchEvent(new MouseEvent("mousemove", o));
      surface.dispatchEvent(new MouseEvent("click", o));
    }, [i, cx, cy]);
  };
  const drag = async (i, x0, y0, x1, y1) => {
    const a = await mkEvt(i, x0, y0), b = await mkEvt(i, x1, y1);
    await page.evaluate(([idx, ax, ay, bx, by]) => {
      const host = [...document.querySelectorAll(".ip-host")][idx];
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      const surface = sr.querySelector(".surface");
      const down = { bubbles: true, composed: true, cancelable: true, clientX: ax, clientY: ay };
      surface.dispatchEvent(new MouseEvent("mousedown", down));
      // drag listeners live on window (overlay.ts) — move in a few steps, then release
      for (let t = 0.25; t <= 1.0; t += 0.25) {
        const o = { bubbles: true, cancelable: true, clientX: ax + (bx - ax) * t, clientY: ay + (by - ay) * t };
        window.dispatchEvent(new MouseEvent("mousemove", o));
      }
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: bx, clientY: by }));
    }, [i, a.cx, a.cy, b.cx, b.cy]);
  };
  const text = (sel) => page.evaluate((q) => document.querySelector(q)?.innerText ?? "", sel);
  const waitChange = async (sel, before, what) => {
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const t = await text(sel);
      if (t !== before && t.length) return t;
    }
    throw new Error(`${what}: ${sel} never changed from ${JSON.stringify(before)}`);
  };
  const clickAssert = async (i, x, y, outSel, re, what) => {
    const before = await text(outSel);
    for (let a = 0; a < 3; a++) {
      await click(i, x, y);
      try {
        const after = await waitChange(outSel, before, what);
        if (!re.test(after)) throw new Error(`${what}: readout mismatch: ${JSON.stringify(after)}`);
        passed.push(what);
        console.error(`OK  ${what} — ${after.slice(0, 110)}`);
        return after;
      } catch (e) { if (a === 2) throw e; }
    }
  };

  // ---------- tip: template tooltip + payload click (widget 2) ----------
  {
    const L = (await layersOf("tip"))[0];
    const [cx, cy] = [L.geometry[0], L.geometry[1]];
    const t = await retryHover(2, cx, cy, (tt) => /point alpha/.test(tt.text), "template-tooltip");
    passed.push("template-tooltip");
    console.error("OK  template-tooltip —", JSON.stringify(t.text));
    await clickAssert(2, cx, cy, "#out_tip", /InteractionEvent\(:tpts, 0.*alpha/, "template-click");
  }

  // ---------- grid: (i,j)=value readout + colorbar value readout (widget 3) ----------
  {
    const Ls = await layersOf("grid");
    const grid = Ls.find((l) => l.kind === "grid");
    const cb = Ls.find((l) => l.kind === "axis" && l.id.startsWith("colorbar"));
    const gx = (grid.geometry.xedges[0] + grid.geometry.xedges[1]) / 2;
    const gy = (grid.geometry.yedges[0] + grid.geometry.yedges[1]) / 2;
    const t = await retryHover(3, gx, gy, (tt) => /\(0,\s*0\)\s*=\s*4/.test(tt.text), "grid-readout");
    passed.push("grid-readout");
    console.error("OK  grid-readout —", JSON.stringify(t.text));
    await clickAssert(3, gx, gy, "#out_grid", /"i"\s*=>\s*0|i.*0/, "grid-click");
    const [bx, by, bw, bh] = cb.geometry;
    // 1-D value readout: the tip shows the bare number; mid-bar over limits [4,19] ≈ 11.5
    const ct = await retryHover(3, bx + bw / 2, by + bh / 2, (tt) => {
      const v = parseFloat(tt.text);
      return Number.isFinite(v) && Math.abs(v - 11.5) < 0.5;
    }, "colorbar-readout");
    passed.push("colorbar-readout");
    console.error("OK  colorbar-readout —", JSON.stringify(ct.text));
  }

  // ---------- poly: polygon / region / text clicks (widget 4) ----------
  {
    const Ls = await layersOf("poly");
    const tri = Ls.find((l) => l.id === "tri");
    const ring = tri.geometry[0];
    let mx = 0, my = 0, n = ring.length / 2;
    for (let k = 0; k < ring.length; k += 2) { mx += ring[k]; my += ring[k + 1]; }
    await clickAssert(4, mx / n, my / n, "#out_poly", /InteractionEvent\(:tri, 0/, "polygon-click");
    const regC = Ls.find((l) => l.id === "reg_c");
    await clickAssert(4, regC.geometry[0], regC.geometry[1], "#out_poly", /:reg_c, 0.*circ/, "region-click");
    const lbl = Ls.find((l) => l.id === "lbl");
    await clickAssert(4, lbl.geometry[0], lbl.geometry[1], "#out_poly", /:lbl, 0.*labelled/, "text-click");
  }

  // ---------- thr: threshold drag commit + axis readout click (widget 5) ----------
  {
    const Ls = await layersOf("thr");
    const thr = Ls.find((l) => l.kind === "threshold");
    const pos = thr.geometry.pos, [s0, s1] = thr.geometry.span;
    const midx = (s0 + s1) / 2;
    const before = await text("#out_thr");
    await drag(5, midx, pos, midx, pos - 40);   // pull the line up ≈ higher data value
    const after = await waitChange("#out_thr", before, "threshold-drag");
    if (!/:thr/.test(after)) throw new Error(`threshold-drag: readout mismatch: ${JSON.stringify(after)}`);
    passed.push("threshold-drag");
    console.error("OK  threshold-drag —", after.slice(0, 110));
    // axis readout: click empty space inside the viewport (top-left quadrant, away from markers/line)
    await clickAssert(5, s0 + (s1 - s0) * 0.15, pos - 80, "#out_thr", /:axis, -1.*"x"\s*=>|:axis, -1/, "axis-readout-click");
  }

  // ---------- sel: selected= pre-highlight + box-select drag (widget 6) ----------
  {
    const selCount = await page.evaluate(() => {
      const host = [...document.querySelectorAll(".ip-host")][6];
      let sr = null; host.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) sr = el.shadowRoot; });
      return sr.querySelectorAll("g.sel > *").length;
    });
    if (selCount < 1) throw new Error(`selected= pre-highlight missing on :webgl mount (g.sel count=${selCount})`);
    passed.push("selected-prehighlight");
    console.error(`OK  selected-prehighlight — g.sel count=${selCount}`);
    const Ls = await layersOf("sel");
    const roi = Ls.find((l) => l.kind === "roi");
    const g = roi.geometry;
    const before = await text("#out_sel");
    // drag the ROI interior by half its width — commit selects points inside the NEW bounds
    await drag(6, g.x + g.w / 2, g.y + g.h / 2, g.x + g.w, g.y + g.h / 2);
    const after = await waitChange("#out_sel", before, "box-select-drag");
    if (!/InteractionEvent\[/.test(after)) throw new Error(`box-select-drag: expected a Vector bond, got ${JSON.stringify(after)}`);
    passed.push("box-select-drag");
    console.error("OK  box-select-drag —", after.slice(0, 130));
  }

  console.log(`WEBGL SWEEP OK — ${passed.length} paths verified live on :webgl: ${passed.join(", ")}`);
} catch (e) {
  failed = e;
} finally {
  await browser.close();
}
if (failed) { console.error(`WEBGL SWEEP FAIL (after ${passed.length} OK: ${passed.join(", ")}):`, failed.message); process.exit(1); }
