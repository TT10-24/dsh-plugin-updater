/**
 * dsh-plugin-updater — Client half.
 *
 * One seat only: the sidebar entry beside Settings. Its badge is the
 * non-blocking "updates are waiting" signal, and the panel it opens is
 * draggable and remembers its position.
 *
 * The panel shows two working layers — plugin packages and the DSH NEXT data
 * folder — plus the DSH core bundled inside DSH NEXT. DSH NEXT updates itself;
 * this plugin only reports the running version and can migrate the data folder
 * the user chooses.
 *
 * Nothing here starts an agent turn, so none of it bills the account.
 *
 * Compatibility posture: the plugin body takes only `slots` and `locale` as hard
 * dependencies; `connection` is probed through `ctx.get()` (a kernel that renames
 * or removes it falls back to the same-origin `/api` fetch below), and every text
 * read has a built-in dictionary fallback in case the locale binding is absent.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-updater',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'plugin-updater'
    const SIDEBAR_SLOT = 'sidebar.footer.action'
    const DETAIL_SLOT = 'plugins.detail.actions'
    const PACKAGE = 'dsh-plugin-updater'
    const POSITION_KEY = 'dsh-plugin-updater:panel-position'
    const APPEARANCE_KEY = 'dsh-plugin-updater:panel-appearance'
    const PANEL_WIDTH = 408
    const PANEL_MAX_HEIGHT = 620

    /** Bounds for the appearance controls; also the sanitiser for stored values. */
    const APPEARANCE_LIMITS = {
      width: { min: 320, max: 560, step: 4 },
      height: { min: 380, max: 820, step: 10 },
      opacity: { min: 0.72, max: 1, step: 0.02 },
    }
    const APPEARANCE_DEFAULT = {
      width: PANEL_WIDTH,
      height: PANEL_MAX_HEIGHT,
      accent: '#6b8cff',
      accent2: '#8f6bff',
      surface: 'navy',
      opacity: 1,
    }
    /** Dark surfaces keep the panel readable without inheriting a light theme. */
    const PANEL_SURFACES = {
      navy: { bg: '#151923', head: '#1a1f2b', row: '#1e2431', rowHover: '#232a39', border: '#2a3140', borderStrong: '#3a4356' },
      graphite: { bg: '#14161a', head: '#191c21', row: '#1e2228', rowHover: '#252a31', border: '#2b3038', borderStrong: '#3b424d' },
      plum: { bg: '#1a1420', head: '#211828', row: '#261c2f', rowHover: '#2f2339', border: '#3a2b44', borderStrong: '#4a3657' },
      forest: { bg: '#101a17', head: '#15211d', row: '#192723', rowHover: '#1f302b', border: '#2a3c35', borderStrong: '#385046' },
    }
    /** Accent pairs for the logo, primary buttons, progress bar and live dots. */
    const PANEL_ACCENTS = [
      { id: 'indigo', accent: '#6b8cff', accent2: '#8f6bff' },
      { id: 'emerald', accent: '#3ecf8e', accent2: '#2bb673' },
      { id: 'amber', accent: '#f5b544', accent2: '#ff8a3d' },
      { id: 'rose', accent: '#ff6b9a', accent2: '#c86bff' },
      { id: 'cyan', accent: '#46c7f5', accent2: '#4c8dff' },
    ]

    const ZH = {
      title: '更新检查',
      open: '查看更新',
      close: '关闭',
      checkNow: '重新检查',
      checking: '正在检查…',
      retry: '重试',
      failed: '检查失败',
      notChecked: '尚未检查',
      pluginsTitle: '插件',
      pluginUpdates: '{count} 个可更新',
      allCurrent: '全部最新',
      nextTitle: 'DSH NEXT',
      nextData: '数据目录',
      nextDataMismatch: 'DSH NEXT 当前使用 {pointer}',
      nextMigrate: '迁移数据目录',
      nextMigrateTitle: '迁移数据目录',
      nextMigrateBody: '把 DSH NEXT 的数据目录指向你选择的文件夹。可只切换指针，或复制插件、工作区与对话。',
      nextSource: '当前数据目录',
      nextTarget: '目标文件夹',
      nextBrowse: '浏览…',
      nextBrowsing: '选择中…',
      nextCopy: '同时复制现有数据（插件、工作区、对话）',
      nextCopyHint: '复制模式要求目标文件夹不存在，可能需要几分钟。',
      nextPointerHint: '只切换指针要求目标文件夹已有 DSH 数据。',
      nextApply: '开始迁移',
      nextApplying: '正在迁移…',
      nextCancel: '取消',
      nextDone: '已指向 {home}，请重启 DSH NEXT 后生效',
      nextFailed: '迁移失败',
      nextPickerFailed: '无法打开文件夹选择器，请手动输入绝对路径',
      nextUnavailable: '未检测到 DSH NEXT 数据目录支持',
      ignoredTitle: '已忽略',
      ignoredRow: '已忽略 {version}',
      ignore: '忽略',
      ignoreFailed: '忽略失败',
      unignore: '取消忽略',
      ignoredRestored: '已取消忽略',
      engineTitle: '内核',
      engineBundled: '随 DSH NEXT 更新',
      latest: '最新',
      update: '更新',
      updateAll: '全部更新',
      updateAllCount: '全部更新 ({count})',
      updating: '正在更新…',
      queued: '等待中',
      updatingName: '正在更新 {name}…',
      stageRemoving: '正在卸载旧版本…',
      stageInstalling: '正在安装新版本…',
      stageRechecking: '正在重新检查…',
      batchProgress: '正在更新 {name}（{done}/{total}）',
      batchUpdating: '正在批量更新 {count} 个插件…',
      batchUpdated: '已更新 {count} 个插件',
      batchPartial: '完成 {done} 个，失败 {failed} 个',
      restored: '已恢复原版本',
      restartThenUpdate: '可重启 DSH NEXT 后再试',
      pendingBuilds: '需批准构建脚本: {names}',
      updated: '更新完成',
      restartHint: '重启 DSH NEXT 后生效',
      lastChecked: '上次检查 {time}',
      bypassed: '跳过 {count} 个（本地链接 / 非版本号）',
      dragHint: '拖动顶部移动，双击复位',
      appearance: '面板设置',
      appearanceHint: '调整大小、颜色与位置',
      panelWidth: '宽度',
      panelHeight: '面板高度',
      accentColor: '强调色',
      customColor: '自定义',
      surfaceColor: '背景',
      surfaceNavy: '深海军蓝',
      surfaceGraphite: '石墨灰',
      surfacePlum: '梅子紫',
      surfaceForest: '森林绿',
      opacity: '不透明度',
      resetAppearance: '恢复默认',
      resetPosition: '复位位置',
      done: '完成',
      degraded: '部分内核能力缺失，已自动降级',
      available: '{count} 个可更新',
      upToDate: '全部最新',
    }
    const EN = {
      title: 'Updates',
      open: 'View updates',
      close: 'Close',
      checkNow: 'Check again',
      checking: 'Checking…',
      retry: 'Retry',
      failed: 'Check failed',
      notChecked: 'Not checked yet',
      pluginsTitle: 'Plugins',
      pluginUpdates: '{count} update(s)',
      allCurrent: 'All current',
      nextTitle: 'DSH NEXT',
      nextData: 'Data directory',
      nextDataMismatch: 'DSH NEXT currently uses {pointer}',
      nextMigrate: 'Migrate data folder',
      nextMigrateTitle: 'Migrate data folder',
      nextMigrateBody: 'Point DSH NEXT at a folder you choose. Switch the pointer only, or copy plugins, workspaces and conversations.',
      nextSource: 'Current data folder',
      nextTarget: 'Target folder',
      nextBrowse: 'Browse…',
      nextBrowsing: 'Choosing…',
      nextCopy: 'Also copy plugins, workspaces and conversations',
      nextCopyHint: 'Copy mode requires a new target folder and may take a few minutes.',
      nextPointerHint: 'Pointer-only mode requires a folder that already holds DSH data.',
      nextApply: 'Start migration',
      nextApplying: 'Migrating…',
      nextCancel: 'Cancel',
      nextDone: 'Now points at {home}; restart DSH NEXT to apply',
      nextFailed: 'Migration failed',
      nextPickerFailed: 'Could not open the folder picker; type an absolute path instead',
      nextUnavailable: 'DSH NEXT data-directory support is unavailable',
      ignoredTitle: 'Ignored',
      ignoredRow: 'Ignored {version}',
      ignore: 'Ignore',
      ignoreFailed: 'Could not ignore this version',
      unignore: 'Unignore',
      ignoredRestored: 'Unignored',
      engineTitle: 'Core',
      engineBundled: 'ships with DSH NEXT',
      latest: 'latest',
      update: 'Update',
      updateAll: 'Update all',
      updateAllCount: 'Update all ({count})',
      updating: 'Updating…',
      queued: 'Queued',
      updatingName: 'Updating {name}…',
      stageRemoving: 'Removing the old version…',
      stageInstalling: 'Installing the new version…',
      stageRechecking: 'Checking again…',
      batchProgress: 'Updating {name} ({done}/{total})',
      batchUpdating: 'Updating {count} plugin(s)…',
      batchUpdated: 'Updated {count} plugin(s)',
      batchPartial: '{done} done, {failed} failed',
      restored: 'previous version restored',
      restartThenUpdate: 'restart DSH NEXT and try again',
      pendingBuilds: 'build scripts need approval: {names}',
      updated: 'Updated',
      restartHint: 'Restart DSH NEXT to apply',
      lastChecked: 'checked {time}',
      bypassed: '{count} skipped (local link / no version)',
      dragHint: 'Drag the header to move, double-click to reset',
      appearance: 'Panel settings',
      appearanceHint: 'Size, color and position',
      panelWidth: 'Width',
      panelHeight: 'Panel height',
      accentColor: 'Accent',
      customColor: 'Custom',
      surfaceColor: 'Surface',
      surfaceNavy: 'Navy',
      surfaceGraphite: 'Graphite',
      surfacePlum: 'Plum',
      surfaceForest: 'Forest',
      opacity: 'Opacity',
      resetAppearance: 'Reset',
      resetPosition: 'Reset position',
      done: 'Done',
      degraded: 'Some kernel capabilities are missing; degraded automatically',
      available: '{count} update(s)',
      upToDate: 'All current',
    }

    /** One shared store: the components subscribe, the plugin body writes. */
    const store = {
      state: {
        status: 'idle',
        report: null,
        error: null,
        busy: {},
        rowErrors: {},
        restartRequired: false,
        message: null,
        open: false,
        updateRequestId: null,
        updateName: null,
        updateStage: 'idle',
        updateLog: null,
        batchTotal: 0,
        batchDone: 0,
        batchName: null,
      },
      listeners: new Set(),
      set(patch) {
        store.state = { ...store.state, ...patch }
        for (const listener of [...store.listeners]) listener(store.state)
      },
      subscribe(listener) {
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      },
    }

    function useUpdaterState() {
      const [state, setState] = React.useState(store.state)
      React.useEffect(() => store.subscribe(setState), [])
      return state
    }

    /** The plugin context, kept after `apply` so calls can reach probed services. */
    let clientContext = null
    let progressSubscription = null

    /** Read a service without a hard dependency; a missing one degrades one path. */
    function findService(name) {
      try {
        const value = clientContext?.get?.(name)
        return value === undefined ? null : value
      } catch {
        return null
      }
    }

    /**
     * Subscribe to the manager's install events on first use. Doing this at the
     * moment of an update (rather than at activation) avoids depending on the
     * client gateway's activation order; a kernel that never exposes `remote`
     * simply keeps the local stage bar.
     */
    function ensureProgressSubscription() {
      if (progressSubscription !== null) return
      const remote = findService('remote')
      if (typeof remote?.$on !== 'function') return
      const disposers = []
      const on = (event, listener) => {
        try {
          const dispose = remote.$on(event, listener)
          if (typeof dispose === 'function') disposers.push(dispose)
        } catch {
          /* this kernel does not forward the event */
        }
      }
      on('plugin-manager/install-state', (progress) => {
        if (progress === null || progress === undefined || progress.requestId !== store.state.updateRequestId) return
        store.set({ updateStage: 'installing', updateAttempt: progress.attempt ?? null })
      })
      on('plugin-manager/install-log', (chunk) => {
        if (chunk === null || chunk === undefined || chunk.requestId !== store.state.updateRequestId) return
        const text = String(chunk.text ?? '').replace(/\u001b\[[0-9;]*m/g, '')
        const line = text.split(/\r?\n/).map((part) => part.trim()).filter(Boolean).pop()
        if (line !== undefined) store.set({ updateLog: line.slice(0, 120) })
      })
      if (disposers.length === 0) return
      progressSubscription = () => {
        for (const dispose of disposers.reverse()) {
          try {
            dispose()
          } catch {
            /* already disposed */
          }
        }
        progressSubscription = null
      }
    }

    /** `{ ok, value }` / `{ ok: false, error }` is the shared RPC result envelope. */
    function unwrap(result) {
      if (result === null || typeof result !== 'object') return result
      if (result.ok === true) return result.value
      if (result.ok === false) {
        throw new Error(typeof result.error?.message === 'string' ? result.error.message : 'the dsh host refused the call')
      }
      return result
    }

    /**
     * One Host call through the shared `/api` carrier.
     *
     * The carrier is probed rather than injected; when it is unavailable the
     * same-origin `fetch` branch sends the identical request. Both paths carry
     * the same `{ args }` payload the Remote gateway expects.
     */
    async function callHost(method, args) {
      const endpoint = `pluginUpdater/${method}`
      const connection = findService('connection')
      const carrierAvailable = typeof connection?.rpc?.call === 'function'
      const send = async (useCarrier) => {
        if (useCarrier) {
          const live = findService('connection')
          if (typeof live?.rpc?.call !== 'function') throw new Error('connection unavailable')
          return live.rpc.call('/api', endpoint, { args })
        }
        const rpcId = globalThis.crypto?.randomUUID?.() ?? `plugin-updater-${Date.now()}-${Math.random().toString(16).slice(2)}`
        const response = await fetch(`api/${endpoint}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json())?.result
      }
      let envelope
      try {
        envelope = await send(carrierAvailable)
      } catch (error) {
        if (!carrierAvailable) throw error
        envelope = await send(false)
      }
      return unwrap(envelope)
    }

    /** A plugin package that is not a plain npm version is not comparable. */
    function comparableVersion(value) {
      return typeof value === 'string' && /^\d+\.\d+/.test(value.trim())
    }

    function entryState(entry) {
      if (entry.status === 'update') return 'update'
      if (entry.status === 'current') return 'current'
      if (entry.status === 'bypassed') return 'bypassed'
      return comparableVersion(entry.installedVersion) ? 'unknown' : 'bypassed'
    }

    function updateEntries(report) {
      return (report?.packages ?? []).filter((entry) => entryState(entry) === 'update')
    }

    function totalUpdates(report) {
      return updateEntries(report).length
    }

    /** Smooth progress: completed packages plus the current package's stage. */
    function progressFraction(state) {
      const stage = state.updateStage === 'installing' ? 0.65 : state.updateStage === 'done' ? 0.92 : 0.2
      if (state.batchTotal > 0) return Math.min(0.99, (state.batchDone + stage) / state.batchTotal)
      if (state.updateRequestId !== null) return stage
      return 0
    }

    /** Translate through the injected locale binding, with a built-in fallback. */
    function makeT(t) {
      if (typeof t === 'function') return t
      return (key, params) => {
        const template = typeof ZH[key] === 'string' ? ZH[key] : typeof EN[key] === 'string' ? EN[key] : String(key)
        return typeof params === 'object' && params !== null
          ? template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
          : template
      }
    }

    /** A failure the user can act on. */
    function describeFailure(method, error) {
      const detail = error instanceof Error ? error.message : String(error)
      return `pluginUpdater/${method}: ${detail}`
    }

    async function runCheck(force) {
      store.set({ status: 'checking' })
      try {
        store.set({ status: 'ready', report: await callHost('check', { force: force !== false }), error: null })
      } catch (error) {
        store.set({ status: 'failed', error: describeFailure('check', error) })
      }
    }

    function newRequestId() {
      return globalThis.crypto?.randomUUID?.() ?? `updater-${Date.now()}-${Math.random().toString(16).slice(2)}`
    }

    /** Remove one updated entry from the visible report before the re-check lands. */
    function markUpdated(name, version) {
      const report = store.state.report
      if (report === null || report === undefined) return
      const packages = (report.packages ?? []).map((entry) =>
        entry.name === name
          ? {
              ...entry,
              installedVersion: version ?? entry.installedVersion,
              latestVersion: version ?? entry.latestVersion,
              hasUpdate: false,
              status: 'current',
              reason: null,
            }
          : entry,
      )
      store.set({ report: { ...report, packages, updates: packages.filter((entry) => entry.hasUpdate).map((entry) => entry.name) } })
    }

    function setRowError(name, message) {
      store.set({ rowErrors: { ...store.state.rowErrors, [name]: message } })
    }

    function clearRowError(name) {
      if (!(name in store.state.rowErrors)) return
      const next = { ...store.state.rowErrors }
      delete next[name]
      store.set({ rowErrors: next })
    }

    /** One update with live stage state; the caller owns busy/messages and batching. */
    async function runUpdate(entry, t) {
      ensureProgressSubscription()
      const requestId = newRequestId()
      clearRowError(entry.name)
      store.set({
        updateRequestId: requestId,
        updateName: entry.name,
        updateStage: 'removing',
        updateLog: null,
      })
      /** If the kernel does not forward install-state, advance the bar by time. */
      const stageTimer = setTimeout(() => {
        if (store.state.updateRequestId === requestId && store.state.updateStage === 'removing') {
          store.set({ updateStage: 'installing' })
        }
      }, 1_200)
      try {
        const result = await callHost('update', { name: entry.name, version: entry.latestVersion, requestId })
        if (result?.ok === true) {
          markUpdated(entry.name, entry.latestVersion)
          store.set({ updateStage: 'done', restartRequired: store.state.restartRequired || result.application === 'restart-required' })
        } else {
          setRowError(entry.name, result?.error ?? t('failed'))
        }
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setRowError(entry.name, message)
        return { ok: false, error: message }
      } finally {
        clearTimeout(stageTimer)
      }
    }

    function updateFailureMessage(name, result, t) {
      const detail = result?.error ?? t('failed')
      const restored = result?.restored === true ? ` · ${t('restored')}` : ''
      const restart = /bundle-in-use|stop-profile/.test(String(detail)) ? ` · ${t('restartThenUpdate')}` : ''
      const pending =
        Array.isArray(result?.pendingBuilds) && result.pendingBuilds.length > 0
          ? ` · ${t('pendingBuilds', { names: result.pendingBuilds.join(', ') })}`
          : ''
      return `${name}: ${detail}${restored}${restart}${pending}`
    }

    async function updateOne(entry, t) {
      store.set({ busy: { ...store.state.busy, [entry.name]: true }, message: t('updatingName', { name: entry.name }) })
      const result = await runUpdate(entry, t)
      const busy = { ...store.state.busy }
      delete busy[entry.name]
      const message =
        result?.ok === true
          ? `${entry.name} → ${entry.latestVersion ?? ''} ${t('updated')}${result.application === 'restart-required' ? ` · ${t('restartHint')}` : ''}`
          : updateFailureMessage(entry.name, result, t)
      store.set({ busy, message, updateRequestId: null, updateName: null, updateStage: 'idle', updateLog: null })
      await runCheck(true)
    }

    /** One click: update every listed plugin, one at a time, with a batch bar. */
    async function updateMany(entries, t) {
      if (entries.length === 0) return
      store.set({
        batchTotal: entries.length,
        batchDone: 0,
        batchName: null,
        busy: {},
        rowErrors: {},
        message: t('batchUpdating', { count: entries.length }),
      })
      let failed = 0
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        store.set({ batchName: entry.name, busy: { ...store.state.busy, [entry.name]: true } })
        const result = await runUpdate(entry, t)
        if (result?.ok !== true) failed += 1
        const busy = { ...store.state.busy }
        delete busy[entry.name]
        store.set({ busy, batchDone: index + 1 })
      }
      store.set({
        batchTotal: 0,
        batchDone: 0,
        batchName: null,
        busy: {},
        updateRequestId: null,
        updateName: null,
        updateStage: 'idle',
        updateLog: null,
        message:
          failed === 0
            ? t('batchUpdated', { count: entries.length })
            : t('batchPartial', { done: entries.length - failed, failed }),
      })
      await runCheck(true)
    }

    /** Pin one plugin version as ignored; a newer release appears again. */
    async function ignorePlugin(entry, t) {
      store.set({ busy: { ...store.state.busy, [entry.name]: true } })
      try {
        const result = await callHost('ignore', { target: entry.name, version: entry.latestVersion })
        if (result?.ok === false) throw new Error(result.error ?? 'the version could not be ignored')
        clearRowError(entry.name)
        store.set({ message: t('ignoredRow', { version: entry.latestVersion ?? '' }) })
        await runCheck(true)
      } catch (error) {
        const message = `${t('ignoreFailed')}: ${error instanceof Error ? error.message : String(error)}`
        setRowError(entry.name, message)
        store.set({ message })
      } finally {
        const busy = { ...store.state.busy }
        delete busy[entry.name]
        store.set({ busy })
      }
    }

    /** Restore an ignored plugin so its current release can be offered again. */
    async function unignorePlugin(entry, t) {
      store.set({ busy: { ...store.state.busy, [entry.name]: true } })
      try {
        const result = await callHost('unignore', { target: entry.name })
        if (result?.ok === false) throw new Error(result.error ?? 'the ignore entry could not be removed')
        store.set({ message: t('ignoredRestored') })
        await runCheck(true)
      } catch (error) {
        const message = `${t('ignoreFailed')}: ${error instanceof Error ? error.message : String(error)}`
        setRowError(entry.name, message)
        store.set({ message })
      } finally {
        const busy = { ...store.state.busy }
        delete busy[entry.name]
        store.set({ busy })
      }
    }

    //#region Dragging
    function readPosition() {
      try {
        const raw = globalThis.localStorage?.getItem(POSITION_KEY)
        if (typeof raw !== 'string' || raw.length === 0) return null
        const parsed = JSON.parse(raw)
        return Number.isFinite(parsed?.left) && Number.isFinite(parsed?.top) ? { left: parsed.left, top: parsed.top } : null
      } catch {
        return null
      }
    }

    function writePosition(position) {
      try {
        if (position === null) globalThis.localStorage?.removeItem(POSITION_KEY)
        else globalThis.localStorage?.setItem(POSITION_KEY, JSON.stringify(position))
      } catch {
        /* storage may be unavailable; dragging still works for this view */
      }
    }

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), Math.max(min, max))
    }

    /** Convert a #rrggbb accent to the translucent tint used by the panel glow. */
    function hexToRgba(value, alpha) {
      const match = /^#([0-9a-f]{6})$/i.exec(typeof value === 'string' ? value.trim() : '')
      if (match === null) return `rgba(107, 140, 255, ${alpha})`
      const number = Number.parseInt(match[1], 16)
      return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`
    }

    /** Keep a stored or user-edited appearance inside the supported bounds. */
    function sanitizeAppearance(value) {
      const input = value !== null && typeof value === 'object' ? value : {}
      const width = Number(input.width)
      const height = Number(input.height)
      const opacity = Number(input.opacity)
      const accent = typeof input.accent === 'string' && /^#[0-9a-f]{6}$/i.test(input.accent) ? input.accent : APPEARANCE_DEFAULT.accent
      const accent2 = typeof input.accent2 === 'string' && /^#[0-9a-f]{6}$/i.test(input.accent2) ? input.accent2 : APPEARANCE_DEFAULT.accent2
      const surface = Object.hasOwn(PANEL_SURFACES, input.surface) ? input.surface : APPEARANCE_DEFAULT.surface
      return {
        width: clamp(Number.isFinite(width) ? Math.round(width) : APPEARANCE_DEFAULT.width, APPEARANCE_LIMITS.width.min, APPEARANCE_LIMITS.width.max),
        height: clamp(Number.isFinite(height) ? Math.round(height) : APPEARANCE_DEFAULT.height, APPEARANCE_LIMITS.height.min, APPEARANCE_LIMITS.height.max),
        accent,
        accent2,
        surface,
        opacity: clamp(Number.isFinite(opacity) ? opacity : APPEARANCE_DEFAULT.opacity, APPEARANCE_LIMITS.opacity.min, APPEARANCE_LIMITS.opacity.max),
      }
    }

    function readAppearance() {
      try {
        const raw = globalThis.localStorage?.getItem(APPEARANCE_KEY)
        if (typeof raw !== 'string' || raw.length === 0) return { ...APPEARANCE_DEFAULT }
        return sanitizeAppearance(JSON.parse(raw))
      } catch {
        return { ...APPEARANCE_DEFAULT }
      }
    }

    function writeAppearance(appearance) {
      try {
        globalThis.localStorage?.setItem(APPEARANCE_KEY, JSON.stringify(appearance))
      } catch {
        /* storage may be unavailable; the controls still work for this view */
      }
    }

    /** Pointer drag for the panel: header grabs, document tracks, edge clamps. */
    function useDrag(panelRef, anchorRef) {
      const [position, setPosition] = React.useState(readPosition)
      const [dragging, setDragging] = React.useState(false)
      const dragRef = React.useRef(null)
      const cleanupRef = React.useRef(null)
      const positionRef = React.useRef(position)
      positionRef.current = position

      /** Move the live node immediately, then let React render the same value. */
      const apply = (left, top) => {
        positionRef.current = { left, top }
        const node = panelRef.current
        if (node !== null) {
          node.style.left = `${left}px`
          node.style.top = `${top}px`
          node.style.bottom = 'auto'
        }
        setPosition({ left, top })
      }

      /** First open without a remembered spot: sit next to the sidebar trigger. */
      React.useEffect(() => {
        if (position !== null) return undefined
        const place = () => {
          const rect = anchorRef?.current?.getBoundingClientRect()
          const width = panelRef.current?.offsetWidth ?? PANEL_WIDTH
          const height = panelRef.current?.offsetHeight ?? 380
          const left = rect ? clamp(rect.right + 10, 8, window.innerWidth - width - 8) : 12
          const top = rect ? clamp(rect.top - Math.min(140, height / 3), 8, window.innerHeight - height - 8) : 96
          setPosition({ left, top })
        }
        const handle = requestAnimationFrame(place)
        return () => cancelAnimationFrame(handle)
      }, [position, panelRef, anchorRef])

      /** Keep the panel on screen when the window shrinks. */
      React.useEffect(() => {
        const onResize = () => {
          setPosition((current) => {
            if (current === null) return current
            const width = panelRef.current?.offsetWidth ?? PANEL_WIDTH
            const height = panelRef.current?.offsetHeight ?? 380
            return {
              left: clamp(current.left, 8, window.innerWidth - width - 8),
              top: clamp(current.top, 8, window.innerHeight - height - 8),
            }
          })
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [panelRef])

      /** Release document listeners if the panel unmounts mid-drag. */
      React.useEffect(() => () => {
        if (cleanupRef.current !== null) cleanupRef.current()
        cleanupRef.current = null
      }, [])

      /**
       * Start a drag.
       *
       * Listeners are attached to `document` synchronously in this handler — not
       * in an effect after a re-render — so a fast pointer never outruns the first
       * move. The node is moved directly as well, so the panel follows the pointer
       * even before React commits the new state.
       */
      const startDrag = (event) => {
        const pointerType = typeof event.pointerType === 'string' ? event.pointerType : 'mouse'
        if (pointerType === 'mouse' && event.button !== 0) return
        const panel = panelRef.current
        if (panel === null) return
        const rect = panel.getBoundingClientRect()
        const start = {
          x: event.clientX,
          y: event.clientY,
          left: rect.left,
          top: rect.top,
          width: panel.offsetWidth || PANEL_WIDTH,
          height: panel.offsetHeight || 380,
        }
        dragRef.current = start
        setDragging(true)
        apply(rect.left, rect.top)
        if (typeof event.preventDefault === 'function') event.preventDefault()
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId)
        } catch {
          /* pointer capture is a convenience; the document listeners still track */
        }

        const move = (moveEvent) => {
          const current = dragRef.current
          if (current === null) return
          const left = clamp(current.left + moveEvent.clientX - current.x, 8, window.innerWidth - current.width - 8)
          const top = clamp(current.top + moveEvent.clientY - current.y, 8, window.innerHeight - current.height - 8)
          apply(left, top)
        }
        const end = () => {
          dragRef.current = null
          setDragging(false)
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerup', end)
          document.removeEventListener('pointercancel', end)
          window.removeEventListener('blur', end)
          if (cleanupRef.current === end) cleanupRef.current = null
          if (positionRef.current !== null) writePosition(positionRef.current)
        }
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', end)
        document.addEventListener('pointercancel', end)
        window.addEventListener('blur', end)
        cleanupRef.current = end
      }

      const reset = () => {
        writePosition(null)
        setPosition(null)
      }

      return { position, dragging, startDrag, reset }
    }
    //#endregion

    /** The gradient tile used by the panel header, sidebar entry and empty state. */
    function LogoMark({ size = 28 }) {
      return h(
        'span',
        {
          style: {
            ...styles.mark,
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: `${Math.max(6, Math.round(size * 0.3))}px`,
          },
          'aria-hidden': true,
        },
        h(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: size * 0.58,
            height: size * 0.58,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', { d: 'M12 4v9' }),
          h('path', { d: 'm8 8 4-4 4 4' }),
          h('path', { d: 'M5 15a7 7 0 0 0 14 0' }),
        ),
      )
    }

    function Section({ title, aside, children }) {
      return h(
        'section',
        { style: styles.section },
        h('div', { style: styles.sectionHead }, h('span', { style: styles.sectionTitle }, title), aside ?? null),
        children,
      )
    }

    function PluginRow({ entry, state, t }) {
      const busy = state.busy[entry.name] === true
      const queued = state.batchTotal > 0 && !busy && state.batchName !== entry.name
      const error = state.rowErrors?.[entry.name]
      const dot = error ? styles.rowDotError : busy ? styles.rowDotBusy : queued ? styles.rowDotQueued : styles.rowDot
      return h(
        'div',
        { className: 'dsh-updater-row', style: { ...styles.row, ...styles.rowUpdate } },
        h('span', { className: busy ? 'dsh-updater-dot-live' : undefined, style: dot, 'aria-hidden': true }),
        h(
          'div',
          { style: styles.rowMain },
          h('div', { style: styles.rowName }, entry.name),
          h(
            'div',
            { style: styles.rowMeta },
            h('span', { style: styles.chip }, entry.installedVersion || '?'),
            h('span', { style: styles.arrow }, '→'),
            h('span', { style: styles.chipAccent }, entry.latestVersion ?? '?'),
          ),
          error ? h('div', { style: styles.rowError }, error) : null,
        ),
        h(
          'div',
          { style: styles.rowActions },
          h(
            'button',
            {
              type: 'button',
              style: styles.rowCta,
              disabled: busy || queued || state.batchTotal > 0,
              onClick: () => updateOne(entry, t),
            },
            busy ? t('updating') : queued ? t('queued') : t('update'),
          ),
          h(
            'button',
            { type: 'button', style: styles.rowLink, disabled: busy || queued || state.batchTotal > 0, onClick: () => ignorePlugin(entry, t) },
            t('ignore'),
          ),
        ),
      )
    }

    /** A muted row for a version the user deliberately pinned. */
    function IgnoredPluginRow({ entry, state, t }) {
      const busy = state.busy[entry.name] === true
      return h(
        'div',
        { className: 'dsh-updater-row', style: { ...styles.row, ...styles.rowIgnored } },
        h('span', { style: styles.rowDotIgnored, 'aria-hidden': true }),
        h(
          'div',
          { style: styles.rowMain },
          h('div', { style: styles.rowName }, entry.name),
          h(
            'div',
            { style: styles.rowMeta },
            h('span', { style: styles.chip }, entry.installedVersion || '?'),
            h('span', { style: styles.arrow }, '→'),
            h('span', { style: styles.chipAccent }, entry.ignoredVersion ?? entry.latestVersion ?? '?'),
            h('span', { style: styles.hint }, t('ignoredRow', { version: entry.ignoredVersion ?? entry.latestVersion ?? '' })),
          ),
        ),
        h(
          'button',
          { type: 'button', style: styles.rowLink, disabled: busy, onClick: () => unignorePlugin(entry, t) },
          busy ? t('updating') : t('unignore'),
        ),
      )
    }

    /** DSH NEXT: running version and the data folder it uses. */
    function NextBlock({ next, t }) {
      const [open, setOpen] = React.useState(false)
      if (next === null || next === undefined) return h('div', { style: styles.muted }, t('nextUnavailable'))
      const data = next.data
      return h(
        'div',
        { style: styles.nextCard },
        h(
          'div',
          { style: styles.nextHead },
          h('span', { style: styles.rowDotOk, 'aria-hidden': true }),
          h(
            'div',
            { style: styles.rowMain },
            h('div', { style: styles.rowName }, 'DSH NEXT'),
            h(
              'div',
              { style: styles.rowMeta },
              h('span', { style: styles.chip }, next.currentVersion ?? '?'),
              h('span', { style: styles.footerDot }, '·'),
              h('span', { style: styles.hint }, `${t('nextData')} ${data?.home ?? ''}`),
            ),
          ),
          h(
            'button',
            { type: 'button', style: styles.ghostSmall, disabled: !data?.canSetHome, onClick: () => setOpen((value) => !value) },
            t('nextMigrate'),
          ),
        ),
        next.status === 'unavailable'
          ? h('div', { style: styles.nextWarning }, next.reason ?? t('nextUnavailable'))
          : null,
        next.status !== 'unavailable' && data !== null && data !== undefined && data.pointerMatchesHome !== true
          ? h('div', { style: styles.nextWarning }, t('nextDataMismatch', { pointer: data.pointer ?? data.defaultHome ?? '?' }))
          : null,
        open ? h(DataHomeDialog, { next, t, onClose: () => setOpen(false) }) : null,
      )
    }

    /** Choose and apply a new DSH NEXT data folder. */
    function DataHomeDialog({ next, t, onClose }) {
      const data = next.data
      const [target, setTarget] = React.useState('')
      const [copy, setCopy] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [browsing, setBrowsing] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [done, setDone] = React.useState(null)

      const browse = async () => {
        setBrowsing(true)
        setError(null)
        try {
          const result = await callHost('chooseDataFolder', {})
          if (result?.ok === false) setError(result.error ?? t('nextPickerFailed'))
          else if (typeof result?.path === 'string' && result.path.length > 0) setTarget(result.path)
        } catch (cause) {
          setError(`${t('nextPickerFailed')}: ${cause instanceof Error ? cause.message : String(cause)}`)
        } finally {
          setBrowsing(false)
        }
      }

      const apply = async () => {
        if (target.trim().length === 0) return
        setBusy(true)
        setError(null)
        try {
          const result = await callHost('migrateDataHome', { target: target.trim(), copy })
          if (result?.ok === false) {
            setError(result.error ?? t('nextFailed'))
            return
          }
          setDone(result)
          store.set({ restartRequired: true })
          await runCheck(true)
        } catch (cause) {
          setError(`${t('nextFailed')}: ${cause instanceof Error ? cause.message : String(cause)}`)
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { style: styles.dataDialog },
        h(
          'div',
          { style: styles.dataDialogHead },
          h(
            'div',
            { style: styles.rowMain },
            h('div', { style: styles.rowName }, t('nextMigrateTitle')),
            h('div', { style: styles.dataNote }, t('nextMigrateBody')),
          ),
          h('button', { type: 'button', style: styles.appearanceClose, title: t('nextCancel'), 'aria-label': t('nextCancel'), disabled: busy || browsing, onClick: onClose }, '×'),
        ),
        h(
          'div',
          { style: styles.dataField },
          h('span', { style: styles.dataLabel }, t('nextSource')),
          h('span', { style: styles.dataPath }, data?.home ?? '?'),
        ),
        h(
          'div',
          { style: styles.dataField },
          h('label', { style: styles.dataLabel, htmlFor: 'dsh-updater-data-target' }, t('nextTarget')),
          h(
            'div',
            { style: styles.dataInputRow },
            h('input', {
              id: 'dsh-updater-data-target',
              type: 'text',
              value: target,
              placeholder: 'D:\\DSH-Next',
              style: styles.dataInput,
              disabled: busy || done !== null,
              onChange: (event) => setTarget(event.target.value),
            }),
            h(
              'button',
              { type: 'button', style: styles.ghostSmall, disabled: busy || browsing || done !== null, onClick: browse },
              browsing ? t('nextBrowsing') : t('nextBrowse'),
            ),
          ),
        ),
        h(
          'label',
          { style: styles.dataCheckboxRow },
          h('input', {
            type: 'checkbox',
            checked: copy,
            disabled: busy || done !== null,
            onChange: (event) => setCopy(event.target.checked),
          }),
          h('span', null, t('nextCopy')),
        ),
        h('div', { style: styles.dataNote }, copy ? t('nextCopyHint') : t('nextPointerHint')),
        error === null ? null : h('div', { style: styles.rowError }, error),
        done === null
          ? null
          : h('div', { style: styles.nextDone }, t('nextDone', { home: done.home ?? target })),
        h(
          'div',
          { style: styles.dataActions },
          h('button', { type: 'button', style: styles.appearanceGhost, disabled: busy || browsing, onClick: onClose }, t('nextCancel')),
          done === null
            ? h(
                'button',
                { type: 'button', style: styles.primarySmall, disabled: busy || target.trim().length === 0, onClick: apply },
                busy ? t('nextApplying') : t('nextApply'),
              )
            : h('button', { type: 'button', style: styles.primarySmall, onClick: onClose }, t('done')),
        ),
      )
    }

    function EngineBlock({ engine, t }) {
      if (engine === null || engine === undefined) return null
      const updating = engine.status === 'update'
      return h(
        'div',
        { style: styles.row },
        h('span', { style: updating ? styles.rowDot : styles.rowDotOk, 'aria-hidden': true }),
        h(
          'div',
          { style: styles.rowMain },
          h('div', { style: styles.rowName }, t('engineTitle')),
          h(
            'div',
            { style: styles.rowMeta },
            h('span', { style: styles.chip }, engine.currentVersion ?? '?'),
            updating ? h('span', { style: styles.arrow }, '→') : null,
            updating ? h('span', { style: styles.chipAccent }, engine.latestVersion ?? '?') : null,
            h('span', { style: styles.hint }, t('engineBundled')),
          ),
        ),
        updating ? null : h('span', { style: styles.rowCheck, 'aria-hidden': true }, '✓'),
      )
    }

    /** The panel-properties popover opened by the three-dot header button. */
    function AppearanceMenu({ t, appearance, onChange, onReset, onResetPosition, onClose }) {
      const tr = makeT(t)
      const range = (key, label, limits) =>
        h(
          'div',
          { style: styles.appearanceGroup },
          h(
            'div',
            { style: styles.appearanceLabelRow },
            h('span', { style: styles.appearanceLabel }, label),
            h('span', { style: styles.appearanceValue }, `${appearance[key]}px`),
          ),
          h('input', {
            type: 'range',
            min: limits.min,
            max: limits.max,
            step: limits.step,
            value: appearance[key],
            'aria-label': label,
            style: styles.appearanceRange,
            onChange: (event) => onChange({ [key]: Number(event.target.value) }),
          }),
        )

      return h(
        'div',
        {
          className: 'dsh-updater-appearance',
          style: styles.appearanceMenu,
          role: 'dialog',
          'aria-label': tr('appearance'),
          onPointerDown: (event) => event.stopPropagation(),
          onDoubleClick: (event) => event.stopPropagation(),
        },
        h(
          'div',
          { style: styles.appearanceHead },
          h(
            'div',
            { style: styles.appearanceTitle },
            h('strong', { style: styles.appearanceTitleStrong }, tr('appearance')),
            h('span', { style: styles.appearanceHint }, tr('appearanceHint')),
          ),
          h(
            'button',
            { type: 'button', style: styles.appearanceClose, title: tr('done'), 'aria-label': tr('done'), onClick: onClose },
            '×',
          ),
        ),
        range('width', tr('panelWidth'), APPEARANCE_LIMITS.width),
        range('height', tr('panelHeight'), APPEARANCE_LIMITS.height),
        h(
          'div',
          { style: styles.appearanceGroup },
          h(
            'div',
            { style: styles.appearanceLabelRow },
            h('span', { style: styles.appearanceLabel }, tr('accentColor')),
            h('span', { style: styles.appearanceValue }, appearance.accent.toUpperCase()),
          ),
          h(
            'div',
            { style: styles.swatches },
            PANEL_ACCENTS.map((preset) =>
              h(
                'button',
                {
                  key: preset.id,
                  type: 'button',
                  style: {
                    ...styles.swatch,
                    background: `linear-gradient(135deg, ${preset.accent}, ${preset.accent2})`,
                    ...(appearance.accent === preset.accent ? styles.swatchSelected : null),
                  },
                  title: preset.id,
                  'aria-label': preset.id,
                  'aria-pressed': appearance.accent === preset.accent,
                  onClick: () => onChange({ accent: preset.accent, accent2: preset.accent2 }),
                },
              ),
            ),
            h(
              'label',
              {
                style: {
                  ...styles.swatch,
                  position: 'relative',
                  overflow: 'hidden',
                  background: 'conic-gradient(from 210deg, #ff6b9a, #f5b544, #3ecf8e, #46c7f5, #6b8cff, #c86bff, #ff6b9a)',
                },
                title: tr('customColor'),
              },
              h('input', {
                type: 'color',
                value: appearance.accent,
                'aria-label': tr('customColor'),
                style: { position: 'absolute', inset: 0, width: '100%', height: '100%', padding: 0, border: 'none', opacity: 0, cursor: 'pointer' },
                onChange: (event) => onChange({ accent: event.target.value, accent2: event.target.value }),
              }),
            ),
          ),
        ),
        h(
          'div',
          { style: styles.appearanceGroup },
          h('div', { style: styles.appearanceLabelRow }, h('span', { style: styles.appearanceLabel }, tr('surfaceColor'))),
          h(
            'div',
            { style: styles.surfaceGrid },
            Object.entries(PANEL_SURFACES).map(([id, surface]) =>
              h(
                'button',
                {
                  key: id,
                  type: 'button',
                  style: { ...styles.surfaceChip, ...(appearance.surface === id ? styles.surfaceChipSelected : null) },
                  'aria-pressed': appearance.surface === id,
                  onClick: () => onChange({ surface: id }),
                },
                h('span', { style: { ...styles.surfaceDot, background: `linear-gradient(135deg, ${surface.head}, ${surface.bg})` } }),
                tr(`surface${id.charAt(0).toUpperCase()}${id.slice(1)}`),
              ),
            ),
          ),
        ),
        h(
          'div',
          { style: styles.appearanceGroup },
          h(
            'div',
            { style: styles.appearanceLabelRow },
            h('span', { style: styles.appearanceLabel }, tr('opacity')),
            h('span', { style: styles.appearanceValue }, `${Math.round(appearance.opacity * 100)}%`),
          ),
          h('input', {
            type: 'range',
            min: Math.round(APPEARANCE_LIMITS.opacity.min * 100),
            max: 100,
            step: Math.round(APPEARANCE_LIMITS.opacity.step * 100),
            value: Math.round(appearance.opacity * 100),
            'aria-label': tr('opacity'),
            style: styles.appearanceRange,
            onChange: (event) => onChange({ opacity: Number(event.target.value) / 100 }),
          }),
        ),
        h(
          'div',
          { style: styles.appearanceFooter },
          h('button', { type: 'button', style: styles.appearanceGhost, onClick: onReset }, tr('resetAppearance')),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
            h('button', { type: 'button', style: styles.appearanceGhost, onClick: onResetPosition }, tr('resetPosition')),
            h('button', { type: 'button', style: styles.appearanceDone, onClick: onClose }, tr('done')),
          ),
        ),
      )
    }

    /** The draggable updater panel. */
    function UpdaterPanel({ t, anchorRef, onClose }) {
      const tr = makeT(t)
      const state = useUpdaterState()
      const panelRef = React.useRef(null)
      const { position, dragging, startDrag, reset } = useDrag(panelRef, anchorRef ?? null)
      const [appearance, setAppearance] = React.useState(readAppearance)
      const [menuOpen, setMenuOpen] = React.useState(false)
      const report = state.report
      const pluginUpdates = updateEntries(report)
      const bypassed = (report?.packages ?? []).filter((entry) => entry.name !== PACKAGE && entryState(entry) === 'bypassed')
      const ignoredEntries = (report?.packages ?? []).filter((entry) => entry.name !== PACKAGE && entry.status === 'ignored')
      const busyAny = Object.keys(state.busy).length > 0 || state.batchTotal > 0
      const checking = state.status === 'checking'
      const updating = state.updateRequestId !== null || state.batchTotal > 0
      const fraction = progressFraction(state)
      const stageLabel =
        state.updateStage === 'installing' ? tr('stageInstalling') : state.updateStage === 'done' ? tr('stageRechecking') : tr('stageRemoving')
      const progressLabel =
        state.batchTotal > 0
          ? tr('batchProgress', {
              name: state.batchName ?? '',
              done: Math.min(state.batchDone + 1, state.batchTotal),
              total: state.batchTotal,
            })
          : `${state.updateName ?? ''} · ${stageLabel}`

      const surface = PANEL_SURFACES[appearance.surface] ?? PANEL_SURFACES.navy
      const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight
      const requestedHeight = Math.min(appearance.height, Math.max(0, viewportHeight - 16))
      // A taller panel must grow upward, not get clipped by its old top edge.
      const effectiveTop = position === null || viewportHeight === 0
        ? null
        : Math.max(8, Math.min(position.top, viewportHeight - requestedHeight - 8))
      const panelStyle = {
        ...styles.panel,
        ...(position === null ? { left: '12px', bottom: '96px' } : { left: `${position.left}px`, top: `${effectiveTop}px` }),
        width: position === null
          ? `min(${appearance.width}px, calc(100vw - 24px))`
          : `min(${appearance.width}px, calc(100vw - ${Math.max(12, position.left)}px - 8px))`,
        height: position === null
          ? `min(${appearance.height}px, calc(100vh - 120px))`
          : `min(${appearance.height}px, calc(100vh - ${effectiveTop}px - 8px))`,
        maxHeight: '100vh',
        opacity: appearance.opacity,
        '--upd-bg': surface.bg,
        '--upd-head': surface.head,
        '--upd-row': surface.row,
        '--upd-row-hover': surface.rowHover,
        '--upd-border': surface.border,
        '--upd-border-strong': surface.borderStrong,
        '--upd-accent': appearance.accent,
        '--upd-accent-2': appearance.accent2,
        '--upd-glow': hexToRgba(appearance.accent, 0.16),
        '--upd-shadow': hexToRgba(appearance.accent, 0.35),
        '--upd-shadow-ring': hexToRgba(appearance.accent, 0.18),
        '--upd-shadow-soft': hexToRgba(appearance.accent, 0.25),
      }

      const changeAppearance = (patch) => {
        setAppearance((current) => {
          const next = sanitizeAppearance({ ...current, ...patch })
          writeAppearance(next)
          return next
        })
      }
      const resetAppearance = () => {
        const next = { ...APPEARANCE_DEFAULT }
        writeAppearance(next)
        setAppearance(next)
      }

      /** Escape closes the popover first, then the panel; the sidebar stays as the way back in. */
      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          if (menuOpen) setMenuOpen(false)
          else onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [onClose, menuOpen])

      const aside = h(
        'div',
        { style: styles.sectionActions },
        pluginUpdates.length > 0
          ? h('span', { style: styles.countPill }, tr('pluginUpdates', { count: pluginUpdates.length }))
          : h('span', { style: styles.okPill }, tr('allCurrent')),
        pluginUpdates.length > 1
          ? h(
              'button',
              {
                type: 'button',
                style: styles.primarySmall,
                disabled: checking || busyAny,
                onClick: () => updateMany(pluginUpdates, tr),
              },
              tr('updateAllCount', { count: pluginUpdates.length }),
            )
          : null,
      )

      return h(
        'div',
        { className: 'dsh-updater-panel', ref: panelRef, style: panelStyle, role: 'dialog', 'aria-label': tr('title') },
        h('style', null, `
          .dsh-updater-panel * { box-sizing: border-box; }
          .dsh-updater-panel .dsh-updater-row:hover { background: var(--upd-row-hover, #232a39); }
          .dsh-updater-panel .dsh-updater-close:hover,
          .dsh-updater-panel .dsh-updater-menu-button:hover { background: var(--upd-row-hover, #232a39); color: var(--upd-text, #eef2f9); }
          .dsh-updater-panel button:hover:not(:disabled) { filter: brightness(1.04); }
          .dsh-updater-panel button:disabled { cursor: default; opacity: .55; }
          .dsh-updater-panel button:focus-visible { outline: 2px solid var(--upd-accent, #6b8cff); outline-offset: 1px; }
          .dsh-updater-spin { animation: dsh-updater-spin .9s linear infinite; }
          @keyframes dsh-updater-spin { to { transform: rotate(360deg); } }
          .dsh-updater-progress-fill { position: relative; overflow: hidden; }
          .dsh-updater-progress-fill::after {
            content: "";
            position: absolute;
            inset: 0;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .35), transparent);
            transform: translateX(-100%);
            animation: dsh-updater-shimmer 2.2s ease-in-out infinite;
          }
          @keyframes dsh-updater-shimmer { to { transform: translateX(100%); } }
          .dsh-updater-dot-live { animation: dsh-updater-pulse 1.6s ease-in-out infinite; }
          @keyframes dsh-updater-pulse { 50% { opacity: .45; } }
          @media (prefers-reduced-motion: reduce) {
            .dsh-updater-progress-fill::after,
            .dsh-updater-dot-live,
            .dsh-updater-spin { animation: none; }
          }
          .dsh-updater-panel ::-webkit-scrollbar { width: 8px; height: 8px; }
          .dsh-updater-panel ::-webkit-scrollbar-thumb { background: var(--upd-border-strong, #3a4356); border-radius: 8px; }
        `),
        h(
          'header',
          {
            style: { ...styles.header, cursor: dragging ? 'grabbing' : 'grab' },
            onPointerDown: startDrag,
            onDoubleClick: reset,
            title: tr('dragHint'),
          },
          h(LogoMark, { size: 28 }),
          h(
            'div',
            { style: styles.titleBlock },
            h(
              'div',
              { style: styles.titleRow },
              h('strong', { style: styles.title }, tr('title')),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-updater-menu-button',
              style: { ...styles.menuButton, ...(menuOpen ? styles.menuButtonOpen : null) },
              title: tr('appearance'),
              'aria-label': tr('appearance'),
              'aria-haspopup': 'dialog',
              'aria-expanded': menuOpen,
              onPointerDown: (event) => event.stopPropagation(),
              onDoubleClick: (event) => event.stopPropagation(),
              onClick: (event) => {
                event.stopPropagation()
                setMenuOpen((current) => !current)
              },
            },
            '•••',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-updater-close',
              style: styles.close,
              title: tr('close'),
              'aria-label': tr('close'),
              onPointerDown: (event) => event.stopPropagation(),
              onClick: (event) => {
                event.stopPropagation()
                onClose()
              },
            },
            '×',
          ),
        ),
        // Sticky settings: outside clicks must not drop the user back to the main panel.
        menuOpen ? h('div', { style: styles.appearanceBackdrop, 'aria-hidden': true }) : null,
        menuOpen
          ? h(AppearanceMenu, {
              t: tr,
              appearance,
              onChange: changeAppearance,
              onReset: resetAppearance,
              onResetPosition: reset,
              onClose: () => setMenuOpen(false),
            })
          : null,
        updating
          ? h(
              'div',
              {
                key: 'progress',
                style: styles.progressBlock,
                role: 'progressbar',
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                'aria-valuenow': Math.round(fraction * 100),
                'aria-label': progressLabel,
              },
              h(
                'div',
                { style: styles.progressHead },
                h('span', { style: styles.progressLabel }, progressLabel),
                h('span', { style: styles.progressPercent }, `${Math.round(fraction * 100)}%`),
              ),
              h(
                'div',
                { style: styles.progressTrack },
                h('div', { className: 'dsh-updater-progress-fill', style: { ...styles.progressFill, width: `${Math.max(4, Math.round(fraction * 100))}%` } }),
              ),
              state.updateLog ? h('div', { style: styles.progressLog }, state.updateLog) : null,
            )
          : null,
        h(
          'div',
          { style: styles.content },
          state.status === 'failed'
            ? h('div', { key: 'check-error', style: styles.statusBanner }, `${tr('failed')}: ${state.error ?? ''}`)
            : null,
          state.message === null ? null : h('div', { key: 'message', style: styles.statusBanner }, state.message),          state.restartRequired
            ? h('div', { key: 'restart', style: styles.restartBanner }, h('span', { style: styles.restartText }, tr('restartHint')))
            : null,
          report === null
            ? h(
                'div',
                { style: styles.empty },
                checking ? h('span', { className: 'dsh-updater-spin', style: styles.spinner, 'aria-hidden': true }) : h(LogoMark, { size: 36 }),
                h('span', { style: styles.muted }, state.status === 'failed' ? `${tr('failed')}: ${state.error ?? ''}` : tr('checking')),
                state.status === 'failed'
                  ? h('button', { type: 'button', style: styles.primarySmall, onClick: () => runCheck(true) }, tr('retry'))
                  : null,
              )
            : [
                h(
                  Section,
                  { key: 'plugins', title: tr('pluginsTitle'), aside },
                  pluginUpdates.length === 0
                    ? null
                    : pluginUpdates.map((entry) => h(PluginRow, { key: entry.name, entry, state, t: tr })),
                  bypassed.length === 0 ? null : h('div', { style: styles.hint }, tr('bypassed', { count: bypassed.length })),
                ),
                ignoredEntries.length === 0
                  ? null
                  : h(
                      Section,
                      { key: 'ignored', title: tr('ignoredTitle') },
                      ignoredEntries.map((entry) => h(IgnoredPluginRow, { key: entry.name, entry, state, t: tr })),
                    ),
                h(
                  Section,
                  { key: 'next', title: tr('nextTitle') },
                  h(NextBlock, { next: report.next, t: tr }),
                ),
                report.engine === null || report.engine === undefined
                  ? null
                  : h(Section, { key: 'engine', title: tr('engineTitle') }, h(EngineBlock, { engine: report.engine, t: tr })),
                report.compat?.degraded === true ? h('div', { key: 'degraded', style: styles.hint }, tr('degraded')) : null,
              ],
        ),
        h(
          'footer',
          { style: styles.footer },
          h(
            'span',
            { style: styles.footerMeta },
            h('span', { style: styles.footerStatusDot, 'aria-hidden': true }),
            report === null ? '' : tr('lastChecked', { time: new Date(report.checkedAt).toLocaleTimeString() }),
          ),
          h(
            'div',
            { style: styles.footerActions },
            h(
              'button',
              { type: 'button', style: styles.footerLink, disabled: checking || busyAny, onClick: () => runCheck(true) },
              checking ? tr('checking') : tr('checkNow'),
            ),
          ),
        ),
      )
    }

    /** The sidebar entry: always present, carries the count, opens the panel. */
    function SidebarEntry({ wide, t }) {
      const tr = makeT(t)
      const state = useUpdaterState()
      const buttonRef = React.useRef(null)
      const count = totalUpdates(state.report)
      const open = state.open
      const marker = count > 0 ? 'count' : state.status === 'ready' ? 'none' : state.status === 'failed' ? 'error' : 'pending'
      return h(
        'div',
        { style: styles.sidebarLayer },
        open
          ? h(UpdaterPanel, {
              t,
              anchorRef: buttonRef,
              onClose: () => store.set({ open: false }),
            })
          : null,
        h(
          'button',
          {
            ref: buttonRef,
            type: 'button',
            style: wide ? styles.sidebarButton : styles.sidebarButtonRail,
            title: tr('open'),
            'aria-label': tr('open'),
            'aria-expanded': open,
            onClick: () => {
              store.set({ open: !open })
              if (!open) runCheck(false)
            },
          },
          h(LogoMark, { size: 18 }),
          wide ? h('span', { style: styles.sidebarLabel }, tr('open')) : null,
          marker === 'count' ? h('span', { style: styles.badge }, String(count)) : null,
          marker === 'pending' ? h('span', { style: styles.badgePending }, '·') : null,
          marker === 'error' ? h('span', { style: styles.badgeError }, '!') : null,
        ),
      )
    }

    /** The same check from this plugin's card in the Plugins page. */
    function PluginCardAction({ t, subject }) {
      const tr = makeT(t)
      const state = useUpdaterState()
      if (subject?.kind !== 'bundle' || subject.pkg?.name !== PACKAGE) return null
      const count = totalUpdates(state.report)
      return h(
        'div',
        { style: styles.sidebarLayer },
        h(
          'button',
          { type: 'button', style: styles.ghostSmall, disabled: state.status === 'checking', onClick: () => runCheck(true) },
          state.status === 'checking' ? tr('checking') : tr('checkNow'),
        ),
        h(
          'button',
          { type: 'button', style: styles.ghostSmall, onClick: () => store.set({ open: true }) },
          count === 0 ? tr('upToDate') : tr('available', { count }),
        ),
      )
    }

    const buttonBase = { font: 'inherit', cursor: 'pointer', borderRadius: '8px', border: '1px solid transparent' }
    /**
     * The panel is a fixed dark-navy surface like the interface preview. It
     * deliberately does not follow a light DSH theme: `bg-overlay` is a scrim
     * token and turns the panel pale gray on light profiles.
     */
    const PANEL_PALETTE = {
      bg: 'var(--upd-bg, #151923)',
      head: 'var(--upd-head, #1a1f2b)',
      row: 'var(--upd-row, #1e2431)',
      rowHover: 'var(--upd-row-hover, #232a39)',
      border: 'var(--upd-border, #2a3140)',
      borderStrong: 'var(--upd-border-strong, #3a4356)',
      text: 'var(--upd-text, #eef2f9)',
      muted: 'var(--upd-muted, #98a3b6)',
      faint: 'var(--upd-faint, #7d879a)',
      brand: 'var(--upd-accent, #6b8cff)',
      accent: 'var(--upd-accent-2, #8f6bff)',
      green: '#3ecf8e',
      amber: '#f5b544',
      red: '#ff6b6b',
    }
    const styles = {
      panel: {
        position: 'fixed',
        width: `min(${PANEL_WIDTH}px, calc(100vw - 24px))`,
        maxHeight: `min(72vh, ${PANEL_MAX_HEIGHT}px)`,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
        background: PANEL_PALETTE.bg,
        backgroundImage: 'radial-gradient(120% 80% at 100% 0%, var(--upd-glow, rgba(107, 140, 255, 0.14)), transparent 62%)',
        color: PANEL_PALETTE.text,
        border: `1px solid ${PANEL_PALETTE.border}`,
        borderRadius: '16px',
        boxShadow: '0 28px 80px rgba(0, 0, 0, 0.38), 0 2px 10px rgba(0, 0, 0, 0.16)',
        font: 'inherit',
        fontSize: '13px',
        overflow: 'hidden',
        zIndex: 60,
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '13px 14px',
        borderBottom: `1px solid ${PANEL_PALETTE.border}`,
        background: PANEL_PALETTE.head,
        touchAction: 'none',
        userSelect: 'none',
      },
      menuButton: {
        ...buttonBase,
        width: '26px',
        height: '24px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        background: 'transparent',
        color: PANEL_PALETTE.muted,
        fontSize: '12px',
        letterSpacing: '1.5px',
        lineHeight: 1,
        flex: 'none',
      },
      menuButtonOpen: { background: PANEL_PALETTE.row, color: PANEL_PALETTE.text },
      appearanceBackdrop: {
        position: 'absolute',
        inset: '54px 0 0',
        background: 'rgba(4, 6, 10, 0.58)',
        zIndex: 4,
      },
      appearanceMenu: {
        position: 'absolute',
        top: '54px',
        right: '10px',
        bottom: '10px',
        width: 'calc(100% - 20px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '11px',
        padding: '12px',
        background: PANEL_PALETTE.head,
        border: `1px solid ${PANEL_PALETTE.borderStrong}`,
        borderRadius: '12px',
        boxShadow: '0 18px 50px rgba(0, 0, 0, 0.5)',
        zIndex: 5,
      },
      appearanceHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' },
      appearanceTitle: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
      appearanceTitleStrong: { fontSize: '12.5px', fontWeight: 700, color: PANEL_PALETTE.text },
      appearanceHint: { fontSize: '10px', color: PANEL_PALETTE.muted },
      appearanceClose: {
        ...buttonBase,
        width: '20px',
        height: '20px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        background: 'transparent',
        color: PANEL_PALETTE.muted,
        fontSize: '14px',
        lineHeight: 1,
      },
      appearanceGroup: { display: 'flex', flexDirection: 'column', gap: '5px' },
      appearanceLabelRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
      appearanceLabel: { fontSize: '10.5px', color: PANEL_PALETTE.muted, fontWeight: 600 },
      appearanceValue: { fontSize: '10.5px', color: PANEL_PALETTE.text, fontVariantNumeric: 'tabular-nums' },
      appearanceRange: { width: '100%', accentColor: PANEL_PALETTE.brand, cursor: 'pointer', margin: '1px 0' },
      swatches: { display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' },
      swatch: {
        ...buttonBase,
        width: '22px',
        height: '22px',
        padding: 0,
        borderRadius: '999px',
        border: '2px solid transparent',
        cursor: 'pointer',
        flex: 'none',
      },
      swatchSelected: { boxShadow: `0 0 0 2px ${PANEL_PALETTE.head}, 0 0 0 4px ${PANEL_PALETTE.text}` },
      surfaceGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px' },
      surfaceChip: {
        ...buttonBase,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 7px',
        borderRadius: '8px',
        border: `1px solid ${PANEL_PALETTE.border}`,
        background: PANEL_PALETTE.row,
        color: PANEL_PALETTE.text,
        fontSize: '10.5px',
        textAlign: 'left',
        cursor: 'pointer',
      },
      surfaceChipSelected: { borderColor: PANEL_PALETTE.brand, boxShadow: `inset 0 0 0 1px ${PANEL_PALETTE.brand}` },
      surfaceDot: { width: '12px', height: '12px', borderRadius: '4px', border: '1px solid rgba(255, 255, 255, 0.14)', flex: 'none' },
      appearanceFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', paddingTop: '2px', marginTop: 'auto', flexWrap: 'wrap' },
      appearanceGhost: {
        ...buttonBase,
        padding: '5px 8px',
        fontSize: '10.5px',
        background: 'transparent',
        borderColor: 'transparent',
        color: PANEL_PALETTE.muted,
      },
      appearanceDone: {
        ...buttonBase,
        padding: '5px 10px',
        fontSize: '10.5px',
        fontWeight: 600,
        borderRadius: '7px',
        background: `linear-gradient(135deg, ${PANEL_PALETTE.brand}, ${PANEL_PALETTE.accent})`,
        borderColor: 'transparent',
        color: '#fff',
      },
      titleBlock: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, flex: 1 },
      titleRow: { display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 },
      mark: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        borderRadius: '8px',
        background: `linear-gradient(135deg, ${PANEL_PALETTE.brand}, ${PANEL_PALETTE.accent})`,
        color: '#fff',
        fontSize: '13px',
        lineHeight: 1,
        flex: 'none',
        boxShadow: '0 6px 16px var(--upd-shadow, rgba(107, 140, 255, 0.35))',
      },
      title: { fontSize: '13.5px', fontWeight: 650, whiteSpace: 'nowrap', color: PANEL_PALETTE.text },
      close: {
        ...buttonBase,
        width: '24px',
        height: '24px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        color: PANEL_PALETTE.muted,
        fontSize: '17px',
        lineHeight: 1,
        padding: 0,
        flex: 'none',
      },
      content: { display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1, minHeight: 0 },
      section: {
        display: 'flex',
        flexDirection: 'column',
        gap: '7px',
        padding: '12px 14px 9px',
        borderBottom: `1px solid ${PANEL_PALETTE.border}`,
      },
      sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
      sectionActions: { display: 'flex', alignItems: 'center', gap: '6px' },
      sectionTitle: {
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: PANEL_PALETTE.muted,
      },
      countPill: {
        fontSize: '10px',
        lineHeight: '16px',
        padding: '0 6px',
        borderRadius: '999px',
        background: 'rgba(245, 181, 68, 0.16)',
        border: '1px solid rgba(245, 181, 68, 0.3)',
        color: PANEL_PALETTE.amber,
      },
      okPill: {
        fontSize: '10px',
        lineHeight: '16px',
        padding: '0 6px',
        borderRadius: '999px',
        background: PANEL_PALETTE.row,
        border: `1px solid ${PANEL_PALETTE.border}`,
        color: PANEL_PALETTE.muted,
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        padding: '9px 10px',
        margin: '0',
        borderRadius: '10px',
      },
      rowUpdate: {
        background: PANEL_PALETTE.row,
        border: `1px solid ${PANEL_PALETTE.border}`,
      },
      rowIgnored: {
        background: 'transparent',
        border: `1px dashed ${PANEL_PALETTE.border}`,
        opacity: 0.82,
      },
      rowActions: { display: 'flex', alignItems: 'center', gap: '6px', flex: 'none' },
      rowLink: {
        ...buttonBase,
        padding: '4px 6px',
        fontSize: '10px',
        background: 'transparent',
        borderColor: 'transparent',
        color: PANEL_PALETTE.muted,
      },
      nextCard: {
        display: 'flex',
        flexDirection: 'column',
        gap: '7px',
        padding: '10px',
        borderRadius: '10px',
        background: PANEL_PALETTE.row,
        border: `1px solid ${PANEL_PALETTE.border}`,
      },
      nextHead: { display: 'flex', alignItems: 'center', gap: '10px' },
      nextWarning: {
        fontSize: '10.5px',
        color: PANEL_PALETTE.amber,
        lineHeight: 1.5,
        wordBreak: 'break-word',
        padding: '6px 8px',
        borderRadius: '8px',
        background: 'rgba(245, 181, 68, 0.08)',
        border: '1px solid rgba(245, 181, 68, 0.3)',
      },
      dataDialog: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px',
        borderRadius: '10px',
        background: PANEL_PALETTE.head,
        border: `1px solid ${PANEL_PALETTE.border}`,
      },
      dataDialogHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' },
      dataField: { display: 'flex', flexDirection: 'column', gap: '4px' },
      dataLabel: { fontSize: '10.5px', color: PANEL_PALETTE.muted, fontWeight: 600 },
      dataNote: { fontSize: '10.5px', color: PANEL_PALETTE.faint, lineHeight: 1.5, wordBreak: 'break-word' },
      dataPath: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '10.5px',
        color: PANEL_PALETTE.text,
        lineHeight: 1.45,
        wordBreak: 'break-all',
      },
      dataInputRow: { display: 'flex', alignItems: 'center', gap: '6px' },
      dataInput: {
        flex: 1,
        minWidth: 0,
        font: 'inherit',
        fontSize: '11px',
        padding: '6px 8px',
        borderRadius: '7px',
        border: `1px solid ${PANEL_PALETTE.border}`,
        background: PANEL_PALETTE.row,
        color: PANEL_PALETTE.text,
      },
      dataCheckboxRow: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '10.5px', color: PANEL_PALETTE.text, cursor: 'pointer' },
      nextDone: { fontSize: '10.5px', color: PANEL_PALETTE.green, lineHeight: 1.5, wordBreak: 'break-word' },
      dataActions: { display: 'flex', justifyContent: 'flex-end', gap: '6px', paddingTop: '2px' },
      rowDot: {
        width: '7px',
        height: '7px',
        borderRadius: '999px',
        flex: 'none',
        background: PANEL_PALETTE.amber,
        boxShadow: '0 0 0 3px rgba(245, 181, 68, 0.18)',
      },
      rowDotBusy: {
        width: '7px',
        height: '7px',
        borderRadius: '999px',
        flex: 'none',
        background: PANEL_PALETTE.brand,
        boxShadow: '0 0 0 3px var(--upd-shadow-ring, rgba(107, 140, 255, 0.18))',
      },
      rowDotQueued: {
        width: '7px',
        height: '7px',
        borderRadius: '999px',
        flex: 'none',
        background: PANEL_PALETTE.muted,
        opacity: 0.45,
      },
      rowDotOk: {
        width: '7px',
        height: '7px',
        borderRadius: '999px',
        flex: 'none',
        background: PANEL_PALETTE.green,
        boxShadow: '0 0 0 3px rgba(62, 207, 142, 0.16)',
      },
      rowDotError: {
        width: '7px',
        height: '7px',
        borderRadius: '999px',
        flex: 'none',
        background: PANEL_PALETTE.red,
        boxShadow: '0 0 0 3px rgba(255, 107, 107, 0.16)',
      },
      rowDotIgnored: {
        width: '7px',
        height: '7px',
        borderRadius: '999px',
        flex: 'none',
        background: PANEL_PALETTE.faint,
        opacity: 0.5,
      },
      rowCheck: { flex: 'none', color: PANEL_PALETTE.green, fontSize: '12px', fontWeight: 700 },
      rowMain: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: 1 },
      rowName: {
        fontSize: '13px',
        fontWeight: 550,
        color: PANEL_PALETTE.text,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      rowMeta: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '10.5px', color: PANEL_PALETTE.muted },
      rowError: { fontSize: '11px', color: PANEL_PALETTE.red, wordBreak: 'break-word', lineHeight: 1.45 },
      chip: {
        padding: 0,
        border: 'none',
        background: 'transparent',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '10.5px',
        lineHeight: '16px',
        color: PANEL_PALETTE.muted,
      },
      chipAccent: {
        padding: 0,
        border: 'none',
        background: 'transparent',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '10.5px',
        lineHeight: '16px',
        color: PANEL_PALETTE.brand,
        fontWeight: 600,
      },
      okDot: { color: PANEL_PALETTE.green, fontWeight: 700 },
      arrow: { color: PANEL_PALETTE.muted, fontSize: '10px' },
      hint: { fontSize: '10.5px', color: PANEL_PALETTE.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      muted: { fontSize: '12px', color: PANEL_PALETTE.muted, wordBreak: 'break-word', lineHeight: 1.5 },
      message: {
        margin: '0 12px 10px',
        padding: '7px 9px',
        borderRadius: '8px',
        background: PANEL_PALETTE.row,
        color: PANEL_PALETTE.muted,
        fontSize: '11px',
        lineHeight: 1.5,
      },
      statusBanner: {
        padding: '9px 14px',
        borderBottom: `1px solid ${PANEL_PALETTE.border}`,
        background: PANEL_PALETTE.head,
        color: PANEL_PALETTE.muted,
        fontSize: '11.5px',
        lineHeight: 1.5,
        wordBreak: 'break-word',
      },
      restartBanner: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '10px 14px',
        borderBottom: `1px solid ${PANEL_PALETTE.border}`,
        borderLeft: `3px solid ${PANEL_PALETTE.amber}`,
        background: 'rgba(245, 181, 68, 0.1)',
        color: PANEL_PALETTE.text,
        fontSize: '11.5px',
        lineHeight: 1.5,
      },
      restartText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      progressBlock: {
        display: 'flex',
        flexDirection: 'column',
        gap: '7px',
        padding: '12px 14px 11px',
        borderBottom: `1px solid ${PANEL_PALETTE.border}`,
        background: PANEL_PALETTE.head,
      },
      progressHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
      progressLabel: {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '12px',
        color: PANEL_PALETTE.text,
      },
      progressPercent: {
        flex: 'none',
        fontSize: '11px',
        color: PANEL_PALETTE.muted,
        fontVariantNumeric: 'tabular-nums',
      },
      progressTrack: { height: '6px', borderRadius: '999px', background: 'var(--upd-border, #252c3a)', overflow: 'hidden' },
      progressFill: {
        height: '100%',
        borderRadius: '999px',
        background: `linear-gradient(90deg, ${PANEL_PALETTE.brand}, ${PANEL_PALETTE.accent})`,
        transition: 'width .25s ease',
      },
      progressLog: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '10.5px',
        color: PANEL_PALETTE.muted,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '26px 16px', textAlign: 'center' },
      emptyIcon: { fontSize: '20px', color: PANEL_PALETTE.muted },
      spinner: {
        width: '16px',
        height: '16px',
        borderRadius: '999px',
        border: '2px solid var(--upd-border-strong, #323b4d)',
        borderTopColor: PANEL_PALETTE.brand,
        display: 'inline-block',
      },
      footer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '10px 14px',
        borderTop: `1px solid ${PANEL_PALETTE.border}`,
        background: PANEL_PALETTE.head,
      },
      footerMeta: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', color: PANEL_PALETTE.muted, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      footerStatusDot: {
        width: '5px',
        height: '5px',
        borderRadius: '999px',
        flex: 'none',
        background: PANEL_PALETTE.green,
        boxShadow: '0 0 0 3px rgba(62, 207, 142, 0.14)',
      },
      footerDot: { opacity: 0.6 },
      footerActions: { display: 'flex', alignItems: 'center', gap: '6px', flex: 'none' },
      primarySmall: {
        ...buttonBase,
        padding: '5px 11px',
        fontSize: '11px',
        fontWeight: 600,
        borderRadius: '7px',
        background: `linear-gradient(135deg, ${PANEL_PALETTE.brand}, ${PANEL_PALETTE.accent})`,
        borderColor: 'transparent',
        color: '#fff',
        boxShadow: '0 6px 14px var(--upd-shadow-soft, rgba(107, 140, 255, 0.25))',
      },
      rowCta: {
        ...buttonBase,
        padding: '4px 10px',
        fontSize: '10.5px',
        fontWeight: 600,
        borderRadius: '7px',
        background: `linear-gradient(135deg, ${PANEL_PALETTE.brand}, ${PANEL_PALETTE.accent})`,
        borderColor: 'transparent',
        color: '#fff',
      },
      ghostSmall: {
        ...buttonBase,
        padding: '5px 10px',
        fontSize: '11px',
        background: 'transparent',
        borderColor: 'var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-primary)',
      },
      footerLink: {
        ...buttonBase,
        padding: '5px 9px',
        fontSize: '10.5px',
        background: 'transparent',
        borderColor: 'transparent',
        color: PANEL_PALETTE.muted,
      },
      sidebarLayer: { display: 'flex', alignItems: 'center', gap: '6px' },
      sidebarButton: {
        ...buttonBase,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 10px',
        height: '32px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        maxWidth: '100%',
      },
      sidebarButtonRail: {
        ...buttonBase,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        height: '32px',
        padding: 0,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
      },
      sidebarGlyph: { fontSize: '15px', lineHeight: '18px' },
      sidebarLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      badge: {
        marginLeft: 'auto',
        minWidth: '16px',
        padding: '0 4px',
        borderRadius: '999px',
        background: 'var(--dsw-alias-state-warn-primary)',
        color: 'var(--dsw-alias-bg-base)',
        fontSize: '11px',
        lineHeight: '16px',
        textAlign: 'center',
      },
      badgePending: { marginLeft: 'auto', color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', lineHeight: '16px' },
      badgeError: { marginLeft: 'auto', color: 'var(--dsw-alias-state-error-primary)', fontSize: '11px', fontWeight: 600, lineHeight: '16px' },
    }

    /** The plugin body: dictionaries, the sidebar seat, and the launch check. */
    function apply(ctx) {
      clientContext = ctx
      ctx.effect(() => {
        if (typeof ctx.locale?.register !== 'function') return () => {}
        try {
          return ctx.locale.register(NS, { zh: ZH, en: EN })
        } catch {
          return () => {}
        }
      }, 'plugin-updater: dictionaries')
      ctx.effect(
        () => ctx.slots.inject(SIDEBAR_SLOT, () => ctx.slots.register({ name: SIDEBAR_SLOT, id: PACKAGE, order: 40, locale: NS }, SidebarEntry)),
        `plugin-updater: ${SIDEBAR_SLOT}`,
      )
      ctx.effect(
        () => ctx.slots.inject(DETAIL_SLOT, () => ctx.slots.register({ name: DETAIL_SLOT, id: `${PACKAGE}-entry`, order: 60, locale: NS }, PluginCardAction)),
        `plugin-updater: ${DETAIL_SLOT}`,
      )
      ctx.effect(() => () => {
        if (typeof progressSubscription === 'function') progressSubscription()
      }, 'plugin-updater: progress cleanup')
      const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => setTimeout(callback, 0)
      ctx.effect(
        () => {
          const handle = schedule(() => {
            runCheck(true)
              .then(() => {
                if (totalUpdates(store.state.report) > 0) store.set({ open: true })
              })
              .catch(() => undefined)
          })
          return () => {
            if (typeof cancelAnimationFrame === 'function' && typeof handle === 'number') cancelAnimationFrame(handle)
            else clearTimeout(handle)
          }
        },
        'plugin-updater: launch check',
      )
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
