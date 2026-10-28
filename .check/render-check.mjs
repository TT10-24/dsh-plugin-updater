/**
 * Headless render check for the Client half.
 *
 * React's DOM renderer is not present in this deployment, so this harness uses a
 * minimal element/hook shim: it calls every captured slot component the way the
 * slot owner would, walks the returned element tree, and fails on any JavaScript
 * error, invalid style value, or DOM prop that React would reject.
 */
import fs from 'node:fs'

const file = process.argv[2] ?? './client.js'
const source = fs.readFileSync(file, 'utf8')
const failures = []
const text = new Set()
const buttons = []
const calls = []

const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useRef(initial) {
    return { current: initial }
  },
}

let captured = null
const windowStub = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry.factory((name) => {
        if (name === 'react') return React
        throw new Error(`unexpected require(${JSON.stringify(name)})`)
      })
    },
  },
}
globalThis.window = windowStub
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
globalThis.requestAnimationFrame = (callback) => {
  setTimeout(callback, 0)
  return 1
}
globalThis.cancelAnimationFrame = () => {}

const report = {
  checkedAt: Date.now(),
  registry: 'https://registry.npmjs.org',
  profileDir: '<profile>',
  packages: [
    { name: 'dsh-ops', installedVersion: '0.3.0', latestVersion: '0.4.0', hasUpdate: true, status: 'update', reason: null, repository: null, source: 'dependency' },
    { name: 'dsh-context', installedVersion: '0.73.1', latestVersion: '0.74.0', hasUpdate: true, status: 'update', reason: null, repository: null, source: 'dependency' },
    { name: 'dsh-whale-widget', installedVersion: '0.4.2', latestVersion: '0.4.2', hasUpdate: false, status: 'current', reason: null, repository: null, source: 'dependency' },
    { name: 'dsh-context-pinned', installedVersion: '0.70.0', latestVersion: '0.77.0', ignoredVersion: '0.77.0', hasUpdate: false, status: 'ignored', reason: null, repository: null, source: 'dependency' },
    { name: 'dsh-plugin-updater', installedVersion: 'link:./local-plugin', latestVersion: null, hasUpdate: false, status: 'bypassed', reason: null, repository: null, source: 'dependency' },
  ],
  updates: ['dsh-ops', 'dsh-context'],
  next: {
    status: 'current',
    product: 'DSH NEXT',
    currentVersion: '2.0.20-next',
    source: 'runtime.json',
    reason: null,
    data: {
      product: 'DSH NEXT',
      home: 'F:\\DSH-Home',
      pointer: 'F:\\DSH-Home',
      pointerMatchesHome: true,
      needsRepair: false,
      canSetHome: true,
      detected: true,
    },
  },
  engine: { status: 'current', currentVersion: '0.2.1-rc.2', latestVersion: '0.2.0-rc.2', reason: null, bundled: true },
  compat: { profileContext: true, pluginManager: true, desktopRuntime: true, dshHomePath: true, degraded: false },
  error: null,
}

globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init })
  return {
    ok: true,
    status: 200,
    json: async () => ({ result: { ok: true, value: report } }),
    text: async () => JSON.stringify({ accepted: true }),
  }
}

new Function('window', source)(windowStub)
if (captured === null) {
  console.error('FAILURE: client.js did not register a module factory')
  process.exit(1)
}

const components = new Map()
const ctx = {
  get: () => null,
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: {
    inject(_slot, callback) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    register(options, Component) {
      const list = components.get(options.name) ?? []
      list.push(Component)
      components.set(options.name, list)
      return () => {}
    },
  },
  effect(callback) {
    callback()
    return () => {}
  },
}

captured.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 30))

console.log('registered slots:', [...components.keys()].join(', '))
const t = (key, params) => (params === undefined ? key : `${key}(${JSON.stringify(params)})`)

const ALLOWED_DOM_PROPS = new Set([
  'style',
  'className',
  'title',
  'role',
  'type',
  'disabled',
  'children',
  'key',
  'ref',
  'onClick',
  'onPointerDown',
  'onDoubleClick',
  'aria-label',
  'aria-hidden',
  'aria-expanded',
  'aria-labelledby',
  'aria-haspopup',
  'aria-pressed',
  'aria-valuemin',
  'aria-valuemax',
  'aria-valuenow',
  'min',
  'max',
  'step',
  'value',
  'onChange',
  'id',
  'htmlFor',
  'placeholder',
  'checked',
  'autoComplete',
  'spellCheck',
  'sec-fetch-site',
  'viewBox',
  'width',
  'height',
  'fill',
  'stroke',
  'strokeWidth',
  'strokeLinecap',
  'strokeLinejoin',
  'd',
  'xmlns',
])
const ALLOWED_STYLE = /^(?:--[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9]*)$/

function flattenText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join(' ')
  return flattenText(node.children)
}

function walk(node, slot, path) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    text.add(String(node))
    return
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) => walk(child, slot, `${path}[${index}]`))
    return
  }
  if (typeof node !== 'object' || typeof node.type === 'undefined') {
    failures.push(`${slot}${path}: invalid element ${String(node)}`)
    return
  }
  if (typeof node.type === 'function') {
    const children = node.children.length === 0 ? undefined : node.children.length === 1 ? node.children[0] : node.children
    let rendered
    try {
      rendered = node.type({ ...node.props, children })
    } catch (error) {
      failures.push(`${slot}${path}: component ${node.type.name || 'anonymous'} threw: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    walk(rendered, slot, path)
    return
  }
  if (typeof node.type === 'string') {
    if (node.type === 'button') buttons.push(node)
    for (const [key, value] of Object.entries(node.props)) {
      if (!ALLOWED_DOM_PROPS.has(key)) failures.push(`${slot}${path}<${node.type}>: unexpected DOM prop ${key}`)
      if (key === 'style') {
        if (value === null || typeof value !== 'object') {
          failures.push(`${slot}${path}<${node.type}>: style is not an object`)
          continue
        }
        for (const [styleKey, styleValue] of Object.entries(value)) {
          if (!ALLOWED_STYLE.test(styleKey)) failures.push(`${slot}${path}<${node.type}>: invalid style key ${styleKey}`)
          if (styleValue === undefined || (typeof styleValue === 'number' && Number.isNaN(styleValue))) {
            failures.push(`${slot}${path}<${node.type}>: style.${styleKey} is ${String(styleValue)}`)
          }
          if (typeof styleValue === 'string' && styleValue.includes('[object Object]')) {
            failures.push(`${slot}${path}<${node.type}>: style.${styleKey} contains an object`)
          }
        }
      }
    }
    node.children.forEach((child, index) => walk(child, slot, `${path}/${node.type}[${index}]`))
    return
  }
  failures.push(`${slot}${path}: unknown element type ${String(node.type)}`)
}

for (const [slot, list] of components) {
  for (const Component of list) {
    const props = {
      t,
      wide: true,
      subject: { kind: 'bundle', pkg: { name: 'dsh-plugin-updater' } },
      anchorRef: { current: null },
      onClose: () => {},
    }
    walk(React.createElement(Component, props), slot, '')
    const html = JSON.stringify(React.createElement(Component, props))
    if (html.includes('"undefined"')) failures.push(`${slot}: rendered output contains undefined`)
  }
}

console.log('components rendered:', [...components.values()].reduce((total, list) => total + list.length, 0))

/** The three-dot header control must exist and describe a popover. */
const appearanceButton = buttons.find((button) => button.props['aria-label'] === 'appearance')
if (appearanceButton === undefined) {
  failures.push('no panel-settings button rendered')
} else {
  if (appearanceButton.props.title !== 'appearance') failures.push('panel-settings button has no title')
  if (appearanceButton.props['aria-haspopup'] !== 'dialog') failures.push('panel-settings button is not marked as a popover trigger')
  if (appearanceButton.props['aria-expanded'] !== false) failures.push('panel-settings button starts expanded')
}

/** The DSH NEXT card must show the running version and offer the data migration sheet. */
const migrateButton = buttons.find((button) => flattenText(button.children).trim() === 'nextMigrate')
if (migrateButton === undefined) failures.push('no DSH NEXT data migration button rendered')
if (!text.has('2.0.20-next')) failures.push('DSH NEXT current version is missing')
if (![...text].some((value) => value.includes('F:\\DSH-Home'))) failures.push('DSH NEXT data directory is missing')

/** The plugin button must call the Remote update endpoint with the exact target. */
const pluginButton = buttons.find((button) => flattenText(button.children).trim() === 'update')
if (pluginButton === undefined) {
  failures.push('no plugin update button rendered')
} else {
  await pluginButton.props.onClick()
  const call = calls.find((entry) => entry.url === 'api/pluginUpdater/update')
  if (call === undefined) failures.push('plugin update button did not call pluginUpdater/update')
  else if (!String(call.init?.body).includes('"name":"dsh-ops"') || !String(call.init?.body).includes('"version":"0.4.0"')) {
    failures.push('plugin update request does not name the exact package and version')
  }
}

/** Ignore must pin the exact version exposed in the row. */
const ignoreButton = buttons.find((button) => flattenText(button.children).trim() === 'ignore')
if (ignoreButton === undefined) {
  failures.push('no plugin ignore button rendered')
} else {
  await ignoreButton.props.onClick()
  const call = calls.find((entry) => entry.url === 'api/pluginUpdater/ignore')
  if (call === undefined) failures.push('ignore button did not call pluginUpdater/ignore')
  else {
    const body = String(call.init?.body)
    if (!body.includes('"target":"dsh-ops"')) failures.push('ignore request does not name the package')
    if (!body.includes('"version":"0.4.0"')) failures.push('ignore request does not name the exact version')
  }
}

/** One click updates every listed plugin; the batch button names both. */
const batchButton = buttons.find((button) => flattenText(button.children).startsWith('updateAllCount'))
if (batchButton === undefined) {
  failures.push('no batch update button rendered for two updates')
} else {
  const before = calls.length
  await batchButton.props.onClick()
  const bodies = calls
    .slice(before)
    .filter((entry) => entry.url === 'api/pluginUpdater/update')
    .map((entry) => String(entry.init?.body))
  if (!bodies.some((body) => body.includes('"name":"dsh-ops"'))) failures.push('batch did not update dsh-ops')
  if (!bodies.some((body) => body.includes('"name":"dsh-context"'))) failures.push('batch did not update dsh-context')
  const requestIds = bodies.map((body) => {
    try {
      return JSON.parse(body).payload.args.requestId
    } catch {
      return null
    }
  })
  if (requestIds.some((id) => typeof id !== 'string' || id.length === 0)) failures.push('batch update is missing a request id')
}

for (const expected of ['pluginsTitle', 'nextTitle', 'engineTitle', 'update', 'nextMigrate', 'ignoredTitle', 'unignore', 'checkNow']) {
  if (!text.has(expected)) failures.push(`rendered output is missing ${expected}`)
}
if (!text.has('dsh-ops')) failures.push('rendered output is missing the plugin row')
if (!text.has('dsh-context-pinned')) failures.push('rendered output is missing the ignored plugin row')
if (![...text].some((value) => value.startsWith('updateAllCount'))) failures.push('rendered output is missing the batch update button')
if (failures.length > 0) {
  console.error('FAILURES:')
  for (const failure of failures) console.error(' -', failure)
  process.exitCode = 1
} else {
  console.log('OK')
}
