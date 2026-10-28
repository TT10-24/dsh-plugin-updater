# 开发历程

这份记录按真实迭代顺序整理，保留遇到的问题、错误判断和最终修复，帮助你能理解“为什么代码长这样”。日期来自开发时的会话记录；仓库里最初的 git 历史是为了公开发布而做的结构化导入，不是当年逐日提交的原始记录。

## 2026-10-15 · 0.1.0 第一版

目标：每次上线自动检查已安装插件，发现更新后在界面里提醒，不消耗 token。

实现：

- Host 读取 profile 的 `package.json`，对每个依赖请求 npm registry 的 `latest`。
- 客户端注册侧边栏入口和右下角浮层，发现更新时显示。
- 更新调用 `pluginManager.installBundle`。

问题：

1. 客户端访问 `ctx.connection` 时没有声明依赖，Cordis 直接抛 `cannot get property "connection" without inject`，每次检查都失败。
2. 失败卡片常驻并压住输入框。
3. 右下角浮层和左侧面板同时出现，显得多余。

修复：

- 把 `connection` 加入客户端依赖，或改用 `ctx.get('connection')` 探测 + 同源 fetch 兜底。
- 失败只在侧边栏留一个小标记，不再弹常驻卡片。
- 后续删除右侧浮层，只保留左侧面板。

## 2026-10-18 · 0.2.0 面板与桌面端

目标：只保留左侧面板、支持拖动、增加 DSH 桌面端与内核检查、自动适配新内核。

改动：

- 删除 `shell.overlay`，只保留 `sidebar.footer.action`。
- 面板支持拖动、双击复位、位置记忆、`Esc` 关闭。
- 新增桌面端版本检查（官方 `dshdesktop.cn` 接口）与内核版本展示；桌面端更新交给官方路由。
- `pluginManager`、`profileContext`、`desktopRuntime` 改为可选探测；`protocol.js` 做导出兜底。

问题：

- **拖动完全没反应**。排查发现创建了 `panelRef`，但面板根节点没有 `ref: panelRef`，`startDrag` 第一行 `panelRef.current` 恒为 `null` 直接 return。
- 修复后把监听改为在 `pointerdown` 里同步挂到 `document`，并直接改节点 `left/top`，避免 React effect 时序导致第一段位移丢失。
- 新增无头拖动回归测试：按下锚定 `(100,100)` → 移动 `(140,130)` → 松手持久化。

## 2026-10-23 · 更新 dsh-ops 0.4.1

目标：点击更新真正执行。

问题 1：点击“更新”没反应。

- 插件管理器的 `installBundle` 在 HMR 环境下拒绝安装已存在的依赖，返回 `already-installed`，在进入 pnpm 前就结束。
- 官方插件页的做法是 **先 removeBundle 再安装**。
- 修复：`update()` 改为 remove → install；失败时用旧精确版本/原始 spec 恢复；结果里返回 `restored`；面板显示失败原因。

问题 2：更新 dsh-ops 后有几个组件未运行、PTC 异常。

- 运行中的 Loader 只有旧的 shell/file/ptc 三行；0.4.1 新增的 discovery/panel/tui/hide-official 四行没有进入运行树。
- PTC 失败是“半新半旧”模块状态；PTC worker 的 sha256 与 provenance 一致，本身没坏。
- 处理：提示并执行一次完整重启；从 profile patch 移除已废弃的 `dsh-ops-background`，移除仅 TUI 使用的 `dsh-ops-tui`（桌面端没有 `tuiPanels`），补全 panel/hide-official 的 config。
- 教训：替换已安装插件后，新组件行必须重启才会加载；仅刷新页面不够。

## 2026-10-26 · 0.3.0 体验与发布准备

目标：更新完成立即消失、实时进度、一键全部更新、准备 GitHub 发布。

- **立即消失**：成功后在本地报告里把该行标记为 current 并移出列表，再后台重新检查；同时不再让 `runCheck` 清空完成提示。
- **进度条**：Host 把客户端生成的 `requestId` 传给 `installBundle`；客户端懒订阅 `plugin-manager/install-state` 与 `install-log`，显示阶段、百分比和 pnpm 末行；无事件时按阶段计时兜底。
- **一键全部更新**：插件区标题旁「全部更新 (N)」，逐个执行、逐行消失、失败行保留错误，最后汇总。
- **重启按钮**：`restart-required` 时显示「立即重启 DSH」，走桌面端官方 `/api/desktop/restart`。
- **发布整理**：版本 0.3.0、MIT、README/CHANGELOG/icon、`files` 白名单、移除 `private`；`protocol.js` 只依赖 Cordis，Remote 绑定内联，降低 GitHub 安装的解析依赖。
- 加入 CI：语法、JSON、locale 平衡、无头渲染、拖动检查。

## 2026-10-26 · 0.3.1 仓库完善与 Pages

目标：把仓库从“能安装”完善成“第一次发现它的人也能看懂、能参与”。

- 用 5 个 Issue 和 Projects #3 看板规划：文档重写、Pages 介绍页、Actions 部署、Issue/PR 模板、维护者笔记移出仓库。
- 从 `main` 切出 `feat/repo-polish-and-pages`，所有改动通过 PR 合并；PR 描述用 `Closes #1` 等关联议题。
- 新增 `site/` 静态介绍页和 `.github/workflows/pages.yml`，由 Actions 部署到 GitHub Pages。
- README、ARCHITECTURE、BUILD-LOG、CONTRIBUTING 统一用“你”与访问者对话；新增界面示意 SVG、FAQ、路线图链接。
- 维护者的新手指南移到仓库外（不提交）；仓库只保留面向访问者的文档。
- 新增 Issue 模板、PR 模板和 `SECURITY.md`，降低反馈与贡献门槛。

## 2026-10-26 · 0.3.2 面板视觉

目标：让实际使用的面板更接近 README / Pages 里的示意，而不是“功能对了但看起来像另一个东西”。

- 头部改成渐变 Logo 方块、标题/副标题、右侧拖动点与关闭按钮；宽度从 380px 调到 408px。
- 进度条改成品牌渐变并加高光扫过；行改成卡片式，版本数字去掉药丸背景，更新按钮用渐变。
- 增加状态点：待更新琥珀、进行中品牌色呼吸、完成绿色、失败红色；底部加绿色状态灯。
- 底部“重新检查”改成文字链接；插件页动作按钮保留描边，避免两个场景混用。
- 无头渲染测试补上 SVG 属性白名单，保证 Logo 在 CI 里也能通过。
- 行为（更新、批量、重启）不变，只改视觉与间距。

## 2026-10-26 · 0.3.3 固定深色表面

目标：实际截图里面板在浅色 DSH 主题下仍显示为浅灰，与深蓝黑的示意图不一致。

- 原因：面板用了 `--dsw-alias-bg-overlay`，它在浅色主题下是半透明遮罩色，不是面板底色。
- 改为固定深色调色板（`#151923` 面板、`#1a1f2b` 头/底、`#1e2431` 行卡片、`#2a3140` 边框），文字/边框/状态点也固定，深色和浅色 DSH 下都保持示意图的深蓝黑。
- 去掉插件区“全部最新”药丸下面重复的一行“全部最新”。
- README 增加 dsh-plugin.org 市场徽章。
- 新增 Issue #9 与 PR #9；行为不变。

## 2026-10-27 · 0.3.4 DSH NEXT 数据目录护栏

目标：修复“桌面端更新到 DSH NEXT 后工作区、对话、插件全没了”的真实事故。

事故链：

1. stable 用户（2.0.18）点击面板的「更新桌面端」。
2. 官方版本服务在 stable 通道返回 `2.0.20-next`；桌面端自己的 `parseCanonicalUpdateVersion` 允许 stable 提升到 Next 安装器，于是下载并启动了 `DSH-NEXT-2.0.20-next-windows.exe`。
3. DSH NEXT 是独立产品，默认数据目录是 `~/.dsh`，只读取 `%APPDATA%\DSH NEXT\home\desktop-next-location.json`。
4. 原数据在 `F:\DSH-Home`（DSH Desktop 的应用内选择），新应用完全不知道，于是以空 home 启动。

第二次问题：DSH NEXT 启动时插件 import 失败：

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/cordis'
imported from F:\Program Files\DSH\plugins\dsh-plugin-updater\protocol.js
```

原因是 0.3.4 之前的 `protocol.js` 静态 import 了 `@deepseek-ai/cordis`。DSH Desktop 的加载器能解析它，但 DSH NEXT 从 profile 外加载 `link:` 插件时看不到这个包。

修复：

- `protocol.js` 改成动态 import + 本地 `ctx.provide()` 基类兜底，DSH NEXT 里不再在 import 阶段失败。
- DSH NEXT 不提供 `desktopRuntime`，Host 改从 `primary-runtime/runtime.json` 读取 `desktopVersion`；重启后桌面端区域从“未检测到”恢复为“已是最新 2.0.20-next”。
- Host 新增 `releaseLine()` / `releaseKind()` 与 `desktopNextPlan()`：当前 stable、目标 `-next` 时返回 `migration` 与 `requiresConfirmation`，不再当普通补丁；补丁 / 功能版本 / 大版本仍走普通更新行。
- 新增版本级 **忽略**：插件和桌面端都可以只忽略当前最新版本，记录在 `ignored.json`；新版本会重新提示，面板保留“已忽略”区域和“取消忽略”。
- 客户端新增迁移卡片：**保留数据并更新** → `prepareDesktopUpdate` → 写 NEXT 位置文件（备份旧指针）→ 再走桌面端官方 `/api/desktop/updates/check`。
- 新增 `desktopData` 与 `repairDesktopData`：已装 NEXT 但指针不对时，面板显示「修复数据目录」。
- Host 在 `<DSH_HOME>/plugin-updater/` 写 `desktop-handoff.json` 和 `restore-desktop-data.ps1`，即使新应用跑不起来也能手动恢复。
- 兼容 NEXT 自己的包名 `dsh-desktop-next`，作为没有 `desktopRuntime` 时的 manifest 回退。

验证：

- 本机把指针写回 `F:\DSH-Home` 后，DSH NEXT 的 `readDataDirectory` 能解析并通过 `holdsNextData` 检查。
- 用 DSH NEXT 自带的 `primary-runtime\...\node.exe` 运行探测，`runtime.json` 返回 `desktopVersion = 2.0.20-next`，桌面端检查为 `current`。
- `node .check/selfcheck.mjs` 增加 release-line / release-kind、临时 APPDATA 的 handoff 写入与 ignore 列表测试；无 `@deepseek-ai/cordis` 时也能构造 Host 服务。
- `render-check` 覆盖迁移按钮（先 `prepareDesktopUpdate`，后 `/api/desktop/updates/check`）以及插件/桌面端的忽略按钮。

## 2026-10-28 · 0.3.5 运行中更新与面板设置

目标：修复“今天全部更新都失败”，并让面板右上角的三个点可以调整面板属性。

事故链（来自 `<DSH_HOME>/plugin-updater/update-trace.log`）：

1. 面板对 `@xmanrui/dsh-im`、`cc-safety-net`、`dsh-ops` 依次点击更新。
2. 每次都是 `update:remove-failed`，`application=failed`，`message=bundle-in-use`。
3. `removeBundle` 在校验“模块是否还在运行”之前，已经执行了 `selectBundle(name, false)` + reload；因此失败后三个 bundle 已经从 `dsh.profile.bundles` 消失，但进程里仍加载着旧模块。
4. 结果是更新全红，而且下一次启动会少三个插件。

原因：DSH NEXT 把宿主模块保留到进程退出；HMR 下 `removeBundle` 无法卸载正在运行的宿主 bundle，只能拒绝。0.3.4 把拒绝当普通失败，没有恢复选中，也没有覆盖安装路径。

修复：

- 更新前记录 `wasSelected`；`removeBundle` 失败后调用 `restoreBundleSelection` 恢复选中（优先 `setBundleEnabled`，失败则原子修改 `dsh.profile.bundles`）。
- `stop-profile`：直接 `installBundle(target)` 覆盖安装（无 HMR 的官方语义），成功返回 `restart-required`。
- `bundle-in-use`：暂时从 profile 依赖中隐藏该包，让 `installBundle` 跳过 HMR 的 `already-installed` 守卫；pnpm 安装后补回依赖。返回 `fallback: 'overwrite-running'` 和 `restartReason: 'host-module'`。
- 覆盖安装失败时，在依赖仍隐藏的状态下 `restoreInstall` 旧版本，再写回原始清单文本与选中状态；不会留下“依赖在、文件没了”或“选中没了”的半状态。
- 客户端把 `bundle-in-use` 从“重启后再试”改成真实的“已替换，重启后生效”。

面板设置：

- 标题栏右侧的伪装饰 `•••` 换成真正的按钮（`aria-haspopup="dialog"`）。
- 打开全宽设置页：宽度 320–560px、最大高度 380–820px、5 套强调色 + 自定义颜色、4 套深色表面、不透明度 72%–100%、恢复默认、复位位置。
- 设置持久化到 `localStorage`，面板根节点写入 CSS 变量；Logo、主按钮、进度条、运行点和焦点环一起换色。
- 点击遮罩、`Esc` 或「完成」关闭；`Esc` 先关设置页再关面板。

验证：

- `selfcheck` 新增三个临时 profile 用例：`bundle-in-use` 成功覆盖、覆盖失败回滚、`stop-profile` 覆盖安装；断言依赖在安装期间确实被隐藏、选中被恢复、失败后版本与清单回到原样。临时用例显式传 `profileDir`，避免 `DSH_PROFILE_DIR` 把测试写进真实 profile。
- `render-check` 断言三个点按钮存在、带 `aria-haspopup` / `aria-expanded`；CSS 自定义属性与 range 输入加入白名单。
- 用真实 `client.js` + React 18 + Edge 无头渲染出默认、自定义、设置页三张截图，检查换色、宽度和遮罩。

## 经验总结

1. Cordis 里访问服务要么 `inject`，要么 `ctx.get()`；直接点属性会抛错。
2. React 里 ref 必须真的挂到元素上；拖动要同步监听并直接移动节点。
3. DSH 的 `installBundle` 是“新增”语义，更新要走 remove + install。
4. 替换已安装插件的代码/新增组件行后，重启是必需的。
5. 更新失败要恢复旧版本并把原因显示在你能看到的地方。
6. 进度事件是“锦上添花”，本地阶段兜底能让进度条永远可用。
7. 跨产品升级先迁移“数据目录指针”，不要假设新版本会沿用旧版本的 home。
8. 从 profile 外加载的 `link:` 插件不要静态 import 内核包；用可选加载或本地兜底，否则换一个宿主就会在启动阶段失败。
9. 任何“先取消选中、再卸载”的操作，失败路径都必须恢复选中；否则失败一次就会在下次启动时丢插件。
10. 画成 `•••` 的装饰如果看起来像按钮，就把它做成按钮；面板设置要能看见、能撤回。