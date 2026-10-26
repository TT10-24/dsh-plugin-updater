# Pull Request

## 这个 PR 做了什么

<!-- 用一两句话说明你改了什么，以及为什么。 -->

## 关联议题

<!-- 例如 Closes #12；合并后 GitHub 会自动关闭这些议题。 -->

## 你怎么验证的

- [ ] `node --check index.js`
- [ ] `node --check client.js`
- [ ] `node --check protocol.js`
- [ ] `node .check/locale-check.mjs ./client.js`
- [ ] `node .check/render-check.mjs ./client.js`
- [ ] `node .check/drag-check.mjs ./client.js`
- [ ] 在 DSH Desktop 里重启并手动验证（说明版本）

## 自查清单

- [ ] 没有提交 token、密码或本机隐私路径
- [ ] 界面文字在中文/英文字典里保持平衡
- [ ] 文档使用“你”与访问者对话
- [ ] 更新/回滚逻辑仍只在 Host 的 `update()` 里
