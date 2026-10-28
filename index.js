/**
 * dsh-plugin-updater — Host half.
 *
 * One check covers three layers, and none of them touches the agent loop, so
 * none of them bills the account:
 *
 *   1. Plugin packages — read from the profile manifest and the live bundle
 *      directory, compared with the npm registry over plain HTTPS.
 *   2. DSH NEXT — the running version from its runtime manifest and the data
 *      folder it currently uses. DSH NEXT updates itself; this plugin only
 *      reports the version and can migrate the data folder.
 *   3. DSH core ("内核") — the version bundled inside DSH NEXT.
 *
 * The migration writes DSH NEXT's own location files after copying the user's
 * profiles, sessions and storages to a folder they choose. It never deletes the
 * source and never writes the pointer before the copy succeeds.
 *
 * Compatibility posture:
 *   * No service is a hard dependency. `pluginManager`, `profileContext` and
 *     `desktopRuntime` are probed through `ctx.get()`, so a renamed or removed
 *     service degrades one capability instead of blocking the plugin.
 *   * Versions are resolved through several fallbacks (runtime service, packaged
 *     manifests, environment).
 *   * Every capability actually observed is reported as `compat`.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { Service } from './protocol.js'

/** Host Service key; also the Remote namespace the browser calls. */
const SERVICE_KEY = 'pluginUpdater'
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const DESKTOP_NEXT_PACKAGE_NAME = 'dsh-desktop-next'
const ENGINE_PACKAGE_NAME = '@deepseek-ai/dsh'
/** The only desktop product this release supports. */
const DESKTOP_NEXT_PRODUCT = 'DSH NEXT'
const DESKTOP_NEXT_USER_DATA = 'DSH NEXT'
const DESKTOP_NEXT_LOCATION_FILE = 'desktop-next-location.json'
const DESKTOP_NEXT_LAST_HOME_FILE = 'desktop-next-last-home.json'
/** Data moved by a folder migration; caches and logs stay behind. */
const DATA_HOME_ENTRIES = ['profiles', 'sessions', 'storages', '.credentials.yaml', '.anonymous-user-id', 'desktop-locale.json', 'desktop-preferences.json']
const DATA_HOME_MARKERS = ['profiles', 'sessions', 'storages']
const execFileAsync = promisify(execFile)

/** Remote methods are declared through the typert protocol's marker descriptor. */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'
const REMOTE_SEGMENT = /^[A-Za-z0-9_$.-]+$/

const REQUEST_TIMEOUT_MS = 12_000
const REPORT_TTL_MS = 5 * 60_000

/** A canonical SemVer the DSH NEXT runtime manifest may carry. */
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

/** Whether `child` is strictly inside `parent`, case-insensitively on Windows. */
function isInside(parent, child) {
  try {
    const from = process.platform === 'win32' ? path.resolve(parent).toLowerCase() : path.resolve(parent)
    const to = process.platform === 'win32' ? path.resolve(child).toLowerCase() : path.resolve(child)
    const relative = path.relative(from, to)
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
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
 * DSH NEXT defaults to `~/.dsh` and only follows its own location file. This
 * plan is read-only; `applyDataHome` writes the chosen directory.
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
      canSetHome: false,
      locationFile: null,
      lastHomeFile: null,
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
    canSetHome: home !== null,
    locationFile: paths.locationFile,
    lastHomeFile: paths.lastHomeFile,
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

/** Resolve the running DSH NEXT version. DSH NEXT exposes its build in runtime.json. */
function resolveNextInstallation(ctx) {
  const runtime = safeGet(ctx, 'desktopRuntime')
  const updates = runtime?.updates
  if (typeof updates?.currentVersion === 'string' && updates.currentVersion.length > 0) {
    return { version: updates.currentVersion, source: 'desktopRuntime' }
  }
  for (const file of desktopRuntimeVersionCandidates()) {
    const parsed = readJsonFile(file)
    if (typeof parsed?.desktopVersion === 'string' && CANONICAL_VERSION.test(parsed.desktopVersion)) {
      return { version: parsed.desktopVersion, source: file }
    }
  }
  const environmentVersion = process.env.DSH_DESKTOP_PRODUCT_VERSION
  if (typeof environmentVersion === 'string' && CANONICAL_VERSION.test(environmentVersion)) {
    return { version: environmentVersion, source: 'environment' }
  }
  for (const file of desktopManifestCandidates()) {
    const parsed = readJsonFile(file)
    if (parsed?.name === DESKTOP_NEXT_PACKAGE_NAME && typeof parsed.version === 'string' && parsed.version.length > 0) {
      return { version: parsed.version, source: file }
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
 * `check`, `update`, `chooseDataFolder` and `migrateDataHome` are Remote:
 * they are what the browser panel calls. None of this touches the agent loop.
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
    this.autoCheck = config.autoCheck !== false
    this.checkOnBoot = config.checkOnBoot !== false
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

  /** Back up the two DSH NEXT pointer files before a change. */
  backupDataPointers(plan) {
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
    return { ok: true, backedUp }
  }

  /** Write both DSH NEXT pointer files and the local handoff record. */
  writeDataPointers(plan, destination, reason, details) {
    try {
      writeJsonFile(plan.locationFile, { home: destination })
      writeJsonFile(plan.lastHomeFile, { home: destination })
    } catch (error) {
      return { ok: false, error: `could not write the DSH NEXT data directory: ${error instanceof Error ? error.message : String(error)}` }
    }
    const handoff = {
      version: 1,
      createdAt: new Date().toISOString(),
      reason,
      product: plan.product,
      home: destination,
      locationFile: plan.locationFile,
      lastHomeFile: plan.lastHomeFile,
      ...details,
    }
    if (this.dataDir !== null) {
      try {
        writeJsonFile(path.join(this.dataDir, 'data-home.json'), handoff)
        fs.writeFileSync(path.join(this.dataDir, 'restore-data-home.ps1'), this.restoreScript(destination), 'utf8')
      } catch (error) {
        this.log(`could not write the data-home record: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.trace('data-home:apply', { reason, home: destination, ...details })
    return { ok: true, ...handoff }
  }

  /**
   * Remote: let the user choose a data folder with the native picker.
   *
   * The Host process is a plain Node child, so a browser directory picker
   * cannot return an absolute path. Windows PowerShell's FolderBrowserDialog
   * can; other platforms fall back to the dialog's text field.
   */
  async chooseDataFolder() {
    if (process.platform !== 'win32') {
      return { ok: false, error: 'the native folder picker is only available on Windows', unsupported: true }
    }
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Select the DSH NEXT data folder'",
      '$dialog.ShowNewFolderButton = $true',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
    ].join('\n')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], {
        windowsHide: true,
        timeout: 300_000,
      })
      const selected = String(stdout ?? '').replace(/^\uFEFF/, '').trim()
      return { ok: true, path: selected.length > 0 ? path.resolve(selected) : null }
    } catch (error) {
      return { ok: false, error: `could not open the folder picker: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Remote: point DSH NEXT at a user-chosen data folder, optionally copying
   * the user's data there first. The copy is conservative: it never deletes the
   * source, writes the pointer only after the copy completes, and removes the
   * new folder if the copy fails.
   */
  async migrateDataHome(target, options = {}) {
    const plan = this.desktopData()
    if (!plan.available) return { ok: false, code: 'unsupported', error: 'DSH NEXT data-directory support is unavailable on this platform' }
    if (plan.home === null || typeof plan.locationFile !== 'string' || typeof plan.lastHomeFile !== 'string') {
      return { ok: false, code: 'no-home', error: 'could not resolve the current DSH data directory' }
    }
    const raw = typeof target === 'string' ? target.trim() : ''
    if (raw.length === 0 || !path.isAbsolute(raw)) return { ok: false, code: 'invalid-target', error: 'choose an absolute folder path' }
    const destination = path.resolve(raw)
    if (path.parse(destination).root === destination) return { ok: false, code: 'invalid-target', error: 'choose a folder, not a drive root' }
    const copy = options.copy === true
    if (sameDirectory(plan.home, destination)) {
      if (copy) return { ok: false, code: 'same-folder', error: 'the target folder is the current data directory' }
      const backup = this.backupDataPointers(plan)
      if (!backup.ok) return backup
      const written = this.writeDataPointers(plan, destination, 'manual', { mode: 'pointer' })
      return written.ok ? { ...written, previous: plan.home, mode: 'pointer', copied: [], skipped: [], backedUp: backup.backedUp, restartRequired: true } : written
    }
    if (isInside(plan.home, destination) || isInside(destination, plan.home)) {
      return { ok: false, code: 'overlap', error: 'the target folder must not contain the current data directory or sit inside it' }
    }
    if (copy) {
      if (fs.existsSync(destination)) return { ok: false, code: 'target-exists', error: 'the copy target must not exist yet' }
      try {
        fs.mkdirSync(destination, { recursive: true })
      } catch (error) {
        return { ok: false, code: 'create-failed', error: `could not create the target folder: ${error instanceof Error ? error.message : String(error)}` }
      }
      const copied = []
      const skipped = []
      try {
        for (const entry of DATA_HOME_ENTRIES) {
          const from = path.join(plan.home, entry)
          let stat
          try {
            stat = fs.statSync(from)
          } catch {
            skipped.push(entry)
            continue
          }
          await fs.promises.cp(from, path.join(destination, entry), {
            recursive: stat.isDirectory(),
            force: false,
            errorOnExist: false,
            dereference: true,
          })
          copied.push(entry)
        }
      } catch (error) {
        try {
          fs.rmSync(destination, { recursive: true, force: true })
        } catch {
          /* leave the partial folder for the user to inspect */
        }
        this.trace('data-home:copy-failed', { target: destination, message: error instanceof Error ? error.message : String(error) })
        return { ok: false, code: 'copy-failed', error: `could not copy the data folder: ${error instanceof Error ? error.message : String(error)}` }
      }
      const backup = this.backupDataPointers(plan)
      if (!backup.ok) return backup
      const written = this.writeDataPointers(plan, destination, 'manual-copy', { mode: 'copy', copied, skipped })
      return written.ok
        ? { ...written, previous: plan.home, mode: 'copy', copied, skipped, backedUp: backup.backedUp, restartRequired: true }
        : written
    }
    let stat = null
    try {
      stat = fs.statSync(destination)
    } catch {
      return { ok: false, code: 'target-missing', error: 'the target folder does not exist; check "copy" to create and fill it' }
    }
    if (!stat.isDirectory()) return { ok: false, code: 'not-a-folder', error: 'the target path is not a folder' }
    const hasData = DATA_HOME_MARKERS.some((entry) => {
      try {
        return fs.existsSync(path.join(destination, entry))
      } catch {
        return false
      }
    })
    if (!hasData) return { ok: false, code: 'empty-target', error: 'the target folder has no DSH data; check "copy" to migrate into it' }
    const backup = this.backupDataPointers(plan)
    if (!backup.ok) return backup
    const written = this.writeDataPointers(plan, destination, 'manual', { mode: 'pointer' })
    return written.ok
      ? { ...written, previous: plan.home, mode: 'pointer', copied: [], skipped: [], backedUp: backup.backedUp, restartRequired: true }
      : written
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
    const empty = { version: 1, packages: {}, updatedAt: null }
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
      })
      return true
    } catch (error) {
      this.log('could not save ignored updates: ' + (error instanceof Error ? error.message : String(error)))
      return false
    }
  }

  /**
   * Ignore exactly one version of one package. A newer version still appears,
   * so this is a version pin, not a mute switch.
   */
  ignore(target, version) {
    const name = typeof target === 'string' ? target.trim() : ''
    const value = typeof version === 'string' ? version.trim() : ''
    if (name.length === 0) return { ok: false, error: 'ignore() needs a package name' }
    if (!/^\d+\.\d+/.test(value)) return { ok: false, error: 'ignore() needs an exact version' }
    const previous = this.ignored
    this.ignored = { ...previous, packages: { ...previous.packages, [name]: value }, updatedAt: new Date().toISOString() }
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
    if (name.length === 0) return { ok: false, error: 'unignore() needs a package name' }
    const previous = this.ignored
    const packages = { ...previous.packages }
    delete packages[name]
    this.ignored = { ...previous, packages, updatedAt: new Date().toISOString() }
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

  /** Read the running DSH NEXT version and data-directory state. */
  checkNext() {
    const installation = resolveNextInstallation(this.ctx)
    return {
      status: installation === null ? 'unavailable' : 'current',
      product: DESKTOP_NEXT_PRODUCT,
      currentVersion: installation?.version ?? null,
      source: installation?.source ?? null,
      reason: installation === null ? 'no DSH NEXT installation detected' : null,
      data: this.desktopData(),
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
    let next = null
    let engine = null
    try {
      ;[packages, next, engine] = await Promise.all([
        this.sweepPackages(installed, dir, registry, controller.signal),
        Promise.resolve(this.checkNext()),
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
      next,
      engine,
      ignored: { packages: this.ignored.packages },
      compat: this.compat(),
      error: this.state.error,
    }
    this.state.report = report
    this.state.error = null
    this.writeCachedReport(report)
    this.log(
      `checked ${packages.length} package(s); ${report.updates.length} plugin update(s); next ${next?.status ?? 'off'}; engine ${engine?.status ?? 'off'}`,
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
      checking: this.state.checking === true,
      hasReport: this.state.report !== null,
      updates: this.state.report?.updates?.length ?? 0,
      next: this.state.report?.next?.status ?? null,
      engine: this.state.report?.engine?.status ?? null,
      ignoredPackages: Object.keys(this.ignored.packages).length,
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
markRemoteMethod('chooseDataFolder')
markRemoteMethod('migrateDataHome')
markRemoteMethod('ignore')
markRemoteMethod('unignore')
