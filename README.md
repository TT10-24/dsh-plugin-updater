# dsh-plugin-updater

**插件 / DSH 桌面端 / 内核更新检查，零 token 消耗。**

在 DSH 启动时自动检查已安装插件、DSH Desktop 和内置内核的版本；发现更新后，用侧边栏旁边的可拖动面板提醒你，并支持单个更新、一键全部更新和更新后立即重启。检查与更新全程**不调用模型、不产生 agent 轮次、不消耗 token**。

> 适用于 DeepSeek Harness Desktop / Web profile。已在 DSH Desktop 2.0.18、dsh `0.2.1-rc.2` 上验证。
>
> 仓库：<https://github.com/TT10-24/dsh-plugin-updater> · 维护说明：[docs/MAINTAINING.md](docs/MAINTAINING.md) · 开发历程：[docs/BUILD-LOG.md](docs/BUILD-LOG.md)

---

## 功能

- **三层检查**
  - 已安装插件：读取 profile 的 `package.json` 与实时 bundle 列表，对比 npm registry。
  - DSH Desktop：调用官方版本服务，显示当前版本与最新版本。
  - 内核（`@deepseek-ai/dsh`）：显示随桌面端内置的版本，仅提示，随桌面端更新。
- **实时进度**：更新时显示进度条、当前阶段（卸载 / 安装 / 重新检查）和 pnpm 最后一行输出。
- **一键全部更新**：一次点击依次更新所有待更新插件，逐个显示进度。
- **更新完成立即消失**：成功的插件行立刻从列表移除，不再闪回“更新”按钮。
- **重启提示与按钮**：更新返回 `restart-required` 时显示「立即重启 DSH」，走桌面端官方重启路由。
- **可拖动面板**：拖动标题栏移动、双击复位、位置记忆、`Esc` 关闭。
- **零 token**：所有检查是普通 HTTPS 请求，更新走 DSH 已有的插件管理器与 pnpm。
- **中英文界面**，跟随 DSH 语言。

## 安装

### 从 GitHub 安装（推荐）

在 DSH Desktop 中打开 **设置 → 插件 → 添加插件**，填入仓库地址，例如：

```
github:TT10-24/dsh-plugin-updater
```

或使用 CLI：

```bash
dsh plugin --profile desktop add github:TT10-24/dsh-plugin-updater
```

也可以固定到某个版本（打 tag 后）：

```bash
dsh plugin --profile desktop add github:TT10-24/dsh-plugin-updater#v0.3.0
```

安装完成后**重启 DSH Desktop**。插件会出现在侧边栏底部（设置按钮旁），显示「查看更新」。

### 从本地目录安装

```bash
dsh plugin --profile desktop add link:"F:/path/to/dsh-plugin-updater"
```

## 使用

1. DSH 启动后会静默检查；有更新时侧边栏出现数量徽标。
2. 点击「查看更新」打开面板。
3. 单个插件点「更新」；多个插件可点「全部更新 (N)」。
4. 面板顶部显示实时进度条与 pnpm 日志末行。
5. 更新成功的插件立即消失；如提示需要重启，点「立即重启 DSH」。
6. 面板可以拖到任意位置，位置会被记住；双击标题栏复位。

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖本插件的行配置：

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

## 兼容性说明

- **插件更新**：DSH 插件管理器的 `installBundle` 在 HMR 环境下拒绝安装已存在的依赖；本插件使用官方同款路径 **先 `removeBundle` 再安装新版本**，失败时自动恢复旧版本。
- **需要重启**：替换已安装插件的代码后，需要重启 DSH Desktop 才能加载新的模块和新增组件行；面板会给出重启按钮。
- **构建脚本**：某些插件需要批准 pnpm 构建脚本；失败时会显示待批准列表并恢复旧版本，可在插件页手动批准后重试。
- **普通 Web 运行**：没有桌面端时，桌面端区域显示“未检测到桌面端”，不会显示更新按钮。
- **自动适配**：`pluginManager`、`profileContext`、`desktopRuntime` 都是可探测服务；内核缺少某项能力时只降级对应图层，不会让插件卡死。

## 隐私与网络

- 读取：profile 的 `package.json`、已安装包的版本号。
- 请求：npm registry（默认 `registry.npmjs.org`）的包版本；DSH Desktop 官方版本服务 `www.dshdesktop.cn`。
- 不发送：会话内容、提示词、凭据或任何模型请求。
- 不调用：LLM、agent 工具、subagent。更新由 DSH 插件管理器执行。

## 开发

运行时文件只有四个：`index.js`（Host）、`client.js`（Web 客户端）、`protocol.js`（内核协议兼容层）、`cordis.patch.yml`（挂载）。没有构建步骤。

仓库内的 `.check/` 是开发期自检脚本（不随 npm 包发布），覆盖 Host 更新/回滚、locale 平衡、无头组件渲染、拖动与批量更新：

```bash
node .check/locale-check.mjs ./client.js
node .check/render-check.mjs ./client.js
node .check/drag-check.mjs ./client.js
```

Host 自检需要 DSH 安装目录来解析 `@deepseek-ai/*`，用法见 [docs/MAINTAINING.md](docs/MAINTAINING.md)。

## 维护与发布

日常修改 → 提交 → 推送 → 打 tag/发布 Release 的完整步骤写在 [docs/MAINTAINING.md](docs/MAINTAINING.md)。其他人可以用 `dsh plugin --profile <name> add github:TT10-24/dsh-plugin-updater` 安装；固定版本用 `#v0.3.0`。

> GitHub 安装不依赖 npm 发布。如果以后也要发布到 npm，请先确认 `dsh-plugin-updater` 这个名称可用，或改成带 scope 的包名；改名时同步修改 `cordis.patch.yml` 里的 `name`。

## 项目文档

- [架构说明](docs/ARCHITECTURE.md)：Host/Client 分工、三层检查、更新与进度事件。
- [开发历程](docs/BUILD-LOG.md)：从 0.1.0 到 0.3.0 的真实问题与修复记录。
- [维护指南](docs/MAINTAINING.md)：GitHub 新手向的提交、推送、Release、Issues、Actions。

## License

MIT
