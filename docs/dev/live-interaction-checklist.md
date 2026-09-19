# Live interaction **and** visual playbook

A user-facing change is not done until this playbook has been driven in a real Pluto + browser
on **every supported backend** (today `:cairo` and `:webgl`) **across the interactable kinds**
below. A 2-plot kitchen-sink (scatter wash + line ring) is a chrome smoke, not verification.

This playbook is **interaction and visual**. Both halves are required. Do not treat
`KIND SWEEP OK` as visual fidelity, and do not treat kitchen-sink chrome as the kind sweep.

## Visual language (settled)

Recipes: highlight is a blend-mode tint, not a mark-derived colour — `colors` (today
`scatter!`'s `color=`) no longer touches the highlight at all, only the tooltip accent
(below). The shadow root holds two overlay svgs with identical box/viewBox. Every
hover/selected highlight without an explicit Julia `hoverstyle` stroke is a BARE shape (no
per-element wrapper) inside `svg.masque-blend` (DOM-first) — `mix-blend-mode` (`multiply` on
light figures, `screen` on dark, chosen at mount from the figure background) sits on that svg
element itself, since Firefox only honours it on a top-level svg, not nested SVG content.
Fixed greys: hover fill/stroke `#8c8c8c`/`#555555` (dark figure `#737373`/`#aaaaaa`),
fill-opacity 1, 1.5px stroke flush on the mark's own drawn edge (`masque-hi masque-hover` — a
`<line>` for seg hover carries the same class and fill too, reading as stroke-only on screen
only because a line has no interior area to fill); selected uses the stronger
`#666666`/`#333333` (dark `#999999`/`#cccccc`) pair at 2px, fill-opacity 1
(`masque-hi masque-wash`). The second svg, `svg.masque-plain` (unblended), holds ROI/threshold,
the selected-seg ring (inner 2px + outer 4px @ 0.25, unchanged ink), and hover/selected
highlights for a layer with an explicit `hoverstyle` stroke — single element, stroke verbatim +
18%/35% tint in that colour (the pre-blend recipe, unchanged), open shapes staying stroke-only
there (no `masque-hover`, `fill: none`); browsers without `mix-blend-mode` fall back to that
same neutral-ink tint. A scatter circle's highlight `r` is the marker's DRAWN radius, not
`markersize / 2` — flush against the visible disc (default `:circle` marker
≈0.3525×`markersize`; a `Circle`/`Rect` geometry marker draws at `markersize`; anything else
falls back to `markersize / 2`). Hover is not selected. Motion is an 80–120 ms opacity fade on
tip / highlight — a plain opacity fade on the highlight shape itself (the blend lives on the
svg root, so a fading child doesn't isolate it); no pulse on a same-hit remount. Tooltip dark
follows OS `prefers-color-scheme` — official Pluto has **no notebook light/dark toggle**
(Settings → Dark mode is help text; Pluto itself uses the same media query).

These decisions are settled: cite the recipes above rather than re-litigating identity,
wash vs ring, first-PR scope, or Pluto coupling.

## How to run

Exactly one Makie backend per notebook process. Do not attach to an existing Try Live Pluto
session — start a separate one.

```text
# Fast loop when masque-dev already has Masque + both Makies:
MASQUE_DEV_ENV=$HOME/.julia/environments/masque-dev julia test/e2e/serve.jl 1237 &
# poll curl http://127.0.0.1:1237 → 200 (not the log)

cd test/e2e
# interaction + per-kind visual (wash/ring/hover-outline/pin/fade/no-red/color-scheme)
node kind_sweep.mjs http://127.0.0.1:1237 "$PWD/kind_sweep_cairo.jl" cairo
# required visual-chrome sibling (same notebooks; not optional)
node polish_verify.mjs http://127.0.0.1:1237 "$PWD/kind_sweep_cairo.jl" cairo
# keyboard nav + ARIA (focus ring/tooltip, Enter bind, Escape/Tab-away, live region)
node keyboard_a11y.mjs http://127.0.0.1:1237 "$PWD/kind_sweep_cairo.jl" cairo

# second Pluto process — WGLMakie cannot share a session with Cairo
MASQUE_DEV_ENV=$HOME/.julia/environments/masque-dev JULIA_NOSYSIMAGE=1 julia test/e2e/serve.jl 1238 &
node kind_sweep.mjs http://127.0.0.1:1238 "$PWD/kind_sweep_webgl.jl" webgl
node polish_verify.mjs http://127.0.0.1:1238 "$PWD/kind_sweep_webgl.jl" webgl
node keyboard_a11y.mjs http://127.0.0.1:1238 "$PWD/kind_sweep_webgl.jl" webgl
```

Portable notebooks (`Pkg.develop` via `@__DIR__`) work without `MASQUE_DEV_ENV`; first open
re-resolves the Makie stack (~6 min). All three drivers also run in CI on the `kind-sweep` job
(matrixed `cairo`/`webgl`), but only **advisorily** (`continue-on-error: true`) — agents still
run this playbook locally before calling a user-facing change done, until the job is promoted
to a required check.
`polish_verify.mjs` is **required** and still **not sufficient** alone (one wash + one ring
+ fade + color-scheme). `kind_sweep.mjs` is **required** and still **not sufficient**
alone until `polish_verify.mjs` also PASSes on that backend. `keyboard_a11y.mjs` is required
only for a change that can touch focus/keyboard/ARIA (the overlay's `keyboard.ts`/`mount.ts`
hooks, or a manifest field it reads, e.g. `label`) — it is not a general substitute for the
other two.

Through-Pluto `@bind` on one scatter is also `bind_click.mjs`. Frontend unit twins for
hover outline / overlay-on-base / wash vs ring / remount identity / `prefers-color-scheme`
CSS live in `frontend/test/overlay.test.ts`. Units are necessary, not live-verify.

## Per-kind boxes (Cairo **and** WGL)

For every **element** kind: hover tooltip, click → `@bind` (index moves), geometry sits
**on the mark** (not beside it), no unexpected console, **and** the visual recipe for that
kind. Where `selected=` is supported (`circles`, `rects`, `polygons`, `segments`,
`polyline` only): selected persists after unhover; wash ≠ hover; open geometry uses the
ring.

`selected=` on `:grid` / `:axis` / `:threshold` / `:roi` / `:view` is fail-loud — do not
bake it; hover/click or drag only.

| Kind | Layer | Selected | Must assert |
| --- | --- | --- | --- |
| Scatter | `:circles` | wash, flush drawn `r`, centered | tip, click `@bind`, persist, overlay-on-base, fade, no `#ff3b30`, blend-tint hover darkens the marker's pixels (screenshot) |
| Lines | `:polyline` | ring | tip, click `@bind`, persist, ring recipe, hover stroke-only (no tint) |
| LineSegments | `:segments` | ring | tip, click `@bind`, persist, hover stroke-only (no tint) |
| Heatmap / Image | `:grid` | **unsupported** | cell tip `(i,j)=value`, click `@bind`, blend-tint hover darkens the cell's pixels (screenshot; grid hover is a closed "rect" geom_) |
| BarPlot | `:rects` | wash | tip, click `@bind`, persist, blend-tint hover darkens the bar's pixels (screenshot) |
| Poly | `:polygons` | wash | tip, click `@bind`, persist, blend-tint hover darkens the polygon's pixels (screenshot) |
| Polar (`PolarAxis` scatter) | `:circles` | wash, flush drawn `r` | tip, click `@bind`, persist |
| Scatter (dark figure) | `:circles` | wash, flush drawn `r` on dark axes | tip, click `@bind`, persist, `screen`-blend hover lightens the marker's pixels (screenshot), still readable |
| Arrows3D | `:segments` | ring | tip, click `@bind`, persist |
| HLines / VLines | `:segments` | ring | tip, click `@bind`, persist |
| Threshold | `:threshold` | none | drag commit → `@bind` |
| ROI / box-select | `:roi` | none | drag commit → `@bind` (vector if `selects=`) |
| View (2D pan) | `:view` | none | drag-to-pan commit → `@bind` (`xmin`/`xmax`). Axis3 orbit is `examples/view_manip*.jl` — skip if it would enlarge the PR |

### Hover (element kinds)

- Tooltip text matches the hovered payload
- Hover stroke **centered on the mark** (not offset onto the host)
- Circles: stroke sits **flush on the marker's own drawn edge** (`r` is the drawn radius,
  not `markersize / 2`)
- Hover on a closed mark (circle/rect/poly) = fixed-grey blend-mode fill tint + 1.5px stroke
  (`masque-hi masque-hover` inside `svg.masque-blend`) — a stronger grey pair marks selection
  (`masque-wash`), not the same tint
- Hover on an open seg (lines/segments) is a `<line class="masque-hi masque-hover">` in the
  same `svg.masque-blend` — it carries the tint class/fill too, but a line has no interior
  area, so it reads as stroke-only on screen regardless (an explicit `hoverstyle` stroke is the
  one case that's genuinely stroke-only: unblended, in `svg.masque-plain`, no `masque-hover`,
  `fill: none`)
- Hover node is the same DOM element across two moves on the same marker (no pulse)
- First insert has `.masque-enter`; a same-hit remount must **not** restart `masque-in`

### Unhover + selected persist (supported kinds)

- Leave applies `.masque-leave` (fade), then `g.hi` empties — not an instant remove
- Tooltip gone after the fade window
- `g.sel` still painted (wash or ring)
- Wash ≠ hover; open geometry is the ring recipe

### Click → bond

- `@bind` / readout updates (`InteractionEvent` layer + index)
- Click a **different** element: readout index **moves**

### Drag kinds

- Threshold / ROI / view: gesture commits; readout changes; overlay stays pinned to the
  base (`<img>` Cairo, `<canvas>` WGL)

### Console

- No unexpected page errors (Bonito `decode_binary` / `fetch_binary` on `:webgl` is
  known-benign)

## Visual fidelity (required — not optional)

These are required visual-fidelity checks, not optional nice-to-haves. Drivers must
**exercise** them, not only mention them.

| Item | What “pass” looks like | Driver |
| --- | --- | --- |
| Wash / ring / hover blend-tint + stroke (flush on the mark's drawn `r`) / overlay-pin | Fixed-grey recipe on the bare shape in `svg.masque-blend`'s `g.hi`/`g.sel` (never the fixed teal); BOTH `svg.masque-blend` and `svg.masque-plain` boxes match `<img>` / `<canvas>` at DPR 2 | `kind_sweep.mjs` per kind + `polish_verify.mjs` |
| Tint-applied (screenshot) | Mean luminance of a ~24×24 css-px `page.screenshot()` clip centred on the mark drops ≥4 (0–255) after hover on a light figure, rises ≥4 on a dark figure — proves the blend actually tints the on-screen pixels, not just the DOM attributes | `kind_sweep.mjs` (scatter, scatter_dark, barplot, heatmap, poly) |
| Flush-radius pixel check (Cairo only) | A pixel just outside the highlight `r` reads as the figure background; a pixel just inside reads as the marker's own colour — proves the outline sits on the drawn edge, not offset | `polish_verify.mjs` (scatter, `:cairo` — skipped on `:webgl`, canvas readback isn't reliable) |
| Remount fade / no pulse | `.masque-enter` on first insert (on the highlight shape itself — no wrapper); same hover node on mousemove; `.masque-leave` on clear | both |
| Pluto dark / `prefers-color-scheme` | Tooltip light `#ffffff`/`#1a1a1a` and dark `#1e1e1e`/`#e8e8e8` via `emulateMedia`. Official Pluto has no notebook toggle — both follow the OS media query. Dark **Makie** figure (`scatter_dark`) uses the `screen`-blend grey pair, not OS colour-scheme (highlights do not follow OS). | `polish_verify.mjs` + `kind_sweep.mjs` (`prefers-color-scheme` + `scatter_dark`) |
| No fixed steel-teal `#3A6F7C`, no alert red `#ff3b30` | Highlight colour is one of the fixed greys or (for an explicit `hoverstyle`) the verbatim stroke, never a fixed literal like the old teal, in overlay CSS, hover stroke, wash, or ring | both |

`prefers-reduced-motion: reduce` stays instant (unit-tested). Live drivers use default
motion so fade is observable.

## Done means

- [ ] `kind_sweep.mjs` **PASS** on `:cairo` (every row, including `scatter_dark` and the tint-applied screenshot check on scatter/scatter_dark/barplot/heatmap/poly)
- [ ] `kind_sweep.mjs` **PASS** on `:webgl` (every row, including `scatter_dark` and the tint-applied screenshot check on scatter/scatter_dark/barplot/heatmap/poly)
- [ ] `polish_verify.mjs` **PASS** on `:cairo` (wash/ring/hover-outline/pin + flush-radius pixel check + dark-figure wash + dark-figure hover blend + remount fade + color-scheme + no `#ff3b30`)
- [ ] `polish_verify.mjs` **PASS** on `:webgl` (same boxes except the Cairo-only flush-radius check)
- [ ] Every row in the table above was exercised (not a subset)
- [ ] Verification was done by driving the playbook directly, not by asking someone else
      to click through plots
