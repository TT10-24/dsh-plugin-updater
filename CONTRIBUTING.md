# 贡献指南

欢迎提交 issue 或 pull request。这个插件刻意保持简单：没有构建步骤、没有运行时依赖、只有四个运行文件。

## 本地开发

```bash
git clone https://github.com/TT10-24/dsh-plugin-updater.git
cd dsh-plugin-updater
```

把插件挂到自己的 DSH profile（示例）：

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

Host 自检需要 DSH 安装目录与真实 profile，见 [docs/MAINTAINING.md](docs/MAINTAINING.md)。

## 约定

- 只用原生 ESM，不引入运行时依赖；客户端只 `require('react')`。
- 颜色只用 `--dsw-alias-*` 主题 token，不写死颜色（图标除外）。
- 用户可见文字同时更新 `locale/zh.json` / `locale/en.json` 和 `client.js` 里的字典。
- 更新/回滚逻辑只放在 Host 的 `update()`；客户端不重复实现。
- 提交信息建议：`feat: ...`、`fix: ...`、`docs: ...`、`chore: ...`。

## Pull Request

1. Fork 本仓库。
2. 在分支上修改并跑检查。
3. 提交 PR，说明改了什么、怎么验证的（最好附 DSH 版本与复现步骤）。
