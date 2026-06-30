# The :webgl widget — ADDITIVE (Holo core untouched). Mirrors Holo's HoloWidget/show, but
# the base layer is a live WGLMakie <canvas> instead of a PNG. Reuses Holo's context,
# build_manifest, overlay bundle, and bond contract verbatim; only the base layer differs.

import Holo
using Holo: build_manifest, InteractionEvent, auto_interactables
import AbstractPlutoDingetjes as APD
using HypertextLiteral: @htl, JavaScript
import JSON3

struct WebGLWidget
    scene::Dict{String, Any}        # serialize_scene payload (4-rule encoded)
    manifest::Dict{String, Any}
    display_css::Int
    width::Int
    height::Int
    px_per_unit::Float64
end

"""
    holo_webgl(fig, interactables; backend=WebGLBackend(), selected=nothing, kwargs...)

Like `Holo.holo`, but renders `fig` live in a browser WGLMakie canvas (client GPU) with
Holo's overlay on top — so 3D / animation / large data work. Same `@bind` contract as `holo`.
"""
function holo_webgl(
        fig, interactables::AbstractVector;
        backend::WebGLBackend = WebGLBackend(), selected = nothing, tip_style = nothing,
    )
    bg0 = fig.scene.backgroundcolor[]
    try
        fig.scene.backgroundcolor[] = Makie.RGBAf(Makie.red(bg0), Makie.green(bg0), Makie.blue(bg0), 1)
        Makie.update_state_before_display!(fig)
        ppu = _ppu(backend, fig)
        ctx = Holo.context(backend, fig, ppu)               # reuse: 1-2px aligned projection
        manifest = build_manifest(interactables, ctx; selected, tip_style)
        result = Holo.render(backend, fig, ppu)             # WebGLResult (scene payload)
        w, h = size(fig.scene)
        display_css = round(Int, min(w, backend.max_width))
        return WebGLWidget(result.scene, manifest, display_css, w, h, Float64(ppu))
    finally
        fig.scene.backgroundcolor[] = bg0
    end
end
holo_webgl(fig, i::Holo.AbstractInteractable; kwargs...) = holo_webgl(fig, [i]; kwargs...)
holo_webgl(fig; kwargs...) = holo_webgl(fig, auto_interactables(fig); kwargs...)

# Build the widget HTML. `*_expr`/`*_js` are JS expressions yielding the data/text:
# published_to_js for Pluto (ships over Pluto's data channel — works local/remote/export, no
# server), or inlined JSON for self-contained/testing. The bundle + shim text become blob
# URLs in the browser so `import()` works without any file:// path or hosted asset.
function _widget_html(w::WebGLWidget; scene_expr, manifest_expr, bundle_js, shim_js)
    overlay = JavaScript(Holo._OVERLAY_JS[])   # reuse Holo's committed overlay bundle verbatim
    # Holo's overlay is base-agnostic (`querySelector("img, canvas")`; image-px scale from
    # `manifest.width`, not the element's intrinsic size — design.md §6), so it binds directly to
    # our <canvas>. No transparent SVG sizer shim anymore (M3.1).
    return @htl(
        """
        <div class="ip-host" style="position:relative; display:inline-block; width:100%; max-width:$(w.display_css)px;">
          <canvas class="holo-webgl-base" width="$(w.width)" height="$(w.height)"
                  style="display:block; width:100%; height:auto;"></canvas>
          <script>
            // regular (non-module) script: document.currentScript is set here (modules' is null),
            // so this resolves the canvas in both Pluto and standalone. Blob URLs let import()
            // load the WGLMakie bundle + shim with no server / no file:// path.
            const _s = document.currentScript;
            const _canvas = _s.parentElement.querySelector("canvas.holo-webgl-base");
            // M2 bundle-sharing: install the ~1MB WGLMakie bundle + shim blob URLs ONCE per
            // notebook on window (the same idempotent-singleton trick Holo uses for window.Holo).
            // `??=` short-circuits, so on a cache hit the published 1MB bundle ref is never even
            // dereferenced — every extra widget reuses the one module (ES imports are URL-cached),
            // instead of re-blobbing + re-importing ~1MB per cell. (The wire already ships the
            // bundle once: published_to_js ids are content-addressed, so N cells publishing the
            // same cached string share one id and Pluto's notebook merge keeps a single copy.)
            const _H = (window.__HoloWGL ??= {});
            const _blob = (t) => URL.createObjectURL(new Blob([t], { type: "text/javascript" }));
            const _bundleUrl = (_H.bundleUrl ??= _blob($(bundle_js)));
            const _shimUrl = (_H.shimUrl ??= _blob($(shim_js)));
            import(_shimUrl).then(({ mountWebGL }) =>
              mountWebGL({ canvas: _canvas, wglBundleUrl: _bundleUrl,
                           scene: $(scene_expr), width: $(w.width), height: $(w.height),
                           pxPerUnit: $(w.px_per_unit) }));
          </script>
          <script>
            $(overlay)
            const _o = document.currentScript;
            const manifest = $(manifest_expr);
            window.Holo.mount(_o, manifest, typeof invalidation === "undefined" ? new Promise(() => {}) : invalidation);
          </script>
        </div>
        """
    )
end

# Cache the bundle (~1MB) + shim text once, not per render.
const _BUNDLE_TEXT = Ref{String}("")
const _SHIM_TEXT = Ref{String}("")
_bundle_text() = (isempty(_BUNDLE_TEXT[]) && (_BUNDLE_TEXT[] = read(wglmakie_bundle_path(), String)); _BUNDLE_TEXT[])
_shim_text() = (isempty(_SHIM_TEXT[]) && (_SHIM_TEXT[] = read(SHIM_JS, String)); _SHIM_TEXT[])

function Base.show(io::IO, m::MIME"text/html", w::WebGLWidget)
    # Everything ships over Pluto's published_to_js data channel — scene + manifest + the
    # bundle/shim text — so there is no server and no file:// path (works remote + export).
    # The bundle is shared once per notebook (M2): published_to_js ids are content-addressed
    # (notebook_id/objectid), so every cell publishing this one cached string gets the same id
    # and Pluto's notebook merge ships the ~1MB once; the browser then caches the blob URL on
    # window.__HoloWGL (see _widget_html) so it imports the WGLMakie module once, not per cell.
    pub = APD.Display.published_to_js
    html = _widget_html(
        w;
        scene_expr = pub(w.scene), manifest_expr = pub(w.manifest),
        bundle_js = pub(_bundle_text()), shim_js = pub(_shim_text()),
    )
    return show(io, m, html)
end

# ---- bond plumbing: identical contract to HoloWidget (same overlay, same events) ----
APD.Bonds.initial_value(::WebGLWidget) = nothing
function APD.Bonds.transform_value(::WebGLWidget, js)
    js === nothing && return nothing
    if haskey(js, "items")
        return InteractionEvent[
            InteractionEvent(Symbol(it["layer"]), Int(it["index"]), get(it, "payload", nothing))
                for it in js["items"]
        ]
    end
    return InteractionEvent(Symbol(js["layer"]), Int(js["index"]), get(js, "payload", nothing))
end
