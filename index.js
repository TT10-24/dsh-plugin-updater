/**
 * dsh-plugin-updater — Host half.
 *
 * One check covers three layers, and none of them touches the agent loop, so
 * none of them bills the account:
 *
 *   1. Plugin packages — read from the profile manifest and the live bundle
 *      directory, compared with the npm registry over plain HTTPS.
 *   2. DSH Desktop — compared with the public desktop release service
 *      (`https://www.dshdesktop.cn/api/desktop/version`). Update is handed to
 *      the desktop's own official flow, never reimplemented here.
 *   3. DSH core ("内核") — the version bundled inside Desktop, compared with the
 *      published `@deepseek-ai/dsh`. Informational: it ships with Desktop.
 *
 * Compatibility posture ("自动兼容新的内核"):
 *   * No service is a hard dependency. `pluginManager`, `profileContext` and
 *     `desktopRuntime` are all probed through `ctx.get()`, so a renamed or
 *     removed service degrades one capability instead of blocking the plugin.
 *   * Versions are resolved through several fallbacks (runtime service, packaged
 *     manifests, environment), because where a kernel keeps its version is an
 *     implementation detail that has moved before.
 *   * External responses are parsed tolerantly (`version`, `latestVersion`, or a
 *     bare version body) so a service field rename does not break the check.
 *   * Every capability actually observed is reported as `compat`, and a degraded
 *     check still returns the layers it could read.
 *
 * The result is served to the Web UI through the Remote endpoints
 * `pluginUpdater/check` and `pluginUpdater/update`. Starting a Desktop update is
 * a browser-side action: the panel POSTs the shell's own
 * `/api/desktop/updates/check` route, exactly as the Desktop settings page does,
 * so the shell keeps ownership of signatures, channels and installer handoff.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { Service } from './protocol.js'

/** Host Service key; also the Remote namespace the browser calls. */
const SERVICE_KEY = 'pluginUpdater'
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const DEFAULT_DESKTOP_ENDPOINT = 'https://www.dshdesktop.cn/api/desktop/version'
const DESKTOP_CHANNEL_HEADER = 'x-dsh-desktop-channel'
const DESKTOP_VERSION_HEADER = 'x-dsh-desktop-version'
const DESKTOP_PACKAGE_NAME = 'dsh-plugin-desktop'
const DESKTOP_NEXT_PACKAGE_NAME = 'dsh-desktop-next'
const ENGINE_PACKAGE_NAME = '@deepseek-ai/dsh'
/** The separate DSH NEXT product that a stable install can be promoted to. */
const DESKTOP_NEXT_PRODUCT = 'DSH NEXT'
const DESKTOP_NEXT_USER_DATA = 'DSH NEXT'
const DESKTOP_NEXT_LOCATION_FILE = 'desktop-next-location.json'
const DESKTOP_NEXT_LAST_HOME_FILE = 'desktop-next-last-home.json'
const DESKTOP_NEXT_DOWNLOAD_PAGE = 'https://www.dshdesktop.cn/download'

/** Remote methods are declared through the typert protocol's marker descriptor. */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'
const REMOTE_SEGMENT = /^[A-Za-z0-9_$.-]+$/

const REQUEST_TIMEOUT_MS = 12_000
const REPORT_TTL_MS = 5 * 60_000

/** A canonical SemVer the desktop version service accepts. */
const CANONICAL_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/**
 * Attach the same prototype marker an `@Remote` method decorator writes, so a
 * plain-JavaScript plugin can export a Remote method without a build step.
 * @param method - public method name on the service prototype.
 */
function markRemoteMethod(method) {
  if (!REMOTE_SEGMENT.test(method)) throw new Error(`invalid Remote method name ${JSON.stringify(method)}`)
  const prototype = UpdaterService.prototype
  const current = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR)?.value
  const methods = current === undefined ? [] : current.methods
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([...methods, Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' }) })]),
    }),
  })
}

/**
 * Compare two dotted version identifiers; a prerelease ranks below its release.
 * Exported for the offline self-check, not part of the plugin API.
 */
export function compareVersions(left, right) {
  const parse = (value) => {
    const text = String(value ?? '').trim().replace(/^[\^~><=\s]*v?/i, '')
    const plus = text.indexOf('+')
    const clean = plus < 0 ? text : text.slice(0, plus)
    const dash = clean.indexOf('-')
    const core = dash < 0 ? clean : clean.slice(0, dash)
    const prerelease = dash < 0 ? '' : clean.slice(dash + 1)
    const numbers = core.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN))
    return { numbers, core, prerelease }
  }
  const a = parse(left)
  const b = parse(right)
  if (a.core === b.core && a.prerelease === b.prerelease) return 0
  if (a.numbers.every(Number.isSafeInteger) && b.numbers.every(Number.isSafeInteger)) {
    const length = Math.max(a.numbers.length, b.numbers.length)
    for (let index = 0; index < length; index += 1) {
      const leftNumber = a.numbers[index] ?? 0
      const rightNumber = b.numbers[index] ?? 0
      if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1
    }
    if (a.prerelease === b.prerelease) return 0
    if (a.prerelease === '') return 1
    if (b.prerelease === '') return -1
  }
  return a.core === b.core ? (a.prerelease === b.prerelease ? 0 : a.prerelease < b.prerelease ? -1 : 1) : a.core < b.core ? -1 : 1
}

/**
 * The release stream a version belongs to. Stable versions have no
 * prerelease; a `-next` prerelease means the DSH NEXT product line, whose
 * installer and default data directory are separate from the stable desktop.
 * Exported for the offline self-check, not part of the plugin API.
 */
export function releaseLine(version) {
  const text = String(version ?? '').trim().replace(/^v/i, '').split('+')[0]
  const dash = text.indexOf('-')
  if (dash < 0) return 'stable'
  const prerelease = text.slice(dash + 1).toLowerCase()
  if (prerelease === 'next' || prerelease.startsWith('next.')) return 'next'
  if (prerelease === 'beta' || prerelease.startsWith('beta.')) return 'beta'
  return 'prerelease'
}

/**
 * The kind of change between two desktop versions: a same-product patch,
 * minor, major or prerelease, or the separate DSH NEXT product line.
 * Exported for the offline self-check, not part of the plugin API.
 */
export function releaseKind(currentVersion, latestVersion) {
  if (typeof latestVersion !== 'string' || latestVersion.length === 0) return null
  if (releaseLine(latestVersion) === 'next' && releaseLine(currentVersion) !== 'next') return 'product-line'
  const numeric = (value) =>
    String(value ?? '')
      .trim()
      .replace(/^v/i, '')
      .split('+')[0]
      .split('-')[0]
      .split('.')
      .map((part) => (/^\d+$/.test(part) ? Number(part) : null))
  const left = numeric(currentVersion)
  const right = numeric(latestVersion)
  if (left.length < 2 || right.length < 2 || left.some((part) => part === null) || right.some((part) => part === null)) return 'version'
  if (right[0] !== left[0]) return 'major'
  if (right[1] !== left[1]) return 'minor'
  if ((right[2] ?? 0) !== (left[2] ?? 0)) return 'patch'
  return 'prerelease'
}

/** Compare two absolute paths the way this host's file system does. */
function sameDirectory(left, right) {
  try {
    const a = path.resolve(left)
    const b = path.resolve(right)
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  } catch {
    return false
  }
}

/** Atomic JSON write: a half-written data-directory pointer must never exist. */
function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), 'utf8')
    fs.renameSync(temporary, file)
  } catch (error) {
    try {
      fs.unlinkSync(temporary)
    } catch {
      /* the temporary file may not exist */
    }
    throw error
  }
}

/** Read a `{ home }` pointer, ignoring a missing or malformed file. */
function readHomePointer(file) {
  const parsed = readJsonFile(file)
  if (typeof parsed?.home !== 'string' || !path.isAbsolute(parsed.home)) return null
  return path.resolve(parsed.home)
}

/** The DSH data home, from the profile context, the environment, or the profile path. */
function resolveDshHome(ctx, profileDir) {
  const profile = safeGet(ctx, 'profileContext')
  if (typeof profile?.home === 'string' && path.isAbsolute(profile.home)) return path.resolve(profile.home)
  if (typeof process.env.DSH_HOME === 'string' && path.isAbsolute(process.env.DSH_HOME)) return path.resolve(process.env.DSH_HOME)
  if (typeof profileDir === 'string' && profileDir.length > 0) {
    const directory = path.resolve(profileDir)
    if (path.basename(path.dirname(directory)).toLowerCase() === 'profiles') return path.dirname(path.dirname(directory))
  }
  return null
}

/**
 * Where DSH NEXT keeps its data-directory choice. It is deliberately outside
 * every data directory (Electron's Roaming folder), exactly as its data
 * directory resolver expects, so a choice survives installer and home changes.
 */
function desktopNextPaths() {
  const appData =
    typeof process.env.APPDATA === 'string' && process.env.APPDATA.length > 0
      ? process.env.APPDATA
      : process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Roaming')
        : process.platform === 'darwin'
          ? path.join(os.homedir(), 'Library', 'Application Support')
          : process.platform === 'linux'
            ? process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
            : null
  if (appData === null) return null
  const root = path.join(appData, DESKTOP_NEXT_USER_DATA)
  const home = path.join(root, 'home')
  return {
    root,
    home,
    locationFile: path.join(home, DESKTOP_NEXT_LOCATION_FILE),
    lastHomeFile: path.join(home, DESKTOP_NEXT_LAST_HOME_FILE),
    downloadPage: DESKTOP_NEXT_DOWNLOAD_PAGE,
  }
}

/** Whether a DSH NEXT executable exists in a usual Windows install location. */
function desktopNextInstalled() {
  const candidates = []
  for (const key of ['ProgramFiles', 'ProgramW6432']) {
    const base = process.env[key]
    if (typeof base === 'string' && base.length > 0) candidates.push(path.join(base, DESKTOP_NEXT_USER_DATA, 'DSH NEXT.exe'))
  }
  if (typeof process.env.LOCALAPPDATA === 'string' && process.env.LOCALAPPDATA.length > 0) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', DESKTOP_NEXT_USER_DATA, 'DSH NEXT.exe'))
  }
  return candidates.some((file) => {
    try {
      return fs.existsSync(file)
    } catch {
      return false
    }
  })
}

/**
 * The data-directory handoff plan for the separate DSH NEXT product.
 *
 * DSH NEXT defaults to `~/.dsh` and only follows its own location file, so a
 * stable install that is promoted to NEXT would otherwise open with an empty
 * home. This plan is read-only; `preserveDesktopHome` applies it.
 */
export function desktopNextPlan(ctx, profileDir, fallbackHome = null) {
  const paths = desktopNextPaths()
  const resolved = resolveDshHome(ctx, profileDir)
  const home =
    resolved ??
    (typeof fallbackHome === 'string' && path.isAbsolute(fallbackHome) ? path.resolve(fallbackHome) : null)
  if (paths === null) {
    return {
      product: DESKTOP_NEXT_PRODUCT,
      available: false,
      installed: false,
      detected: false,
      home,
      pointer: null,
      pointerMatchesHome: false,
      pointerIsDefault: false,
      defaultHome: path.join(os.homedir(), '.dsh'),
      needsRepair: false,
      canPreserveHome: false,
      locationFile: null,
      lastHomeFile: null,
      downloadPage: DESKTOP_NEXT_DOWNLOAD_PAGE,
      environmentVariable: 'DSH_DESKTOP_NEXT_HOME',
    }
  }
  const installed = desktopNextInstalled()
  let detected = installed
  try {
    detected = detected || fs.existsSync(paths.root)
  } catch {
    /* the probe is best-effort */
  }
  const pointer = readHomePointer(paths.locationFile)
  const pointerMatchesHome = home !== null && pointer !== null && sameDirectory(pointer, home)
  const defaultHome = path.join(os.homedir(), '.dsh')
  const pointerIsDefault = pointer !== null && sameDirectory(pointer, defaultHome)
  return {
    product: DESKTOP_NEXT_PRODUCT,
    available: true,
    installed,
    detected,
    home,
    pointer,
    pointerMatchesHome,
    pointerIsDefault,
    defaultHome,
    needsRepair: detected && home !== null && !pointerMatchesHome && (pointer === null || pointerIsDefault),
    canPreserveHome: home !== null,
    locationFile: paths.locationFile,
    lastHomeFile: paths.lastHomeFile,
    downloadPage: DESKTOP_NEXT_DOWNLOAD_PAGE,
    environmentVariable: 'DSH_DESKTOP_NEXT_HOME',
  }
}

/** One version answer as a comparable outcome instead of a thrown error. */
function outcome(status, version, reason) {
  return { status, version: version ?? null, reason: reason ?? null }
}

/** Read one JSON file, or null when it is missing or malformed. */
function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Read a service without declaring it a hard dependency.
 * A renamed or absent service must not stop the plugin from activating.
 */
function safeGet(ctx, key) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(key) : undefined
  } catch {
    return undefined
  }
}

/** Read a package's `latest` manifest from one npm registry. */
export async function fetchLatestVersion(registry, name, signal) {
  const base = String(registry ?? DEFAULT_REGISTRY).replace(/\/+$/, '')
  const url = `${base}/${encodeURIComponent(name)}/latest`
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal, redirect: 'follow' })
    if (response.status === 404) return outcome('missing', null, `registry has no package ${name}`)
    if (!response.ok) return outcome('error', null, `registry answered HTTP ${response.status}`)
    const body = await response.json()
    const version = typeof body?.version === 'string' ? body.version : null
    if (version === null) return outcome('error', null, 'registry answer carried no version')
    return outcome('ok', version, null)
  } catch (error) {
    if (signal?.aborted) return outcome('error', null, 'cancelled')
    return outcome('error', null, `registry request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Ask the public desktop release service for the newest version in a channel.
 * The response shape is read leniently: a renamed field must not break the check.
 */
export async function fetchDesktopVersion(endpoint, channel, currentVersion, signal) {
  const url = typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : DEFAULT_DESKTOP_ENDPOINT
  const headers = { accept: 'application/json', 'cache-control': 'no-cache' }
  if (typeof channel === 'string' && channel.length > 0) headers[DESKTOP_CHANNEL_HEADER] = channel
  if (typeof currentVersion === 'string' && CANONICAL_VERSION.test(currentVersion)) headers[DESKTOP_VERSION_HEADER] = currentVersion
  try {
    const response = await fetch(url, { method: 'GET', headers, redirect: 'follow', signal })
    if (!response.ok) return { ...outcome('error', null, `desktop version service answered HTTP ${response.status}`), channel: null }
    const text = await response.text()
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    const trimmed = typeof text === 'string' ? text.trim() : ''
    const version =
      typeof parsed?.version === 'string'
        ? parsed.version
        : typeof parsed?.latestVersion === 'string'
          ? parsed.latestVersion
          : CANONICAL_VERSION.test(trimmed)
            ? trimmed
            : null
    if (version === null) return { ...outcome('error', null, 'desktop version service returned no version'), channel: null }
    return { ...outcome('ok', version, null), channel: typeof parsed?.channel === 'string' ? parsed.channel : null }
  } catch (error) {
    return {
      ...outcome('error', null, signal?.aborted ? 'cancelled' : `desktop version request failed: ${error instanceof Error ? error.message : String(error)}`),
      channel: null,
    }
  }
}

/** The version a dependency spec pins, or null for a range, link, workspace, git or tarball spec. */
function versionFromSpec(spec) {
  if (typeof spec !== 'string') return null
  const trimmed = spec.trim().replace(/^[\^~><=\s]*v?/i, '')
  return /^\d+\.\d+/.test(trimmed) ? trimmed : null
}

/** The version an installed package's own manifest reports, when it is readable. */
function readInstalledVersion(dir) {
  const parsed = readJsonFile(path.join(dir, 'package.json'))
  return typeof parsed?.version === 'string' && parsed.version.length > 0 ? parsed.version : null
}

/** Best-effort description of the source repository recorded by an installed package. */
function readRepository(dir) {
  const parsed = readJsonFile(path.join(dir, 'package.json'))
  const repository = typeof parsed?.repository === 'string' ? parsed.repository : parsed?.repository?.url
  return typeof repository === 'string' && repository.length > 0 ? repository : null
}

/** Read the profile manifest that lists the plugins this profile installed. */
function readProfileManifest(dir) {
  const file = path.join(dir, 'package.json')
  return { file, parsed: JSON.parse(fs.readFileSync(file, 'utf8')) }
}

/** Write text beside a target and rename it into place. */
function writeTextAtomic(file, text) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporary, text, 'utf8')
    fs.renameSync(temporary, file)
  } catch (error) {
    try {
      fs.unlinkSync(temporary)
    } catch {
      /* the temporary file may not exist */
    }
    throw error
  }
}

/** Write the profile manifest atomically, keeping its two-space JSON shape. */
function writeProfileManifest(file, parsed) {
  writeTextAtomic(file, `${JSON.stringify(parsed, null, 2)}\n`)
}

/** Whether a profile's bundle selection currently includes a package. */
function bundleSelected(dir, name) {
  try {
    const bundles = readProfileManifest(dir).parsed?.dsh?.profile?.bundles
    return Array.isArray(bundles) && bundles.includes(name)
  } catch {
    return false
  }
}

/** Add or remove one bundle selection, preserving every other manifest field. */
function setBundleSelected(dir, name, selected) {
  const manifest = readProfileManifest(dir)
  const current = Array.isArray(manifest.parsed?.dsh?.profile?.bundles) ? manifest.parsed.dsh.profile.bundles : []
  if (selected === current.includes(name)) return false
  const bundles = selected ? [...current, name] : current.filter((item) => item !== name)
  manifest.parsed.dsh = {
    ...manifest.parsed.dsh,
    profile: {
      ...manifest.parsed.dsh?.profile,
      bundles,
    },
  }
  writeProfileManifest(manifest.file, manifest.parsed)
  return true
}

/**
 * Where a DSH NEXT runtime records the desktop version it was built for.
 * The Host process itself is `primary-runtime/dependencies/node/bin/node.exe`,
 * so `runtime.json` sits three levels above its executable.
 */
function desktopRuntimeVersionCandidates() {
  const candidates = []
  try {
    if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
      candidates.push(path.join(process.resourcesPath, 'runtime', process.arch, 'primary-runtime', 'runtime.json'))
    }
  } catch {
    /* the path is optional */
  }
  try {
    if (typeof process.execPath === 'string' && process.execPath.length > 0) {
      const directory = path.dirname(process.execPath)
      candidates.push(path.join(directory, 'runtime.json'))
      candidates.push(path.join(directory, '..', 'runtime.json'))
      candidates.push(path.join(directory, '..', '..', '..', 'runtime.json'))
    }
  } catch {
    /* the path is optional */
  }
  try {
    candidates.push(path.join(process.cwd(), 'runtime.json'))
  } catch {
    /* the path is optional */
  }
  return [...new Set(candidates)]
}

/** Where a packaged Desktop keeps its own manifest, in the orders a kernel has used. */
function desktopManifestCandidates() {
  const candidates = []
  try {
    if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
      candidates.push(path.join(process.resourcesPath, 'app', 'package.json'))
      candidates.push(path.join(process.resourcesPath, 'app.asar', 'package.json'))
      candidates.push(path.join(process.resourcesPath, 'package.json'))
    }
  } catch {
    /* the path is optional */
  }
  try {
    if (typeof process.execPath === 'string' && process.execPath.length > 0) {
      candidates.push(path.join(path.dirname(process.execPath), 'resources', 'app', 'package.json'))
      candidates.push(path.join(path.dirname(process.execPath), 'resources', 'app.asar', 'package.json'))
    }
  } catch {
    /* the path is optional */
  }
  try {
    candidates.push(path.join(process.cwd(), 'package.json'))
  } catch {
    /* the path is optional */
  }
  return [...new Set(candidates)]
}

/** Where the bundled DSH core keeps its manifest. */
function engineManifestCandidates(ctx) {
  const candidates = []
  try {
    if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
      candidates.push(path.join(process.resourcesPath, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
      candidates.push(path.join(process.resourcesPath, 'app.asar', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
    }
  } catch {
    /* the path is optional */
  }
  try {
    if (typeof process.execPath === 'string' && process.execPath.length > 0) {
      candidates.push(path.join(path.dirname(process.execPath), 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
      candidates.push(path.join(path.dirname(process.execPath), 'resources', 'app.asar', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
    }
  } catch {
    /* the path is optional */
  }
  const profile = safeGet(ctx, 'profileContext')
  if (typeof profile?.dir === 'string' && profile.dir.length > 0) {
    candidates.push(path.join(profile.dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  }
  return [...new Set(candidates)]
}

/** Resolve the installed DSH Desktop version and release channel. */
function resolveDesktopInstallation(ctx) {
  const runtime = safeGet(ctx, 'desktopRuntime')
  const updates = runtime?.updates
  const channel = typeof updates?.releaseChannel === 'string' && updates.releaseChannel.length > 0 ? updates.releaseChannel : 'stable'
  if (typeof updates?.currentVersion === 'string' && updates.currentVersion.length > 0) {
    return { version: updates.currentVersion, channel, source: 'desktopRuntime', packaged: updates?.isPackaged === true }
  }
  for (const file of desktopRuntimeVersionCandidates()) {
    const parsed = readJsonFile(file)
    if (typeof parsed?.desktopVersion === 'string' && CANONICAL_VERSION.test(parsed.desktopVersion)) {
      return { version: parsed.desktopVersion, channel, source: file, packaged: true }
    }
  }
  const environmentVersion = process.env.DSH_DESKTOP_PRODUCT_VERSION
  if (typeof environmentVersion === 'string' && CANONICAL_VERSION.test(environmentVersion)) {
    return { version: environmentVersion, channel, source: 'environment', packaged: true }
  }
  for (const file of desktopManifestCandidates()) {
    const parsed = readJsonFile(file)
    if (
      (parsed?.name === DESKTOP_PACKAGE_NAME || parsed?.name === DESKTOP_NEXT_PACKAGE_NAME) &&
      typeof parsed.version === 'string' &&
      parsed.version.length > 0
    ) {
      return { version: parsed.version, channel, source: file, packaged: true }
    }
  }
  return null
}

/** Resolve the DSH core version bundled with this installation. */
function resolveEngineInstallation(ctx) {
  for (const file of engineManifestCandidates(ctx)) {
    const parsed = readJsonFile(file)
    if (parsed?.name === ENGINE_PACKAGE_NAME && typeof parsed.version === 'string' && parsed.version.length > 0) {
      return { version: parsed.version, source: file }
    }
  }
  return null
}

/**
 * The plugin updater service.
 *
 * `check` and `update` are Remote: they are what the browser panel calls. The
 * Desktop update is triggered by the panel through the shell's own route, so the
 * Host half only ever reads versions. None of this touches the agent loop.
 */
export class UpdaterService extends Service {
  /**
   * @param ctx - owning Cordis context.
   * @param config - resolved plugin config.
   */
  constructor(ctx, config = {}) {
    super(ctx, SERVICE_KEY)
    this.config = config
    /**
     * The source-mode Remote binding the gateway's discovery reads. It is plain
     * data, so this plugin needs no typert package import to be published from a
     * GitHub tarball.
     */
    this.typertRemote = Object.freeze({ service: this, serviceKey: SERVICE_KEY, namespace: SERVICE_KEY })
    this.registry = typeof config.registry === 'string' && config.registry.length > 0 ? config.registry : DEFAULT_REGISTRY
    this.desktopEndpoint =
      typeof config.desktopEndpoint === 'string' && config.desktopEndpoint.length > 0 ? config.desktopEndpoint : DEFAULT_DESKTOP_ENDPOINT
    this.autoCheck = config.autoCheck !== false
    this.checkOnBoot = config.checkOnBoot !== false
    this.checkDesktop = config.checkDesktop !== false
    this.checkEngine = config.checkEngine !== false
    this.logLines = config.verbose === true
    this.report = null
    this.pending = null
    this.dataDir = resolveDataDir(ctx)
    this.lastReportFile = this.dataDir === null ? null : path.join(this.dataDir, 'last-report.json')
    this.ignoredFile = this.dataDir === null ? null : path.join(this.dataDir, 'ignored.json')
    this.ignored = this.readIgnored()
    this.state = { checking: false, error: null, report: this.readCachedReport() }
  }

  /** True when this Host half could resolve its profile directory. */
  get hasProfile() {
    return this.profileDir() !== null
  }

  /** The profile directory whose `package.json` names the installed plugins. */
  profileDir() {
    const injected = this.config.profileDir
    if (typeof injected === 'string' && injected.length > 0) return injected
    if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR.length > 0) return process.env.DSH_PROFILE_DIR
    const profile = safeGet(this.ctx, 'profileContext')
    if (typeof profile?.dir === 'string' && profile.dir.length > 0) return profile.dir
    if (typeof profile?.name === 'string' && profile.name.length > 0) {
      const home = typeof profile.home === 'string' && profile.home.length > 0 ? profile.home : null
      if (home !== null) return path.join(home, 'profiles', profile.name)
    }
    return null
  }

  /** Data-directory status for the separate DSH NEXT product, if present. */
  desktopData() {
    const fallback = this.dataDir === null ? null : path.dirname(this.dataDir)
    return desktopNextPlan(this.ctx, this.profileDir(), fallback)
  }

  /** A portable recovery script for the case where this plugin cannot run in the new app. */
  restoreScript(home) {
    const json = JSON.stringify({ home }).replace(/'/g, "''")
    return [
      '# Restore the DSH NEXT data directory written by dsh-plugin-updater.',
      '# Run this after installing DSH NEXT if it opened with an empty workspace.',
      "$ErrorActionPreference = 'Stop'",
      "$root = Join-Path $env:APPDATA 'DSH NEXT\\home'",
      'New-Item -ItemType Directory -Force -Path $root | Out-Null',
      `$json = '${json}'`,
      '$utf8 = New-Object System.Text.UTF8Encoding($false)',
      "[System.IO.File]::WriteAllText((Join-Path $root 'desktop-next-location.json'), $json, $utf8)",
      "[System.IO.File]::WriteAllText((Join-Path $root 'desktop-next-last-home.json'), $json, $utf8)",
      "Write-Host 'DSH NEXT will use this data directory on its next launch.'",
      '',
    ].join('\r\n')
  }

  /**
   * Point DSH NEXT at this profile's data home, backing up whatever choice it
   * had. Writing the pointer before the installer runs is what keeps the
   * workspace, conversations and plugins visible after a product-line change.
   */
  preserveDesktopHome(reason) {
    const plan = this.desktopData()
    if (!plan.available) return { ok: false, error: 'DSH NEXT data-directory support is unavailable on this platform' }
    if (plan.home === null) return { ok: false, error: 'could not resolve the current DSH data directory' }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backedUp = []
    for (const file of [plan.locationFile, plan.lastHomeFile]) {
      if (typeof file !== 'string') continue
      try {
        if (fs.existsSync(file)) {
          const backup = `${file}.bak-${stamp}`
          fs.copyFileSync(file, backup)
          backedUp.push(backup)
        }
      } catch (error) {
        return { ok: false, error: `could not back up ${file}: ${error instanceof Error ? error.message : String(error)}` }
      }
    }
    try {
      writeJsonFile(plan.locationFile, { home: plan.home })
      writeJsonFile(plan.lastHomeFile, { home: plan.home })
    } catch (error) {
      return { ok: false, error: `could not write the DSH NEXT data directory: ${error instanceof Error ? error.message : String(error)}` }
    }
    const handoff = {
      version: 1,
      createdAt: new Date().toISOString(),
      reason,
      product: plan.product,
      home: plan.home,
      locationFile: plan.locationFile,
      lastHomeFile: plan.lastHomeFile,
      downloadPage: plan.downloadPage,
    }
    if (this.dataDir !== null) {
      try {
        writeJsonFile(path.join(this.dataDir, 'desktop-handoff.json'), handoff)
        fs.writeFileSync(path.join(this.dataDir, 'restore-desktop-data.ps1'), this.restoreScript(plan.home), 'utf8')
      } catch (error) {
        this.log(`could not write the handoff record: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.trace('desktop:preserve-home', { reason, home: plan.home, backedUp })
    return { ok: true, ...handoff, backedUp }
  }

  /**
   * Remote: preflight a Desktop update that changes product line.
   *
   * Only a `-next` target is treated as a product change. It writes the
   * successor's data-directory pointer before the shell downloads or installs
   * anything, then the client continues with the shell's official flow.
   */
  prepareDesktopUpdate(preserveHome, targetVersion) {
    if (preserveHome !== true) return { ok: true, skipped: 'preserve-home-not-requested' }
    if (releaseLine(targetVersion) !== 'next') return { ok: true, skipped: 'not-a-product-line-change' }
    return this.preserveDesktopHome('desktop-update')
  }

  /** Remote: repair a DSH NEXT pointer that does not point at this data home. */
  repairDesktopData() {
    return this.preserveDesktopHome('manual-repair')
  }

  /** Registry the plugin manager itself would ask, so the check follows the profile. */
  async preferredRegistry() {
    try {
      const manager = safeGet(this.ctx, 'pluginManager')
      const registries = await manager?.registries?.()
      const first = registries?.registry
      if (typeof first === 'string' && first.length > 0) return first
    } catch {
      /* fall back to the public registry */
    }
    return this.registry
  }

  /** What this kernel actually provides; a missing capability degrades one layer only. */
  compat() {
    const profileContext = safeGet(this.ctx, 'profileContext')
    const pluginManager = safeGet(this.ctx, 'pluginManager')
    const desktopRuntime = safeGet(this.ctx, 'desktopRuntime')
    return {
      profileContext: profileContext !== undefined,
      pluginManager: pluginManager !== undefined,
      desktopRuntime: desktopRuntime !== undefined,
      dshHomePath: typeof this.ctx?.dshHomePath === 'function',
      degraded: profileContext === undefined || pluginManager === undefined,
    }
  }


  /** Read the per-profile ignore list; a malformed file is treated as empty. */
  readIgnored() {
    const empty = { version: 1, packages: {}, desktop: null, updatedAt: null }
    if (this.ignoredFile === null) return empty
    const parsed = readJsonFile(this.ignoredFile)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return empty
    const packages = {}
    if (parsed.packages !== null && typeof parsed.packages === 'object' && !Array.isArray(parsed.packages)) {
      for (const [name, version] of Object.entries(parsed.packages)) {
        if (typeof name === 'string' && name.length > 0 && typeof version === 'string' && version.length > 0) packages[name] = version
      }
    }
    return {
      version: 1,
      packages,
      desktop: typeof parsed.desktop === 'string' && parsed.desktop.length > 0 ? parsed.desktop : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    }
  }

  /** Persist the ignore list next to the cached report. */
  writeIgnored() {
    if (this.ignoredFile === null) return false
    try {
      writeJsonFile(this.ignoredFile, {
        version: 1,
        updatedAt: new Date().toISOString(),
        packages: this.ignored.packages,
        desktop: this.ignored.desktop,
      })
      return true
    } catch (error) {
      this.log('could not save ignored updates: ' + (error instanceof Error ? error.message : String(error)))
      return false
    }
  }

  /**
   * Ignore exactly one version of one package, or the current desktop update.
   * A newer version still appears, so this is a version pin, not a mute switch.
   */
  ignore(target, version) {
    const name = typeof target === 'string' ? target.trim() : ''
    const value = typeof version === 'string' ? version.trim() : ''
    if (name.length === 0) return { ok: false, error: 'ignore() needs a package name or "desktop"' }
    if (!/^\d+\.\d+/.test(value)) return { ok: false, error: 'ignore() needs an exact version' }
    const previous = this.ignored
    this.ignored =
      name === 'desktop'
        ? { ...previous, desktop: value, updatedAt: new Date().toISOString() }
        : { ...previous, packages: { ...previous.packages, [name]: value }, updatedAt: new Date().toISOString() }
    if (!this.writeIgnored()) {
      this.ignored = previous
      return { ok: false, error: 'could not save the ignore list' }
    }
    this.state.report = null
    this.trace('ignore:set', { target: name, version: value })
    return { ok: true, target: name, version: value, ignored: this.ignored }
  }

  /** Remove an ignore entry so the next check can offer that version again. */
  unignore(target) {
    const name = typeof target === 'string' ? target.trim() : ''
    if (name.length === 0) return { ok: false, error: 'unignore() needs a package name or "desktop"' }
    const previous = this.ignored
    if (name === 'desktop') this.ignored = { ...previous, desktop: null, updatedAt: new Date().toISOString() }
    else {
      const packages = { ...previous.packages }
      delete packages[name]
      this.ignored = { ...previous, packages, updatedAt: new Date().toISOString() }
    }
    if (!this.writeIgnored()) {
      this.ignored = previous
      return { ok: false, error: 'could not save the ignore list' }
    }
    this.state.report = null
    this.trace('ignore:clear', { target: name })
    return { ok: true, target: name, ignored: this.ignored }
  }

  /** Read the cached report written by an earlier boot, if it is still fresh and parseable. */
  readCachedReport() {
    if (this.lastReportFile === null) return null
    const parsed = readJsonFile(this.lastReportFile)
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  }

  /** Persist the newest report so a later boot can answer instantly. */
  writeCachedReport(report) {
    if (this.lastReportFile === null) return
    try {
      fs.writeFileSync(this.lastReportFile, JSON.stringify(report), 'utf8')
    } catch (error) {
      this.log(`could not save the report: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Tagged Host-side logging; silent unless the config asks for it. */
  log(message) {
    if (!this.logLines) return
    const logger = this.ctx?.logger
    if (typeof logger?.info === 'function') logger.info(`[plugin-updater] ${message}`)
  }

  /**
   * Check every layer, reusing the cached answer while it is fresh.
   * @param force - ignore the cached result and ask the network again.
   */
  async check(force) {
    const cached = this.state.report
    const fresh = cached !== null && typeof cached.checkedAt === 'number' && Date.now() - cached.checkedAt < REPORT_TTL_MS
    if (force !== true && fresh) return { ...cached, cached: true }
    if (this.pending !== null) return this.pending
    this.state.checking = true
    this.pending = this.runCheck().finally(() => {
      this.state.checking = false
      this.pending = null
    })
    return this.pending
  }

  /**
   * Collect every plugin package this profile installed.
   *
   * Two sources are merged so a newly added plugin is picked up automatically,
   * with no list to maintain here: the profile manifest's dependencies (what the
   * plugin manager wrote when it installed something) and the live bundle
   * directory (what is actually present, including a bundle selected by hand).
   */
  async installedPackages(dir) {
    const found = new Map()
    if (dir !== null) {
      try {
        const { parsed } = readProfileManifest(dir)
        for (const [name, spec] of Object.entries(parsed?.dependencies ?? {})) {
          if (typeof spec === 'string') found.set(name, { spec, source: 'dependency' })
        }
      } catch (error) {
        this.state.error = `could not read ${path.join(dir, 'package.json')}: ${error instanceof Error ? error.message : String(error)}`
      }
    } else {
      this.state.error = 'could not resolve the profile directory'
    }
    try {
      const manager = safeGet(this.ctx, 'pluginManager')
      const bundles = await manager?.listBundles?.()
      for (const bundle of bundles ?? []) {
        if (bundle?.installed !== true || typeof bundle.name !== 'string') continue
        const existing = found.get(bundle.name)
        found.set(bundle.name, {
          spec: existing?.spec ?? null,
          source: existing === undefined ? 'bundle' : existing.source,
          manifestVersion: typeof bundle.version === 'string' ? bundle.version : null,
        })
      }
    } catch (error) {
      this.log(`could not list bundles: ${error instanceof Error ? error.message : String(error)}`)
    }
    return found
  }

  /** Compare every installed plugin package with the registry. */
  async sweepPackages(installed, dir, registry, signal) {
    return Promise.all(
      [...installed].map(async ([name, entry]) => {
        const packageDir = dir === null ? null : path.join(dir, 'node_modules', name)
        const latest = await fetchLatestVersion(registry, name, signal)
        const installedVersion =
          versionFromSpec(entry.spec) ?? entry.manifestVersion ?? (packageDir === null ? null : readInstalledVersion(packageDir))
        const comparable = installedVersion !== null
        const ignoredVersion = this.ignored.packages[name] ?? null
        const ignored = latest.status === 'ok' && ignoredVersion !== null && ignoredVersion === latest.version
        const hasUpdate = latest.status === 'ok' && comparable && !ignored && compareVersions(installedVersion, latest.version) < 0
        return {
          name,
          installedVersion: installedVersion ?? (typeof entry.spec === 'string' ? entry.spec : ''),
          latestVersion: latest.version,
          hasUpdate,
          ignoredVersion,
          status: latest.status === 'ok' ? (ignored ? 'ignored' : hasUpdate ? 'update' : comparable ? 'current' : 'bypassed') : latest.status,
          reason: latest.reason,
          repository: packageDir === null ? null : readRepository(packageDir),
          source: entry.source,
        }
      }),
    )
  }

  /** Compare the installed Desktop with the public release service. */
  async checkDesktopUpdate(registry, signal) {
    const installation = resolveDesktopInstallation(this.ctx)
    if (installation === null) {
      return {
        status: 'unavailable',
        currentVersion: null,
        latestVersion: null,
        channel: 'stable',
        reason: 'no DSH Desktop installation detected',
        endpoint: this.desktopEndpoint,
        canUpdate: false,
        data: this.desktopData(),
      }
    }
    const latest = await fetchDesktopVersion(this.desktopEndpoint, installation.channel, installation.version, signal)
    const hasUpdate = latest.status === 'ok' && compareVersions(installation.version, latest.version) < 0
    const line = releaseLine(installation.version)
    const latestLine = latest.status === 'ok' ? releaseLine(latest.version) : null
    const kind = latest.status === 'ok' ? releaseKind(installation.version, latest.version) : null
    const ignoredVersion = this.ignored.desktop
    const ignored = latest.status === 'ok' && ignoredVersion !== null && ignoredVersion === latest.version
    const data = this.desktopData()
    /** Stable may be promoted to the separate NEXT product; that is a migration, not a patch. */
    const migration =
      latest.status === 'ok' && hasUpdate && !ignored && latestLine === 'next' && line !== 'next' ? { ...data, targetVersion: latest.version } : null
    return {
      status: latest.status === 'ok' ? (ignored ? 'ignored' : hasUpdate ? 'update' : 'current') : latest.status,
      currentVersion: installation.version,
      latestVersion: latest.version,
      channel: latest.channel ?? installation.channel,
      reason: latest.reason,
      endpoint: this.desktopEndpoint,
      source: installation.source,
      canUpdate: true,
      line,
      latestLine,
      kind,
      ignoredVersion,
      migration,
      requiresConfirmation: migration !== null,
      data,
    }
  }

  /** Compare the bundled DSH core with the published package. */
  async checkEngineUpdate(registry, signal) {
    const installation = resolveEngineInstallation(this.ctx)
    if (installation === null) return null
    const latest = await fetchLatestVersion(registry, ENGINE_PACKAGE_NAME, signal)
    const hasUpdate = latest.status === 'ok' && compareVersions(installation.version, latest.version) < 0
    return {
      status: latest.status === 'ok' ? (hasUpdate ? 'update' : 'current') : latest.status,
      currentVersion: installation.version,
      latestVersion: latest.version,
      reason: latest.reason,
      bundled: true,
    }
  }

  /** The actual sweep across all three layers, serialized by `check`. */
  async runCheck() {
    const dir = this.profileDir()
    this.state.error = null
    const installed = await this.installedPackages(dir)

    let registry = await this.preferredRegistry()
    if (registry.endsWith('/')) registry = registry.replace(/\/+$/, '')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let packages = []
    let desktop = null
    let engine = null
    try {
      ;[packages, desktop, engine] = await Promise.all([
        this.sweepPackages(installed, dir, registry, controller.signal),
        this.checkDesktop ? this.checkDesktopUpdate(registry, controller.signal) : null,
        this.checkEngine ? this.checkEngineUpdate(registry, controller.signal) : null,
      ])
    } finally {
      clearTimeout(timer)
    }

    const report = {
      checkedAt: Date.now(),
      registry,
      profileDir: dir,
      packages,
      updates: packages.filter((entry) => entry.hasUpdate).map((entry) => entry.name),
      desktop,
      engine,
      ignored: { packages: this.ignored.packages, desktop: this.ignored.desktop },
      compat: this.compat(),
      error: this.state.error,
    }
    this.state.report = report
    this.state.error = null
    this.writeCachedReport(report)
    this.log(
      `checked ${packages.length} package(s); ${report.updates.length} plugin update(s); desktop ${desktop?.status ?? 'off'}; engine ${engine?.status ?? 'off'}`,
    )
    return report
  }

  /**
   * Update one installed plugin.
   *
   * The manager's `installBundle` refuses a package that is already a profile
   * dependency (`already-installed`) while HMR is active — that guard is for
   * adding plugins, not for updating them. The supported update path (the one
   * the official Plugins page uses) is `removeBundle` followed by a fresh
   * install, so this method does exactly that and restores the previous version
   * if the new one cannot be installed.
   *
   * @param name - exact installed package name.
   * @param version - exact target version; the latest published one when omitted.
   * @param requestId - client-owned installation id; the manager emits
   *   `plugin-manager/install-state` / `install-log` with it so the panel can
   *   render live progress while this unary call is still running.
   */
  async update(name, version, requestId) {
    if (typeof name !== 'string' || name.length === 0) return { ok: false, name: 'invalid request' }
    const manager = safeGet(this.ctx, 'pluginManager')
    if (manager === undefined || manager === null) {
      return { ok: false, name, version: null, stage: 'install', application: 'failed', error: 'the plugin manager is not active in this profile', restored: false }
    }
    const installOptions = { enabled: true }
    if (typeof requestId === 'string' && requestId.length > 0) installOptions.requestId = requestId
    const target = typeof version === 'string' && version.length > 0 ? `${name}@${version}` : name
    const profileDir = this.profileDir()
    const packageDir = profileDir === null ? null : path.join(profileDir, 'node_modules', name)
    const previousVersion = packageDir === null ? null : readInstalledVersion(packageDir)
    let originalSpec = null
    let wasSelected = false
    if (profileDir !== null) {
      try {
        const manifest = readProfileManifest(profileDir).parsed
        originalSpec = manifest?.dependencies?.[name] ?? null
        wasSelected = Array.isArray(manifest?.dsh?.profile?.bundles) && manifest.dsh.profile.bundles.includes(name)
      } catch {
        originalSpec = null
      }
    }
    this.trace('update:start', { name, version, target, requestId: requestId ?? null, previousVersion, originalSpec, wasSelected })

    let removed
    try {
      removed = await manager.removeBundle(name)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.trace('update:remove-threw', { name, message })
      if (/bundle-in-use|stop-profile/.test(message)) {
        const selection = await this.restoreBundleSelection(manager, name, wasSelected)
        const code = /stop-profile/.test(message) ? 'stop-profile' : 'bundle-in-use'
        this.trace('update:fallback-start', { name, code, wasSelected, selection, thrown: true })
        return this.installOverRunning(manager, name, version, target, requestId, previousVersion, originalSpec, code, wasSelected)
      }
      return { ok: false, name, version: version ?? null, spec: target, stage: 'remove', application: 'failed', error: message, restored: false }
    }
    const removedOk = removed?.application === 'applied' || removed?.application === 'restart-required'
    if (!removedOk) {
      const code = typeof removed?.error?.code === 'string' ? removed.error.code : null
      const message =
        typeof removed?.error?.diagnostic === 'string'
          ? removed.error.diagnostic
          : typeof code === 'string'
            ? code
            : `could not remove the installed version (${removed?.application ?? 'failed'})`
      this.trace('update:remove-failed', { name, application: removed?.application ?? null, code, message })
      /**
       * DSH NEXT can refuse to unload a running host bundle ("bundle-in-use")
       * or ask for a restart when HMR is off ("stop-profile"). Removing first is
       * impossible there, but both are still legitimate updates: the plugin
       * manager's own install path can replace the files and report
       * `restart-required`. Never leave the bundle deselected on this path.
       */
      if (code === 'bundle-in-use' || code === 'stop-profile' || /bundle-in-use|stop-profile/.test(message)) {
        const selection = await this.restoreBundleSelection(manager, name, wasSelected)
        this.trace('update:fallback-start', { name, code, wasSelected, selection })
        return this.installOverRunning(manager, name, version, target, requestId, previousVersion, originalSpec, code ?? 'bundle-in-use', wasSelected)
      }
      return {
        ok: false,
        name,
        version: version ?? null,
        spec: target,
        stage: 'remove',
        application: typeof removed?.application === 'string' ? removed.application : 'failed',
        error: message,
        restored: false,
      }
    }
    this.trace('update:removed', { name, application: removed.application })

    let result
    try {
      result = await manager.installBundle(target, installOptions)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const restored = await this.restoreInstall(manager, name, previousVersion, originalSpec)
      this.trace('update:install-threw', { name, target, message, restored })
      return { ok: false, name, version: version ?? null, spec: target, stage: 'install', application: 'failed', error: message, restored }
    }
    const installed = result?.application === 'applied' || result?.application === 'restart-required'
    if (!installed) {
      const message =
        typeof result?.error?.diagnostic === 'string'
          ? result.error.diagnostic
          : typeof result?.error?.code === 'string'
            ? result.error.code
            : `install ${result?.application ?? 'failed'}`
      const restored = await this.restoreInstall(manager, name, previousVersion, originalSpec)
      this.trace('update:install-failed', { name, target, message, restored })
      return {
        ok: false,
        name,
        version: version ?? null,
        spec: target,
        stage: 'install',
        application: typeof result?.application === 'string' ? result.application : 'failed',
        error: message,
        pendingBuilds: Array.isArray(result?.pendingBuilds) ? result.pendingBuilds : [],
        restored,
      }
    }
    this.trace('update:installed', { name, target, application: result.application })
    return {
      ok: true,
      name,
      version: typeof version === 'string' ? version : null,
      spec: target,
      changed: result?.changed === true,
      application: typeof result?.application === 'string' ? result.application : 'applied',
      warnings: Array.isArray(result?.warnings) ? result.warnings : [],
      error: null,
      pendingBuilds: Array.isArray(result?.pendingBuilds) ? result.pendingBuilds : [],
      restored: false,
    }
  }

  /**
   * Replace a running bundle when `removeBundle` refused to unload it.
   *
   * With HMR, `installBundle` refuses an already-declared package name before
   * pnpm runs. Hiding the dependency for the duration of that call lets the
   * manager run its normal pnpm + reconcile path; pnpm writes the dependency
   * back on success. The original manifest text is restored on any failure, and
   * the previous version is reinstalled while the dependency is still hidden.
   */
  async installOverRunning(manager, name, version, target, requestId, previousVersion, originalSpec, code, wasSelected) {
    const profileDir = this.profileDir()
    const manifestFile = profileDir === null ? null : path.join(profileDir, 'package.json')
    let hidden = null
    if (manifestFile !== null && code === 'bundle-in-use') {
      try {
        const text = fs.readFileSync(manifestFile, 'utf8')
        const parsed = JSON.parse(text)
        if (parsed?.dependencies !== undefined && Object.hasOwn(parsed.dependencies, name)) {
          hidden = text
          delete parsed.dependencies[name]
          writeProfileManifest(manifestFile, parsed)
          this.trace('update:dependency-hidden', { name })
        }
      } catch (error) {
        hidden = null
        this.trace('update:dependency-hide-failed', { name, message: error instanceof Error ? error.message : String(error) })
      }
    }

    const options = { enabled: true }
    if (typeof requestId === 'string' && requestId.length > 0) options.requestId = requestId
    if (typeof version === 'string' && version.length > 0) options.saveExact = true

    let result = null
    let thrown = null
    try {
      result = await manager.installBundle(target, options)
    } catch (error) {
      thrown = error
    }
    const installed = result?.application === 'applied' || result?.application === 'restart-required'
    if (installed) {
      this.trace('update:overwrite-installed', { name, target, application: result.application, code })
      if (manifestFile !== null) {
        try {
          const parsed = readProfileManifest(profileDir).parsed
          if (parsed?.dependencies?.[name] === undefined) {
            parsed.dependencies = {
              ...parsed.dependencies,
              [name]: typeof version === 'string' && version.length > 0 ? version : originalSpec ?? target,
            }
            writeProfileManifest(manifestFile, parsed)
            this.trace('update:dependency-restored', { name })
          }
        } catch (error) {
          this.trace('update:dependency-verify-failed', { name, message: error instanceof Error ? error.message : String(error) })
        }
      }
      return {
        ok: true,
        name,
        version: typeof version === 'string' ? version : null,
        spec: target,
        changed: result?.changed === true,
        application: result.application,
        restartReason: result?.restartReason ?? (result.application === 'restart-required' && code === 'bundle-in-use' ? 'host-module' : undefined),
        warnings: Array.isArray(result?.warnings) ? result.warnings : [],
        error: null,
        pendingBuilds: Array.isArray(result?.pendingBuilds) ? result.pendingBuilds : [],
        restored: false,
        fallback: code === 'bundle-in-use' ? 'overwrite-running' : 'install-over',
      }
    }

    const message = thrown !== null
      ? thrown instanceof Error ? thrown.message : String(thrown)
      : typeof result?.error?.diagnostic === 'string'
        ? result.error.diagnostic
        : typeof result?.error?.code === 'string'
          ? result.error.code
          : `install ${result?.application ?? 'failed'}`
    /** Roll back while the dependency is still hidden, so the exact previous version can be installed. */
    const restored = await this.restoreInstall(manager, name, previousVersion, originalSpec)
    if (hidden !== null && manifestFile !== null) {
      try {
        writeTextAtomic(manifestFile, hidden)
        this.trace('update:dependency-restored-text', { name })
      } catch (error) {
        this.trace('update:dependency-restore-text-failed', { name, message: error instanceof Error ? error.message : String(error) })
      }
    }
    const selection = await this.restoreBundleSelection(manager, name, wasSelected)
    this.trace('update:overwrite-failed', { name, target, code, message, restored, selection })
    return {
      ok: false,
      name,
      version: version ?? null,
      spec: target,
      stage: 'install',
      application: typeof result?.application === 'string' ? result.application : 'failed',
      error: message,
      pendingBuilds: Array.isArray(result?.pendingBuilds) ? result.pendingBuilds : [],
      restored,
      fallback: code === 'bundle-in-use' ? 'overwrite-running' : 'install-over',
    }
  }

  /**
   * Put a bundle back into the profile selection after a removal attempt
   * deselected it but could not unload it. `setBundleEnabled` is the official
   * path; the direct manifest edit is the safety net for older managers.
   */
  async restoreBundleSelection(manager, name, shouldBeSelected) {
    if (shouldBeSelected !== true) return { restored: false, reason: 'not-selected-before' }
    const profileDir = this.profileDir()
    if (profileDir !== null && bundleSelected(profileDir, name)) return { restored: true, via: 'manifest' }
    try {
      if (typeof manager?.setBundleEnabled === 'function') {
        const result = await manager.setBundleEnabled(name, true)
        if (result?.application === 'applied' || result?.application === 'restart-required') {
          return { restored: true, via: 'manager' }
        }
      }
    } catch (error) {
      this.trace('update:selection-restore-threw', { name, message: error instanceof Error ? error.message : String(error) })
    }
    if (profileDir !== null) {
      try {
        if (setBundleSelected(profileDir, name, true)) return { restored: true, via: 'manifest-write' }
        return { restored: true, via: 'manifest' }
      } catch (error) {
        this.trace('update:selection-write-failed', { name, message: error instanceof Error ? error.message : String(error) })
      }
    }
    return { restored: false }
  }

  /** Reinstall the previous version (exact first, then the original spec) after a failed update. */
  async restoreInstall(manager, name, previousVersion, originalSpec) {
    const candidates = []
    if (typeof previousVersion === 'string' && previousVersion.length > 0) candidates.push(`${name}@${previousVersion}`)
    if (typeof originalSpec === 'string' && originalSpec.length > 0 && !/^(?:link|file|workspace|git|https?):/i.test(originalSpec)) {
      candidates.push(`${name}@${originalSpec}`)
    }
    for (const spec of candidates) {
      try {
        const back = await manager.installBundle(spec, { enabled: true })
        if (back?.application === 'applied' || back?.application === 'restart-required') return true
      } catch {
        /* try the next candidate */
      }
    }
    return false
  }

  /** Append one line to the update trace so a failed click leaves evidence. */
  trace(event, details) {
    if (this.dataDir === null) return
    try {
      fs.appendFileSync(path.join(this.dataDir, 'update-trace.log'), `${new Date().toISOString()} ${event} ${JSON.stringify(details)}\n`, 'utf8')
    } catch {
      /* the trace is best-effort */
    }
  }

  /** Cheap liveness answer, used by the browser to tell "not yet" from "broken". */
  status() {
    return {
      ok: true,
      autoCheck: this.autoCheck,
      registry: this.registry,
      desktopEndpoint: this.desktopEndpoint,
      checking: this.state.checking === true,
      hasReport: this.state.report !== null,
      updates: this.state.report?.updates?.length ?? 0,
      desktop: this.state.report?.desktop?.status ?? null,
      engine: this.state.report?.engine?.status ?? null,
      ignoredPackages: Object.keys(this.ignored.packages).length,
      ignoredDesktop: this.ignored.desktop,
      compat: this.compat(),
    }
  }

  /** Check shortly after boot, so the answer is ready before the page asks. */
  scheduleBootCheck() {
    if (!this.autoCheck || !this.checkOnBoot) return
    const timer = setTimeout(() => {
      this.check(true).catch((error) => this.log(`boot check failed: ${error instanceof Error ? error.message : String(error)}`))
    }, 1_500)
    timer.unref?.()
  }
}

/** The per-profile data directory the bootstrap context knows how to resolve. */
function resolveDataDir(ctx) {
  try {
    const resolved = ctx?.dshHomePath?.('plugin-updater')
    if (typeof resolved === 'string' && resolved.length > 0) return resolved
  } catch {
    /* no home resolver in this composition */
  }
  const profile = safeGet(ctx, 'profileContext')
  if (typeof profile?.home === 'string' && profile.home.length > 0) return path.join(profile.home, 'plugin-updater')
  try {
    if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0) {
      return path.join(process.env.DSH_HOME, 'plugin-updater')
    }
  } catch {
    /* the path is optional */
  }
  return null
}

/**
 * Cordis plugin body.
 *
 * Deliberately declares no `inject`: every service it uses is optional, so a
 * kernel that renames or drops one leaves this plugin active with that single
 * capability degraded (and `compat` reports it) instead of parked forever.
 */
export function apply(ctx, config) {
  const service = new UpdaterService(ctx, config ?? {})
  const dir = service.dataDir
  if (dir !== null) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      /* the cache directory is an optimization, not a requirement */
    }
  }
  ctx.effect(() => () => {
    service.report = null
  }, 'plugin-updater: release')
  service.scheduleBootCheck()
}

markRemoteMethod('check')
markRemoteMethod('update')
markRemoteMethod('status')
markRemoteMethod('desktopData')
markRemoteMethod('prepareDesktopUpdate')
markRemoteMethod('repairDesktopData')
markRemoteMethod('ignore')
markRemoteMethod('unignore')
