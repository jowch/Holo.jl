# Live interaction **and** visual playbook

A user-facing change is not done until this playbook has been driven in a real Pluto + browser
on **every supported backend** (today `:cairo` and `:webgl`) **across the interactable kinds**
below. A 2-plot kitchen-sink (scatter wash + line ring) is a chrome smoke, not verification.

This playbook is **interaction and visual**. Both halves are required. Do not treat
`KIND SWEEP OK` as visual fidelity, and do not treat kitchen-sink chrome as the kind sweep.

## Visual language (settled)

Recipes: highlight ink `--masque-ink` = neutral, derived from the figure background
(near-black on light figures, near-white on dark; **not** iOS / alert red `#ff3b30`); when
the element's colour is resolvable (`colors`, today `scatter!`'s `color=`) the outline is
that colour mixed 70/30 toward the ink (darker on light figures, lighter on dark); an
explicit `hoverstyle` stroke is used verbatim. Hover on a closed mark (circle/rect/poly) =
1.5px stroke flush on the mark's own drawn edge + an 18% tint fill in that same colour
(`masque-hi masque-hover`). Hover on an open seg (lines/segments) stays stroke-only,
`fill: none` (`masque-hi`, no `masque-hover`). A scatter circle's highlight `r` is the
marker's DRAWN radius, not `markersize / 2` — flush against the visible disc (default
`:circle` marker ≈0.3525×`markersize`; a `Circle`/`Rect` geometry marker draws at
`markersize`; anything else falls back to `markersize / 2`). Selected closed = 35% wash
fill + 2px stroke, selected open = ring (inner 2px + outer 4px @ 0.25). Hover is not
selected. Motion is an 80–120 ms opacity fade on tip / highlight mount and clear; no pulse
on a same-hit remount. Tooltip dark follows OS `prefers-color-scheme` — official Pluto has
**no notebook light/dark toggle** (Settings → Dark mode is help text; Pluto itself uses the
same media query).

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
| Scatter | `:circles` | wash, flush drawn `r`, centered | tip, click `@bind`, persist, overlay-on-base, fade, no `#ff3b30`, hover tint+stroke darker than the mark |
| Lines | `:polyline` | ring | tip, click `@bind`, persist, ring recipe, hover stroke-only (no tint) |
| LineSegments | `:segments` | ring | tip, click `@bind`, persist, hover stroke-only (no tint) |
| Heatmap / Image | `:grid` | **unsupported** | cell tip `(i,j)=value`, click `@bind`, hover tint+stroke is neutral dark ink (no `colors`) |
| BarPlot | `:rects` | wash | tip, click `@bind`, persist |
| Poly | `:polygons` | wash | tip, click `@bind`, persist |
| Polar (`PolarAxis` scatter) | `:circles` | wash, flush drawn `r` | tip, click `@bind`, persist |
| Scatter (dark figure) | `:circles` | wash, flush drawn `r` on dark axes | tip, click `@bind`, persist, hover tint+stroke lighter than the mark, still readable |
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
- Hover on a closed mark (circle/rect/poly) = 18% tint fill + 1.5px stroke
  (`masque-hi masque-hover`) — not the 35% wash used for selection
- Hover on an open seg (lines/segments) stays stroke-only, `fill: none` (`masque-hi`, no
  `masque-hover`)
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
| Wash 35% / ring / hover 18% tint + stroke (flush on the mark's drawn `r`) / overlay-pin | Mark-derived or neutral-ink recipes on the mark (never the fixed teal); SVG box matches `<img>` / `<canvas>` at DPR 2 | `kind_sweep.mjs` per kind + `polish_verify.mjs` |
| Flush-radius pixel check (Cairo only) | A pixel just outside the highlight `r` reads as the figure background; a pixel just inside reads as the marker's own colour — proves the outline sits on the drawn edge, not offset | `polish_verify.mjs` (scatter, `:cairo` — skipped on `:webgl`, canvas readback isn't reliable) |
| Remount fade / no pulse | `.masque-enter` on first insert; same hover node on mousemove; `.masque-leave` on clear | both |
| Pluto dark / `prefers-color-scheme` | Tooltip light `#ffffff`/`#1a1a1a` and dark `#1e1e1e`/`#e8e8e8` via `emulateMedia`. Official Pluto has no notebook toggle — both follow the OS media query. Dark **Makie** figure (`scatter_dark`) still uses the figure-aware ink/mark mix (highlights do not follow OS). | `polish_verify.mjs` + `kind_sweep.mjs` (`prefers-color-scheme` + `scatter_dark`) |
| No fixed steel-teal `#3A6F7C`, no alert red `#ff3b30` | Highlight colour derives from the mark or the figure ink, never a fixed literal, in overlay CSS, hover stroke, wash, or ring | both |

`prefers-reduced-motion: reduce` stays instant (unit-tested). Live drivers use default
motion so fade is observable.

## Done means

- [ ] `kind_sweep.mjs` **PASS** on `:cairo` (every row, including `scatter_dark`)
- [ ] `kind_sweep.mjs` **PASS** on `:webgl` (every row, including `scatter_dark`)
- [ ] `polish_verify.mjs` **PASS** on `:cairo` (wash/ring/hover-outline/pin + flush-radius pixel check + dark-figure wash + remount fade + color-scheme + no `#ff3b30`)
- [ ] `polish_verify.mjs` **PASS** on `:webgl` (same boxes except the Cairo-only flush-radius check)
- [ ] Every row in the table above was exercised (not a subset)
- [ ] Verification was done by driving the playbook directly, not by asking someone else
      to click through plots
