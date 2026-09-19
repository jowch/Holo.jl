// Shared visual-fidelity asserts for kind_sweep.mjs + polish_verify.mjs.
// Recipe (locked in CLAUDE.md's "Overlay recipes" paragraph — cite, do not reopen): the shadow
// root holds THREE sibling top-level svgs, identical box/viewBox, in DOM order `svg.masque-fill`
// (`mix-blend-mode: color-dodge`, both light and dark figures — a fixed `#141414` source
// brightens without rotating hue, measured across a 10-colour palette), `svg.masque-edge`
// (`multiply` on light figures, `screen` on dark — this is the darkening half, so the state
// distinction — hover 1.5px vs. selected 2px — lives here), `svg.masque-plain` (no blend).
// Firefox only honours `mix-blend-mode` on a top-level svg, not nested SVG content, which is why
// there is no single wrapped svg with per-element blend classes. A closed mark (circle/rect/
// polygon) hover or selected highlight is TWO shapes, identical geometry, one in each of
// `masque-fill`/`masque-edge` (`masque-hi masque-fillshape` / `masque-hi masque-hover` or
// `masque-wash`); an open seg (line has no interior) is edge-only; a `rectfill` (selects-ROI
// grid cell-block union) is fill-only. `svg.masque-plain` holds ROI/threshold, the selected-open
// ring (unchanged ink), and a layer with an explicit Julia `hoverstyle` stroke — single element,
// unblended, verbatim colour + 18%/35% tint (the pre-split recipe). Hovering a mark that is
// already selected draws no highlight at all (both layers are already opaque from the wash; a
// 1.5px hover stroke over a 2px selected stroke would read as weaker, not stronger) — the
// tooltip and `@bind` still work for that hit. Remount fade is a plain opacity fade on each
// shape (`masque-enter`/`masque-leave`, no wrapper to isolate), 80-120ms.

export const ALERT_RED = "#ff3b30";
export const TEAL = "#3A6F7C";

// The fill layer's source colour (`color-dodge` against this near-black brightens without
// rotating hue — see mount.ts). The edge layer keeps the old fixed-grey darkening stroke pair;
// only the fill side is new (there is no more grey *fill*, dodge replaced it).
export const DODGE_FILL = "rgb(20, 20, 20)";
export const GREY = {
  light: { hoverStroke: "rgb(85, 85, 85)", washStroke: "rgb(51, 51, 51)" },
  dark: { hoverStroke: "rgb(170, 170, 170)", washStroke: "rgb(204, 204, 204)" },
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
// dodge fill / fixed-grey edge stroke, or, for an explicit `hoverstyle`, the caller's own
// verbatim colour, so this literal must never appear in the overlay.
export function assertNoTeal(blob, where) {
  const s = typeof blob === "string" ? blob : JSON.stringify(blob);
  if (/#3a6f7c|rgb\(\s*58[\s,]+111[\s,]+124\s*\)/i.test(s)) {
    throw new Error(`${where}: steel-teal ${TEAL} leaked (highlight must be the dodge fill / grey edge, or an explicit hoverstyle, not a fixed literal)`);
  }
}

function hasClass(className, want) {
  return String(className || "").trim().split(/\s+/).includes(want);
}

function realColor(c) {
  return !!c && c !== "none" && c !== "rgba(0, 0, 0, 0)" && c !== "transparent";
}

// Every capture site (kind_sweep.mjs's `inspect`/`dispatchAt`, polish_verify.mjs's `inspect`/
// `hoverAt`) hands assertWash/assertHoverRecipe an object `{ fill, edge, plain }`: `fill` is the
// shape (if any) found in `svg.masque-fill`'s g.sel/g.hi, `edge` the one in `svg.masque-edge`,
// `plain` the one in `svg.masque-plain` (an explicit-`hoverstyle` layer, or — only for
// assertRing below — a selected-open-geometry ring). Each captured shape is `{ layer, tag,
// className, stroke, fill, fillOpacity (all getComputedStyle), width, opacity (stroke-width/
// stroke-opacity attributes), blend (getComputedStyle(svg).mixBlendMode, null for `plain`), …
// geometry }`. `wantDark` selects the figure-relative grey edge stroke (GREY.dark on a dark
// figure, GREY.light otherwise) — irrelevant for the `plain` (explicit-hoverstyle) path.
export function assertWash(wash, where, wantDark) {
  const { fill, edge, plain } = wash || {};
  if (plain && !fill && !edge) {
    // Explicit `hoverstyle` stroke: unblended, single element, verbatim colour + 35% tint (the
    // pre-split recipe, unchanged).
    if (!hasClass(plain.className, "masque-hi") || !hasClass(plain.className, "masque-wash")) {
      throw new Error(`${where}: wash element missing masque-hi/masque-wash class ${JSON.stringify(plain)}`);
    }
    if (plain.width !== "2") throw new Error(`${where}: wash recipe ${JSON.stringify(plain)}`);
    if (!realColor(plain.fill) || plain.fill !== plain.stroke) {
      throw new Error(`${where}: wash fill/stroke mismatch ${JSON.stringify(plain)}`);
    }
    if (String(plain.fillOpacity) !== "0.35") {
      throw new Error(`${where}: wash fill-opacity ${plain.fillOpacity} (want 0.35)`);
    }
    assertNoAlertRed(plain, where);
    assertNoTeal(plain, where);
    return;
  }
  if (!fill || !edge) throw new Error(`${where}: wash missing fill/edge pair ${JSON.stringify(wash)}`);
  if (!hasClass(fill.className, "masque-hi") || !hasClass(fill.className, "masque-fillshape")) {
    throw new Error(`${where}: wash fill shape missing masque-hi/masque-fillshape class ${JSON.stringify(fill)}`);
  }
  if (fill.fill !== DODGE_FILL) throw new Error(`${where}: wash fill colour ${fill.fill} (want ${DODGE_FILL})`);
  if (String(fill.fillOpacity) !== "1") throw new Error(`${where}: wash fill-opacity ${fill.fillOpacity} (want 1)`);
  if (fill.stroke !== "none") throw new Error(`${where}: wash fill shape stroke ${fill.stroke} (want none)`);
  if (fill.blend !== "color-dodge") throw new Error(`${where}: wash fill blend ${fill.blend} (want color-dodge)`);

  if (!hasClass(edge.className, "masque-hi") || !hasClass(edge.className, "masque-wash")) {
    throw new Error(`${where}: wash edge shape missing masque-hi/masque-wash class ${JSON.stringify(edge)}`);
  }
  if (edge.width !== "2") throw new Error(`${where}: wash edge width ${edge.width} (want 2)`);
  const g = wantDark ? GREY.dark : GREY.light;
  if (edge.stroke !== g.washStroke) throw new Error(`${where}: wash edge stroke ${edge.stroke} (want ${g.washStroke})`);
  if (edge.fill !== "none") throw new Error(`${where}: wash edge fill ${edge.fill} (want none)`);
  if (edge.blend !== (wantDark ? "screen" : "multiply")) {
    throw new Error(`${where}: wash edge blend ${edge.blend} (want ${wantDark ? "screen" : "multiply"})`);
  }
  assertNoAlertRed(wash, where);
  assertNoTeal(wash, where);
}

// Selected-open-geometry ring: unblended, lives only in `svg.masque-plain`, unchanged by the
// fill/edge split.
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

// `closed` distinguishes a closed mark (circle/rect/poly — fill shape present, edge shape gets
// the `masque-hover` tint class too even though its own fill is inert) from an open seg (line —
// edge-only, no fill shape at all) in the default split-blend path, and the two UNBLENDED
// `hoverstyle` variants (`hi.plain` set, `hi.fill`/`hi.edge` both absent) the same way the old
// single-svg recipe did. If `closed` is omitted it's inferred from whichever shape is present
// (a fill shape or a non-`line` plain tag means closed) — pass it explicitly when the caller
// hovered an open seg (no fill shape to infer from). `wantDark` selects GREY.dark/GREY.light for
// the edge stroke; irrelevant on the `plain` path.
export function assertHoverRecipe(hi, where, closed, wantDark) {
  const { fill, edge, plain } = hi || {};
  if (plain && !fill && !edge) {
    if (closed === undefined) closed = plain.tag !== "line";
    if (!hasClass(plain.className, "masque-hi")) {
      throw new Error(`${where}: hover element missing masque-hi class ${JSON.stringify(plain)}`);
    }
    if (plain.width !== "1.5" || plain.opacity !== null) {
      throw new Error(`${where}: hover recipe ${JSON.stringify(plain)}`);
    }
    if (!realColor(plain.stroke)) throw new Error(`${where}: hover stroke not resolved ${JSON.stringify(plain)}`);
    if (closed) {
      // Explicit `hoverstyle` stroke, closed shape: unblended, verbatim colour + 18% tint.
      if (!hasClass(plain.className, "masque-hover")) {
        throw new Error(`${where}: closed hover missing masque-hover tint class ${JSON.stringify(plain)}`);
      }
      if (!realColor(plain.fill) || plain.fill !== plain.stroke) {
        throw new Error(`${where}: hover tint fill/stroke mismatch ${JSON.stringify(plain)}`);
      }
      if (String(plain.fillOpacity) !== "0.18") {
        throw new Error(`${where}: hover fill-opacity ${plain.fillOpacity} (want 0.18)`);
      }
    } else {
      // Explicit `hoverstyle` stroke, open seg: unblended, stroke-only, no tint class.
      if (hasClass(plain.className, "masque-hover")) {
        throw new Error(`${where}: open hover unexpectedly has masque-hover tint class ${JSON.stringify(plain)}`);
      }
      if (plain.fill !== "none") throw new Error(`${where}: open hover fill ${plain.fill} (want none, stroke-only)`);
    }
    assertNoAlertRed(plain, where);
    assertNoTeal(plain, where);
    return;
  }

  if (!edge) throw new Error(`${where}: missing hover edge stroke ${JSON.stringify(hi)}`);
  if (closed === undefined) closed = !!fill;
  if (closed && !fill) throw new Error(`${where}: closed hover missing fill shape ${JSON.stringify(hi)}`);
  if (!closed && fill) throw new Error(`${where}: open hover unexpectedly has a fill shape ${JSON.stringify(hi)}`);

  if (!hasClass(edge.className, "masque-hi") || !hasClass(edge.className, "masque-hover")) {
    throw new Error(`${where}: hover edge missing masque-hi/masque-hover class ${JSON.stringify(edge)}`);
  }
  if (edge.width !== "1.5" || edge.opacity !== null) {
    throw new Error(`${where}: hover edge recipe ${JSON.stringify(edge)}`);
  }
  if (!realColor(edge.stroke)) throw new Error(`${where}: hover edge stroke not resolved ${JSON.stringify(edge)}`);
  const g = wantDark ? GREY.dark : GREY.light;
  if (edge.stroke !== g.hoverStroke) throw new Error(`${where}: hover edge stroke ${edge.stroke} (want ${g.hoverStroke})`);
  if (edge.fill !== "none") throw new Error(`${where}: hover edge fill ${edge.fill} (want none)`);
  if (edge.blend !== (wantDark ? "screen" : "multiply")) {
    throw new Error(`${where}: hover edge blend ${edge.blend} (want ${wantDark ? "screen" : "multiply"})`);
  }
  if (closed) {
    if (!hasClass(fill.className, "masque-hi") || !hasClass(fill.className, "masque-fillshape")) {
      throw new Error(`${where}: hover fill missing masque-hi/masque-fillshape class ${JSON.stringify(fill)}`);
    }
    if (fill.fill !== DODGE_FILL) throw new Error(`${where}: hover fill colour ${fill.fill} (want ${DODGE_FILL})`);
    if (String(fill.fillOpacity) !== "1") throw new Error(`${where}: hover fill-opacity ${fill.fillOpacity} (want 1)`);
    if (fill.stroke !== "none") throw new Error(`${where}: hover fill stroke ${fill.stroke} (want none)`);
    if (fill.blend !== "color-dodge") throw new Error(`${where}: hover fill blend ${fill.blend} (want color-dodge)`);
  }
  assertNoAlertRed(hi, where);
  assertNoTeal(hi, where);
}

// Hovering a mark that is already selected must NOT draw a hover highlight (both layers already
// carry the opaque selected wash — see the module comment). The tooltip and `@bind` still fire;
// only this is skipped.
export function assertNoHighlight(hi, where) {
  if (hi?.fill || hi?.edge) {
    throw new Error(`${where}: highlight drawn on an already-selected mark ${JSON.stringify(hi)}`);
  }
}

// Circle highlight geometry: r must equal the underlying geometry r exactly (no more r+2 halo).
// Call once per shape present (a closed mark's hover/selected draws it into BOTH the fill and
// edge layers, identical geometry — callers check both).
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

// Tint-applied (dodge fill brightens the mark itself, screenshot-verified): mean luminance
// (0-255) of a small page.screenshot() clip centred INSIDE the mark (a small box well within the
// drawn edge, not overlapping the rim — the rim is the darkening edge stroke, sampling across it
// would cancel the fill-layer reading), taken before vs. after the hover highlight applies.
// `color-dodge` against the near-black fill source can only raise luminance, so both a light and
// a dark figure are expected to get BRIGHTER on hover — this is what replaced the old
// darkens-on-light/lightens-on-dark check when the highlight split into a brightening fill and a
// darkening stroke. See PNG.sync.read (pngjs, already a devDependency here) for the buffer -> RGBA
// decode.
export function meanLuminance(png) {
  let sum = 0;
  const n = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) {
    sum += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
  }
  return sum / n;
}

export function assertTintApplied(lumBefore, lumAfter, where, minDelta = 4) {
  const delta = lumAfter - lumBefore;
  if (delta < minDelta) {
    throw new Error(
      `${where}: luminance before=${lumBefore.toFixed(1)} after=${lumAfter.toFixed(1)} delta=${delta.toFixed(1)} ` +
      `(want >= +${minDelta} — the dodge fill brightens the interior on every figure)`,
    );
  }
}
