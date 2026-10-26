/**
 * dsh-plugin-updater — compatibility shim for the one kernel package it needs.
 *
 * A profile-installed bundle resolves `@deepseek-ai/*` packages that dsh itself
 * ships, without declaring them as dependencies. Keeping the import in one file
 * makes that contract obvious and easy to audit.
 *
 * Only `Service` is imported: the Remote binding and its method marker are
 * ordinary plain-JSON metadata (see `index.js`), so publishing this plugin from a
 * GitHub tarball does not depend on the typert package being resolvable.
 * `Service` itself falls back to `default.Service` for a kernel that moved the
 * named export.
 */

import * as cordis from '@deepseek-ai/cordis'

const Service = cordis.Service ?? cordis.default?.Service
if (typeof Service !== 'function') {
  throw new Error('dsh-plugin-updater: the installed @deepseek-ai/cordis exports no Service class')
}

export { Service }
