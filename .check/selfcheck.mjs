/**
 * Offline sanity check for the dsh-plugin-updater Host half.
 *
 * Must run from a directory that resolves `@deepseek-ai/*` (the dsh app tree).
 * It builds a real Cordis context, mounts the service, and performs one genuine
 * profile read plus registry/desktop sweep — including the "newly added plugin"
 * path and the desktop layer. It never writes into the profile.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { UpdaterService, compareVersions, fetchLatestVersion, fetchDesktopVersion, releaseLine, releaseKind } from '../index.js'

const failures = []
const cases = [
  ['0.3.0', '0.4.0', -1],
  ['0.4.2', '0.4.2', 0],
  ['1.0.0', '0.9.9', 1],
  ['1.0.0', '1.0.1', -1],
  ['2.0.0', '10.0.0', -1],
  ['1.0.0-beta.1', '1.0.0', -1],
  ['1.0.1', '1.0.0', 1],
  ['0.1.0', '0.1.0-rc.2', 1],
  ['^0.3.0', '0.3.0', 0],
  ['~1.2.3', '1.2.3', 0],
  ['0.2.1-rc.2', '0.2.1-rc.2', 0],
]
for (const [left, right, expected] of cases) {
  const actual = compareVersions(left, right)
  if (actual !== expected) failures.push(`${left} vs ${right}: expected ${expected}, got ${actual}`)
}
console.log(`version comparisons: ${cases.length - failures.length}/${cases.length} passed`)

const lineCases = [
  ['2.0.18', 'stable'],
  ['2.0.20', 'stable'],
  ['2.0.20-next', 'next'],
  ['2.0.20-next.1', 'next'],
  ['2.0.20-beta.1', 'beta'],
  ['0.2.1-rc.2', 'prerelease'],
]
for (const [version, expected] of lineCases) {
  const actual = releaseLine(version)
  if (actual !== expected) failures.push(`releaseLine(${version}): expected ${expected}, got ${actual}`)
}
console.log(`release lines: ${lineCases.length} checked`)

const kindCases = [
  ['2.0.18', '2.0.20-next', 'product-line'],
  ['2.0.18', '2.0.20', 'patch'],
  ['2.0.18', '2.1.0', 'minor'],
  ['2.0.18', '3.0.0', 'major'],
  ['2.0.20-next', '2.0.20', 'prerelease'],
]
for (const [current, latest, expected] of kindCases) {
  const actual = releaseKind(current, latest)
  if (actual !== expected) failures.push(`releaseKind(${current}, ${latest}): expected ${expected}, got ${actual}`)
}
console.log(`release kinds: ${kindCases.length} checked`)

const descriptor = Object.getOwnPropertyDescriptor(UpdaterService.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods')?.value
console.log('remote descriptor:', JSON.stringify(descriptor))
const methods = (descriptor?.methods ?? []).map((entry) => entry.method).sort().join(',')
if (methods !== 'check,desktopData,ignore,prepareDesktopUpdate,repairDesktopData,status,unignore,update') failures.push(`unexpected Remote methods: ${methods}`)

const profileDir = process.argv[2]
if (typeof profileDir !== 'string' || profileDir.length === 0) {
  console.error('usage: node .check/selfcheck.mjs <profile-dir> [client-path]')
  console.error('  profile-dir: the DSH profile directory, e.g. %DSH_HOME%/profiles/desktop')
  process.exit(1)
}
const home = path.resolve(profileDir, '..', '..')
/** Plain Node has no Electron resources path; the engine detector can use this env. */
try {
  if (process.resourcesPath === undefined && typeof process.env.DSH_DESKTOP_RESOURCES === 'string') {
    process.resourcesPath = process.env.DSH_DESKTOP_RESOURCES
  }
} catch {
  /* the property may be read-only on some runtimes */
}
const calls = []
const ctx = new Context()
ctx.provide('profileContext', { name: path.basename(profileDir), dir: profileDir, home })
ctx.provide('pluginManager', {
  registries: async () => ({ registry: null, fallbackRegistries: [], resolved: null }),
  listBundles: async () => [
    { name: '@deepseek-ai/dsh-base', version: '0.2.1-rc.2', installed: false, enabled: true, removable: false },
    { name: 'dsh-ops', version: '0.3.0', installed: true, enabled: true, removable: true },
    { name: 'dsh-whale-widget', version: '0.4.2', installed: true, enabled: true, removable: true },
    { name: 'dsh-plugin-updater', version: '0.2.0', installed: true, enabled: true, removable: true },
    { name: 'dsh-simulated-new-plugin', version: '1.0.0', installed: true, enabled: true, removable: true },
  ],
  removeBundle: async (name) => {
    calls.push({ op: 'remove', name })
    return { changed: true, application: 'applied', stage: 'remove', target: name }
  },
  installBundle: async (spec, options) => {
    calls.push({ op: 'install', spec, requestId: options?.requestId ?? null })
    return { changed: true, application: 'restart-required', stage: 'install', target: spec }
  },
})
ctx.provide('desktopRuntime', {
  updates: {
    isPackaged: true,
    currentVersion: '2.0.18',
    releaseChannel: 'stable',
  },
})
ctx.provide('logger', { info: (...args) => console.log('  log:', ...args) })

const service = new UpdaterService(ctx, { verbose: true })
console.log('service key:', service.name, '| profileDir:', service.profileDir(), '| dataDir:', service.dataDir)
console.log('typertRemote:', JSON.stringify({ serviceKey: service.typertRemote.serviceKey, namespace: service.typertRemote.namespace }))
console.log('compat:', JSON.stringify(service.compat()))

const report = await service.check(true)
console.log('report:', JSON.stringify({ registry: report.registry, profileDir: report.profileDir, updates: report.updates, error: report.error }))
for (const entry of report.packages) {
  console.log(`  - ${entry.name} [${entry.source}] ${entry.installedVersion} -> ${entry.latestVersion} | ${entry.status}`)
}
console.log('desktop layer:', JSON.stringify(report.desktop))
console.log('engine layer:', JSON.stringify(report.engine))

const simulated = report.packages.find((entry) => entry.name === 'dsh-simulated-new-plugin')
if (simulated === undefined) failures.push('a bundle present only in the live bundle list was not checked')
else console.log('new-plugin path:', JSON.stringify(simulated))

if (report.desktop?.status === undefined) failures.push('desktop layer missing from the report')
if (report.desktop?.currentVersion !== '2.0.18') failures.push(`desktop current version not read from the runtime: ${report.desktop?.currentVersion}`)
if (report.desktop?.line !== 'stable') failures.push(`desktop release line not reported: ${report.desktop?.line}`)
if (report.desktop?.data?.home !== home) failures.push(`desktop data home not resolved: ${report.desktop?.data?.home}`)
if (report.desktop?.migration !== null && report.desktop?.requiresConfirmation !== true) failures.push('a NEXT migration was not marked as requiring confirmation')

/** The handoff write must land in a temporary APPDATA, never the real one. */
const tempAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-next-'))
const previousAppData = process.env.APPDATA
process.env.APPDATA = tempAppData
try {
  const handoffContext = new Context()
  handoffContext.provide('profileContext', { name: path.basename(profileDir), dir: profileDir, home })
  const handoff = new UpdaterService(handoffContext, { profileDir })
  handoff.dataDir = path.join(tempAppData, 'plugin-updater')
  handoff.ignoredFile = path.join(handoff.dataDir, 'ignored.json')
  fs.mkdirSync(handoff.dataDir, { recursive: true })
  const prepared = handoff.prepareDesktopUpdate(true, '2.0.20-next')
  const pointerFile = path.join(tempAppData, 'DSH NEXT', 'home', 'desktop-next-location.json')
  const pointer = fs.existsSync(pointerFile) ? JSON.parse(fs.readFileSync(pointerFile, 'utf8')) : null
  if (prepared.ok !== true) failures.push(`handoff write failed: ${prepared.error}`)
  if (pointer?.home !== home) failures.push(`handoff pointer is ${pointer?.home}, expected ${home}`)
  if (!fs.existsSync(path.join(handoff.dataDir, 'desktop-handoff.json'))) failures.push('handoff manifest was not written')
  if (!fs.existsSync(path.join(handoff.dataDir, 'restore-desktop-data.ps1'))) failures.push('handoff recovery script was not written')
  const repaired = handoff.repairDesktopData()
  if (repaired.ok !== true) failures.push(`handoff repair failed: ${repaired.error}`)
  const skipped = handoff.prepareDesktopUpdate(false, '2.0.20-next')
  if (skipped.skipped !== 'preserve-home-not-requested') failures.push('opt-out did not skip the handoff')
  const notProduct = handoff.prepareDesktopUpdate(true, '2.0.20')
  if (notProduct.skipped !== 'not-a-product-line-change') failures.push('a stable patch was treated as a product change')

  const ignoredOne = handoff.ignore('dsh-ops', '9.9.9')
  const ignoredDesktop = handoff.ignore('desktop', '2.0.20-next')
  const ignoredFile = path.join(handoff.dataDir, 'ignored.json')
  const ignoredState = fs.existsSync(ignoredFile) ? JSON.parse(fs.readFileSync(ignoredFile, 'utf8')) : null
  if (ignoredOne.ok !== true || ignoredDesktop.ok !== true) failures.push('ignore() did not accept a package and a desktop version')
  if (ignoredState?.packages?.['dsh-ops'] !== '9.9.9') failures.push('ignore() did not persist the package version')
  if (ignoredState?.desktop !== '2.0.20-next') failures.push('ignore() did not persist the desktop version')
  const unignored = handoff.unignore('dsh-ops')
  if (unignored.ok !== true) failures.push('unignore() did not remove the package entry')
  if (handoff.readIgnored().packages['dsh-ops'] !== undefined) failures.push('unignore() left the package entry behind')
  console.log('ignore list: temporary dataDir OK')
} finally {
  process.env.APPDATA = previousAppData
  fs.rmSync(tempAppData, { recursive: true, force: true })
}
if (report.engine !== null && report.engine?.currentVersion === undefined) failures.push('engine layer has no current version')
console.log('engine detected:', report.engine === null ? 'none (no bundled manifest)' : report.engine.currentVersion)

const desktopAnswer = await fetchDesktopVersion(undefined, 'stable', '2.0.18', new AbortController().signal)
console.log('desktop service answer:', JSON.stringify(desktopAnswer))
if (desktopAnswer.status === 'ok' && desktopAnswer.version === null) failures.push('desktop service answer carried no version')

const status = service.status()
console.log('status:', JSON.stringify(status))

const single = await fetchLatestVersion('https://registry.npmjs.org', '@deepseek-ai/dsh', new AbortController().signal)
console.log('engine registry answer:', JSON.stringify(single))

/** Update path: remove first, then install the exact target. */
const installedVersion = JSON.parse(fs.readFileSync(path.join(profileDir, 'node_modules', 'dsh-ops', 'package.json'), 'utf8')).version
const updateResult = await service.update('dsh-ops', '0.4.2', 'req-selfcheck')
console.log('update result:', JSON.stringify(updateResult))
console.log('update calls:', JSON.stringify(calls))
if (calls[0]?.op !== 'remove' || calls[0]?.name !== 'dsh-ops') failures.push('update did not remove the installed bundle first')
if (calls[1]?.op !== 'install' || calls[1]?.spec !== 'dsh-ops@0.4.2') failures.push('update did not install the exact target afterwards')
if (calls[1]?.requestId !== 'req-selfcheck') failures.push('update did not forward the client request id to installBundle')
if (updateResult.ok !== true) failures.push(`update reported failure: ${updateResult.error}`)

/** A failed install must put the previous version back. */
const restoreCalls = []
const ctx2 = new Context()
ctx2.provide('profileContext', { name: path.basename(profileDir), dir: profileDir, home })
ctx2.provide('pluginManager', {
  removeBundle: async (name) => ({ changed: true, application: 'applied', stage: 'remove', target: name }),
  installBundle: async (spec) => {
    restoreCalls.push(spec)
    if (spec.endsWith('@99.99.99')) throw new Error('incompatible-version')
    return { changed: true, application: 'applied', stage: 'install', target: spec }
  },
})
const failing = new UpdaterService(ctx2, {})
const failedUpdate = await failing.update('dsh-ops', '99.99.99')
console.log('failed update result:', JSON.stringify(failedUpdate), 'restore calls:', JSON.stringify(restoreCalls))
if (failedUpdate.ok !== false) failures.push('failed update reported success')
if (failedUpdate.restored !== true) failures.push('failed update did not restore the previous version')
if (!restoreCalls.some((spec) => spec === `dsh-ops@${installedVersion}`)) failures.push('restore did not reinstall the previous exact version')

const updateSource = UpdaterService.prototype.update.toString()
if (!updateSource.includes('removeBundle')) failures.push('update no longer removes before installing')
if (!updateSource.includes('restoreInstall')) failures.push('update has no restore path')

/** Static contract checks on the Client half. */
const clientPath = process.argv[3] ?? './client.js'
const client = fs.readFileSync(clientPath, 'utf8')
if (client.includes("'shell.overlay'")) failures.push('client still registers the right-hand overlay slot')
if (!client.includes('useDrag')) failures.push('client has no drag support')
if (!client.includes('ref: panelRef')) failures.push('the drag ref is not attached to the panel node')
if (!client.includes('document.addEventListener')) failures.push('drag listeners are not attached synchronously')
if (!client.includes('localStorage')) failures.push('client does not remember the dragged position')
if (!client.includes('/api/desktop/updates/check')) failures.push('client does not use the shell desktop update route')
if (!client.includes('/api/desktop/restart')) failures.push('client cannot restart the desktop after an update')
if (!client.includes('restartRequired')) failures.push('client does not surface the restart requirement')
if (!client.includes('progressFraction')) failures.push('client has no progress model')
if (!client.includes("role: 'progressbar'")) failures.push('client has no progress bar')
if (!client.includes('updateAllCount')) failures.push('client has no one-click batch update button')
if (!client.includes("plugin-manager/install-state")) failures.push('client does not subscribe to install progress')
if (!client.includes("plugin-manager/install-log")) failures.push('client does not subscribe to install logs')
if (!client.includes('markUpdated')) failures.push('client does not hide updated rows immediately')
if (!client.includes("credentials: 'same-origin'")) failures.push('client desktop update request does not carry the browser session')
if (!/inject: \['slots', 'locale'\]/.test(client)) failures.push('client dependencies changed unexpectedly')

if (failures.length > 0) {
  console.error('FAILURES:', failures.join(' | '))
  process.exitCode = 1
} else {
  console.log('OK')
}
