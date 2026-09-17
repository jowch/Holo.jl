// Entry point. Self-installs onto the global so Julia's guarded IIFE can call
// `window.Masque.mount(...)` once per session.
import { mount } from "./overlay"

;(globalThis as unknown as { Masque?: unknown }).Masque = { mount }

export { mount }
