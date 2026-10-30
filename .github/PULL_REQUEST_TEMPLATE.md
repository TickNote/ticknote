## 变更说明 / What changed

<!-- 这个 PR 做了什么？为什么需要？请聚焦一件事。/ What does this PR do? Why is it needed? Keep it focused on one thing. -->

## 关联 Issue / Related issue

<!-- 例如 Closes #12；没有关联 Issue 时说明背景 / e.g. Closes #12; explain the background when there is no related issue -->

## 测试方式 / How it was tested

<!-- 列出跑过的命令与手动验证步骤；UI 改动请说明测试路径 / List the commands you ran and the manual verification steps; for UI changes describe the test path -->

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm test`（或 `npm run test:mcp`，涉及 MCP 时先 `npm run build:mcp`）/ (or `npm run test:mcp`; run `npm run build:mcp` first when MCP is involved)
- [ ] 手动验证 / Manual verification（步骤 / steps：）

## 截图与录屏 / Screenshots and recordings

<!-- UI 相关改动请附上前后对比；无 UI 改动可写“不适用” / Attach before/after comparisons for UI changes; write “N/A” when there is no UI change -->

## 检查清单 / Checklist

- [ ] 已跑 typecheck / test / build，或说明了为何不适用 / Ran typecheck / test / build, or explained why they do not apply
- [ ] 未提交 `release/`、`resources/mcp/server.js` 等生成物 / No generated files such as `release/` or `resources/mcp/server.js` are committed
- [ ] 新增/修改 IPC 或 MCP 工具已同步 `docs/ARCHITECTURE.md`、`docs/MCP.md` / New or changed IPC / MCP tools are reflected in `docs/ARCHITECTURE.md` and `docs/MCP.md`
- [ ] 未包含真实 API Key、数据库文件或私人记录 / No real API keys, database files or private records are included
- [ ] 变更聚焦，未混入无关格式化或重构 / The change is focused, with no unrelated formatting or refactoring
- [ ] 已阅读 [CONTRIBUTING.md](/CONTRIBUTING.md)（[English](/CONTRIBUTING.en.md)）与行为准则 / Read [CONTRIBUTING.md](/CONTRIBUTING.md) ([English](/CONTRIBUTING.en.md)) and the Code of Conduct
