# 贡献指南

感谢你愿意改进 TickNote（待办便签）。这是一个 Windows-only 的 Electron 桌面应用，MIT 许可。改动前请先读 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 与 [DESIGN.md](DESIGN.md)。

## 开发环境

- **Windows 10 / 11 x64**（托盘、系统通知、NSIS 打包都依赖 Windows）。
- **Node.js >= 22**（`.nvmrc` 固定为 22）。数据库使用内置的 `node:sqlite`，不需要 MSVC，也没有原生模块。
- npm（仓库提交了 `package-lock.json`，请用它安装）。

```powershell
git clone https://github.com/TickNote/ticknote.git
cd ticknote
npm install
npm run dev
```

## 常用命令

| 命令                                                       | 说明                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| `npm run dev`                                              | electron-vite 开发模式（主进程改动自动重启，渲染层 HMR） |
| `npm run build`                                            | 构建 main / preload / renderer 到 `out/`                 |
| `npm run build:mcp`                                        | esbuild 打包 MCP server → `resources/mcp/server.js`      |
| `npm run build:all`                                        | `build` + `build:mcp`                                    |
| `npm start`                                                | 运行已构建的应用（`electron .`）                         |
| `npm run typecheck`                                        | `tsc --noEmit`                                           |
| `npm run lint` / `npm run format` / `npm run format:check` | oxlint / Prettier                                        |
| `npm test`                                                 | `vitest run` + `npm run test:mcp`                        |
| `npm run test:watch`                                       | vitest watch 模式                                        |
| `npm run test:mcp`                                         | MCP 端到端测试（先 `build:mcp`）                         |
| `npm run dist`                                             | `build:all` + electron-builder，产物在 `release/`        |
| `npm run pack:portable`                                    | 把 `release/win-unpacked` 打成便携 zip                   |

> `npm test` 先跑 `vitest run`（用例在 `tests/*.test.ts`，配置见 `vitest.config.mts`），再跑 MCP 端到端脚本。涉及 MCP 时先执行 `npm run build:mcp`，否则测的是旧的 `resources/mcp/server.js`。

## 目录结构（简述）

```
src/main/      Electron 主进程：窗口、托盘、热键、提醒、设置、导出、卸载、IPC、数据库
src/preload/   contextBridge 白名单（window.api）
src/renderer/  React 19，两个入口 main.html / capture.html
src/shared/    IPC 通道名（ipc.ts）与 DTO（types.ts）
src/mcp/       stdio MCP server（独立进程，复用 main/db/repo.ts）
tests/         vitest 用例（repo / export / ai-parse）
scripts/       MCP 端到端与冒烟脚本、便携打包脚本
build/         图标与 NSIS 自定义脚本
docs/          架构、MCP、隐私文档
```

根目录另有 `vitest.config.mts`、`.prettierrc`、`.prettierignore`、`.editorconfig`。

完整树与数据流见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 代码约定

1. **SQL 只写在 `src/main/db/repo.ts`。** IPC handler 与 MCP 工具都调 repo，不要在别处拼 SQL。
2. **跨进程契约集中在 `src/shared/`。** 通道名从 `IPC` 常量引用，不要写字面量；DTO 从 `types.ts` 导入。
3. **主进程必须校验入参。** 每个 `ipcMain.handle` 用 zod 校验，限制字符串长度、uuid、枚举。
4. **preload 只暴露白名单方法。** 不要暴露 `ipcRenderer`、`require` 或任意通道调用；渲染层保持 `contextIsolation: true` / `nodeIntegration: false`。
5. **保持零依赖倾向。** 数据库用 `node:sqlite`，构建用 electron-vite / esbuild；新增运行时依赖前请先说明理由。
6. **不要改动已发布的数据库 DDL。** schema 变更请追加 `SCHEMA_VERSION` 迁移分支。
7. **UI 文案用中文。** 与现有界面保持一致（「记录」「润色」「卸载」，不用「发送」「录入」）。
8. **不修改 `DESIGN.md` 以迁就实现。** 实现偏离设计时，在 Issue/PR 里说明原因。

## 提交规范（Conventional Commits 简版）

格式：

```
<type>(<scope>): <subject>
```

常用 type：

| type       | 用途                   |
| ---------- | ---------------------- |
| `feat`     | 新功能                 |
| `fix`      | 缺陷修复               |
| `docs`     | 只改文档               |
| `refactor` | 不改变行为的重构       |
| `perf`     | 性能优化               |
| `test`     | 测试相关               |
| `build`    | 构建 / 依赖 / 打包配置 |
| `ci`       | CI 配置                |
| `chore`    | 杂项（格式化、清理）   |

scope 可用：`main`、`renderer`、`preload`、`db`、`mcp`、`export`、`ai`、`settings`、`docs`、`build`。

示例：

```
feat(mcp): 增加 search_items 的 kind 过滤
fix(renderer): 抽屉切换类型后按当前筛选立即刷新
docs(architecture): 补充 MCP 数据库路径解析顺序
build: 只保留 zh-CN / en-US 语言包
```

要求：

- subject 用一句话说明“做了什么”，不加句号，长度控制在 72 字符内。
- 一个提交只做一件事；格式化、重构、功能不要混在一起。
- 正文（可选）说明“为什么”，关联 Issue 用 `Closes #12`。

## 新增 IPC 检查清单

- [ ] `src/shared/ipc.ts` 增加通道名常量
- [ ] `src/shared/types.ts` 增加/复用 DTO
- [ ] `src/main/db/repo.ts` 增加数据方法（SQL 只在这里）
- [ ] `src/main/index.ts` 的 `setupIpc()` 注册 handler，并用 zod 校验
- [ ] 写操作后调用 `notifyItemsChanged()`（刷新托盘 + 通知主窗）
- [ ] `src/preload/index.ts` 暴露对应方法（事件类返回取消订阅函数）
- [ ] `src/renderer/src/api.ts` 的 mock 补同名实现，保持浏览器预览可用
- [ ] `docs/ARCHITECTURE.md` 与 `DESIGN.md` 第 8 节的通道表同步
- [ ] `npm run typecheck` 通过

## 新增 MCP 工具检查清单

- [ ] `src/mcp/server.ts` 用 `registerTool` + zod `inputSchema`
- [ ] 只调用 `repo` 方法，不写 SQL
- [ ] 读操作标 `annotations.readOnlyHint: true`；破坏性操作标 `destructiveHint: true`
- [ ] 返回 `ok(serialize(...))` / `fail(...)`，字段与现有工具一致
- [ ] 删除等不可逆操作默认不注册，由 `settings.json` 开关控制
- [ ] `docs/MCP.md` 工具表更新
- [ ] `scripts/test-mcp.ts` 补端到端断言
- [ ] `npm run build:mcp && npm run test:mcp` 通过

## 测试与打包

- 提交前至少跑：`npm run typecheck`、`npm run lint`、`npm run build`、`npm test`。只改 MCP 时跑 `npm run build:mcp && npm run test:mcp`。
- 单元测试放在 `tests/`（`repo.test.ts`、`export.test.ts`、`ai-parse.test.ts`），由 `vitest.config.mts` 指定 `tests/**/*.test.ts`；需要边改边跑用 `npm run test:watch`。
- `scripts/` 里还有独立的冒烟脚本（`test-db.ts`、`test-ai.ts`），可用 `npx tsx scripts/test-db.ts` 单独运行；MCP 的端到端脚本则是 `scripts/test-mcp.ts`。
- 打包验证：

  ```powershell
  npm run dist
  # 产物：release\TickNote-<version>-Setup.exe 与 release\win-unpacked\
  npm run pack:portable
  # 产物：release\TickNote-<version>-portable.zip
  ```

- 打包后请手动冒烟：启动主窗、热键唤起浮窗并保存、关闭到托盘、导出 Markdown、设置面板可打开。改动 MCP 时，用 `release\win-unpacked\TickNote.exe` + `resources\mcp\server.js`（`ELECTRON_RUN_AS_NODE=1`）连接一次。

## Issue 要求

- **Bug**：用 Bug 报告模板，写清版本、安装方式（Setup / 便携 / 开发）、系统版本、复现步骤、期望结果；附日志或截图，但**不要粘贴 API Key 或私人记录**。
- **功能建议**：用功能建议模板，先讲使用场景，再讲期望行为。
- 先搜索已有 Issue，避免重复；一个 Issue 只谈一个问题。
- 安全漏洞**不要**开公开 Issue，请按 [SECURITY.md](SECURITY.md) 私下报告。

## PR 要求

- 从最新 `main` 拉分支，PR 描述用仓库模板（变更说明、关联 Issue、测试方式、截图）。
- 保持 diff 聚焦：不混入无关的格式化或重构。
- 新增行为请补测试或说明为何无法自动测试；UI 改动请附截图或录屏。
- 合并前确保 CI 通过（GitHub Actions 在 `windows-latest` 上跑 `typecheck` / `lint` / `build:all` / `test`），并至少一位维护者 Review。
- 提交前确认没有把生成物或本地数据带进仓库。

## 不要提交的文件

以下内容已在 `.gitignore` 中，请勿强制添加：

- `release/`（安装包、`win-unpacked`、便携 zip）
- `resources/mcp/server.js`（由 `npm run build:mcp` 生成）
- `out/`、`dist/`、`.vite/`、`coverage/`
- `.tmp/`、`.screenshots/`、`scripts/.cache/`
- `*.log`、`*.tsbuildinfo`

另外，本地数据（`ticknote.db`、`*.db-wal`、`*.db-shm`、`settings.json`）虽然默认存放在 `%APPDATA%\TickNote` 而不在仓库里，也请不要复制进仓库或贴到 Issue / PR 中。

## 许可

向本仓库提交代码即表示你同意以 [MIT License](LICENSE) 授权你的贡献，版权归 TickNote Contributors。
