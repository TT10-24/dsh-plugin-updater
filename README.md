# dsh-plugin-updater

[![check](https://github.com/TT10-24/dsh-plugin-updater/actions/workflows/check.yml/badge.svg)](https://github.com/TT10-24/dsh-plugin-updater/actions/workflows/check.yml)
[![pages](https://github.com/TT10-24/dsh-plugin-updater/actions/workflows/pages.yml/badge.svg)](https://tt10-24.github.io/dsh-plugin-updater/)
[![license: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)

**你的 DSH 插件更新管家：插件、桌面端、内核，一次检查完，零 token 消耗。**

打开 DSH 时，它会静默检查你安装的插件、DSH Desktop 本体和内置内核有没有新版本；有更新时，侧边栏旁会出现一个可拖动的面板。你可以单个更新、一键全部更新，更新完直接重启，全程不调用模型、不产生 agent 轮次、不消耗 token。

[**在线介绍页**](https://tt10-24.github.io/dsh-plugin-updater/) · [安装](#安装) · [使用](#使用) · [常见问题](#常见问题) · [项目看板](https://github.com/users/TT10-24/projects/3)

![dsh-plugin-updater 面板界面示意](docs/assets/panel-preview.svg)


---

## 你会得到什么

- **三层检查**
  - **插件**：读取你的 profile 与实时 bundle 列表，对比 npm registry。
  - **DSH Desktop**：调用官方版本服务，告诉你当前版本和最新版本。
  - **内核**：显示随桌面端内置的 `@deepseek-ai/dsh` 版本；它随桌面端更新。
- **实时进度**：进度条、当前阶段（卸载 / 安装 / 重新检查）和 pnpm 最后一行输出。
- **一键全部更新**：一次点击，按顺序更新所有待更新插件，已完成的行立即消失。
- **更新即消失**：成功的插件不会再闪回“更新”按钮。
- **重启按钮**：需要重启时，直接点「立即重启 DSH」。
- **可拖动面板**：拖动标题栏移动、双击复位、记住位置、`Esc` 关闭。
- **面板设置**：点标题栏右侧的 **⋯**，调整宽度、最大高度、强调色、背景和不透明度；设置会记住，也能一键复位。
- **运行中也能更新**：DSH NEXT 拒绝热卸载的宿主插件会自动改为覆盖安装，并提示重启后生效，不再整批失败。
- **零 token**：检查只是普通 HTTPS 请求；更新交给 DSH 自己的插件管理器与 pnpm。
- **中英文界面**：跟随你的 DSH 语言。

## 安装

### 从 GitHub 安装（推荐）

打开 DSH Desktop 的 **设置 → 插件 → 添加插件**，填入：

```
github:TT10-24/dsh-plugin-updater
```

或者在终端里：

```bash
dsh plugin --profile desktop add github:TT10-24/dsh-plugin-updater
```

固定到某个版本：

```bash
dsh plugin --profile desktop add github:TT10-24/dsh-plugin-updater#v0.3.5
```

安装完成后重启 DSH Desktop。插件会出现在侧边栏底部（设置按钮旁），显示「查看更新」。

### 从本地目录安装

如果你在改代码，可以链接本地目录：

```bash
dsh plugin --profile desktop add link:"F:/path/to/dsh-plugin-updater"
```

## 使用

1. DSH 启动后会静默检查；有更新时侧边栏出现数量徽标。
2. 点「查看更新」打开面板。
3. 单个插件点「更新」；多个插件点「全部更新 (N)」。
4. 面板顶部会显示实时进度条和 pnpm 日志末行。
5. 更新成功的插件立即消失；如果需要重启，点「立即重启 DSH」。
6. 点面板右上角的 **⋯** 打开面板设置：拖动宽度、最大高度和不透明度，选择强调色与背景；**复位位置** 会把面板放回侧边栏旁。
7. 面板可以拖到任意位置，位置会被记住；双击标题栏复位。

> 更新已安装插件后，DSH Desktop 需要重启才能加载新的代码或新增组件行。这是 DSH 插件替换机制的限制，不是插件本身的问题。

## 面板设置

点标题栏右侧的 **⋯** 打开设置页，所有改动即时生效：

- **宽度** 320–560px，**最大高度** 380–820px；内容超出时在面板内部滚动。
- **强调色** 内置靛蓝、翠绿、琥珀、玫红、青蓝五套，也可以点最右侧的彩色圆点自选颜色；它会影响 Logo、主按钮、进度条和运行状态点。
- **背景** 内置深海军蓝、石墨灰、梅子紫、森林绿四套深色表面，不会跟随浅色主题变白。
- **不透明度** 72%–100%，适合把面板压在编辑器或网页上。
- **恢复默认** / **复位位置** 随时回到初始大小与侧边栏旁的默认位置。

设置保存在浏览器本地（`dsh-plugin-updater:panel-appearance`），不会上传，也不会消耗 token。

## 配置

在你的 profile 的 `cordis.patch.yml` 里覆盖本插件的行配置：

```yaml
- id: plugin-updater
  name: dsh-plugin-updater
  config:
    # 自定义 registry（默认 https://registry.npmjs.org）
    registry: https://registry.npmmirror.com
    # 桌面端版本服务（默认官方地址）
    desktopEndpoint: https://www.dshdesktop.cn/api/desktop/version
    autoCheck: true          # 是否自动检查
    checkOnBoot: true        # 启动后 1.5s 自动检查
    checkDesktop: true       # 是否检查桌面端
    checkEngine: true        # 是否检查内核
    verbose: false           # Host 日志
```

修改后重启 DSH Desktop 生效。

## 桌面端升级与 DSH NEXT

从 2.0.20 起，稳定通道可能把 **DSH NEXT** 作为桌面端升级包下发。DSH NEXT 是独立产品：安装器、可执行文件和默认数据目录（`~/.dsh`）都和 DSH Desktop 不同。直接更新会打开一个空工作区，看起来像“工作区、对话和插件都没了”；数据其实还在原来的 DSH 数据目录里。

0.3.4 起，这种升级不再走普通的「更新桌面端」：

1. 面板会显示 **DSH Desktop → DSH NEXT** 迁移卡片，并标出当前数据目录。
2. 点 **保留数据并更新**：插件先把 DSH NEXT 的数据目录指针写到当前 DSH 数据目录（例如 `F:\DSH-Home`），备份原指针，再把更新交给桌面端官方安装流程。
3. 如果已经装了 DSH NEXT、但它的数据目录没有对齐，面板会出现 **修复数据目录**，一键改回。

手动恢复的两种方式：

- 打开 DSH NEXT → 设置 → 数据目录 → 选择原来的 DSH 数据目录；
- 或运行 `<DSH_HOME>\plugin-updater\restore-desktop-data.ps1`。

数据目录与安装目录是两回事：换安装位置、重装桌面端都不会删除 `F:\DSH-Home` 这类数据目录。升级前仍建议保留一份数据目录备份。

> 桌面端官方更新流程下载的是 one-click 安装包，可能不提供安装位置选择；需要自己选目录时，用官网的 `DSH-NEXT-...-x64-Setup.exe`。装到哪个盘都不影响已经写好的数据目录。

## 忽略某个版本

不想升级 DSH NEXT、插件做了不兼容的大改、或者你更喜欢旧版时，可以只忽略“这一次”的版本：

- 每个可更新插件行都有 **忽略**；桌面端有 **忽略本次**。
- 只忽略当前最新版本；上游发布更新的版本后会重新提示。
- 已忽略的版本会留在 **已忽略** 区域，随时可以 **取消忽略**。
- 记录在 `<DSH_HOME>/plugin-updater/ignored.json`，只在本机，不发送。

插件会把桌面端更新分成 **补丁 / 功能版本 / 大版本 / 产品线切换**。只有产品线切换（例如 DSH Desktop → DSH NEXT）会打开迁移卡片；普通版本更新仍是普通更新行。

## 常见问题

**会消耗 token 吗？**

不会。检查只请求 npm registry 和 DSH Desktop 官方版本服务；更新调用 DSH 插件管理器与 pnpm。没有 LLM、没有 agent、没有 subagent。

**为什么更新完要重启？**

替换已安装插件的代码后，运行中的 DSH 仍持有旧模块；新增的组件行也要重启后才会进入运行树。面板检测到 `restart-required` 时会给你一个重启按钮。

**点「更新」会发生什么？**

插件先尝试卸载旧版本，再安装目标版本。如果安装失败，它会自动恢复旧版本，并把原因显示在对应插件行下方。DSH 的 `installBundle` 本身是“新增插件”语义，直接安装已存在的包会被拒绝，所以默认走 remove + install。

在 DSH NEXT 中，正在运行的宿主插件可能被拒绝热卸载（`bundle-in-use`）或要求重启（`stop-profile`）。0.3.5 起遇到这两种情况会自动切换为覆盖安装：先把该依赖暂时从 profile 清单中隐藏，让插件管理器完成 pnpm 安装与重建，再恢复依赖并把插件重新选中。成功后提示重启，失败则回滚到原版本。

**普通 Web 环境能用吗？**

可以检查插件；没有桌面端时，桌面端区域会显示“未检测到桌面端”，也不会出现桌面端更新按钮。

**某个插件要求批准 pnpm 构建脚本怎么办？**

安装会失败并恢复旧版本，面板会显示待批准的构建脚本。你可以在插件页手动批准后重试。

**怎么固定版本或回滚？**

安装时用 `#v0.3.5` 固定 tag；回滚就重新安装旧 tag，然后重启 DSH Desktop。

**点了「忽略」之后怎么恢复？**

面板底部的 **已忽略** 区域会保留一条记录，点 **取消忽略** 就会在下次检查时重新提示。忽略只针对那一个版本，不会永久关闭这类更新。

## 兼容性与限制

- **插件更新**：优先使用 DSH 官方的 remove → install 路径；遇到 `bundle-in-use` / `stop-profile` 时自动覆盖安装并提示重启，失败会恢复旧版本、恢复 bundle 选中状态。
- **需要重启**：替换已安装插件后，必须重启 DSH Desktop 才能加载新代码/新组件行。
- **构建脚本**：某些插件需要批准 pnpm 构建脚本；失败时会显示待批准列表。
- **普通 Web 运行**：没有桌面端路由，桌面端区域只显示状态。
- **自动适配**：`pluginManager`、`profileContext`、`desktopRuntime` 都是可探测服务；内核缺少某项能力时只降级对应图层，不会让插件卡死。
- **DSH NEXT 兼容**：DSH NEXT 从 profile 外加载 `link:` 插件时看不到 `@deepseek-ai/cordis`；`protocol.js` 会退回本地 `ctx.provide()` 基类，不再在启动阶段失败。它也不提供 `desktopRuntime`，插件从 `primary-runtime/runtime.json` 读取 `desktopVersion`，桌面端区域不再误报“未检测到”。

## 隐私与网络

- 读取：你的 profile 的 `package.json`、已安装包的版本号、本机 DSH / DSH NEXT 的数据目录指针，以及 `ignored.json`（都只在本地比较，不发送）。
- 请求：npm registry（默认 `registry.npmjs.org`）的包版本；DSH Desktop 官方版本服务 `www.dshdesktop.cn`。
- 不发送：会话内容、提示词、凭据或任何模型请求。
- 不调用：LLM、agent 工具、subagent。更新由 DSH 插件管理器执行。

## 项目文档

- [架构说明](docs/ARCHITECTURE.md)：Host/Client 分工、三层检查、更新与进度事件。
- [开发历程](docs/BUILD-LOG.md)：从 0.1.0 到 0.3.5 的真实问题与修复记录。
- [贡献指南](CONTRIBUTING.md)：本地开发、检查与 PR 约定。
- [路线图](https://github.com/users/TT10-24/projects/3)：正在做和接下来要做的事。

## 参与贡献

如果你发现 bug 或有新想法，欢迎开 [Issue](https://github.com/TT10-24/dsh-plugin-updater/issues)。提交代码前请先看 [CONTRIBUTING.md](CONTRIBUTING.md)，并确保以下检查通过：

```bash
node .check/locale-check.mjs ./client.js
node .check/render-check.mjs ./client.js
node .check/drag-check.mjs ./client.js
```

提交 PR 时，描述里用 `Closes #编号` 关联对应议题；合并后看板会自动更新。

## English

A zero-token update checker for DSH (DeepSeek Harness). It checks your installed plugins, DSH Desktop and the bundled core on launch, then reminds you with a draggable panel. You can update one plugin, update all of them in one click, and restart when DSH asks for it — no model calls, no token spend.

Click the **⋯** button in the panel header to change its width, maximum height, accent color, surface and opacity; the choice is remembered locally. In DSH NEXT, a host bundle that refuses hot removal is replaced in place and reported as **restart required** instead of failing the whole batch.

When the stable channel promotes **DSH NEXT**, the panel treats it as a product-line migration rather than a patch. **Keep data and update** writes the DSH NEXT data-directory pointer to your current DSH home before the shell's installer runs, so the new app opens with the same workspace, conversations and plugins. A repair action covers a NEXT install that was already pointed at its default `~/.dsh` home.

Install:

```bash
dsh plugin --profile desktop add github:TT10-24/dsh-plugin-updater
```

Read the [online page](https://tt10-24.github.io/dsh-plugin-updater/) or the [architecture notes](docs/ARCHITECTURE.md) for details.

## License

MIT