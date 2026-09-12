# Live interaction **and** visual playbook (agents)

**Audience: agents.** The maintainer does not click through plots. A user-facing change is not
done until **you** have driven this playbook in a real Pluto + browser on **every supported
backend** (today `:cairo` and `:webgl`) **across the interactable kinds** below. A 2-plot
kitchen-sink (scatter wash + line ring) is a chrome smoke, not verification.

This playbook is **interaction and visual**. Both halves are required. Do not treat
`KIND SWEEP OK` as visual fidelity, and do not treat kitchen-sink chrome as the kind sweep.

## Locked visual language (cite, do not reopen)

Recipes: inspector ink `#3A6F7C` (**not** iOS / alert red `#ff3b30`), hover = stroke only
(2px @ 0.85, `fill: none`), selected closed = wash `rgba(58, 111, 124, 0.12)` + 2.5px
stroke, selected open = ring (inner 2px + outer ~4px @ 0.25), circle halo `r + 2`. Hover
is not selected. Motion is an 80–120 ms opacity fade on tip / highlight mount and clear;
no pulse on a same-hit remount. Tooltip dark follows OS `prefers-color-scheme` — official
Pluto has **no notebook light/dark toggle** (Settings → Dark mode is help text; Pluto
itself uses the same media query).

Cite the locked recipes above; do not re-litigate identity, wash vs ring, first-PR
scope, or Pluto coupling.

## How to run (you, not a human)

Exactly one Makie backend per notebook process. Do not attach to a maintainer Try Live Pluto
session — leave it up. Start your own.

```text
# Fast loop when holo-dev already has Holo + both Makies:
HOLO_DEV_ENV=$HOME/.julia/environments/holo-dev julia test/e2e/serve.jl 1237 &
# poll curl http://127.0.0.1:1237 → 200 (not the log)

cd test/e2e
# interaction + per-kind visual (wash/ring/halo/pin/fade/no-red/color-scheme)
node kind_sweep.mjs http://127.0.0.1:1237 "$PWD/kind_sweep_cairo.jl" cairo
# required visual-chrome sibling (same notebooks; not optional)
node polish_verify.mjs http://127.0.0.1:1237 "$PWD/kind_sweep_cairo.jl" cairo

# second Pluto process — WGLMakie cannot share a session with Cairo
HOLO_DEV_ENV=$HOME/.julia/environments/holo-dev JULIA_NOSYSIMAGE=1 julia test/e2e/serve.jl 1238 &
node kind_sweep.mjs http://127.0.0.1:1238 "$PWD/kind_sweep_webgl.jl" webgl
node polish_verify.mjs http://127.0.0.1:1238 "$PWD/kind_sweep_webgl.jl" webgl
```

Portable notebooks (`Pkg.develop` via `@__DIR__`) work without `HOLO_DEV_ENV`; first open
re-resolves the Makie stack (~6 min). Both drivers are **local — not CI**.
`polish_verify.mjs` is **required** and still **not sufficient** alone (one wash + one ring
+ fade + color-scheme). `kind_sweep.mjs` is **required** and still **not sufficient**
alone until `polish_verify.mjs` also PASSes on that backend.

Through-Pluto `@bind` on one scatter is also `bind_click.mjs`. Frontend unit twins for
halo / overlay-on-base / wash vs ring / remount identity / `prefers-color-scheme` CSS
live in `frontend/test/overlay.test.ts`. Units are necessary, not live-verify.

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
| Scatter | `:circles` | wash, halo `r + 2`, centered | tip, click `@bind`, persist, overlay-on-base, fade, no `#ff3b30` |
| Lines | `:polyline` | ring | tip, click `@bind`, persist, ring recipe |
| LineSegments | `:segments` | ring | tip, click `@bind`, persist |
| Heatmap / Image | `:grid` | **unsupported** | cell tip `(i,j)=value`, click `@bind` |
| BarPlot | `:rects` | wash | tip, click `@bind`, persist |
| Poly | `:polygons` | wash | tip, click `@bind`, persist |
| Polar (`PolarAxis` scatter) | `:circles` | wash, halo `r + 2` | tip, click `@bind`, persist |
| Scatter (dark figure) | `:circles` | wash, halo `r + 2` on dark axes | tip, click `@bind`, persist, steel-teal still readable |
| Arrows3D | `:segments` | ring | tip, click `@bind`, persist |
| HLines / VLines | `:segments` | ring | tip, click `@bind`, persist |
| Threshold | `:threshold` | none | drag commit → `@bind` |
| ROI / box-select | `:roi` | none | drag commit → `@bind` (vector if `selects=`) |
| View (2D pan) | `:view` | none | drag-to-pan commit → `@bind` (`xmin`/`xmax`). Axis3 orbit is `examples/view_manip*.jl` — skip if it would enlarge the PR |

### Hover (element kinds)

- Tooltip text matches the hovered payload
- Hover stroke **centered on the mark** (not offset onto the host)
- Circles: halo **just outside** the marker (`r + 2`)
- Hover is stroke-only (`fill: none`, 2px, opacity 0.85) — no wash
- Hover node is the same DOM element across two moves on the same marker (no pulse)
- First insert has `.holo-enter`; a same-hit remount must **not** restart `holo-in`

### Unhover + selected persist (supported kinds)

- Leave applies `.holo-leave` (fade), then `g.hi` empties — not an instant remove
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

These were the #50 gaps. They are checklist items. Drivers must **exercise** them, not
only mention them.

| Item | What “pass” looks like | Driver |
| --- | --- | --- |
| Wash / ring / halo (`r+2`) / overlay-pin | Steel-teal recipes on the mark; SVG box matches `<img>` / `<canvas>` at DPR 2 | `kind_sweep.mjs` per kind + `polish_verify.mjs` |
| Remount fade / no pulse | `.holo-enter` on first insert; same hover node on mousemove; `.holo-leave` on clear | both |
| Pluto dark / `prefers-color-scheme` | Tooltip light `#ffffff`/`#1a1a1a` and dark `#1e1e1e`/`#e8e8e8` via `emulateMedia`. Official Pluto has no notebook toggle — both follow the OS media query. Dark **Makie** figure (`scatter_dark`) still uses inspector ink (highlights do not follow OS). | `polish_verify.mjs` + `kind_sweep.mjs` (`prefers-color-scheme` + `scatter_dark`) |
| Steel-teal `#3A6F7C`, not `#ff3b30` | No alert red in overlay CSS, hover stroke, wash, or ring | both |

`prefers-reduced-motion: reduce` stays instant (unit-tested). Live drivers use default
motion so fade is observable.

## Done means

- [ ] `kind_sweep.mjs` **PASS** on `:cairo` (every row, including `scatter_dark`)
- [ ] `kind_sweep.mjs` **PASS** on `:webgl` (every row, including `scatter_dark`)
- [ ] `polish_verify.mjs` **PASS** on `:cairo` (wash/ring/halo/pin + dark-figure wash + remount fade + color-scheme + no `#ff3b30`)
- [ ] `polish_verify.mjs` **PASS** on `:webgl` (same boxes)
- [ ] Every row in the table above was exercised (not a subset)
- [ ] You did **not** ask the maintainer to click through plots
