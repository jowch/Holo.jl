// Shared visual-fidelity asserts for kind_sweep.mjs + polish_verify.mjs.
// Recipes are locked in the store visual-design.md (cite, do not reopen):
// inspector ink #3A6F7C, wash / ring / halo r+2, remount fade, OS prefers-color-scheme.

export const INK = "#3A6F7C";
export const WASH = "rgba(58, 111, 124, 0.12)";
export const ALERT_RED = "#ff3b30";

export const TIP_LIGHT = { bg: "rgb(255, 255, 255)", color: "rgb(26, 26, 26)" };
export const TIP_DARK = { bg: "rgb(30, 30, 30)", color: "rgb(232, 232, 232)" };

function normRgb(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "");
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
  if (!info.firstEnter) throw new Error(`${where}: first hover missing holo-enter fade`);
}

export function assertLeaveFade(info, where) {
  if (info.hi === 0) throw new Error(`${where}: hover cleared instantly (no remount fade)`);
  if (!info.leaving) throw new Error(`${where}: leave did not apply holo-leave`);
}

export function assertTipScheme(cs, scheme, where) {
  const exp = scheme === "dark" ? TIP_DARK : TIP_LIGHT;
  if (normRgb(cs.bg) !== normRgb(exp.bg) || normRgb(cs.color) !== normRgb(exp.color)) {
    throw new Error(`${where}: ${scheme} tip ${JSON.stringify(cs)} want ${JSON.stringify(exp)}`);
  }
}

export function assertSchemeCss(css, where) {
  if (!/prefers-color-scheme:\s*dark/.test(css)) {
    throw new Error(`${where}: overlay CSS missing prefers-color-scheme: dark (Pluto's only theme signal)`);
  }
  if (!/#1e1e1e/.test(css) || !/#e8e8e8/.test(css)) {
    throw new Error(`${where}: dark tooltip tokens missing`);
  }
  assertNoAlertRed(css, where);
}

export async function assertTooltipColorScheme(page, sampleTip) {
  assertSchemeCss(await sampleTip.css(), "overlay-css");
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    const cs = await sampleTip.computed();
    assertTipScheme(cs, scheme, `tooltip/${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}
