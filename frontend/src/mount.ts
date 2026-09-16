import { SVG_NS, drawSelection } from "./highlight"
import { hitLayerByIndex } from "./selection"
import { onLeave } from "./hover"
import { onDown, onUp, onCancel, onLostCapture, onClick, onPointerMove } from "./bond"
import { buildFocusable, computeLayerStarts, focusTo, handleKeydown } from "./keyboard"
import * as thresholdDrag from "./drag/threshold"
import * as roiDrag from "./drag/roi"
import { createOverlayState, cancelPendingMove, cancelPendingDrag, MOTION_MS } from "./state"
import type { OverlayCtx } from "./state"
import type { Hit, Manifest } from "./types"

const STYLE = `
:host { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.surface { position: absolute; inset: 0; cursor: crosshair; pointer-events: auto; }
.surface.hot { cursor: pointer; }
.surface.grab { cursor: grab; }
.surface.grabbing { cursor: grabbing; }
.surface.cur-nwse { cursor: nwse-resize; }
.surface.cur-nesw { cursor: nesw-resize; }
.surface.cur-ns { cursor: ns-resize; }
.surface.cur-ew { cursor: ew-resize; }
.surface.cur-move { cursor: move; }
.holo-threshold-line { stroke-width: var(--holo-line-w, 2); }
.holo-threshold-line.hovered { stroke-width: calc(var(--holo-line-w, 2) * 1.75); }
/* Default :focus-visible outline stays until a focus ring is actually drawn (kbd-ring, set by
   keyboard.ts's focusTo) — so tabbing in still shows *something* before the first arrow press,
   but the browser outline doesn't double up with our own ring once one exists. */
.surface.kbd-ring:focus-visible { outline: none; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
       clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.holo-enter { animation: holo-in ${MOTION_MS}ms ease-out; }
.holo-leave { animation: holo-out ${MOTION_MS}ms ease-in forwards; }
@keyframes holo-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes holo-out { from { opacity: 1 } to { opacity: 0 } }
/* --holo-fig-bg (set by mount.ts from the manifest's "background" field) is the figure's own
   background colour — the tooltip theme follows IT, not just the OS prefers-color-scheme, so a
   dark Makie figure in a light Pluto page still gets a dark tooltip. Registering the property
   makes it interpolable/animatable and, more importantly, gives lch(from …) below a typed
   <color> to read "l" off — an unregistered custom property is a plain token stream, which
   relative-color syntax cannot decompose. 49.44 is the lch lightness of middle grey (#808080);
   calc(infinity) collapses the clamp() to its 12 (dark) or 100 (light) endpoint on either side
   of it, so the derived surface is always a flat near-white or near-black grey (chroma/hue 0),
   never a tint of the figure's own hue — the mark accent (added by tooltip_* / colors, not
   here) is the only place the figure's actual colour is allowed to show through. The trailing
   / 1 forces full opacity: omitting the alpha component of lch(from …) inherits the ORIGIN
   colour's own alpha, and holo() always forces the figure's background opaque before building
   the manifest, but a caller building the manifest directly (build_manifest's background
   kwarg, not through holo()) isn't guaranteed to. */
@property --holo-fig-bg { syntax: "<color>"; inherits: true; initial-value: #ffffff; }
:host {
  --holo-tip-bg-resolved: var(--holo-tip-bg, lch(from var(--holo-fig-bg) clamp(12, calc((l - 49.44) * infinity), 100) 0 0 / 1));
  --holo-tip-color-resolved: var(--holo-tip-color, lch(from var(--holo-fig-bg) clamp(12, calc((49.44 - l) * infinity), 100) 0 0 / 1));
  --holo-tip-border-resolved: var(--holo-tip-border, color-mix(in lch, var(--holo-tip-bg-resolved), var(--holo-tip-color-resolved) 20%));
}
/* Browsers without CSS relative colour syntax (no lch(from …)/calc(infinity)) fall back to
   exactly today's behaviour: a static light theme, OS prefers-color-scheme for dark — the
   figure's own background plays no part. */
@supports not (color: lch(from red calc(l * infinity) 0 0)) {
  :host {
    --holo-tip-bg-resolved: var(--holo-tip-bg, #ffffff);
    --holo-tip-color-resolved: var(--holo-tip-color, #1a1a1a);
    --holo-tip-border-resolved: var(--holo-tip-border, rgba(0,0,0,0.1));
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --holo-tip-bg-resolved: var(--holo-tip-bg, #1e1e1e);
      --holo-tip-color-resolved: var(--holo-tip-color, #e8e8e8);
      --holo-tip-border-resolved: var(--holo-tip-border, rgba(255,255,255,0.15));
    }
  }
}
.holo-tip { position: absolute; opacity: 0; pointer-events: none; z-index: 10;
       padding: var(--holo-tip-padding, 8px 12px); border-radius: var(--holo-tip-radius, 4px);
       background: var(--holo-tip-bg-resolved); color: var(--holo-tip-color-resolved);
       border: 1px solid var(--holo-tip-border-resolved);
       border-left: var(--holo-mark-border, 1px solid var(--holo-tip-border-resolved));
       box-shadow: var(--holo-tip-shadow, 0 2px 4px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08));
       font: var(--holo-tip-font-size, 11px)/1.4 var(--holo-tip-font, system-ui, -apple-system, sans-serif);
       max-width: var(--holo-tip-maxwidth, 320px); white-space: normal;
       transition: opacity ${MOTION_MS}ms ease-out; }
.holo-tip.show { opacity: 1; }
/* left's containing block is .holo-tip's PADDING box (absolute-position offsets are measured
   from the padding edge, CSS 2.1 §10.1), 1px inside its own 1px border — and the 5px transparent
   left/right borders below put the visible apex at the horizontal CENTRE of this element's own
   box, 5px right of its left edge. --holo-caret-x (geometry.ts's caretX) is "px from the anchored
   tooltip's OUTER left edge to the anchor" — landing the apex exactly there needs both offsets
   backed out: -1 (border) -5 (this element's own half-width) = -6. The 14px fallback (used only
   when --holo-caret-x is unset, i.e. every cursor-following, non-anchored placement) preserves
   the pre-existing default apex position (14-6=8, the literal this replaced). */
.holo-tip::before { content: ""; position: absolute; top: -5px; left: calc(var(--holo-caret-x, 14px) - 6px);
       border: 5px solid transparent; border-top: none; border-bottom-color: var(--holo-tip-bg-resolved);
       display: var(--holo-tip-caret, block); }
.holo-tip.flip-y::before { top: auto; bottom: -5px; border-bottom: none;
       border-top: 5px solid var(--holo-tip-bg-resolved); }
.holo-tip.flip-x::before { left: auto; right: 8px; }
.holo-tip-row { display: flex; gap: 8px; justify-content: space-between; }
.holo-tip-key { color: var(--holo-tip-accent, #6b7280); }
.holo-tip-val { font-variant-numeric: tabular-nums; }
@media (prefers-color-scheme: dark) {
  .holo-tip { box-shadow: var(--holo-tip-shadow, 0 2px 4px rgba(0,0,0,0.4), 0 8px 16px rgba(0,0,0,0.3)); }
}
@media (prefers-reduced-motion: reduce) {
  .holo-enter, .holo-leave { animation: none; }
  .holo-tip { transition: none; }
}
`

interface Mounted {
    cleanup: () => void
}

/**
 * Mount the interaction overlay.
 * @param scriptEl  the cell's <script> (its parent is the light-DOM host containing the <img>/<canvas> base)
 * @param manifest  hit-region manifest (from published_to_js or inlined JSON)
 * @param invalidation  Pluto's cleanup promise (resolves on cell re-render)
 */
export function mount(scriptEl: HTMLElement, manifest: Manifest, invalidation?: Promise<unknown>): Mounted {
    const host = scriptEl.parentElement as HTMLElement | null
    // Image-px scale comes from manifest.width, not the element's intrinsic size, so a
    // <canvas> needs no sizer shim. The host is assumed to hold exactly one base element.
    const base = host?.querySelector("img, canvas") as HTMLElement | null
    const noop: Mounted = { cleanup: () => {} }
    if (!host || !base) return noop

    // the @bind target is the host element; start with no selection
    ;(host as unknown as { value: unknown }).value = null

    const shadowHost = document.createElement("div")
    const shadow = shadowHost.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = STYLE
    const svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("viewBox", `0 0 ${manifest.width} ${manifest.height}`)
    svg.setAttribute("preserveAspectRatio", "none")
    const selGroup = document.createElementNS(SVG_NS, "g") // persistent box-selection highlights (g.sel, z-below hover)
    selGroup.setAttribute("class", "sel")
    svg.appendChild(selGroup)
    const hiGroup = document.createElementNS(SVG_NS, "g") // transient hover highlights (g.hi, z-above sel)
    hiGroup.setAttribute("class", "hi")
    svg.appendChild(hiGroup)
    const surface = document.createElement("div")
    surface.className = "surface"
    // touch-action: block native scroll/pinch on the surface ONLY when this manifest has a drag
    // interaction (threshold / ROI / view) — a hover/click-only plot (e.g. a plain scatter) must
    // not hijack page scrolling when a finger lands on it. This has to be decided up front, not
    // toggled per-pointerdown: UAs resolve touch-action at the touch's first contact, so setting
    // it later has no effect on the gesture already in flight.
    if (manifest.layers.some((l) => l.events.includes("drag"))) surface.style.touchAction = "none"
    const tip = document.createElement("div")
    tip.className = "holo-tip"
    tip.setAttribute("role", "tooltip")
    tip.setAttribute("aria-hidden", "true")

    // Keyboard nav needs the surface to be a real focus stop; role="application" (over the
    // safer "group") because NVDA/JAWS's default browse mode intercepts arrow keys before a
    // "group" ever sees them — "application" tells the AT this widget owns its own key
    // handling. aria-label is generic (there's no per-plot title in the manifest to draw one
    // from); aria-describedby points at a static, non-live usage hint (below) — the two must
    // share this shadow root, since ARIA idrefs don't cross shadow boundaries.
    surface.setAttribute("tabindex", "0")
    surface.setAttribute("role", "application")
    surface.setAttribute("aria-label", "Interactive plot")
    surface.setAttribute("aria-describedby", "holo-kbd-hint")

    const kbdHint = document.createElement("div")
    kbdHint.id = "holo-kbd-hint"
    kbdHint.className = "sr-only"
    kbdHint.textContent = "Use arrow keys to move between elements, Page Up or Page Down to jump between layers, " +
        "Enter to select, Escape to leave."

    // aria-live="polite", not the tooltip: aria-hidden toggling on the tooltip isn't an
    // announcement path for assistive tech, only a visibility one. Created empty and populated
    // later (keyboard.ts's focusTo, debounced) — a region created and filled in the same tick
    // often doesn't announce.
    const liveRegion = document.createElement("div")
    liveRegion.className = "sr-only"
    liveRegion.setAttribute("aria-live", "polite")
    liveRegion.setAttribute("aria-atomic", "true")

    shadow.append(style, svg, surface, tip, kbdHint, liveRegion)
    host.appendChild(shadowHost)
    // --holo-fig-bg drives the CSS-only tooltip theme (mount.ts's STYLE, lch(from …)); set
    // before tipStyle below so an explicit tooltip_bg/tooltip_color kwarg (--holo-tip-bg/
    // --holo-tip-color) still wins outright — they're independent custom properties consumed
    // together via nested var() fallbacks, not a write-order race.
    if (manifest.background) shadowHost.style.setProperty("--holo-fig-bg", manifest.background)
    if (manifest.tipStyle) for (const [k, v] of Object.entries(manifest.tipStyle)) shadowHost.style.setProperty(k, v)

    const thresholdLines = thresholdDrag.buildThresholdLines(manifest, svg)
    const roiBoxes = roiDrag.buildROIBoxes(manifest, svg)
    const focusable = buildFocusable(manifest)
    const layerStarts = computeLayerStarts(focusable)
    const ctx: OverlayCtx = {
        manifest_: manifest, host_: host, base_: base, surface_: surface, tip_: tip, hiGroup_: hiGroup, selGroup_: selGroup,
        thresholdLines_: thresholdLines, roiBoxes_: roiBoxes,
        shadowRoot_: shadow, focusable_: focusable, layerStarts_: layerStarts, liveRegion_: liveRegion,
    }
    const state = createOverlayState()

    // Pinned to the base (img/canvas), not the host: WGLMakie can size the <canvas>
    // differently from `.ip-host`, which left g.sel offset when the SVG was `inset:0` on the host.
    const syncOverlayToBase = () => {
        const hr = host.getBoundingClientRect()
        const br = base.getBoundingClientRect()
        if (!(br.width > 0 && br.height > 0)) return
        shadowHost.style.left = `${br.left - hr.left}px`
        shadowHost.style.top = `${br.top - hr.top}px`
        shadowHost.style.width = `${br.width}px`
        shadowHost.style.height = `${br.height}px`
        state.surfaceSized_ = false
    }
    syncOverlayToBase()
    const overlayRO = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncOverlayToBase) : null
    overlayRO?.observe(host)
    overlayRO?.observe(base)
    window.addEventListener("resize", syncOverlayToBase)
    let overlayFrames = 0
    const overlayTick = () => {
        syncOverlayToBase()
        if (++overlayFrames < 24) requestAnimationFrame(overlayTick)
    }
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(overlayTick)

    const down = (e: PointerEvent) => onDown(ctx, state, e)
    const move = (e: PointerEvent) => onPointerMove(ctx, state, e)
    const up = (e: PointerEvent) => onUp(ctx, state, e)
    const cancel = (e: PointerEvent) => onCancel(ctx, state, e)
    const leave = () => onLeave(ctx, state)
    const lostCapture = () => onLostCapture(ctx, state)
    const click = (e: MouseEvent) => onClick(ctx, state, e)
    const keydown = (e: KeyboardEvent) => handleKeydown(ctx, state, e)
    // DOM focus leaving the surface — Tab-away, a click landing elsewhere on the page, or the
    // notebook cell itself losing focus — must clear keyboard focus the same way Escape does.
    // Without this, focusIdx/focusHit/kbd-ring/the live region's last text all stay pinned to
    // whatever was last focused, and hover.ts's restoreFocus keeps re-drawing that stale ring
    // on every later pointer miss even though nothing is keyboard-focused anymore.
    const focusout = () => focusTo(ctx, state, null)

    surface.addEventListener("pointerdown", down)
    surface.addEventListener("pointermove", move)
    surface.addEventListener("pointerup", up)
    surface.addEventListener("pointercancel", cancel)
    surface.addEventListener("pointerleave", leave)
    surface.addEventListener("lostpointercapture", lostCapture)
    surface.addEventListener("click", click)
    surface.addEventListener("keydown", keydown)
    surface.addEventListener("focusout", focusout)

    // Drawn into g.sel, not g.hi: it must survive hovers (onMove clears g.hi on every miss)
    // and support multiple selected indices (drawHi keeps only the last).
    {
        const pre: Hit[] = []
        for (const layer of manifest.layers) {
            for (const idx of layer.selected ?? []) {
                pre.push({ layer, ...hitLayerByIndex(layer, idx) })
            }
        }
        if (pre.length) drawSelection(state, selGroup, pre)
    }

    const cleanup = () => {
        surface.removeEventListener("pointerdown", down)
        surface.removeEventListener("pointermove", move)
        surface.removeEventListener("pointerup", up)
        surface.removeEventListener("pointercancel", cancel)
        surface.removeEventListener("pointerleave", leave)
        surface.removeEventListener("lostpointercapture", lostCapture)
        surface.removeEventListener("click", click)
        surface.removeEventListener("keydown", keydown)
        surface.removeEventListener("focusout", focusout)
        window.removeEventListener("resize", syncOverlayToBase)
        overlayRO?.disconnect()
        overlayFrames = 24
        cancelPendingMove(state)
        cancelPendingDrag(state)
        if (state.hiLeaveTimer_ != null) clearTimeout(state.hiLeaveTimer_)
        if (state.tipFlipTimer_ != null) clearTimeout(state.tipFlipTimer_)
        if (state.announceTimer_ != null) clearTimeout(state.announceTimer_)
        shadowHost.remove()
    }
    invalidation?.then(cleanup)
    return { cleanup }
}
