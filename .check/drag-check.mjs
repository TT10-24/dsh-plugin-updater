/**
 * Headless regression check for the panel drag.
 *
 * Renders the sidebar entry with the same hook/element shim as render-check,
 * attaches a fake panel node through the element `ref`, then drives
 * pointerdown → pointermove → pointerup and verifies the node moves, stays
 * inside the viewport, and remembers its position.
 */
import fs from 'node:fs'

const file = process.argv[2] ?? './client.js'
const source = fs.readFileSync(file, 'utf8')
const failures = []
const stored = []
const documentListeners = new Map()
const windowListeners = new Map()

const panelNode = {
  style: {},
  offsetWidth: 380,
  offsetHeight: 400,
  getBoundingClientRect: () => ({ left: 100, top: 100, right: 480, bottom: 500, width: 380, height: 400 }),
}

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
  innerWidth: 1200,
  innerHeight: 800,
  requestAnimationFrame: (callback) => {
    setTimeout(callback, 0)
    return 1
  },
  cancelAnimationFrame: () => {},
  addEventListener(type, listener) {
    windowListeners.set(type, listener)
  },
  removeEventListener(type, listener) {
    if (windowListeners.get(type) === listener) windowListeners.delete(type)
  },
  localStorage: {
    getItem: () => null,
    setItem: (key, value) => stored.push({ key, value }),
    removeItem: () => {},
  },
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
globalThis.localStorage = windowStub.localStorage
globalThis.requestAnimationFrame = windowStub.requestAnimationFrame
globalThis.cancelAnimationFrame = windowStub.cancelAnimationFrame
globalThis.document = {
  addEventListener(type, listener) {
    documentListeners.set(type, listener)
  },
  removeEventListener(type, listener) {
    if (documentListeners.get(type) === listener) documentListeners.delete(type)
  },
}

const report = {
  checkedAt: Date.now(),
  packages: [
    { name: 'dsh-ops', installedVersion: '0.3.0', latestVersion: '0.4.0', hasUpdate: true, status: 'update', reason: null, repository: null, source: 'dependency' },
  ],
  updates: ['dsh-ops'],
  next: {
    status: 'current',
    product: 'DSH NEXT',
    currentVersion: '2.0.20-next',
    reason: null,
    data: { home: 'F:\\DSH-Home', pointer: 'F:\\DSH-Home', pointerMatchesHome: true, needsRepair: false, canSetHome: true, detected: true },
  },
  engine: { status: 'current', currentVersion: '0.2.1-rc.2', latestVersion: '0.2.1-rc.2', reason: null, bundled: true },
  compat: { profileContext: true, pluginManager: true, desktopRuntime: true, dshHomePath: true, degraded: false },
  error: null,
}
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ result: { ok: true, value: report } }),
  text: async () => JSON.stringify({ accepted: true }),
})

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

const headers = []
function walk(node, depth = 0) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') return
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, depth + 1))
    return
  }
  if (typeof node.type === 'function') {
    const children = node.children.length === 0 ? undefined : node.children.length === 1 ? node.children[0] : node.children
    walk(node.type({ ...node.props, children }), depth + 1)
    return
  }
  if (typeof node.type === 'string') {
    if (node.props.ref !== null && typeof node.props.ref === 'object' && 'current' in node.props.ref) {
      node.props.ref.current = panelNode
    }
    if (node.type === 'header') headers.push(node)
    node.children.forEach((child) => walk(child, depth + 1))
  }
}

const Sidebar = components.get('sidebar.footer.action')?.[0]
if (Sidebar === undefined) {
  console.error('FAILURE: sidebar.footer.action was not registered')
  process.exit(1)
}
walk(React.createElement(Sidebar, { wide: true, t: (key) => key }))

const header = headers[0]
if (header === undefined) {
  console.error('FAILURE: the panel header was not rendered')
  process.exit(1)
}
const onPointerDown = header.props.onPointerDown
if (typeof onPointerDown !== 'function') {
  console.error('FAILURE: the panel header has no pointerdown handler')
  process.exit(1)
}

onPointerDown({
  pointerType: 'mouse',
  button: 0,
  pointerId: 1,
  clientX: 300,
  clientY: 200,
  preventDefault() {},
  currentTarget: { setPointerCapture() {} },
})
if (panelNode.style.left !== '100px' || panelNode.style.top !== '100px') {
  failures.push(`pointerdown did not anchor the panel at its rect: ${JSON.stringify(panelNode.style)}`)
}

const move = documentListeners.get('pointermove')
if (typeof move !== 'function') {
  failures.push('pointermove listener was not attached to document')
} else {
  move({ clientX: 340, clientY: 230 })
  if (panelNode.style.left !== '140px' || panelNode.style.top !== '130px') {
    failures.push(`pointermove did not move the panel: ${JSON.stringify(panelNode.style)}`)
  }
}

const up = documentListeners.get('pointerup')
if (typeof up !== 'function') {
  failures.push('pointerup listener was not attached to document')
} else {
  up()
  if (documentListeners.size !== 0) failures.push('drag listeners were not removed on pointerup')
  const saved = stored.at(-1)
  if (saved === undefined || !String(saved.value).includes('"left":140') || !String(saved.value).includes('"top":130')) {
    failures.push(`the final position was not remembered: ${JSON.stringify(saved)}`)
  }
}

if (failures.length > 0) {
  console.error('FAILURES:')
  for (const failure of failures) console.error(' -', failure)
  process.exitCode = 1
} else {
  console.log('drag check OK: anchor 100,100 → move 140,130 → saved')
}
