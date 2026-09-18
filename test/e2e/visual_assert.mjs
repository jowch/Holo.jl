// Shared visual-fidelity asserts for kind_sweep.mjs + polish_verify.mjs.
// Recipe (locked in CLAUDE.md's "Overlay recipes" paragraph — cite, do not reopen):
// every highlight element carries class masque-hi and gets its colour from the shadow
// stylesheet (never a stroke/fill attribute) — a neutral figure-aware ink by default, or the
// mark's own colour mixed toward that ink when resolvable. Hover on a closed shape
// (circle/rect/poly) = 1.5px stroke flush on the mark's own drawn edge + an 18% tint fill
// (masque-hi masque-hover); hover on an open shape (seg — lines/segments) stays stroke-only
// (masque-hi, no masque-hover, fill: none). Selected closed = 35% wash fill + 2px stroke;
// selected open = ring; remount fade.

export const ALERT_RED = "#ff3b30";
export const TEAL = "#3A6F7C";

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

// The old fixed steel-teal ring #3A6F7C is retired — every highlight now derives its colour
// from the mark or the figure-aware ink, so this literal must never appear in the overlay.
export function assertNoTeal(blob, where) {
  const s = typeof blob === "string" ? blob : JSON.stringify(blob);
  if (/#3a6f7c|rgb\(\s*58[\s,]+111[\s,]+124\s*\)/i.test(s)) {
    throw new Error(`${where}: steel-teal ${TEAL} leaked (highlight colour must derive from the mark/ink, not a fixed literal)`);
  }
}

function hasClass(className, want) {
  return String(className || "").trim().split(/\s+/).includes(want);
}

function realColor(c) {
  return !!c && c !== "none" && c !== "rgba(0, 0, 0, 0)" && c !== "transparent";
}

// `wash`/`ring`/`hi` are captured in-page as { className, stroke, fill, fillOpacity (all
// getComputedStyle), width, opacity (stroke-width/stroke-opacity attributes), … geometry }.
export function assertWash(wash, where) {
  if (!wash || !hasClass(wash.className, "masque-hi") || !hasClass(wash.className, "masque-wash")) {
    throw new Error(`${where}: wash element missing masque-hi/masque-wash class ${JSON.stringify(wash)}`);
  }
  if (wash.width !== "2") throw new Error(`${where}: wash recipe ${JSON.stringify(wash)}`);
  if (!realColor(wash.fill) || wash.fill !== wash.stroke) {
    throw new Error(`${where}: wash fill/stroke mismatch ${JSON.stringify(wash)}`);
  }
  if (String(wash.fillOpacity) !== "0.35") {
    throw new Error(`${where}: wash fill-opacity ${wash.fillOpacity} (want 0.35)`);
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

// `closed` distinguishes the two hover variants: a closed shape (circle/rect/poly) gets an
// 18% tint fill on top of the stroke (masque-hover); an open shape (seg — lines/segments)
// stays stroke-only. If omitted, inferred from `hi.tag` (only a `line` element is open) —
// pass it explicitly when the caller didn't capture `tag`.
export function assertHoverRecipe(hi, where, closed) {
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
  if (closed) {
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

// Mark-colour derivation: hover/selected outline colour is the mark's own colour mixed toward
// --masque-ink (darker on light figures, lighter on dark), never the raw mark colour, and never
// the fixed teal. `strokeL` is the highlight's computed-stroke lightness (colorLightness); `markL`
// is the resolved mark colour's lightness (also colorLightness, of a temp element's
// getComputedStyle(...).color after `style.color = mark` — done in-page, see kind_sweep.mjs).
export function assertMarkDerivedInk(strokeL, markL, wantDarker, where) {
  if (strokeL === null || markL === null) {
    throw new Error(`${where}: could not parse stroke/mark lightness (stroke=${strokeL}, mark=${markL})`);
  }
  const diff = markL - strokeL; // positive: stroke is darker than the mark
  if (wantDarker ? diff < 5 : diff > -5) {
    throw new Error(`${where}: stroke L=${strokeL.toFixed(1)} vs mark L=${markL.toFixed(1)} not ${wantDarker ? "darker" : "lighter"} by >=5`);
  }
}

// No resolvable mark colour (no `colors` on the layer): the outline falls back to the neutral
// figure-aware ink, which on a light figure must read as dark (well below mid lightness).
export function assertNeutralDarkInk(strokeL, where) {
  if (strokeL === null) throw new Error(`${where}: could not parse stroke lightness`);
  if (strokeL >= 30) throw new Error(`${where}: stroke L=${strokeL.toFixed(1)} not neutral dark ink (want <30)`);
}
