# Live interaction checklist

Runnable on the kitchen-sink / Try Live notebook and on `test/e2e/polish_verify.mjs`.
Do **Cairo and WGL** (separate Pluto sessions). Recipes: inspector ink `#3A6F7C`, hover =
stroke only (2px @ 0.85), selected closed = wash, selected open = ring, circle halo
`r + 2` (see the locked overlay visual language). Hover is not selected.

**Setup:** click source is the **top** plot; **bottom** remounts with `selected=`
(do not feed a widget's own bond into itself — Pluto cycle; same split as
`examples/demo.jl`).

Automated twin: `node test/e2e/polish_verify.mjs <base-url> <notebook> <cairo|webgl>`.
Through-Pluto `@bind` emit is `test/e2e/bind_click.mjs`. Frontend unit twins live in
`frontend/test/overlay.test.ts` (halo `r + 2`, overlay-on-base, remount `selected=`,
wash vs hover vs ring).

## Each backend (`:cairo` / `:webgl`)

### Hover
- [ ] Tooltip text matches the hovered payload (e.g. `label` / `beta`)
- [ ] Hover stroke is **centered on the marker** (not beside it)
- [ ] Halo sits **just outside** the marker (`r + 2`) — not flush, not a much larger miss, not smaller than the marker
- [ ] Hover is stroke-only (`fill: none`, 2px, opacity 0.85) — no wash

### Unhover
- [ ] Tooltip gone
- [ ] Hover stroke gone (`g.hi` empty)

### Click → bond
- [ ] Click a point: `@bind` / readout updates (`InteractionEvent` layer + index)
- [ ] Click a **different** point: readout index **moves**

### Selected persists (`selected=` → `g.sel`)
- [ ] After click, **unhover**: wash (scatter) or ring (line) **still painted**
- [ ] Click another point: wash **moves** to the new marker (old marker not selected)
- [ ] Wash ≠ hover: selected is wash fill + 2.5px stroke; hover is stroke-only
- [ ] Open geometry: selected **ring** on a line segment (inner 2px + outer ~4px @ 0.25)

### Console
- [ ] No unexpected page / console errors (Bonito `decode_binary` / `fetch_binary` on `:webgl` is known-benign)

## Both backends
- [ ] Cairo (`<img>` base) — all boxes above
- [ ] WGL (`<canvas>` base) — all boxes above
