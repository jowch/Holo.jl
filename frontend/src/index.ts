// Entry point. Self-installs onto the global so Julia's guarded IIFE can call
// `window.Holo.mount(...)` once per session.
import { mount } from "./overlay"

;(globalThis as unknown as { Holo?: unknown }).Holo = { mount }

export { mount }
