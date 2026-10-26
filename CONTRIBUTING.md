# 贡献指南

欢迎你提交 Issue 或 Pull Request。这个插件刻意保持简单：没有构建步骤、没有运行时依赖，运行时只有四个文件。

## 本地开发

```bash
git clone https://github.com/TT10-24/dsh-plugin-updater.git
cd dsh-plugin-updater
```

把插件挂到你的 DSH profile（示例）：

```bash
dsh plugin --profile desktop add link:"<本目录绝对路径>"
```

修改后重启 DSH Desktop。

## 检查

```bash
node --check index.js
node --check client.js
node --check protocol.js
node .check/locale-check.mjs ./client.js
node .check/render-check.mjs ./client.js
node .check/drag-check.mjs ./client.js
```

Host 自检需要 DSH 安装目录和真实 profile，只在本机运行；GitHub Actions 只跑纯 Node 检查：

```bash
DSH_DESKTOP_RESOURCES="<DSH Desktop>/resources" \
  node .check/selfcheck.mjs "<DSH_HOME>/profiles/desktop" "./client.js"
```

## 约定

- 只用原生 ESM，不引入运行时依赖；客户端只 `require('react')`。
- 颜色只用 `--dsw-alias-*` 主题 token，不写死颜色（图标除外）。
- 你看到的界面文字要同时更新 `locale/zh.json` / `locale/en.json` 和 `client.js` 里的字典。
- 更新/回滚逻辑只放在 Host 的 `update()`；客户端不重复实现。
- 提交信息建议：`feat: ...`、`fix: ...`、`docs: ...`、`chore: ...`。

## 提 PR 之前

1. 先看 [项目看板](https://github.com/users/TT10-24/projects/3) 和已有 Issue，避免重复。
2. 从 `main` 切一个分支，例如 `feat/progress-bar`。
3. 跑完上面的检查。
4. 提交 PR，说明你改了什么、怎么验证的，并附上 DSH Desktop / dsh 版本与复现步骤。
5. 在 PR 描述里用 `Closes #编号` 关联对应 Issue。

## 报告问题

请使用 [Bug 模板](https://github.com/TT10-24/dsh-plugin-updater/issues/new?template=bug_report.yml)，尽量附上：

- DSH Desktop 版本与 dsh 内核版本
- 插件版本
- 操作系统
- 复现步骤、期望结果、实际结果
- 相关日志（去掉 token/隐私信息）

## Pull Request 检查清单

- [ ] 语法与 `.check/` 检查通过
- [ ] 中英文字典平衡
- [ ] 没有提交 token、密码或本机隐私路径
