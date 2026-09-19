// Shared visual-fidelity asserts for kind_sweep.mjs + polish_verify.mjs.
// Recipe (locked in CLAUDE.md's "Overlay recipes" paragraph — cite, do not reopen):
// the shadow root holds two overlay svgs with identical box/viewBox. `svg.masque-blend`
// (DOM-first) carries `mix-blend-mode` (multiply on light figures, screen on dark) on the svg
// element itself — Firefox only honours the blend mode on a top-level svg, not nested SVG
// content, so there is no per-element wrapper. Every hover/selected highlight without an
// explicit Julia `hoverstyle` stroke is a BARE shape inside it: `masque-hi masque-hover` (hover
// — circle/rect/polygon, or a `line` for seg hover; the fill is inert on a line, so it reads as
// stroke-only on screen even though the class/fill are the same) or `masque-hi masque-wash`
// (selected). The shape's fill/stroke are fixed greys (GREY below), fill-opacity 1, stroke-width
// 1.5 (hover) / 2 (selected). `svg.masque-plain` (after it, unblended) holds ROI/threshold, the
// selected-seg ring (`g.sel > g > line×2`, unchanged ink), and hover/selected highlights for a
// layer with an explicit `hoverstyle` stroke — single element, stroke verbatim, 18%/35% tint in
// that colour (the pre-blend recipe, unchanged), open shapes staying stroke-only there (no
// `masque-hover`, `fill: none`). Remount fade is a plain opacity fade on the shape itself
// (`masque-enter`/`masque-leave`, no wrapper to isolate), 80-120ms.

export const ALERT_RED = "#ff3b30";
export const TEAL = "#3A6F7C";

// Fixed greys the blend-tint recipe reads from host custom properties — see mount.ts. No mark
// colour is involved: every kind darkens (light figure, multiply) or lightens (dark figure,
// screen) in its own hue without Masque knowing the element's colour.
export const GREY = {
  light: { hoverFill: "rgb(140, 140, 140)", hoverStroke: "rgb(85, 85, 85)", washFill: "rgb(102, 102, 102)", washStroke: "rgb(51, 51, 51)" },
  dark: { hoverFill: "rgb(115, 115, 115)", hoverStroke: "rgb(170, 170, 170)", washFill: "rgb(153, 153, 153)", washStroke: "rgb(204, 204, 204)" },
};

// getComputedStyle serializes a colour back out in whatever functional notation the browser
// picked for the value's colour space — not necessarily rgb(). A color-mix(in lch, …) result in
// particular can come back as lch(), lab(), oklch(), or (Chromium, gamut-mapped) color(srgb …).
// Returns 0-100 (rgb/color(srgb) rescaled; lab/lch already 0-100; oklab/oklch rescaled from
// their 0-1 lightness), or null if unparseable.
function colorLightness(s) {
  const str = String(s || "").trim();
  let m = str.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const ch = m[1].split(",").slice(0, 3).map((x) => Number(x.trim()));
    if (ch.some(Number.isNaN)) return null;
    return (ch.reduce((a, b) => a + b, 0) / 3 / 255) * 100;
  }
  m = str.match(/^color\(srgb\s+([^)]+)\)$/i);
  if (m) {
    const ch = m[1].trim().split(/\s+/).slice(0, 3).map((x) => Number(x));
    if (ch.some(Number.isNaN)) return null;
    return (ch.reduce((a, b) => a + b, 0) / 3) * 100;
  }
  m = str.match(/^(ok)?(?:lab|lch)\(([^)]+)\)$/i);
  if (m) {
    const L = Number(m[2].trim().split(/\s+/)[0]);
    if (Number.isNaN(L)) return null;
    return m[1] ? L * 100 : L;
  }
  return null;
}
export { colorLightness };

export function assertNoAlertRed(blob, where) {
  const s = typeof blob === "string" ? blob : JSON.stringify(blob);
  if (/#ff3b30|rgba?\(\s*255[\s,]+59[\s,]+48(?:[\s,/][^)]*)?\)/i.test(s)) {
    throw new Error(`${where}: alert red ${ALERT_RED} leaked into the overlay`);
  }
}

// The old fixed steel-teal ring #3A6F7C is retired — every highlight now either draws the
// fixed-grey blend tint (GREY above) or, for an explicit `hoverstyle`, the caller's own verbatim
// colour, so this literal must never appear in the overlay.
export function assertNoTeal(blob, where) {
  const s = typeof blob === "string" ? blob : JSON.stringify(blob);
  if (/#3a6f7c|rgb\(\s*58[\s,]+111[\s,]+124\s*\)/i.test(s)) {
    throw new Error(`${where}: steel-teal ${TEAL} leaked (highlight colour must be the blend-tint grey or an explicit hoverstyle, not a fixed literal)`);
  }
}

function hasClass(className, want) {
  return String(className || "").trim().split(/\s+/).includes(want);
}

function realColor(c) {
  return !!c && c !== "none" && c !== "rgba(0, 0, 0, 0)" && c !== "transparent";
}

// `wash`/`ring`/`hi` are captured in-page as { className, stroke, fill, fillOpacity (all
// getComputedStyle), width, opacity (stroke-width/stroke-opacity attributes), blend
// (getComputedStyle(svg.masque-blend).mixBlendMode when the shape lives in that svg, or null
// when it's in `svg.masque-plain` instead — the explicit-`hoverstyle` case), … geometry }.
// `wantDark` selects the figure-relative grey pair (GREY.dark for a dark figure, GREY.light
// otherwise) — irrelevant when `blend` is null.
export function assertWash(wash, where, wantDark) {
  if (!wash || !hasClass(wash.className, "masque-hi") || !hasClass(wash.className, "masque-wash")) {
    throw new Error(`${where}: wash element missing masque-hi/masque-wash class ${JSON.stringify(wash)}`);
  }
  if (wash.width !== "2") throw new Error(`${where}: wash recipe ${JSON.stringify(wash)}`);
  if (wash.blend) {
    if (wash.blend !== (wantDark ? "screen" : "multiply")) {
      throw new Error(`${where}: wash blend mode ${wash.blend} (want ${wantDark ? "screen" : "multiply"})`);
    }
    const g = wantDark ? GREY.dark : GREY.light;
    if (wash.fill !== g.washFill) throw new Error(`${where}: wash fill ${wash.fill} (want ${g.washFill})`);
    if (wash.stroke !== g.washStroke) throw new Error(`${where}: wash stroke ${wash.stroke} (want ${g.washStroke})`);
    if (String(wash.fillOpacity) !== "1") {
      throw new Error(`${where}: wash fill-opacity ${wash.fillOpacity} (want 1)`);
    }
  } else {
    // Explicit `hoverstyle` stroke: lives in svg.masque-plain, unblended, verbatim colour + 35%
    // tint (unchanged).
    if (!realColor(wash.fill) || wash.fill !== wash.stroke) {
      throw new Error(`${where}: wash fill/stroke mismatch ${JSON.stringify(wash)}`);
    }
    if (String(wash.fillOpacity) !== "0.35") {
      throw new Error(`${where}: wash fill-opacity ${wash.fillOpacity} (want 0.35)`);
    }
  }
  assertNoAlertRed(wash, where);
  assertNoTeal(wash, where);
}

export function assertRing(ring, where) {
  if (!ring || ring.lines.length !== 2) throw new Error(`${where}: ring ${JSON.stringify(ring)}`);
  if (!ring.lines.every((l) => hasClass(l.className, "masque-hi"))) {
    throw new Error(`${where}: ring line missing masque-hi class ${JSON.stringify(ring)}`);
  }
  const widths = ring.lines.map((l) => l.width).sort().join(",");
  if (widths !== "2,4") throw new Error(`${where}: ring recipe ${JSON.stringify(ring)}`);
  const strokes = ring.lines.map((l) => l.stroke);
  if (strokes[0] !== strokes[1] || !realColor(strokes[0])) {
    throw new Error(`${where}: ring stroke ${JSON.stringify(ring)}`);
  }
  const outer = ring.lines.find((l) => l.width === "4");
  if (!outer || String(outer.opacity) !== "0.25") {
    throw new Error(`${where}: ring outer opacity ${outer?.opacity} (want 0.25)`);
  }
  assertNoAlertRed(ring, where);
  assertNoTeal(ring, where);
}

// `closed` distinguishes the two UNBLENDED hover variants (explicit `hoverstyle`, `hi.blend`
// null, `svg.masque-plain`): a closed shape (circle/rect/poly) gets a tint fill on top of the
// stroke (masque-hover); an open shape (seg — lines/segments) stays stroke-only, no tint class.
// In the default BLENDED path (`hi.blend` set, `svg.masque-blend`) every hover — closed or an
// open seg's `<line>` — carries `masque-hover` and the same fixed-grey fill/stroke; a `<line>`
// has no interior area, so its fill is inert and it still reads as stroke-only on screen even
// though the DOM/CSS state is identical to a closed shape's. If `closed` is omitted, it's
// inferred from `hi.tag` (only a `line` element is open) — pass it explicitly when the caller
// didn't capture `tag`. `wantDark` selects GREY.dark/GREY.light; irrelevant when `hi.blend` is
// null.
export function assertHoverRecipe(hi, where, closed, wantDark) {
  if (!hi) throw new Error(`${where}: missing hover stroke`);
  if (closed === undefined) closed = hi.tag !== "line";
  if (!hasClass(hi.className, "masque-hi")) {
    throw new Error(`${where}: hover element missing masque-hi class ${JSON.stringify(hi)}`);
  }
  if (hi.width !== "1.5" || hi.opacity !== null) {
    throw new Error(`${where}: hover recipe ${JSON.stringify(hi)}`);
  }
  if (!realColor(hi.stroke)) {
    throw new Error(`${where}: hover stroke not resolved ${JSON.stringify(hi)}`);
  }
  if (hi.blend) {
    if (hi.blend !== (wantDark ? "screen" : "multiply")) {
      throw new Error(`${where}: hover blend mode ${hi.blend} (want ${wantDark ? "screen" : "multiply"})`);
    }
    if (!hasClass(hi.className, "masque-hover")) {
      throw new Error(`${where}: hover missing masque-hover tint class ${JSON.stringify(hi)}`);
    }
    const g = wantDark ? GREY.dark : GREY.light;
    if (hi.fill !== g.hoverFill) throw new Error(`${where}: hover fill ${hi.fill} (want ${g.hoverFill})`);
    if (hi.stroke !== g.hoverStroke) throw new Error(`${where}: hover stroke ${hi.stroke} (want ${g.hoverStroke})`);
    if (String(hi.fillOpacity) !== "1") {
      throw new Error(`${where}: hover fill-opacity ${hi.fillOpacity} (want 1)`);
    }
  } else if (closed) {
    // Explicit `hoverstyle` stroke, closed shape: unblended, verbatim colour + 18% tint (unchanged).
    if (!hasClass(hi.className, "masque-hover")) {
      throw new Error(`${where}: closed hover missing masque-hover tint class ${JSON.stringify(hi)}`);
    }
    if (!realColor(hi.fill) || hi.fill !== hi.stroke) {
      throw new Error(`${where}: hover tint fill/stroke mismatch ${JSON.stringify(hi)}`);
    }
    if (String(hi.fillOpacity) !== "0.18") {
      throw new Error(`${where}: hover fill-opacity ${hi.fillOpacity} (want 0.18)`);
    }
  } else {
    // Explicit `hoverstyle` stroke, open seg: unblended, stroke-only, no tint class.
    if (hasClass(hi.className, "masque-hover")) {
      throw new Error(`${where}: open hover unexpectedly has masque-hover tint class ${JSON.stringify(hi)}`);
    }
    if (hi.fill !== "none") {
      throw new Error(`${where}: open hover fill ${hi.fill} (want none, stroke-only)`);
    }
  }
  assertNoAlertRed(hi, where);
  assertNoTeal(hi, where);
}

// Circle highlight geometry: r must equal the underlying geometry r exactly (no more r+2 halo),
// for both hover and selected circles.
export function assertCircleR(actualR, geomR, where) {
  if (String(Number(actualR)) !== String(Number(geomR))) {
    throw new Error(`${where}: circle r=${actualR} geom r=${geomR} (want equal, no halo)`);
  }
}

export function assertRemountStable(info, where) {
  if (!info?.ok) throw new Error(`${where}: hover remounted (${info?.reason || "pulse"})`);
  if (!info.firstEnter) throw new Error(`${where}: first hover missing masque-enter fade`);
}

export function assertLeaveFade(info, where) {
  if (info.hi === 0) throw new Error(`${where}: hover cleared instantly (no remount fade)`);
  if (!info.leaving) throw new Error(`${where}: leave did not apply masque-leave`);
}

// The caret's visible apex — not the box `left`/`top` coordinates an e2e driver already reads
// elsewhere in this file — is the thing the "caret on the anchor" contract is actually about, and
// no jsdom/happy-dom unit test can check it (calc()/border-box geometry needs a real layout
// engine). apexX/anchorX are both real page-space px, measured in a live browser.
export function assertCaretAtAnchor(apexX, anchorX, where, tol = 1) {
  if (Math.abs(apexX - anchorX) > tol) {
    throw new Error(`${where}: caret apex at ${apexX.toFixed(1)}px, anchor at ${anchorX.toFixed(1)}px (want within ${tol}px)`);
  }
}

// Tooltip theme is derived from the FIGURE's own background (CSS relative-colour syntax,
// mount.ts), not just OS prefers-color-scheme — so this checks brightness *relationships*
// (bg/fg contrast in the expected direction), not hardcoded rgb literals: the exact sRGB a
// browser's lch(from …) resolves to isn't something to hand-compute and pin down here.
export function assertTipBrightness(cs, wantDark, where) {
  const bgL = colorLightness(cs.bg), fgL = colorLightness(cs.color);
  if (bgL === null || fgL === null) throw new Error(`${where}: could not parse tip colors ${JSON.stringify(cs)}`);
  const bgOk = wantDark ? bgL < 40 : bgL > 60;
  const fgOk = wantDark ? fgL > 60 : fgL < 40;
  if (!bgOk || !fgOk) {
    throw new Error(
      `${where}: tip ${JSON.stringify(cs)} not ${wantDark ? "dark" : "light"}-themed (bgL=${bgL.toFixed(1)} fgL=${fgL.toFixed(1)})`,
    );
  }
}

// The `@supports not (…)` block in mount.ts's STYLE is the fallback for browsers without CSS
// relative-colour syntax — it reproduces the old static-light / OS-dark behaviour verbatim, so
// its literals (#1e1e1e/#e8e8e8) still have to be present; their absence here means the legacy
// fallback path itself is missing, not that a modern browser is failing to go dark.
export function assertSchemeCss(css, where) {
  if (!/prefers-color-scheme:\s*dark/.test(css)) {
    throw new Error(`${where}: overlay CSS missing prefers-color-scheme: dark (relative-colour fallback path)`);
  }
  if (!/#1e1e1e/.test(css) || !/#e8e8e8/.test(css)) {
    throw new Error(`${where}: legacy no-relative-colour dark tooltip fallback tokens missing`);
  }
  assertNoAlertRed(css, where);
}

// sample.css() reads the injected stylesheet once. sample.computedFor("light"|"dark") hovers
// the corresponding figure (default-background vs. explicitly dark-background) and returns its
// tooltip's { bg, color }. Confirms both a light and a dark FIGURE get the right tooltip theme,
// and — the actual new contract — that OS colour-scheme alone does *not* flip a light figure's
// tooltip once the figure itself carries a background.
export async function assertTooltipColorScheme(page, sample) {
  assertSchemeCss(await sample.css(), "overlay-css");
  assertTipBrightness(await sample.computedFor("light"), false, "tooltip/light-figure");
  assertTipBrightness(await sample.computedFor("dark"), true, "tooltip/dark-figure");
  await page.emulateMedia({ colorScheme: "dark" });
  assertTipBrightness(await sample.computedFor("light"), false, "tooltip/light-figure-under-os-dark");
  await page.emulateMedia({ colorScheme: "light" });
}

// Tint-applied (blend darkens/lightens the mark itself, screenshot-verified): mean luminance
// (0-255) of a small page.screenshot() clip centred on the mark, taken before vs. after the
// hover blend-tint applies. A light figure must get darker (drop), a dark figure lighter
// (rise) — by at least `minDelta`, kept loose since exact grey/blend math varies by figure and
// GPU/driver AA. This is what replaced the old mark-derived-ink lightness check: the highlight
// no longer reads the mark's colour at all, so there is nothing per-element left to compare —
// only whether the blend visibly tinted the pixels in the right direction. See PNG.sync.read
// (pngjs, already a devDependency here) for the buffer -> RGBA decode.
export function meanLuminance(png) {
  let sum = 0;
  const n = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) {
    sum += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
  }
  return sum / n;
}

export function assertTintApplied(lumBefore, lumAfter, wantDark, where, minDelta = 4) {
  const delta = lumAfter - lumBefore;
  const ok = wantDark ? delta >= minDelta : delta <= -minDelta;
  if (!ok) {
    throw new Error(
      `${where}: luminance before=${lumBefore.toFixed(1)} after=${lumAfter.toFixed(1)} delta=${delta.toFixed(1)} ` +
      `(want ${wantDark ? `>= +${minDelta}` : `<= -${minDelta}`})`,
    );
  }
}
