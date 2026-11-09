/**
 * Offline regression check for update identity and version ordering.
 *
 * The reported bug: a plugin installed from a local link was compared with an
 * unrelated npm package that happened to share its name, and a higher version
 * on npm made the panel offer a replacement. The same report could also offer a
 * downgrade because prerelease identifiers were compared as plain strings.
 *
 * No network: globalThis.fetch is replaced with a small registry double.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { UpdaterService, compareVersions, installSource, isSemver, repositoryFromSpec, repositoryIdentity } from '../index.js'

const failures = []
function equal(label, actual, expected) {
  const ok = Object.is(actual, expected)
  if (!ok) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}

/** SemVer 2.0.0 precedence, including numeric prerelease identifiers. */
const versionCases = [
  ['0.3.0', '0.4.0', -1],
  ['0.4.2', '0.4.2', 0],
  ['1.0.0', '0.9.9', 1],
  ['2.0.0', '10.0.0', -1],
  ['1.0.0-beta.1', '1.0.0', -1],
  ['1.0.0-beta.10', '1.0.0-beta.2', 1],
  ['1.0.0-rc.10', '1.0.0-rc.9', 1],
  ['1.0.0-2', '1.0.0-10', -1],
  ['1.0.0-alpha', '1.0.0-alpha.1', -1],
  ['1.0.0-alpha.beta', '1.0.0-beta', -1],
  ['1.0.0-beta', '1.0.0-beta.2', -1],
  ['1.0.0+build.2', '1.0.0+build.1', 0],
  ['^0.3.0', '0.3.0', 0],
  ['~1.2.3', '1.2.3', 0],
  ['v1.2.3', '1.2.3', 0],
]
for (const [left, right, expected] of versionCases) equal(`compare(${left}, ${right})`, compareVersions(left, right), expected)

equal('link spec is local', installSource('link:F:/work/my-plugin'), 'local')
equal('file spec is local', installSource('file:../my-plugin.tgz'), 'local')
equal('workspace spec is local', installSource('workspace:*'), 'local')
equal('github spec is remote', installSource('github:me/github-plugin'), 'remote')
equal('range spec is registry', installSource('^1.2.3'), 'registry')
equal('npm alias is not a registry install', installSource('npm:other-package@1.0.0'), 'alias')
equal('range is not a concrete target', isSemver('^1.2.3'), false)
equal('concrete version is a valid target', isSemver('1.2.3-beta.1'), true)
equal('github repository identity', repositoryIdentity('git+https://github.com/Me/Repo.git#readme'), 'github.com/me/repo')
equal('github spec repository identity', repositoryFromSpec('github:me/repo#v1.0.0'), 'github.com/me/repo')
equal('link spec has no repository identity', repositoryFromSpec('link:F:/work/my-plugin'), null)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-updater-identity-'))
const profileDir = path.join(root, 'profiles', 'desktop')
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}

write(path.join(profileDir, 'package.json'), {
  name: 'dsh-profile-test',
  private: true,
  dependencies: {
    'link-plugin': 'link:F:/work/link-plugin',
    'same-name-plugin': '1.0.0',
    'registry-plugin': '^1.0.0',
    'beta-plugin': '1.0.0-beta.10',
    'missing-plugin': '1.0.0',
    'github-plugin': 'github:me/github-plugin',
    'github-foreign': 'github:me/github-foreign',
  },
  dsh: {
    profile: {
      bundles: [
        'link-plugin',
        'same-name-plugin',
        'registry-plugin',
        'beta-plugin',
        'missing-plugin',
        'github-plugin',
        'github-foreign',
      ],
    },
  },
})

const installed = [
  ['link-plugin', '1.0.0', 'github.com/me/link-plugin'],
  ['same-name-plugin', '1.0.0', 'github.com/me/same-name-plugin'],
  ['registry-plugin', '1.0.0', 'github.com/me/registry-plugin'],
  ['beta-plugin', '1.0.0-beta.10', 'github.com/me/beta-plugin'],
  ['missing-plugin', '1.0.0', 'github.com/me/missing-plugin'],
  ['github-plugin', '1.0.0', 'github.com/me/github-plugin'],
  ['github-foreign', '1.0.0', 'github.com/me/github-foreign'],
]
for (const [name, version, repository] of installed) {
  write(path.join(profileDir, 'node_modules', name, 'package.json'), { name, version, repository: { type: 'git', url: `git+https://${repository}.git` } })
}

const published = new Map([
  ['link-plugin', { version: '9.9.9', repository: 'git+https://github.com/someone-else/link-plugin.git' }],
  ['same-name-plugin', { version: '9.9.9', repository: 'git+https://github.com/someone-else/same-name-plugin.git' }],
  ['registry-plugin', { version: '1.1.0', repository: 'git+https://github.com/me/registry-plugin.git' }],
  ['beta-plugin', { version: '1.0.0-beta.2', repository: 'git+https://github.com/me/beta-plugin.git' }],
  ['registry-plugin@1.1.0', { version: '1.1.0', repository: 'git+https://github.com/me/registry-plugin.git' }],
  ['same-name-plugin@9.9.9', { version: '9.9.9', repository: 'git+https://github.com/someone-else/same-name-plugin.git' }],
  ['github-plugin', { version: '2.0.0', repository: 'git+https://github.com/me/github-plugin.git' }],
  ['github-plugin@2.0.0', { version: '2.0.0', repository: 'git+https://github.com/me/github-plugin.git' }],
  ['github-foreign', { version: '9.9.9', repository: 'git+https://github.com/someone-else/github-foreign.git' }],
  ['github-foreign@9.9.9', { version: '9.9.9', repository: 'git+https://github.com/someone-else/github-foreign.git' }],
])

const calls = []
const manager = {
  calls,
  registries: async () => ({ registry: 'https://registry.test', fallbackRegistries: [], resolved: 'https://registry.test' }),
  listBundles: async () => installed.map(([name, version]) => ({ name, version, installed: true, enabled: true, removable: true })),
  removeBundle: async (name) => {
    calls.push({ op: 'remove', name })
    return { changed: true, application: 'applied', stage: 'remove', target: name }
  },
  installBundle: async (spec, options) => {
    calls.push({ op: 'install', spec, requestId: options?.requestId ?? null })
    return { changed: true, application: 'applied', stage: 'install', target: spec }
  },
}

/** The repo's dev install resolves the real Cordis base; CI does not. */
let Context = null
try {
  Context = (await import('@deepseek-ai/cordis')).Context
} catch {
  Context = null
}
const services = {}
const ctx = Context !== null
  ? new Context()
  : {
      provide(name, value) {
        services[name] = value
      },
      get(name) {
        return services[name]
      },
    }
ctx.provide('profileContext', { name: 'desktop', dir: profileDir, home: root })
ctx.provide('pluginManager', manager)

const originalFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  const text = String(url)
  const match = /^https:\/\/registry\.test\/(.+)\/(latest|[^/]+)$/.exec(text)
  const key = match === null ? null : `${decodeURIComponent(match[1])}${match[2] === 'latest' ? '' : `@${match[2]}`}`
  const body = key === null ? null : published.get(key) ?? null
  if (body === null || body === undefined) {
    return { ok: false, status: 404, async json() { return {} } }
  }
  return { ok: true, status: 200, async json() { return { name: key.split('@')[0], ...body } } }
}

try {
  write(path.join(root, 'plugin-updater', 'ignored.json'), { version: 1, packages: {}, updatedAt: null })
  const service = new UpdaterService(ctx, { profileDir, checkEngine: false, verbose: false })
  const report = await service.check(true)
  const rows = new Map(report.packages.map((entry) => [entry.name, entry]))

  equal('link install is not compared with npm', rows.get('link-plugin')?.status, 'local')
  equal('link install offers no update', rows.get('link-plugin')?.hasUpdate, false)
  equal('same name but different repository is not offered', rows.get('same-name-plugin')?.status, 'foreign')
  equal('same name but different repository offers no update', rows.get('same-name-plugin')?.hasUpdate, false)
  equal('registry install still gets its update', rows.get('registry-plugin')?.hasUpdate, true)
  equal('registry update target', rows.get('registry-plugin')?.latestVersion, '1.1.0')
  equal('github install with a matching repository can update', rows.get('github-plugin')?.hasUpdate, true)
  equal('github install update target', rows.get('github-plugin')?.latestVersion, '2.0.0')
  equal('github install pointing at another repository is not offered', rows.get('github-foreign')?.status, 'foreign')
  equal('github install pointing at another repository offers no update', rows.get('github-foreign')?.hasUpdate, false)
  equal('newer prerelease is not a downgrade target', rows.get('beta-plugin')?.hasUpdate, false)
  equal('missing package is reported as missing', rows.get('missing-plugin')?.status, 'missing')

  calls.length = 0
  const linked = await service.update('link-plugin', '9.9.9')
  equal('updating a link install is refused', linked.ok, false)
  equal('refused link install never touches the manager', calls.length, 0)

  const foreign = await service.update('same-name-plugin', '9.9.9')
  equal('updating a same-name foreign package is refused', foreign.ok, false)
  equal('refused foreign package never touches the manager', calls.length, 0)

  const downgrade = await service.update('beta-plugin', '1.0.0-beta.2')
  equal('downgrade is refused', downgrade.ok, false)
  equal('refused downgrade never touches the manager', calls.length, 0)

  const foreignUpdate = await service.update('github-foreign', '9.9.9')
  equal('updating a github install from another repository is refused', foreignUpdate.ok, false)
  equal('refused github identity never touches the manager', calls.length, 0)

  calls.length = 0
  const updated = await service.update('registry-plugin', '1.1.0', 'req-identity')
  equal('a real registry update still runs', updated.ok, true)
  equal('real update installs the exact target', calls[1]?.spec, 'registry-plugin@1.1.0')

  calls.length = 0
  const github = await service.update('github-plugin', '2.0.0', 'req-github')
  equal('a verified github install can still update', github.ok, true)
  equal('verified github update installs the exact target', calls[1]?.spec, 'github-plugin@2.0.0')
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(root, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('\nall identity and version checks passed')
