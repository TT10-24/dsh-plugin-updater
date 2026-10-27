/**
 * dsh-plugin-updater — compatibility shim for the one kernel package it needs.
 *
 * A profile-installed bundle normally resolves `@deepseek-ai/*` packages that
 * dsh itself ships. DSH NEXT also loads linked plugins from outside its own
 * module graph, where that package is not visible, so a static import would
 * make the whole plugin fail with ERR_MODULE_NOT_FOUND before it can start.
 *
 * Resolution is checked first; only a resolvable kernel package is imported.
 * When it is not visible, the local base registers the same instance through
 * `ctx.provide()`. Both give the Remote gateway a `ctx.get('pluginUpdater')`
 * value with `ctx` and `name`. Only `Service` is needed: the Remote binding
 * and its method marker are plain JSON metadata (see `index.js`).
 */

/** Minimal Cordis-compatible service base used when the kernel package is not visible. */
class LocalService {
  constructor(ctx, name) {
    this.ctx = ctx
    this.name = name
    if (typeof ctx?.provide !== 'function') {
      throw new Error('dsh-plugin-updater: this kernel does not expose ctx.provide()')
    }
    ctx.provide(name, this)
  }
}

let Service = LocalService
let resolved = null
try {
  resolved = typeof import.meta.resolve === 'function' ? import.meta.resolve('@deepseek-ai/cordis') : null
} catch {
  /* linked DSH NEXT plugins cannot see the kernel package */
}
if (typeof resolved === 'string' && resolved.length > 0) {
  try {
    const cordis = await import(resolved)
    const candidate = cordis.Service ?? cordis.default?.Service
    if (typeof candidate === 'function') Service = candidate
  } catch {
    /* fall back to the local base */
  }
}

export { Service }
