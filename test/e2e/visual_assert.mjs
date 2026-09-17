// Shared visual-fidelity asserts for kind_sweep.mjs + polish_verify.mjs.
// Recipes are locked in the store visual-design.md (cite, do not reopen):
// inspector ink #3A6F7C, wash / ring / halo r+2, remount fade, OS prefers-color-scheme.

export const INK = "#3A6F7C";
export const WASH = "rgba(58, 111, 124, 0.12)";
export const ALERT_RED = "#ff3b30";

// getComputedStyle serializes an achromatic lch()-derived colour back out as lch(), not rgb()
// (observed in Chromium) — so brightness has to be read off whichever functional notation the
// browser chose, not assumed to be rgb(). Returns 0-100 (rgb rescaled; lab/lch already 0-100;
// oklab/oklch rescaled from their 0-1 lightness), or null if unparseable.
function colorLightness(s) {
  const str = String(s || "").trim();
  let m = str.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const ch = m[1].split(",").slice(0, 3).map((x) => Number(x.trim()));
    if (ch.some(Number.isNaN)) return null;
    return (ch.reduce((a, b) => a + b, 0) / 3 / 255) * 100;
  }
  m = str.match(/^(ok)?(?:lab|lch)\(([^)]+)\)$/i);
  if (m) {
    const L = Number(m[2].trim().split(/\s+/)[0]);
    if (Number.isNaN(L)) return null;
    return m[1] ? L * 100 : L;
  }
  return null;
}

export function assertNoAlertRed(blob, where) {
  const s = typeof blob === "string" ? blob : JSON.stringify(blob);
  if (/#ff3b30|rgba?\(\s*255[\s,]+59[\s,]+48(?:[\s,/][^)]*)?\)/i.test(s)) {
    throw new Error(`${where}: alert red ${ALERT_RED} leaked (want steel-teal ${INK})`);
  }
}

export function assertWash(wash, where) {
  if (!wash || wash.fill !== WASH || wash.stroke !== INK || wash.width !== "2.5") {
    throw new Error(`${where}: wash recipe ${JSON.stringify(wash)}`);
  }
  assertNoAlertRed(wash, where);
}

export function assertRing(ring, where) {
  if (!ring || ring.lines.length !== 2) throw new Error(`${where}: ring ${JSON.stringify(ring)}`);
  const widths = ring.lines.map((l) => l.width).sort().join(",");
  if (widths !== "2,4" || !ring.lines.every((l) => l.fill === "none" && l.stroke === INK)) {
    throw new Error(`${where}: ring recipe ${JSON.stringify(ring)}`);
  }
  const outer = ring.lines.find((l) => l.width === "4");
  if (!outer || String(outer.opacity) !== "0.25") {
    throw new Error(`${where}: ring outer opacity ${outer?.opacity} (want 0.25)`);
  }
  assertNoAlertRed(ring, where);
}

export function assertHoverRecipe(hi, where) {
  if (!hi) throw new Error(`${where}: missing hover stroke`);
  if (hi.fill !== "none" || hi.width !== "2" || hi.opacity !== "0.85" || hi.stroke !== INK) {
    throw new Error(`${where}: hover recipe ${JSON.stringify(hi)}`);
  }
  assertNoAlertRed(hi, where);
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
