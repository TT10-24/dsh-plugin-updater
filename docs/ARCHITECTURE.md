# 架构说明

这个插件只有两个运行时半边，没有构建步骤：

| 文件 | 运行位置 | 职责 |
| --- | --- | --- |
| `index.js` | DSH Host（Node/Electron 主进程） | 读取 profile、请求 npm/桌面端版本服务、调用插件管理器执行更新 |
| `client.js` | DSH Web 页面 | 侧边栏入口、可拖动面板、面板外观设置、进度条、批量更新、重启按钮 |
| `protocol.js` | Host | 可选地从 `@deepseek-ai/cordis` 取 `Service`；取不到时用本地 `ctx.provide()` 基类 |
| `cordis.patch.yml` | Host | 把一个 `plugin-updater` 行插入 profile |
| `locale/*.json` | 插件管理器 | 插件卡片的中英文标题与说明 |

## 数据流

```
启动
  └─ Host apply()
       └─ 1.5s 后 check(true)
            ├─ 读 profile/package.json + pluginManager.listBundles()
            ├─ npm registry: <pkg>/latest
            ├─ 桌面端: https://www.dshdesktop.cn/api/desktop/version
            └─ 内核: 读取 resources/app/node_modules/@deepseek-ai/dsh
                 ↓ 结果缓存到 <DSH_HOME>/plugin-updater/last-report.json
                 ↓ 通过 Remote 端点 pluginUpdater/check 提供给页面
页面
  └─ 侧边栏入口 → 面板
       ├─ check  → 刷新报告
       ├─ update → 单个更新（带 requestId）
       └─ updateMany（客户端循环）→ 逐个调用 update
            └─ 订阅 plugin-manager/install-state / install-log 显示进度
```

## Remote 端点

Host 用一个普通 Cordis Service（`pluginUpdater`）暴露这些方法：

- `check(force)`：缓存 5 分钟；`force:true` 强制刷新。
- `update(name, version, requestId)`：更新一个插件。
- `status()`：轻量存活信息与 `compat`。
- `desktopData()`：当前数据目录与 DSH NEXT 指针是否对齐。
- `prepareDesktopUpdate(preserveHome, targetVersion)`：产品线切换前写入 NEXT 数据目录指针。
- `repairDesktopData()`：事后修复 NEXT 指针。
- `ignore(target, version)` / `unignore(target)`：按版本忽略插件或桌面端更新。

Remote 绑定是内联的纯 JSON：

```js
this.typertRemote = Object.freeze({ service: this, serviceKey: 'pluginUpdater', namespace: 'pluginUpdater' })
```

方法标记通过 `@deepseek-ai/dsh-typert-protocol/remote-methods` 原型描述符写入，因此不需要引入 typert 包，也不需要编译。

## 更新一个插件：remove + install，必要时覆盖安装

DSH 插件管理器的 `installBundle` 在 HMR 环境下会拒绝“已经存在于 profile 依赖”的包（`already-installed`），它是给“新增插件”用的。官方插件页的更新路径是：

1. `removeBundle(name)` 卸载旧版本；
2. `installBundle("name@新版本", { enabled: true, requestId })` 安装新版本；
3. 失败时用旧版本（先精确版本，再原始 spec）恢复。

替换已安装插件的 JS 模块后，**新的组件行需要重启 DSH Desktop 才会进入运行树**；面板检测到 `restart-required` 会显示「立即重启 DSH」。

### DSH NEXT 的 `bundle-in-use` / `stop-profile`

DSH NEXT 会保留启动时已加载的宿主模块；`removeBundle` 在卸载前会先取消 bundle 选中并 reload，如果模块仍持有 fiber，就返回 `bundle-in-use`；没有 HMR 时则返回 `stop-profile`。旧版 0.3.4 把这两种情况都当成失败，而且取消选中已经生效，所以一次失败的更新会同时让插件在下次启动时消失。

0.3.5 的处理：

1. **先恢复选中**：`restoreBundleSelection` 用 `setBundleEnabled(name, true)` 把 bundle 放回 `dsh.profile.bundles`；管理器方法不可用时直接原子写 profile 清单。
2. **`stop-profile`**：直接 `installBundle(target)` 覆盖安装，依赖保留，管理器报告 `restart-required`。
3. **`bundle-in-use`**：先把该依赖从 profile 清单中暂时移除，让 `installBundle` 跳过 HMR 的 `already-installed` 守卫；pnpm 安装完成后再把依赖补回。成功返回 `{ ok: true, application: 'restart-required', fallback: 'overwrite-running' }`。
4. **失败回滚**：在依赖仍隐藏时调用 `restoreInstall` 重装旧版本，然后恢复原始清单文本与 bundle 选中状态。若回滚也失败，至少保留原始清单，下一次启动不会丢插件。

这条路径仍然只使用插件管理器自己的 `installBundle` / pnpm，不绕过兼容性检查、构建脚本审批或版本解析。

## 面板外观

面板的尺寸与配色完全在 Client 侧，Host 不参与：

- 设置存在 `localStorage` 的 `dsh-plugin-updater:panel-appearance`：`width`、`height`（最大高度）、`accent` / `accent2`、`surface`、`opacity`。
- `sanitizeAppearance` 把越界或损坏的值夹回范围，因此手动改 localStorage 也不会让面板消失。
- 面板根节点写入 `--upd-bg`、`--upd-head`、`--upd-row`、`--upd-border`、`--upd-accent`、`--upd-glow` 等 CSS 变量；`PANEL_PALETTE` 全部走 `var(..., fallback)`，所以默认仍是深海军蓝 + 靛蓝，切换后 Logo、主按钮、进度条、状态点和焦点环一起变化。
- 标题栏的三个点打开全宽设置页；点击遮罩、`Esc` 或「完成」关闭。`Esc` 先关设置页，再关面板。

## 进度

Host 把客户端生成的 `requestId` 传给 `installBundle`。管理器的 `runPnpm` 在该请求期间发出：

- `plugin-manager/install-state`：阶段与 registry 尝试；
- `plugin-manager/install-log`：pnpm 输出块。

客户端在第一次更新时懒订阅这两个事件（`ctx.get('remote')?.$on`），按 `requestId` 过滤。若内核不转发事件，进度条按本地阶段计时推进（1.2s 后从“卸载”进入“安装”），不会卡住。

## 立即消失

更新成功后，客户端不等重新检查，先把该行在本地报告里改成 `current` 并移出列表（`markUpdated`），再在后台 `check(true)` 校正。因此不会出现“更新按钮闪回一下才消失”。

## 忽略与版本隔离

每个可更新行有一个版本级开关，不是永久静音：

- Host 把 `{ packages: { <name>: <version> }, desktop: <version> }` 写到 `<DSH_HOME>/plugin-updater/ignored.json`。
- `check` 时只把“忽略版本 === 最新版本”的条目标成 `ignored`；上游发新版本后会自动恢复为可更新。
- `updates` 与徽标计数只统计 `hasUpdate`，所以忽略不会让角标一直亮。
- 面板保留一个“已忽略”区域，`unignore` 后下一次检查立即重新提示。

## 兼容性策略

- `pluginManager`、`profileContext`、`desktopRuntime` 全部用 `ctx.get()` 探测，缺失只降级对应图层。
- 版本来源多级回退：`desktopRuntime` → DSH NEXT 的 `runtime.json`（`desktopVersion`）→ 打包 manifest → 环境变量。DSH NEXT 不提供 `desktopRuntime`，但 `primary-runtime/runtime.json` 记录了桌面版本。
- 外部响应宽容解析（`version` / `latestVersion` / 裸版本字符串）。
- `protocol.js` 优先使用 `@deepseek-ai/cordis` 的 `Service`；DSH NEXT 从 profile 外加载 `link:` 插件时看不到这个包，于是退回本地 `ctx.provide()` 基类，不再让整个插件在 import 阶段失败。

## 安全与 token

- 检查只发普通 HTTPS GET：npm registry 与 `www.dshdesktop.cn`。
- 更新调用 DSH 自己的插件管理器 / pnpm；不调用 LLM、agent 工具或 subagent。
- 不读取会话内容、提示词或凭据；只读 profile 的 `package.json` 与已安装包版本。

## 桌面端产品线迁移（DSH NEXT）

桌面端在 stable 通道可能返回 `2.0.20-next`。桌面端自己的 `parseCanonicalUpdateVersion` 允许这种“stable 提升到 Next 安装器”的行为，但 DSH NEXT 的默认数据目录是 `~/.dsh`，并且只读取自己的位置文件：

`%APPDATA%\DSH NEXT\home\desktop-next-location.json`

如果不管它，新版本会以一个空 home 启动，看起来像工作区、对话和插件全没了。插件把这种更新识别为产品线切换：

1. `checkDesktopUpdate` 用 `releaseLine()` / `releaseKind()` 比较当前/最新版本；目标是 `-next` 且当前不是 next 时，返回 `migration` 与 `requiresConfirmation`。普通补丁、功能版本、大版本仍走普通更新行。
2. 客户端迁移卡片先调用 `pluginUpdater/prepareDesktopUpdate`。Host 备份旧的位置文件，写入 `desktop-next-location.json` 和 `desktop-next-last-home.json`，并在 `<DSH_HOME>/plugin-updater/` 留下 `desktop-handoff.json` 和 `restore-desktop-data.ps1`。
3. 只有写入成功，客户端才 POST `/api/desktop/updates/check`；下载、签名、安装仍由桌面端官方流程负责。
4. `pluginUpdater/desktopData` 报告指针是否对齐；`repairDesktopData` 用于已经装好 NEXT 之后的一键修复。

安装位置与数据目录互相独立：安装器换到哪个盘，都不会移动 `DSH_HOME`。

## 已知限制

- 普通 Web 运行没有桌面端路由，桌面端区域显示“未检测到桌面端”。
- 某些插件需要批准 pnpm 构建脚本；失败时恢复旧版本并显示待批准列表。
- 更新后必须重启才能加载新代码；这是 DSH 插件替换机制的限制。
- 覆盖安装依赖插件管理器允许在 HMR 下重新安装同一包名；如果 DSH 后续版本收紧该守卫，Host 会返回失败并恢复旧版本，而不是假装成功。
