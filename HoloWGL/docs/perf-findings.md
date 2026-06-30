# HoloWGL — Perf findings (the `:webgl` wire envelope)

> **The single source of every size number for the `:webgl` backend.** Other HoloWGL docs
> (`roadmap.md`, `NOTES.md`) **cite** this file — they don't restate the figures (numbers duplicated
> across docs drift). This is the `:webgl` analogue of root Holo's `../../docs/perf-findings.md`,
> which covers the Cairo **PNG + manifest** envelope and is **unchanged** by this backend — the
> `:webgl` payload is a *new* format (a serialized WGLMakie scene + the vendored bundle), so it gets
> its own envelope here.
>
> **Reproduce** (re-runnable, prints the live numbers — they can't silently rot):
> `julia --project=HoloWGL HoloWGL/bench/payload_size.jl`. Last measured **2026-06-30** at commit
> **`f763c6d`** (the M2 envelope correction, PR #20), **WGLMakie 0.13.12, Julia 1.12**. Re-run and
> reconcile this file on any wire-format change (a new geometry layout, a new scene field, an encoding
> change, an animation/frames slot) — and note the new commit here.

## The payload terms

A rendered `:webgl` cell ships three payloads over Pluto's `published_to_js` (MsgPack on the wire);
the click *return* value (`{layer,index,payload}`) is tiny and not a factor:

| Term | Carried by | Cost driver | Shipped |
|------|-----------|-------------|---------|
| **WGLMakie bundle** | `published_to_js` → blob URL → `import()` | fixed (vendored bundle + three.js + atlas) | **once per notebook** (M2) |
| **scene** | `published_to_js` (MsgPack binary) | #plots × geometry + glyph atlas | every render (per cell / per frame) |
| **manifest + overlay** | reuses Holo core verbatim | #hit-elements | every render (tiny — see `../../docs/perf-findings.md`) |

The **bundle dominated** and is now shared once per notebook (M2 / PR #18), so the per-cell cost is
just the **scene**.

## Envelope (2026-06-30, WGLMakie 0.13.12)

| | shipped | wire | gzip-bin | gzip-json | JSON proxy |
|---|---|---|---|---|---|
| WGLMakie bundle | once per notebook | **1.09 MB** | — | — | — |
| scene — 2D lines (200 pts) | per cell | **0.07 MB** | 0.02 | 0.05 | 0.33 |
| scene — 2D scatter + text (40) | per cell | **0.10 MB** | 0.03 | 0.08 | 0.44 |
| scene — 3D helix (300 pts) | per cell | **0.14 MB** | 0.05 | 0.11 | 0.56 |

So the first `:webgl` cell ships ~1.1 MB (bundle) + ~0.07–0.14 MB (scene); each **additional** cell —
and each tier-1 reactive re-render — ships just its **0.07–0.14 MB** scene. That's **≈8–16×** below
the 1.09 MB bundle.

### Wire vs JSON proxy

`published_to_js` does **not** ship the scene as JSON text. Pluto's MsgPack encodes every typed
numeric `Vector` (`Float32`/`Int32`/`UInt32`/`UInt8` — exactly what `_plain` emits) as a **binary**
extension (`reinterpret(UInt8, x)`, `sizeof·length`). So the real wire is the **binary** column,
**~4–5× under** `JSON3.write` (floats-as-text) — the proxy an earlier bench reported. The committed
bench reports both; the `wire` column is what actually crosses the wire (dominant term; structural
map/string overhead adds a little).

## Bundle sharing — why it's once per notebook (M2 / PR #18)

`published_to_js` ids are content-addressed (`notebook_id/objectid(x)`, and `objectid(::String)` is
content-based), so the one `Ref`-cached bundle string has a **stable id** that crosses the wire
exactly once: across cells, Pluto's notebook merge keeps one copy on load; across re-runs of a cell,
Pluto nulls already-known ids before sending (`known_published_objects` + `format_output.jl`), so a
re-run re-ships only its new-id scene, never the stable-id bundle. The browser then caches the
bundle/shim blob URLs once on `window.__HoloWGL` so the WGLMakie module imports once, not per cell.

## Deferred compression levers (measured, not yet built)

The per-cell scene is already small (binary), so compression is **deferred** — both levers measured:

- **gzip.** The bench's `gzip-bin` column measures gzip-of-binary at **~3×** (0.07→0.02 MB), but to
  use it we'd have to bypass `published_to_js`'s object channel and hand-roll a **msgpack decoder in
  JS**. The cheap path — gzip-of-JSON via the browser's native `DecompressionStream` → `JSON.parse`
  (the `gzip-json` column) — buys only **~25%** vs the current wire, since it starts from float-text.
  Not worth a new JS decoder + failure surface for ~0.05 MB/cell yet.
- **Atlas sharing.** The glyph-atlas tiles (`glyph_data/atlas_updates/<hash>`) carry content hashes
  **observed to repeat across scenes** (the digit/label tiles recur in all three bench figures above),
  so they're shareable like the bundle — but each is ~10–20 KB, gzip overlaps the win, and hoisting
  them to a shared channel is real complexity.

**Revisit both only if tier-1 animation profiling (per-frame scene re-ship) shows the scene is the
bottleneck** — tier-2 in-place patching (NOTES.md) already ships no new scene at all.
