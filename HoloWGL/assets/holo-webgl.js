// HoloWGL :webgl bootstrap — renders a serialize_scene payload with NO Bonito runtime and
// NO server. Imports WGLMakie's own bundle (version-matched, three.js inlined) and feeds it
// through a tiny shim. Validated by the spikes (full 2D+3D fidelity, animation hook).
//
// Usage (from the Holo widget HTML, mount===:webgl):
//   import { mountWebGL } from "./holo-webgl.js";
//   mountWebGL({ canvas, wglBundleUrl, scene: published, width, height, pxPerUnit });
//
// `scene` is the published_to_js payload from HoloWGL.scene_payload (the 4-rule encoding).

// --- the ENTIRE -bonito shim --------------------------------------------------
function makeBonitoShim() {
  class ConnStub { send() {} on() { return () => {}; } }
  ConnStub.send_error = (msg, e) => console.error("[holo-wgl]", msg, (e && e.stack) || e);
  return {
    // MUST be true: WGLMakie gates observable updates on this. comm.send is a no-op, so
    // client-side updates (camera/uniform animation) fire without any server (spike finding).
    can_send_to_julia: () => true,
    throttle_function: (f) => f,
    Connection: ConnStub,
    _ConnStub: ConnStub,
  };
}

// functional observable shim: stores callbacks, notify() runs them -> the animation hook
function obs(v) {
  const cbs = [];
  return {
    value: v,
    on(f) { cbs.push(f); return () => {}; },
    notify(nv) { if (nv !== undefined) this.value = nv; cbs.forEach((f) => f(this.value)); },
  };
}

const TA = { f32: Float32Array, i32: Int32Array, u32: Uint32Array, u8: Uint8Array };

// rebuild the structures WGLMakie's deserialize expects from the 4-rule tags
function rewrap(x) {
  if (x && typeof x === "object" && !Array.isArray(x)) {
    if ("__obs__" in x) return obs(rewrap(x.__obs__));   // Observable shim
    if ("__t__" in x) return new TA[x.__t__](x.d);        // 1-D TypedArray
    const o = {};
    for (const k in x) o[k] = rewrap(x[k]);               // {array,size} recurse; nested dicts
    return o;
  }
  if (Array.isArray(x)) return x.map(rewrap);
  return x;
}

export async function mountWebGL({ canvas, wglBundleUrl, scene, width, height, pxPerUnit = 2 }) {
  const WGL = await import(wglBundleUrl);
  window.Bonito = makeBonitoShim();             // WGLMakie reads window.Bonito globals
  const wrapper = canvas.parentElement;
  const sceneObj = rewrap(scene);
  WGL.setup_scene_init(
    wrapper, canvas,
    width, height,
    null,                  // resize_to (fixed size -> overlay alignment holds)
    pxPerUnit, 1,
    obs([width, height]),  // real_size
    obs([width, height]),  // canvas_width
    obs(sceneObj),         // scene_serialized (.value set -> immediate init)
    new window.Bonito._ConnStub(),
    30,                    // framerate
    obs(false),            // done_init
  );
  // Return WGL so an animation driver can do BOTH tiers without re-importing:
  //  - uniforms/camera: find the live observable in `scene` and .notify(v)
  //  - data (positions): WGL.find_plots([uuid])[0].geometry.attributes.wgl_positions
  //      .array.set(frame); attr.needsUpdate = true;   (smooth, no Julia round-trip)
  return { scene: sceneObj, WGL };
}
