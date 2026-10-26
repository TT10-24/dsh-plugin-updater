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

## 经验总结

1. Cordis 里访问服务要么 `inject`，要么 `ctx.get()`；直接点属性会抛错。
2. React 里 ref 必须真的挂到元素上；拖动要同步监听并直接移动节点。
3. DSH 的 `installBundle` 是“新增”语义，更新要走 remove + install。
4. 替换已安装插件的代码/新增组件行后，重启是必需的。
5. 更新失败要恢复旧版本并把原因显示在你能看到的地方。
6. 进度事件是“锦上添花”，本地阶段兜底能让进度条永远可用。
