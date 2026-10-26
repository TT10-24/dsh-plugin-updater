# 架构说明

这个插件只有两个运行时半边，没有构建步骤：

| 文件 | 运行位置 | 职责 |
| --- | --- | --- |
| `index.js` | DSH Host（Node/Electron 主进程） | 读取 profile、请求 npm/桌面端版本服务、调用插件管理器执行更新 |
| `client.js` | DSH Web 页面 | 侧边栏入口、可拖动面板、进度条、批量更新、重启按钮 |
| `protocol.js` | Host | 只从 `@deepseek-ai/cordis` 取 `Service`，作为内核兼容层 |
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

Host 用一个普通 Cordis Service（`pluginUpdater`）暴露三个方法：

- `check(force)`：缓存 5 分钟；`force:true` 强制刷新。
- `update(name, version, requestId)`：更新一个插件。
- `status()`：轻量存活信息与 `compat`。

Remote 绑定是内联的纯 JSON：

```js
this.typertRemote = Object.freeze({ service: this, serviceKey: 'pluginUpdater', namespace: 'pluginUpdater' })
```

方法标记通过 `@deepseek-ai/dsh-typert-protocol/remote-methods` 原型描述符写入，因此不需要引入 typert 包，也不需要编译。

## 更新一个插件为什么是 remove + install

DSH 插件管理器的 `installBundle` 在 HMR 环境下会拒绝“已经存在于 profile 依赖”的包（`already-installed`），它是给“新增插件”用的。官方插件页的更新路径是：

1. `removeBundle(name)` 卸载旧版本；
2. `installBundle("name@新版本", { enabled: true, requestId })` 安装新版本；
3. 失败时用旧版本（先精确版本，再原始 spec）恢复。

替换已安装插件的 JS 模块后，**新的组件行需要重启 DSH Desktop 才会进入运行树**；面板检测到 `restart-required` 会显示「立即重启 DSH」。

## 进度

Host 把客户端生成的 `requestId` 传给 `installBundle`。管理器的 `runPnpm` 在该请求期间发出：

- `plugin-manager/install-state`：阶段与 registry 尝试；
- `plugin-manager/install-log`：pnpm 输出块。

客户端在第一次更新时懒订阅这两个事件（`ctx.get('remote')?.$on`），按 `requestId` 过滤。若内核不转发事件，进度条按本地阶段计时推进（1.2s 后从“卸载”进入“安装”），不会卡住。

## 立即消失

更新成功后，客户端不等重新检查，先把该行在本地报告里改成 `current` 并移出列表（`markUpdated`），再在后台 `check(true)` 校正。因此不会出现“更新按钮闪回一下才消失”。

## 兼容性策略

- `pluginManager`、`profileContext`、`desktopRuntime` 全部用 `ctx.get()` 探测，缺失只降级对应图层。
- 版本来源多级回退：运行时服务 → 打包 manifest → 环境变量。
- 外部响应宽容解析（`version` / `latestVersion` / 裸版本字符串）。
- `protocol.js` 只依赖 `@deepseek-ai/cordis`，并对 `default.Service` 兜底。

## 安全与 token

- 检查只发普通 HTTPS GET：npm registry 与 `www.dshdesktop.cn`。
- 更新调用 DSH 自己的插件管理器 / pnpm；不调用 LLM、agent 工具或 subagent。
- 不读取会话内容、提示词或凭据；只读 profile 的 `package.json` 与已安装包版本。

## 已知限制

- 普通 Web 运行没有桌面端路由，桌面端区域显示“未检测到桌面端”。
- 某些插件需要批准 pnpm 构建脚本；失败时恢复旧版本并显示待批准列表。
- 更新后必须重启才能加载新代码；这是 DSH 插件替换机制的限制。
