/**
 * Offline sanity check for the dsh-plugin-updater Host half.
 *
 * Must run from a directory that resolves `@deepseek-ai/*` (the dsh app tree).
 * It builds a real Cordis context, mounts the service, and performs one genuine
 * profile read, registry sweep and DSH NEXT data-folder migration — including
 * the "newly added plugin" path. It never writes into the profile.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { UpdaterService, compareVersions, fetchLatestVersion } from '../index.js'

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

const descriptor = Object.getOwnPropertyDescriptor(UpdaterService.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods')?.value
console.log('remote descriptor:', JSON.stringify(descriptor))
const methods = (descriptor?.methods ?? []).map((entry) => entry.method).sort().join(',')
if (methods !== 'check,chooseDataFolder,ignore,migrateDataHome,status,unignore,update') failures.push(`unexpected Remote methods: ${methods}`)

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
    currentVersion: '2.0.20-next',
  },
})
ctx.provide('logger', { info: (...args) => console.log('  log:', ...args) })

const service = new UpdaterService(ctx, { verbose: true })
/** Keep the mock update trace out of the real <DSH_HOME>/plugin-updater log. */
const selfcheckData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-updater-check-'))
service.dataDir = selfcheckData
service.lastReportFile = path.join(selfcheckData, 'last-report.json')
service.ignoredFile = path.join(selfcheckData, 'ignored.json')
console.log('service key:', service.name, '| profileDir:', service.profileDir(), '| dataDir:', service.dataDir)
console.log('typertRemote:', JSON.stringify({ serviceKey: service.typertRemote.serviceKey, namespace: service.typertRemote.namespace }))
console.log('compat:', JSON.stringify(service.compat()))

const report = await service.check(true)
console.log('report:', JSON.stringify({ registry: report.registry, profileDir: report.profileDir, updates: report.updates, error: report.error }))
for (const entry of report.packages) {
  console.log(`  - ${entry.name} [${entry.source}] ${entry.installedVersion} -> ${entry.latestVersion} | ${entry.status}`)
}
console.log('next layer:', JSON.stringify(report.next))
console.log('engine layer:', JSON.stringify(report.engine))

const simulated = report.packages.find((entry) => entry.name === 'dsh-simulated-new-plugin')
if (simulated === undefined) failures.push('a bundle present only in the live bundle list was not checked')
else console.log('new-plugin path:', JSON.stringify(simulated))

if (report.next?.status === undefined) failures.push('DSH NEXT layer missing from the report')
if (report.next?.currentVersion !== '2.0.20-next') failures.push(`DSH NEXT current version not read from the runtime: ${report.next?.currentVersion}`)
if (report.next?.product !== 'DSH NEXT') failures.push(`DSH NEXT product name is ${report.next?.product}`)
if (report.next?.data?.home !== home) failures.push(`DSH NEXT data home not resolved: ${report.next?.data?.home}`)

/** DSH NEXT data-folder migration, in an isolated source home. */
const tempAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-next-'))
const previousAppData = process.env.APPDATA
process.env.APPDATA = tempAppData
const sourceHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-source-'))
const targetHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-target-'))
fs.rmSync(targetHome, { recursive: true, force: true })
fs.mkdirSync(path.join(sourceHome, 'profiles', 'desktop'), { recursive: true })
fs.writeFileSync(path.join(sourceHome, 'profiles', 'desktop', 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', dependencies: {} }))
fs.mkdirSync(path.join(sourceHome, 'sessions'), { recursive: true })
fs.writeFileSync(path.join(sourceHome, 'sessions', 'one.jsonl'), '{"hello":"world"}\n')
fs.mkdirSync(path.join(sourceHome, 'storages'), { recursive: true })
fs.writeFileSync(path.join(sourceHome, 'storages', 'state.json'), '{"ok":true}\n')
try {
  const handoffContext = new Context()
  handoffContext.provide('profileContext', {
    name: 'desktop',
    dir: path.join(sourceHome, 'profiles', 'desktop'),
    home: sourceHome,
  })
  const handoff = new UpdaterService(handoffContext, { profileDir: path.join(sourceHome, 'profiles', 'desktop') })
  handoff.dataDir = path.join(tempAppData, 'plugin-updater')
  handoff.lastReportFile = path.join(handoff.dataDir, 'last-report.json')
  handoff.ignoredFile = path.join(handoff.dataDir, 'ignored.json')
  fs.mkdirSync(handoff.dataDir, { recursive: true })

  const copied = await handoff.migrateDataHome(targetHome, { copy: true })
  const pointerFile = path.join(tempAppData, 'DSH NEXT', 'home', 'desktop-next-location.json')
  const pointer = fs.existsSync(pointerFile) ? JSON.parse(fs.readFileSync(pointerFile, 'utf8')) : null
  if (copied.ok !== true) failures.push(`data copy failed: ${copied.error}`)
  if (pointer?.home !== targetHome) failures.push(`data pointer is ${pointer?.home}, expected ${targetHome}`)
  if (!fs.existsSync(path.join(targetHome, 'sessions', 'one.jsonl'))) failures.push('sessions were not copied')
  if (!fs.existsSync(path.join(targetHome, 'storages', 'state.json'))) failures.push('storages were not copied')
  if (!fs.existsSync(path.join(targetHome, 'profiles', 'desktop', 'package.json'))) failures.push('profiles were not copied')
  if (!fs.existsSync(path.join(handoff.dataDir, 'data-home.json'))) failures.push('data-home manifest was not written')
  if (!fs.existsSync(path.join(handoff.dataDir, 'restore-data-home.ps1'))) failures.push('data-home recovery script was not written')

  const pointerOnly = await handoff.migrateDataHome(sourceHome, { copy: false })
  if (pointerOnly.ok !== true) failures.push(`pointer-only migration failed: ${pointerOnly.error}`)
  const emptyTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-empty-'))
  const refused = await handoff.migrateDataHome(emptyTarget, { copy: false })
  if (refused.ok !== false || refused.code !== 'empty-target') failures.push('pointer-only migration accepted an empty folder')
  fs.rmSync(emptyTarget, { recursive: true, force: true })
  const overlap = await handoff.migrateDataHome(path.join(sourceHome, 'profiles', 'nested'), { copy: false })
  if (overlap.ok !== false || overlap.code !== 'overlap') failures.push('migration accepted a target inside the source home')

  const ignoredOne = handoff.ignore('dsh-ops', '9.9.9')
  const ignoredFile = path.join(handoff.dataDir, 'ignored.json')
  const ignoredState = fs.existsSync(ignoredFile) ? JSON.parse(fs.readFileSync(ignoredFile, 'utf8')) : null
  if (ignoredOne.ok !== true) failures.push('ignore() did not accept a package version')
  if (ignoredState?.packages?.['dsh-ops'] !== '9.9.9') failures.push('ignore() did not persist the package version')
  const unignored = handoff.unignore('dsh-ops')
  if (unignored.ok !== true) failures.push('unignore() did not remove the package entry')
  if (handoff.readIgnored().packages['dsh-ops'] !== undefined) failures.push('unignore() left the package entry behind')
  console.log('data home + ignore list: temporary homes OK')
} finally {
  process.env.APPDATA = previousAppData
  fs.rmSync(tempAppData, { recursive: true, force: true })
  fs.rmSync(sourceHome, { recursive: true, force: true })
  fs.rmSync(targetHome, { recursive: true, force: true })
}

if (report.engine !== null && report.engine?.currentVersion === undefined) failures.push('engine layer has no current version')
console.log('engine detected:', report.engine === null ? 'none (no bundled manifest)' : report.engine.currentVersion)

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
const failingData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-updater-fail-'))
failing.dataDir = failingData
failing.lastReportFile = path.join(failingData, 'last-report.json')
failing.ignoredFile = path.join(failingData, 'ignored.json')
const failedUpdate = await failing.update('dsh-ops', '99.99.99')
console.log('failed update result:', JSON.stringify(failedUpdate), 'restore calls:', JSON.stringify(restoreCalls))
if (failedUpdate.ok !== false) failures.push('failed update reported success')
if (failedUpdate.restored !== true) failures.push('failed update did not restore the previous version')
if (!restoreCalls.some((spec) => spec === `dsh-ops@${installedVersion}`)) failures.push('restore did not reinstall the previous exact version')

const updateSource = UpdaterService.prototype.update.toString()
if (!updateSource.includes('removeBundle')) failures.push('update no longer removes before installing')
if (!updateSource.includes('restoreInstall')) failures.push('update has no restore path')

/**
 * DSH NEXT refuses to unload a running host bundle. The service must retry
 * through installBundle without leaving the bundle deselected, and must roll
 * back cleanly when the replacement fails.
 */
function makeTempProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-updater-profile-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-test',
    private: true,
    dependencies: { 'dsh-ops': '0.4.3' },
    dsh: { profile: { bundles: ['dsh-ops'] } },
  }, null, 2) + '\n')
  fs.mkdirSync(path.join(dir, 'node_modules', 'dsh-ops'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'node_modules', 'dsh-ops', 'package.json'), JSON.stringify({ name: 'dsh-ops', version: '0.4.3' }))
  return dir
}
function tempManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
}
function tempManager(dir, behavior) {
  const calls = []
  const manager = {
    calls,
    removeBundle: async (name) => {
      calls.push({ op: 'remove', name })
      const manifest = tempManifest(dir)
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((item) => item !== name)
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
      return { changed: true, application: 'failed', stage: 'remove', target: name, error: { code: behavior.removeCode } }
    },
    setBundleEnabled: async (name, enabled) => {
      calls.push({ op: 'select', name, enabled })
      const manifest = tempManifest(dir)
      manifest.dsh.profile.bundles = enabled ? [...manifest.dsh.profile.bundles, name] : manifest.dsh.profile.bundles.filter((item) => item !== name)
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
      return { changed: true, application: 'applied', stage: 'enable', target: name, enabled }
    },
    installBundle: async (spec, options) => {
      const manifest = tempManifest(dir)
      calls.push({ op: 'install', spec, requestId: options?.requestId ?? null, dependencyPresent: Object.hasOwn(manifest.dependencies, 'dsh-ops') })
      if (behavior.installFails !== undefined && spec.endsWith('@0.4.4')) throw new Error(behavior.installFails)
      if (spec.endsWith('@0.4.4')) {
        manifest.dependencies['dsh-ops'] = '0.4.4'
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
        return { changed: true, application: 'restart-required', restartReason: 'host-module', stage: 'install', target: spec }
      }
      manifest.dependencies['dsh-ops'] = '0.4.3'
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
      return { changed: true, application: 'applied', stage: 'install', target: spec }
    },
  }
  const context = new Context()
  context.provide('profileContext', { name: path.basename(dir), dir, home: path.dirname(dir) })
  context.provide('pluginManager', manager)
  return { manager, context }
}

const runningDir = makeTempProfile()
const running = tempManager(runningDir, { removeCode: 'bundle-in-use' })
const runningService = new UpdaterService(running.context, { verbose: true, profileDir: runningDir })
const runningResult = await runningService.update('dsh-ops', '0.4.4', 'req-overwrite')
console.log('bundle-in-use update:', JSON.stringify(runningResult))
console.log('bundle-in-use calls:', JSON.stringify(running.manager.calls))
if (runningResult.ok !== true) failures.push(`bundle-in-use update failed: ${runningResult.error}`)
if (runningResult.fallback !== 'overwrite-running') failures.push('bundle-in-use update did not use the overwrite fallback')
if (runningResult.application !== 'restart-required') failures.push('bundle-in-use update did not ask for a restart')
if (running.manager.calls.some((call) => call.op === 'install' && call.dependencyPresent === true)) failures.push('overwrite fallback did not hide the existing dependency')
if (tempManifest(runningDir).dependencies['dsh-ops'] !== '0.4.4') failures.push('overwrite fallback left the wrong dependency version')
if (!tempManifest(runningDir).dsh.profile.bundles.includes('dsh-ops')) failures.push('overwrite fallback left the bundle deselected')
if (!running.manager.calls.some((call) => call.op === 'select' && call.enabled === true)) failures.push('overwrite fallback did not restore the bundle selection through the manager')
fs.rmSync(runningDir, { recursive: true, force: true })

const rollbackDir = makeTempProfile()
const rollback = tempManager(rollbackDir, { removeCode: 'bundle-in-use', installFails: 'disk-full' })
const rollbackService = new UpdaterService(rollback.context, { verbose: true, profileDir: rollbackDir })
const rollbackResult = await rollbackService.update('dsh-ops', '0.4.4', 'req-rollback')
console.log('overwrite rollback:', JSON.stringify(rollbackResult), 'calls:', JSON.stringify(rollback.manager.calls))
if (rollbackResult.ok !== false) failures.push('failed overwrite reported success')
if (rollbackResult.restored !== true) failures.push('failed overwrite did not restore the previous version')
if (rollbackResult.stage !== 'install') failures.push('failed overwrite reported the wrong stage')
if (tempManifest(rollbackDir).dependencies['dsh-ops'] !== '0.4.3') failures.push('failed overwrite did not restore the original dependency spec')
if (!tempManifest(rollbackDir).dsh.profile.bundles.includes('dsh-ops')) failures.push('failed overwrite left the bundle deselected')
fs.rmSync(rollbackDir, { recursive: true, force: true })

const stoppedDir = makeTempProfile()
const stopped = tempManager(stoppedDir, { removeCode: 'stop-profile' })
const stoppedService = new UpdaterService(stopped.context, { verbose: true, profileDir: stoppedDir })
const stoppedResult = await stoppedService.update('dsh-ops', '0.4.4', 'req-stop')
console.log('stop-profile update:', JSON.stringify(stoppedResult), 'calls:', JSON.stringify(stopped.manager.calls))
if (stoppedResult.ok !== true) failures.push(`stop-profile update failed: ${stoppedResult.error}`)
if (stoppedResult.fallback !== 'install-over') failures.push('stop-profile update did not install over the running bundle')
if (stopped.manager.calls.some((call) => call.op === 'install' && call.dependencyPresent === false)) failures.push('stop-profile update hid a dependency it did not need to hide')
if (tempManifest(stoppedDir).dependencies['dsh-ops'] !== '0.4.4') failures.push('stop-profile update left the wrong dependency version')
fs.rmSync(stoppedDir, { recursive: true, force: true })

/** Static contract checks on the Client half. */
const clientPath = process.argv[3] ?? './client.js'
const client = fs.readFileSync(clientPath, 'utf8')
if (client.includes("'shell.overlay'")) failures.push('client still registers the right-hand overlay slot')
if (!client.includes('useDrag')) failures.push('client has no drag support')
if (!client.includes('ref: panelRef')) failures.push('the drag ref is not attached to the panel node')
if (!client.includes('document.addEventListener')) failures.push('drag listeners are not attached synchronously')
if (!client.includes('localStorage')) failures.push('client does not remember the dragged position')
if (client.includes('/api/desktop/')) failures.push('client still depends on a legacy desktop route')
if (!client.includes('restartRequired')) failures.push('client does not surface the restart requirement')
if (!client.includes('progressFraction')) failures.push('client has no progress model')
if (!client.includes("role: 'progressbar'")) failures.push('client has no progress bar')
if (!client.includes('updateAllCount')) failures.push('client has no one-click batch update button')
if (!client.includes("plugin-manager/install-state")) failures.push('client does not subscribe to install progress')
if (!client.includes("plugin-manager/install-log")) failures.push('client does not subscribe to install logs')
if (!client.includes('markUpdated')) failures.push('client does not hide updated rows immediately')
if (!client.includes('chooseDataFolder')) failures.push('client has no native data-folder picker')
if (!client.includes('migrateDataHome')) failures.push('client cannot migrate the DSH NEXT data folder')
if (!client.includes('nextTitle')) failures.push('client has no DSH NEXT section')
if (!client.includes('nextMigrate')) failures.push('client has no DSH NEXT data migration action')
if (!client.includes('nextCopy')) failures.push('client cannot copy data during migration')
if (!client.includes('DSH NEXT')) failures.push('client does not name the DSH NEXT product')
if (client.includes('不消耗 token') || client.includes('noTokens')) failures.push('client still renders the token footer')
if (client.includes("subtitle:")) failures.push('client still renders the panel subtitle')
if (!/inject: \['slots', 'locale'\]/.test(client)) failures.push('client dependencies changed unexpectedly')
if (!updateSource.includes('bundle-in-use')) failures.push('update does not handle bundle-in-use')
if (!updateSource.includes('installOverRunning')) failures.push('update has no overwrite fallback')
if (!updateSource.includes('restoreBundleSelection')) failures.push('update does not restore a deselected bundle')
if (!client.includes('APPEARANCE_KEY')) failures.push('client does not remember panel appearance')
if (!client.includes('dsh-updater-menu-button')) failures.push('client has no three-dot panel settings button')
if (!client.includes('appearanceMenu')) failures.push('client has no panel appearance popover')
if (!client.includes('--upd-accent')) failures.push('client does not theme the accent color')
if (!client.includes('panelWidth')) failures.push('client has no panel width control')
if (!client.includes('surfaceColor')) failures.push('client has no panel surface control')

fs.rmSync(selfcheckData, { recursive: true, force: true })
fs.rmSync(failingData, { recursive: true, force: true })
if (failures.length > 0) {
  console.error('FAILURES:', failures.join(' | '))
  process.exitCode = 1
} else {
  console.log('OK')
}
