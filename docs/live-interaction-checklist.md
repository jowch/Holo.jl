# Live interaction playbook (agents)

**Audience: agents.** The maintainer does not click through plots. A user-facing change is not
done until **you** have driven this playbook in a real Pluto + browser on **every supported
backend** (today `:cairo` and `:webgl`) **across the interactable kinds** below. A 2-plot
kitchen-sink (scatter wash + line ring) is a chrome smoke, not verification.

Recipes (locked overlay visual language): inspector ink `#3A6F7C`, hover = stroke only (2px @
0.85, `fill: none`), selected closed = wash `rgba(58, 111, 124, 0.12)` + 2.5px stroke, selected
open = ring (inner 2px + outer ~4px @ 0.25), circle halo `r + 2`. Hover is not selected.

## How to run (you, not a human)

Exactly one Makie backend per notebook process. Do not attach to a maintainer Try Live Pluto
session — leave it up. Start your own.

```text
# Fast loop when holo-dev already has Holo + both Makies:
HOLO_DEV_ENV=$HOME/.julia/environments/holo-dev julia test/e2e/serve.jl 1237 &
# poll curl http://127.0.0.1:1237 → 200 (not the log)

cd test/e2e
node kind_sweep.mjs http://127.0.0.1:1237 "$PWD/kind_sweep_cairo.jl" cairo
node kind_sweep.mjs http://127.0.0.1:1238 "$PWD/kind_sweep_webgl.jl" webgl
```

Portable notebooks (`Pkg.develop` via `@__DIR__`) work without `HOLO_DEV_ENV`; first open
re-resolves the Makie stack (~6 min). `kind_sweep.mjs` is local — not CI. Overlay-chrome smoke
(`polish_verify.mjs` on a wash+ring figure) is optional and **not sufficient**.

Through-Pluto `@bind` on one scatter is also `bind_click.mjs`. Frontend unit twins for halo /
overlay-on-base / wash vs ring live in `frontend/test/overlay.test.ts`.

## Per-kind boxes (Cairo **and** WGL)

For every **element** kind: hover tooltip, click → `@bind` (index moves), geometry sits **on the
mark** (not beside it), no unexpected console. Where `selected=` is supported (`circles`,
`rects`, `polygons`, `segments`, `polyline` only): selected persists after unhover; wash ≠ hover;
open geometry uses the ring.

`selected=` on `:grid` / `:axis` / `:threshold` / `:roi` / `:view` is fail-loud — do not bake it;
hover/click or drag only.

| Kind | Layer | Selected | Must assert |
| --- | --- | --- | --- |
| Scatter | `:circles` | wash, halo `r + 2`, centered | tip, click `@bind`, persist, overlay-on-base |
| Lines | `:polyline` | ring | tip, click `@bind`, persist |
| LineSegments | `:segments` | ring | tip, click `@bind`, persist |
| Heatmap / Image | `:grid` | **unsupported** | cell tip `(i,j)=value`, click `@bind` |
| BarPlot | `:rects` | wash | tip, click `@bind`, persist |
| Poly | `:polygons` | wash | tip, click `@bind`, persist |
| Polar (`PolarAxis` scatter) | `:circles` | wash, halo `r + 2` | tip, click `@bind`, persist |
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

### Unhover + selected persist (supported kinds)

- Tooltip gone; `g.hi` empty
- `g.sel` still painted (wash or ring)
- Wash ≠ hover; open geometry is the ring recipe

### Click → bond

- `@bind` / readout updates (`InteractionEvent` layer + index)
- Click a **different** element: readout index **moves**

### Drag kinds

- Threshold / ROI / view: gesture commits; readout changes; overlay stays pinned to the base
  (`<img>` Cairo, `<canvas>` WGL)

### Console

- No unexpected page errors (Bonito `decode_binary` / `fetch_binary` on `:webgl` is known-benign)

## Done means

- [ ] `kind_sweep.mjs` **PASS** on `:cairo`
- [ ] `kind_sweep.mjs` **PASS** on `:webgl`
- [ ] Every row in the table above was exercised (not a subset)
- [ ] You did **not** ask the maintainer to click through plots
