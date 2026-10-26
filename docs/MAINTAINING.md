# 维护指南（GitHub 新手向）

仓库：<https://github.com/TT10-24/dsh-plugin-updater>

## 先理解几个词

- **仓库（Repository）**：一个项目的文件夹。这个仓库只放 `dsh-plugin-updater` 一个插件。
- **提交（Commit）**：给当前文件状态拍一张快照，附带一句说明。
- **分支（Branch）**：并行开发线。默认叫 `main`，个人项目只用一个就够。
- **远程（Remote）**：GitHub 上的仓库副本，通常叫 `origin`。
- **推送（Push）**：把本地提交上传到 GitHub。
- **Release / Tag**：给某个版本打标签并写发布说明，别人可以固定安装这个版本。

## 日常修改流程

插件源码在：

```
F:\Program Files\DSH\plugins\dsh-plugin-updater
```

改完文件后：

```bash
cd "F:/Program Files/DSH/plugins/dsh-plugin-updater"
git status                 # 看改了哪些文件
git diff                   # 看具体改动
git add -A                 # 暂存全部改动
git commit -m "fix: 修复某个问题"
git push
```

第一次推送或登录过期时，Git Credential Manager 会打开浏览器，登录 GitHub 并点授权即可。

### 用 GitHub 网页改文档

小的 README/文档改动可以直接在 GitHub 网页点文件 → 铅笔图标 → 修改 → **Commit changes**。代码改动建议仍在本地做，因为需要重启 DSH 验证。

### 用 GitHub Desktop（可选）

如果不想记命令，可以安装 GitHub Desktop，把 `F:\Program Files\DSH\plugins\dsh-plugin-updater` 添加为本地仓库，之后用图形界面提交/推送。

## 发新版本

1. 修改 [package.json](package.json) 的 `version`（例如 `0.3.1`）。
2. 在 [CHANGELOG.md](CHANGELOG.md) 顶部加一节，写清改了什么。
3. 运行检查：

```bash
node .check/locale-check.mjs ./client.js
node .check/render-check.mjs ./client.js
node .check/drag-check.mjs ./client.js
```

4. 提交并推送：

```bash
git add -A
git commit -m "chore: release v0.3.1"
git push
```

5. 打标签并推送标签：

```bash
git tag -a v0.3.1 -m "v0.3.1"
git push origin v0.3.1
```

6. 在 GitHub 网页：**Releases → Draft a new release**，选择标签 `v0.3.1`，标题和说明可用 CHANGELOG 内容，点 **Publish release**。

别人安装固定版本：

```bash
dsh plugin --profile desktop add github:TT10-24/dsh-plugin-updater#v0.3.1
```

## 别人怎么安装

- 插件页：**设置 → 插件 → 添加插件**，填 `github:TT10-24/dsh-plugin-updater`。
- CLI：

```bash
dsh plugin --profile desktop add github:TT10-24/dsh-plugin-updater
```

安装/更新后需要重启 DSH Desktop。插件本身也会检查并提示更新。

## Issues 和 Actions

- **Issues**：别人反馈问题的地方。仓库默认开启。可以给 issue 加 `bug` / `enhancement` 标签。
- **Actions**：仓库的自动检查。每次 push 会运行 `.github/workflows/check.yml`，检查语法、locale、渲染和拖动测试。打开仓库的 **Actions** 标签可以看到绿色勾或红色叉。

## 常见错误

- **不要提交** `node_modules/`、日志、`.check` 里的临时文件；`.gitignore` 已处理常见项。
- **不要提交 token/密码**；如果误提交，立刻在 GitHub 设置里撤销该 token。
- **不要强推**（`git push --force`）到 `main`，除非你明确知道自己在做什么。
- **换行/编码**：保持 UTF-8；Windows 的 CRLF 不影响 Node 运行。
- **更新后组件不运行**：替换插件后需要重启 DSH Desktop，新增组件行才会进入运行树。

## 撤销一次坏提交

```bash
git log --oneline          # 找到要撤销的提交
git revert <commit-id>     # 生成一个反向提交（推荐，保留历史）
git push
```

## 本机 Host 自检（可选）

`selfcheck.mjs` 需要 DSH 安装目录来解析 `@deepseek-ai/*`，并且需要一个真实 profile：

```bash
cd "F:/Program Files/DSH/plugins/dsh-plugin-updater"
$env:DSH_DESKTOP_RESOURCES = "F:/Program Files/DSH Desktop/resources"
node .check/selfcheck.mjs "F:/DSH-Home/profiles/desktop" "./client.js"
```

（自检会写一条 `update-trace.log` 到 `<DSH_HOME>/plugin-updater/`，可删除。）
