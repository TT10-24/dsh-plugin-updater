# 架构说明

这个插件只有两个运行时半边，没有构建步骤：

| 文件 | 运行位置 | 职责 |
| --- | --- | --- |
| `index.js` | DSH Host（Node 子进程） | 读取 profile、请求 npm、调用插件管理器执行更新、迁移 DSH NEXT 数据目录 |
| `client.js` | DSH Web 页面 | 侧边栏入口、可拖动面板、外观设置、进度条、批量更新、数据目录迁移对话框 |
| `protocol.js` | Host | 可选地从 `@deepseek-ai/cordis` 取 `Service`；取不到时用本地 `ctx.provide()` 基类 |
| `cordis.patch.yml` | Host | 把一个 `plugin-updater` 行插入 profile |
| `locale/*.json` | 插件管理器 | 插件卡片的中英文标题与说明 |

0.3.5 起只支持 DSH NEXT，不再包含 DSH Desktop 的版本服务、安装器更新或产品线迁移卡片。

## 数据流

```
启动
  └─ Host apply()
       └─ 1.5s 后 check(true)
            ├─ 读 profile/package.json + pluginManager.listBundles()
            ├─ npm registry: <pkg>/latest
            ├─ DSH NEXT: runtime.json 的 desktopVersion + 数据目录 plan
            └─ 内核: 读取 resources/app/node_modules/@deepseek-ai/dsh
                 ↓ 结果缓存到 <DSH_HOME>/plugin-updater/last-report.json
                 ↓ 通过 Remote 端点 pluginUpdater/check 提供给页面
页面
  └─ 侧边栏入口 → 面板
       ├─ check  → 刷新报告
       ├─ update → 单个更新（带 requestId）
       ├─ updateMany（客户端循环）→ 逐个调用 update
       └─ migrateDataHome / chooseDataFolder → DSH NEXT 数据目录迁移
            └─ 订阅 plugin-manager/install-state / install-log 显示进度
```

## Remote 端点

Host 用一个普通 Cordis Service（`pluginUpdater`）暴露这些方法：

- `check(force)`：缓存 5 分钟；`force:true` 强制刷新。
- `update(name, version, requestId)`：更新一个插件。
- `status()`：轻量存活信息与 `compat`。
- `chooseDataFolder()`：Windows 原生文件夹选择器，返回绝对路径或 `null`。
- `migrateDataHome(target, { copy })`：切换/复制 DSH NEXT 数据目录并写指针。
- `ignore(name, version)` / `unignore(name)`：按版本忽略插件更新。

Remote 绑定是内联的纯 JSON：

```js
this.typertRemote = Object.freeze({ service: this, serviceKey: 'pluginUpdater', namespace: 'pluginUpdater' })
```

方法标记通过 `@deepseek-ai/dsh-typert-protocol/remote-methods` 原型描述符写入，因此不需要引入 typert 包，也不需要编译。

## 更新来源与身份

只看包名是不够的：本地链接的插件可能与 npm 上另一个包同名，版本还更高。0.3.7 起，检查与更新都先确认“这是不是同一个项目”。

### 检查阶段

`installedPackages()` 把 profile 依赖与 `listBundles()` 合并，键名大小写无关；每个条目保留依赖 spec、实际 `package.json` 版本和 `node_modules` 是否为链接。`sweepPackages()` 再按来源分流：

| 来源 | 处理 |
| --- | --- |
| 版本号 / 范围（registry） | 请求 npm `latest`，比较版本与仓库 |
| `link:` / `file:` / `workspace:` | 不请求 npm，状态 `local` |
| `github:` / `git+` / git URL | 只有能从 spec 解析出仓库，且 registry 包的 `repository` 指向同一仓库时才比较 |
| `npm:` 别名 | 不比较，状态 `local` |
| 无 spec、仅 bundle | `node_modules` 存在且不是链接时按 registry 包处理 |

仓库比较把 URL 归一化成 `host/owner/repo`，忽略 `git+`、`.git`、`#fragment` 和 GitHub 的 `/tree/...` 后缀。同名但仓库不同，或 GitHub 安装无法验证仓库时，返回 `foreign`，不进入更新列表。

两个 bundle 对同一个包名报告不同版本时返回 `conflict`，不要猜哪一个才是“已安装”。旧缓存报告没有 `schema: 2` 会被丢弃，避免升级后沿用旧的身份判断。

### 更新阶段

`update(name, version, requestId)` 在移除任何文件之前按顺序检查：

1. **来源**：本地链接、`file:`、`workspace:`、别名、无法验证仓库的 git/URL 安装直接拒绝（`code: 'not-registry'`）。
2. **版本格式**：目标必须是具体的 SemVer（`x.y.z`，可带预发布），不接受范围或 tag。
3. **不降级**：目标版本必须严格高于已安装版本，否则拒绝（`code: 'not-newer'`）。
4. **仓库身份**：安装了 `repository` 或来源是 GitHub 时，再取 `<name>@<version>` 的 manifest；仓库不一致拒绝（`identity-mismatch`），GitHub 来源无法验证时拒绝（`identity-unverified`）。

只有四项都通过，才调用 `removeBundle` 与 `installBundle`。这样即使报告过期、dist-tag 回退或有人直接调用 Remote，也不会把插件降级或换成同名包。

版本比较使用 SemVer 2.0.0：预发布标识按点分段，纯数字段按数值比较（`beta.10 > beta.2`），数字段低于字母段，构建元数据不参与排序。

## 更新一个插件：remove + install，必要时覆盖安装

DSH 插件管理器的 `installBundle` 在 HMR 环境下会拒绝“已经存在于 profile 依赖”的包（`already-installed`），它是给“新增插件”用的。官方插件页的更新路径是：

1. `removeBundle(name)` 卸载旧版本；
2. `installBundle("name@新版本", { enabled: true, requestId })` 安装新版本；
3. 失败时用旧版本（先精确版本，再原始 spec）恢复。

### DSH NEXT 的 `bundle-in-use` / `stop-profile`

DSH NEXT 会保留启动时已加载的宿主模块；`removeBundle` 在卸载前会先取消 bundle 选中并 reload，如果模块仍持有 fiber，就返回 `bundle-in-use`；没有 HMR 时则返回 `stop-profile`。旧版 0.3.4 把这两种情况都当成失败，而且取消选中已经生效，所以一次失败的更新会同时让插件在下次启动时消失。

0.3.5 的处理：

1. **先恢复选中**：`restoreBundleSelection` 用 `setBundleEnabled(name, true)` 把 bundle 放回 `dsh.profile.bundles`；管理器方法不可用时直接原子写 profile 清单。
2. **`stop-profile`**：直接 `installBundle(target)` 覆盖安装，依赖保留，管理器报告 `restart-required`。
3. **`bundle-in-use`**：先把该依赖从 profile 清单中暂时移除，让 `installBundle` 跳过 HMR 的 `already-installed` 守卫；pnpm 安装完成后再把依赖补回。成功返回 `{ ok: true, application: 'restart-required', fallback: 'overwrite-running' }`。
4. **失败回滚**：在依赖仍隐藏时调用 `restoreInstall` 重装旧版本，然后恢复原始清单文本与 bundle 选中状态。若回滚也失败，至少保留原始清单，下一次启动不会丢插件。

这条路径仍然只使用插件管理器自己的 `installBundle` / pnpm，不绕过兼容性检查、构建脚本审批或版本解析。重启由用户通过 DSH NEXT 标题栏完成；插件不再调用旧的 `/api/desktop/restart` 路由。

## DSH NEXT 信息与数据目录迁移

`checkNext()` 只读 `runtime.json` 的 `desktopVersion`（以及可选的 `desktopRuntime` / 环境变量 / `dsh-desktop-next` manifest 回退），返回：

```js
{
  status: 'current',
  product: 'DSH NEXT',
  currentVersion: '2.0.20-next',
  data: { home, pointer, pointerMatchesHome, needsRepair, canSetHome, ... }
}
```

不再请求 `www.dshdesktop.cn`，也不再启动安装器。

### 指针

DSH NEXT 只读 `%APPDATA%\DSH NEXT\home\desktop-next-location.json`。迁移写两个文件：

- `desktop-next-location.json`
- `desktop-next-last-home.json`

写之前把已有文件备份为 `.bak-时间戳`；写之后在 `<DSH_HOME>/plugin-updater/` 留 `data-home.json` 和 `restore-data-home.ps1`。

### 两种模式

- **只切换指针**（`copy:false`）：目标目录必须已存在且包含 `profiles` / `sessions` / `storages` 之一。适合数据已经在另一块盘。
- **复制并切换**（`copy:true`）：目标目录必须不存在；复制 `profiles`、`sessions`、`storages`、`.credentials.yaml`、`.anonymous-user-id`、`desktop-locale.json`、`desktop-preferences.json`，成功后再写指针。复制失败会删除本次创建的目标目录。

约束：

- 目标不能是当前数据目录的同一个、父级或子级目录。
- 源目录永远不会被删除。
- 复制使用 `fs.cp` 的递归模式，包含 `profiles/node_modules`；数据量大时耗时明显。
- 运行中复制可能漏掉当前会话最后几条消息；重要对话应先结束当前任务。

### 文件夹选择器

Host 是普通 Node 子进程，浏览器的目录选择器拿不到绝对路径。Windows 下用 PowerShell 的 `FolderBrowserDialog`（`-STA -EncodedCommand`）返回绝对路径；其他平台或 PowerShell 不可用时，客户端允许手动输入绝对路径。

## 面板外观

面板的尺寸与配色完全在 Client 侧，Host 不参与：

- 设置存在 `localStorage` 的 `dsh-plugin-updater:panel-appearance`：`width`、`height`（面板高度）、`accent` / `accent2`、`surface`、`opacity`。
- `sanitizeAppearance` 把越界或损坏的值夹回范围，因此手动改 localStorage 也不会让面板消失。
- 面板根节点写入 `--upd-bg`、`--upd-head`、`--upd-row`、`--upd-border`、`--upd-accent`、`--upd-glow` 等 CSS 变量；`PANEL_PALETTE` 全部走 `var(..., fallback)`。
- 标题栏的三个点打开全宽设置页；只通过三个点、`Esc`、「完成」或关闭按钮退出，点击遮罩或面板外侧不会把设置页退回主面板。`Esc` 先关设置页，再关面板。
- 标题栏不再显示副标题，页脚只显示上次检查时间。

## 进度

Host 把客户端生成的 `requestId` 传给 `installBundle`。管理器的 `runPnpm` 在该请求期间发出：

- `plugin-manager/install-state`：阶段与 registry 尝试；
- `plugin-manager/install-log`：pnpm 输出块。

客户端在第一次更新时懒订阅这两个事件（`ctx.get('remote')?.$on`），按 `requestId` 过滤。若内核不转发事件，进度条按本地阶段计时推进（1.2s 后从“卸载”进入“安装”），不会卡住。

## 立即消失

更新成功后，客户端不等重新检查，先把该行在本地报告里改成 `current` 并移出列表（`markUpdated`），再在后台 `check(true)` 校正。因此不会出现“更新按钮闪回一下才消失”。

## 忽略与版本隔离

每个可更新行有一个版本级开关，不是永久静音：

- Host 把 `{ packages: { <name>: <version> } }` 写到 `<DSH_HOME>/plugin-updater/ignored.json`。
- `check` 时只把“忽略版本 === 最新版本”的条目标成 `ignored`；上游发新版本后会自动恢复为可更新。
- `updates` 与徽标计数只统计 `hasUpdate`，所以忽略不会让角标一直亮。
- 面板保留一个“已忽略”区域，`unignore` 后下一次检查立即重新提示。

## 兼容性策略

- `pluginManager`、`profileContext`、`desktopRuntime` 全部用 `ctx.get()` 探测，缺失只降级对应能力。
- DSH NEXT 版本来源：`desktopRuntime` → `runtime.json` 的 `desktopVersion` → 环境变量 → `dsh-desktop-next` manifest。
- `protocol.js` 优先使用 `@deepseek-ai/cordis` 的 `Service`；DSH NEXT 从 profile 外加载 `link:` 插件时看不到这个包，于是退回本地 `ctx.provide()` 基类。

## 安全与 token

- 检查只发普通 HTTPS GET：npm registry。
- 更新调用 DSH 自己的插件管理器 / pnpm；不调用 LLM、agent 工具或 subagent。
- 迁移只在本机读写用户确认的文件夹，不发送文件内容。
- 不读取会话内容或提示词；只读 profile 的 `package.json`、已安装包版本、数据目录指针与 `ignored.json`。

## 已知限制

- 只支持 DSH NEXT；不再检测 DSH Desktop。
- 某些插件需要批准 pnpm 构建脚本；失败时恢复旧版本并显示待批准列表。
- 更新插件或切换数据目录后必须重启 DSH NEXT。
- 复制迁移包含 `node_modules`，体积大时耗时明显；运行中复制可能漏掉当前会话最后几条消息。
- 覆盖安装依赖插件管理器允许在 HMR 下重新安装同一包名；如果 DSH 后续收紧该守卫，Host 会返回失败并恢复旧版本，而不是假装成功。
