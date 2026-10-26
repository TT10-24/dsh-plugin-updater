# 安全策略

## 报告漏洞

如果你发现安全问题，请不要在公开 Issue 里贴 token、密码、会话内容或可被利用的细节。请使用仓库的 **Security → Report a vulnerability**（GitHub Security Advisories）私密报告。

## 这个插件会接触什么

- 读取：你的 DSH profile 的 `package.json`、已安装包版本。
- 请求：npm registry 的包版本；DSH Desktop 官方版本服务。
- 更新：调用 DSH 插件管理器与 pnpm，不会自行执行任意脚本。

## 不会做什么

- 不读取会话内容、提示词或凭据。
- 不调用 LLM、agent 工具或 subagent。
- 不把任何数据发送到上述服务之外的地方。

## 支持范围

只对最新 Release 和 `main` 提供安全修复。更新后请重启 DSH Desktop，让新代码生效。
