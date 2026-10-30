# TickNote（待办便签）设计文档（v1.13 · 对应应用 0.1.1）

> 状态：当前规格已与 0.1.1 代码核对 · Electron / SQLite / MCP stdio
> 0.1.1 修订：草稿恢复与异步防覆盖、复合分页和字面搜索、跨进程写入刷新、独立导出目录、JSON 备份合并恢复、统一删除撤销、提醒筛选与显式应用、AI 连接测试与设置安全持久化；界面细节同时修正输入区重复焦点框、外观菜单换行、AI 润色按钮常驻高亮。
> 范围：第 1–12、14 节描述当前功能；第 13、15、16 节保留历史记录，历史验收不代表本版本全部实机验证通过。每日自动数据库备份、按 AI 批次撤销尚未实现。
> 产品定位：记录内容与创建时间，不做任务调度。

## 1. 目标

做一个常驻托盘的本地速记工具：按一个热键弹出输入框，写下内容和时间就走；需要时再回来看、搜索、完成，偶尔给某条记录设个提醒；同时通过 MCP 让任意 AI 客户端读写同一份记录。

### 1.1 必须做到

1. **捕获摩擦接近 0**：热键 → 输入 → 回车 → 窗口消失，全程不打断当前工作。
2. **本地优先**：数据只存在本机的一个 SQLite 文件，不联网也能用。
3. **AI 可读可写**：MCP 作为标准出口，App 不启动时 AI 也能读写（stdio 子进程直连数据库）。
4. **可长期使用**：单文件数据库 + 导出能力，不怕软件跑路。

### 1.2 非目标（明确不做）

- 项目管理、甘特图、多人协作、日历视图
- 富文本 / 图片 / 附件
- 云同步、账号体系
- 标签树、复杂优先级体系
- 内置聊天机器人（只保留一个可选的“自然语言录入”）

---

## 2. 总体方案

```
              ┌──────────────┐
  全局热键 →  │ 浮窗（捕获） │ ─┐
              └──────────────┘  │
              ┌──────────────┐  ├──→ SQLite 单文件（唯一数据源）
  托盘/主窗 → │ 主窗（回顾） │ ─┘         ↑
              └──────────────┘            │
                                   ┌──────┴───────┐
  AI 客户端（Claude / Cursor / Trae）→│ MCP stdio 子进程 │
                                   └──────────────┘
```

人和 AI 共用一份数据，不设第二套存储；MCP 进程与 App 进程通过 SQLite WAL 并发读写。

---

## 3. 技术栈

| 层次 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | Electron（package-lock.json 固定安装解析版本） | 生态成熟、坑少；代价是包体和常驻内存 |
| 构建 | electron-vite + electron-builder | 开发热更新 + NSIS 安装包 |
| 前端 | React + TypeScript | 两个窗口共用组件 |
| 存储 | Electron 内置 `node:sqlite` + WAL + FTS5 | 无原生编译依赖，多进程安全；本机无 MSVC，改用内置 SQLite |
| MCP | `@modelcontextprotocol/sdk` 1.32 + stdio | 官方 SDK，工具用 zod 定义 schema；入口用 esbuild 打成单文件 |
| 打包 | electron-builder 26（NSIS） | 免安装目录、安装包、开始菜单快捷方式（AUMID 依赖它） |
| 校验 | zod | IPC 入参与 MCP 入参共用 |

依赖清单（核心）：`electron`、`electron-vite`、`electron-builder`、`@modelcontextprotocol/sdk`、`zod`、`react`；SQLite 用运行时内置能力，不引第三方包。

---

## 4. 工程结构

```
ticknote/
├─ src/
│  ├─ main/
│  │  ├─ index.ts            应用入口、单实例锁、数据迁移、提醒调度
│  │  ├─ windows.ts          主窗/浮窗创建、定位与拖动记忆
│  │  ├─ tray.ts             托盘图标、菜单与角标
│  │  ├─ ipc.ts              IPC handler（zod 校验）
│  │  ├─ settings.ts         settings.json 读写、AI Key 加解密
│  │  ├─ db/
│  │  │  ├─ schema.ts        DDL 与版本号（随包编译）
│  │  │  └─ repo.ts          items 的唯一数据访问层
│  │  ├─ ai/parse.ts         可选：当前输入文本润色
│  │  └─ export/markdown.ts  导出
│  ├─ mcp/server.ts          stdio MCP 入口（独立进程）
│  ├─ preload/index.ts       contextBridge 白名单 API
│  ├─ renderer/
│  │  ├─ main.html / capture.html
│  │  └─ src/                 App + components/ + utils.ts
│  └─ shared/                类型、IPC 通道名
├─ resources/mcp/server.js   esbuild 产物（build:mcp 生成，不入库）
├─ tests/                    Vitest 单元测试
├─ electron-builder.yml
└─ package.json
```

关键约定：
- `repo.ts` 是**唯一**直接碰数据库的模块，IPC 和 MCP 都调它，禁止各自写 SQL。
- `preload` 只暴露白名单方法，渲染进程无 Node 能力（`contextIsolation: true`、`nodeIntegration: false`）。

---

## 5. 数据模型

### 5.1 表结构

```sql
CREATE TABLE items (
  id           TEXT PRIMARY KEY,              -- uuid v4
  content      TEXT NOT NULL,                 -- 原始文本，不加工
  kind         TEXT NOT NULL DEFAULT 'note'
               CHECK (kind IN ('note','todo')),
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','done')),
  remind_at    INTEGER,                       -- UTC 毫秒；可选提醒，NULL 表示不提醒
  reminded_at  INTEGER,                       -- 请求通知前的处理标记，防重复；非送达回执
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  completed_at INTEGER,
  source       TEXT NOT NULL DEFAULT 'human'
               CHECK (source IN ('human','ai')),
  ai_run_id    TEXT                           -- AI 调用标识；批次撤销尚未实现
);

CREATE INDEX idx_items_created ON items(created_at);
CREATE INDEX idx_items_remind  ON items(remind_at) WHERE remind_at IS NOT NULL;
CREATE INDEX idx_items_status  ON items(status, created_at);
```

### 5.2 全文搜索

```sql
CREATE VIRTUAL TABLE items_fts USING fts5(
  content, content='items', content_rowid='rowid', tokenize='trigram'
);
-- 配 INSERT / UPDATE / DELETE 三个触发器同步
```

- 中文必须用 `trigram`，默认分词器对中文基本无效。
- trigram 要求查询串 ≥3 字符；不足 3 字符时走 `LIKE` 回退。查询按字面文本匹配：FTS 双引号转义，LIKE 转义 `%`、`_`、反斜线，不删除 URL、路径和括号。
- 列表固定按 `(created_at DESC, id DESC)` 排序；新分页游标为 `{createdAt, id}`，相同时间戳也不漏记录，边界记录删除后仍可续页。兼容旧数字游标，但旧游标无法区分同毫秒记录。

### 5.3 时间与分组规则

- 全部存 UTC 毫秒，展示时转本地时区。
- 列表只按**创建时间**分组：今天 → 昨天 → 更早日期（标 `MM-DD`），组内按 `(created_at DESC, id DESC)` 排序。
- `remind_at` 只用于弹通知，**不参与分组、不影响排序**；列表里用「提醒 HH:mm」小标记提示。
- 请求系统展示通知前先写 `reminded_at`，避免重启后重复弹；该标记不保证 Windows 实际送达。应用未运行时错过的提醒，在启动后合并成一条“有 N 条提醒已过期”的提示，不逐条弹。
- 不设 `due_at`、不做“逾期”分组，也不因未完成把记录挪到别的分组。
- 时间展示：今天/昨天只显示 `HH:mm`，更早的显示 `MM-DD HH:mm`。
- 修改 `remind_at` 时把 `reminded_at` 重置为 NULL，否则改到未来时间后不会再弹。
- 同一轮扫描命中超过 3 条时合并成一条通知（正文列前 3 条 + “等 N 条”），避免批量提醒刷屏。

### 5.4 数据位置与备份

| 项 | 路径 / 行为 |
|---|---|
| 数据库 | `%APPDATA%\TickNote\ticknote.db`（运行时含 `-wal`、`-shm`） |
| 设置 | `%APPDATA%\TickNote\settings.json`，原子写入，保留 `.bak` 供损坏恢复 |
| 草稿 | Electron userData 下的渲染层 localStorage，主窗、浮窗、逐条编辑分别保存 |
| Markdown | 上次选择的目录，首次默认 `%APPDATA%\TickNote\export\`，每次建独立子目录 |
| JSON 备份 | 设置 → 数据管理 → 备份全部记录，系统对话框选择路径 |

- JSON 格式为 `{format:'ticknote-backup', version:1, exportedAt, items}`，保存 `Item` 的 id、正文、类型、状态、来源和各时间字段，不含设置、API Key、未提交草稿及内部 `ai_run_id`；它是记录备份，不是整个应用目录的镜像。
- 恢复前完整校验文件（最多 100 MB、100000 条）；事务合并，只插入缺失 id，不覆盖已有记录，保持原时间；失败回滚。取消选择不修改数据。
- 如需复制原始数据库，应先退出 App 和所有连接此库的 MCP 进程，保证 WAL 数据已落盘；不要仅复制运行中的主 db 文件。
- 首次启动幂等复制旧 `%APPDATA%\QuickNote` 数据及旧 `quicknote.db`（含现有 WAL/SHM），保留旧文件。
- **未实现 / 后续规划**：每天首次启动自动备份数据库并保留最近 7 份；当前不能依赖自动备份。

---

## 6. 核心流程

### 6.1 捕获

1. 全局热键触发 → 若已有浮窗实例则聚焦，恢复未提交草稿与类型，不清空输入。
2. 浮窗定位到**鼠标所在显示器**居中偏上（`screen.getDisplayNearestPoint(screen.getCursorScreenPoint())`）。
3. 输入框为自适应高度的 textarea（1–5 行），无边框、不透明、带阴影。
4. `Enter` 保存并隐藏；`Shift+Enter` 换行；`Esc` 明确丢弃当前草稿并隐藏；失焦、× 和热键收起保留草稿。
5. 保存内容默认 `kind='todo'`、`status='open'`、`source='human'`；浮窗与主窗都用输入框上方的「待办 / 便签」切换决定 `kind`，不解析 `#todo` 之类的前缀。
6. 保存成功清空已提交草稿，显示“已记录”，约 450ms 后隐藏；重新唤起或编辑使旧计时器失效。保存失败保留输入并显示错误，提交锁防止连续 Enter 重复写入。
7. 主窗底部的常驻多行输入框（composer）：高度随内容增长，最高 120px 后内部滚动；`Enter` 提交并清空、保持焦点，`Shift+Enter` 换行，`Ctrl+N` 聚焦；与浮窗共用 `items:create`。
8. 中文输入法选词时按 `Enter` 只确认候选词、不提交（监听 composition 状态）。
9. 主窗、浮窗及抽屉编辑草稿随输入保存到 localStorage，刷新/重启可恢复；正文上限 2000 字符，有计数与保存状态。AI 返回仅可更新发起时仍有效的草稿，不能覆盖后续编辑或新会话。
10. 热键的最后一个空格可能漏进刚聚焦的输入框，浮窗在唤起后 200ms 内丢弃空格键。

### 6.2 提醒（可选）

- 在详情抽屉里设置：10 分钟后 / 1 小时后 / 今天或明天 18:00 / 明天 9:00 / 自定义时间 / 清除提醒。自定义日期时间编辑完点击「应用」才保存，界面拒绝过去时间。
- 预设「今天 18:00」若当前已过 18:00，则顺延到明天 18:00，避免设下去立刻弹通知。
- 调度：主进程每 30 秒扫描 `remind_at <= now AND reminded_at IS NULL AND status='open'`，命中后先写 `reminded_at` 再弹通知；不堆大量 `setTimeout`，休眠唤醒后也能补上。
- 通知：Electron `Notification` → Windows 操作中心 toast，标题「待办便签提醒」，正文截断 80 字；点击切换到提醒筛选并打开该条；合并通知打开首条。
- 前提：App 必须运行（托盘常驻，默认开机自启，可在设置关闭）；`app.setAppUserModelId` 必须与安装快捷方式的 AUMID 一致，否则 toast 可能不显示。
- 错过：App 未运行时到点的提醒不会弹，启动时扫描过期未提醒项，合并成一条“有 N 条提醒已过期”，不逐条补弹。
- 抑制：Windows 勿扰 / 专注助手、系统通知关闭、应用通知被关都会静默，无法绕过，设置页给出说明。
- 已完成的任务不再提醒；MCP/底层接口允许过去时间，在下一轮扫描时处理（最长约 30 秒），界面自定义输入要求未来时间。
- 「提醒」筛选展示所有未完成且设了提醒的记录，含已经标记提醒的记录；详情显示待提醒 / 待补提醒 / 已提醒 / 已补提醒 / 已完成。「已补提醒」按时间差超过 60 秒推断，不是系统送达回执。
- 提醒不改变列表顺序和分组；没有“稍后提醒”按钮，改时间就是重新设置。

### 6.3 完成

`status='done'` + `completed_at`。已完成仍留在原日期分组里（加删除线），不移动到列表底部；顶部「已完成」可单独筛选。

### 6.4 搜索

顶部单一搜索框，输入即搜（150ms 防抖），命中高亮。搜索覆盖全部记录，不叠加当前列表筛选；结果按 `(created_at DESC, id DESC)` 排序，显示内容、创建时间、状态。主窗最多展示 50 条，并在达到上限时提示缩小关键词。数据变更或窗口恢复焦点后重查，旧请求不能覆盖新查询。

### 6.5 导出 Markdown

- 命名：`notes-YYYY-MM-DD.md`，按创建日期分文件。
- 位置：主窗导出时弹系统「选择文件夹」对话框，默认上次使用的目录（首次为 `%APPDATA%\TickNote\export`）；取消则不写文件。托盘「导出 Markdown」不弹框，直接写到上次/默认目录。
- 待办格式：`- [ ] 内容`（有提醒时追加完整本地日期时间，例如 `提醒 2026-10-30 18:00`），已完成 `- [x]`。
- 入口：主窗 `⋯` →「导出 Markdown」（范围弹窗 + 文件夹选择，完成后 toast 显示条数与目标目录）+ 托盘菜单「导出 Markdown」（气泡提示条数与目录）。
- 每次在选定目录中创建独立 `TickNote-YYYY-MM-DD-HHmmss-<随机后缀>` 子目录，里面按日期写 Markdown；不覆盖以前导出的文件，不做实时双向同步。

---

## 7. 窗口与交互规格

### 7.1 浮窗

| 项 | 规格 |
|---|---|
| 尺寸 | 宽 620；创建初值 150，渲染后通常 242–298；resize 主进程限制 180–330 |
| 样式 | `frame:false`、`alwaysOnTop:true`、`skipTaskbar:true`、`resizable:false`、不透明 |
| 顶部条 | 18px 拖动条：左侧握把可拖动整个窗口，右侧 `×` 隐藏浮窗（不退出应用） |
| 位置 | 首次唤起在鼠标所在屏幕居中；拖动后本次运行内记住，再次唤起重用并夹回工作区 |
| 失焦行为 | 自动隐藏（可设置关闭） |

> 不使用 `transparent:true`：Windows 上透明无边框窗口会让中文输入法候选框错位，这是已知高频问题。

### 7.2 主窗

- 默认 900×640，可缩放；关闭时收进托盘而不是退出（首次关闭给出一次提示）。
- 顶部：标题栏只保留搜索框与右侧 `⋯` 菜单/设置（不显示应用名）；`⋯` 内含「导出 Markdown」与外观切换（跟随 / 浅色 / 深色）→ 筛选行（chip + 右侧统计）。
- 筛选：全部 / 待办 / 便签 / 已完成 / 提醒；统计展示全部未完成待办，跨天不归零。空状态按筛选与搜索分别提示。
- 主体：按创建日期分组（今天 / 昨天 / 更早日期），分组头可折叠；组内按时间倒序；新记录落在顶部并短暂高亮。
- 刷新：保持已加载页数和当前详情；MCP 写入由主进程每 2 秒检查 `PRAGMA data_version` 后通知刷新，回到窗口也重查；跨天更新分组与统计。
- 底部：常驻多行输入框（composer），左侧待办/便签切换，右侧「记录」按钮；内容为空时按钮禁用。

### 7.3 托盘常驻

- 应用常驻托盘：主窗 `close` 事件拦截为 `hide()`，只有托盘菜单「退出」才真正 `app.quit()`（用 `isQuitting` 标志区分）。
- 左键单击托盘图标：显示并聚焦主窗；收起使用窗口关闭按钮。
- 右键菜单：打开浮窗 / 打开主窗 / 未完成待办 N 条（禁用项，仅展示）/ 导出 Markdown / 设置 / 退出。
- 图标 tooltip 显示“未完成待办 N 条、待提醒 M 条”。Windows 托盘没有原生角标 API，不做角标，避免自绘多套状态图标。
- 单实例：`requestSingleInstanceLock`，第二次启动只唤起已有实例；带 `--autostart` 启动时不抢焦点。
- 首次关闭主窗时提示一次“已收进托盘”，之后不再提示。

### 7.4 开机自启

- 设置页提供「开机自启」开关，默认开启（提醒依赖常驻），可随时关闭；关闭只影响下次开机，不退出当前进程。
- 实现：`app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: ['--autostart'] })`；带 `--autostart` 启动时只进托盘，不显示主窗。
- 状态以 `app.getLoginItemSettings()` 为准，不只看 `settings.json`：用户在任务管理器「启动」里禁用后，开关旁显示“已开启但被系统阻止”（读取 `executableWillLaunchAtLogin`）。
- 便携版移动目录后登录项可能失效；请放在固定目录后重新切换自启，长期使用建议安装版。当前没有便携版专属提示条。

### 7.5 设置（最小集）

实现为主窗内的设置面板（顶部「设置」按钮或托盘菜单「设置」打开），包含：

- 全局热键：显示当前组合，点击「录制」后按一次组合键即改键并立即重新注册；注册失败在面板顶部红字提示，托盘入口兜底。
- 开机自启：开关写 `app.setLoginItemSettings`，以 `getLoginItemSettings` 为准；`executableWillLaunchAtLogin=false` 时提示“被系统阻止”；开发模式不写启动项（`process.defaultApp` 守卫）。
- 浮窗失焦隐藏：关闭后失焦不收起，仍可用 ×、热键或 Esc 收起；Esc 丢弃，其他方式保留草稿。
- MCP 删除工具：默认关闭，开启并重启 AI 客户端后 `delete_item` 才注册。
- AI 润色：启用开关（开启后才显示配置）、接口地址、模型、API Key（输入后保存，用 `safeStorage` 加密写 settings.json，可清除）；浮窗与主窗出现「AI 润色」按钮，结果回显、Enter 才记录。
- AI 连接测试：先保存配置再点击，发送固定句「请回复 OK」，10 秒超时，不发送记录；提示接口/模型/Key 错误。加密不可用时拒绝保存新 Key，不再明文降级；旧 `plain:` 值启动时尝试加密，失败则清除并需重新填写。设置写入失败不提交新的内存状态。
- 数据管理：完整记录 JSON 备份、合并恢复（不覆盖同 id）、清空全部记录（二次确认）。
- 卸载 TickNote：安装版打开安装目录里的 `Uninstall TickNote.exe`（二次确认）；便携版提示“直接删除解压目录”，数据仍在 `%APPDATA%\TickNote`。
- 主题在顶部 `⋯` 菜单的「跟随 / 浅色 / 深色」切换。

### 7.6 热键冲突

`globalShortcut.register()` 返回 `false` 时必须立刻提示“快捷键被占用，请到设置里更换”，并在设置页提供录制式改键，同时保留托盘入口作为兜底（热键失效也不至于无法记录）。

### 7.7 长内容查看（详情抽屉）

- 列表使用轻背景与留白，正文最多 2 行；悬停/选中显示行尾删除，选中行有色条。待办复选框与便签图标使用对齐的类型槽，增大点击区域。
- 点击整行打开右侧详情，复选框只切换完成状态。宽窗抽屉可调宽（上限 min(560px, 50vw)）；窗口宽度 ≤780px 时改为约 420px 覆盖层。
- 顶部导航与底部操作固定，中间正文、提醒区域独立滚动；长内容时主要操作仍可达。
- 正文最多 2000 字符；编辑保留本地草稿，失焦保存，显示保存中 / 已保存 / 失败及重试。关闭、上一条/下一条、切换类型/状态前等待保存，失败留在当前记录。
- 列表与抽屉删除统一即时删除 + 5 秒「撤销」，恢复原 id、内容、时间、状态及提醒；无长期回收站。撤销窗口结束后无法通过此按钮恢复。
- 提醒自定义输入点击「应用」提交；复制使用当前编辑内容并给出反馈。
- `Esc` / × 关闭；列表 `↑` `↓` 移动选择，`Enter` 打开。设置/导出弹层有对话框语义、初始焦点、Tab 约束及关闭后的焦点恢复。

---

## 8. IPC 契约

| 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `items:create` | `{content, kind}` | `Item` | 正文 trim 后 1–2000 字符 |
| `items:list` | `{filter, cursor?, limit?}` | `Item[]` | filter 为 all/todo/note/done/reminders；cursor 为 `{createdAt,id}` 或兼容数字；默认 30，最大 50 |
| `items:search` | `{q, limit?}` | `Item[]` | q ≤200；默认 30，最大 50；主窗请求 50 |
| `items:get` | `{id}` | `Item / null` | 读取单条 |
| `items:update` | `{id, content}` | `Item / null` | 正文 1–2000 字符，更新 updatedAt |
| `items:set-kind` | `{id, kind}` | `Item / null` | 切换类型，保留状态和创建时间 |
| `items:complete` / `items:restore` | `{id}` | `Item / null` | 完成 / 取消完成 |
| `items:set-reminder` | `{id, remindAt:number/null}` | `Item / null` | 重置 remindedAt |
| `items:delete` | `{id}` | `boolean` | 硬删除 |
| `items:restore-deleted` | `{item}` | `Item / null` | 列表、抽屉的 5 秒撤销 |
| `items:clear-all` | — | `number` | 删除条数；界面二次确认 |
| `items:stats` | — | `{todayOpenTodos,openTodos,pendingReminders}` | 界面/托盘使用 openTodos |
| `export:markdown` | `{scope?}` | `ExportResult / null` | all/todo/note/done/reminders/today；取消为 null |
| `backup:export` / `backup:import` | — | `{path,count} / null` | 系统文件选择；取消为 null，恢复 count 为新增条数 |
| `settings:get` / `settings:set` | — / `SettingsPatch` | `Settings` | 白名单，不向 renderer 返回明文或密文 Key |
| `autostart:get` / `autostart:set` | — / `{enabled}` | `AutostartStatus` | 含系统 blocked 状态 |
| `ai:parse` | `{content}` | `{content,kind} / null` | 3 秒超时，失败保留输入 |
| `ai:test` | — | `string` | 10 秒超时，使用已保存配置 |
| `app:uninstall` | — | `UninstallResult` | 打开本地卸载程序 |
| `capture:hide` / `window:open-main` | — | — | renderer → main，send |
| `capture:resize` | `height:number` | — | send，clamp 180–330 |
| `capture:shown` | — | — | main → renderer，恢复草稿并聚焦 |
| `settings:open` | — | — | main → renderer，托盘打开设置 |
| `items:changed` | — | — | main → renderer，写操作、外部数据变化或跨天后刷新 |
| `items:focus` | `{id}` | — | main → renderer，通知点击定位 |

入参在 main 侧用 zod 校验。错误通过拒绝的 Promise 返回，界面提供可读错误并保留输入。精确 DTO 以 `src/shared/types.ts`、`src/preload/index.ts` 为准。

---

## 9. MCP 服务

### 9.1 进程模型

安装包内自带 Electron 运行时，用 `ELECTRON_RUN_AS_NODE=1` 让它以 Node 模式执行 `mcp/server.js`，因此**不需要用户额外安装 Node**，也不需要 App 在运行。

```
AI 客户端 ──stdio──> TickNote.exe (ELECTRON_RUN_AS_NODE) ──> ticknote.db (WAL)
```

`mcp/server.ts` 只依赖 `repo.ts` 和数据库路径解析，不加载任何窗口/Electron UI 模块。构建时用 esbuild 打成 `resources/mcp/server.js`，打包时作为 `extraResources` 放到安装目录 `resources\mcp\server.js`（不进 asar）。`delete_item` 是否注册由数据库同目录 `settings.json` 的 `mcpDeleteEnabled` 决定，改了开关需要重启 AI 客户端（MCP 进程是每个客户端各自启动的）。

### 9.2 客户端配置示例

NSIS 按用户安装，默认目录 `%LOCALAPPDATA%\Programs\TickNote`（安装时可改）：

```json
{
  "mcpServers": {
    "ticknote": {
      "command": "C:\\Users\\<用户名>\\AppData\\Local\\Programs\\TickNote\\TickNote.exe",
      "args": ["C:\\Users\\<用户名>\\AppData\\Local\\Programs\\TickNote\\resources\\mcp\\server.js"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

数据库路径由 server 自己按 `%APPDATA%` 解析，不在配置里写死；如需多库，支持 `TICKNOTE_DB` 覆盖；`TICKNOTE_DATA`（兼容 `QUICKNOTE_DATA`）改变默认数据目录。

### 9.3 工具契约

| 工具 | 入参（zod） | 注解 | 行为 |
|---|---|---|---|
| `search_items` | `q: string(1..200)`, `limit?: 1..50` | readOnly | FTS 检索，返回精简条目 |
| `list_items` | `from?: ISO`, `to?: ISO`, `status?: 'open'\|'done'`, `kind?`, `limit?: 1..50` | readOnly | 按时间与状态列出，默认 20 条 |
| `create_item` | `content: string(1..2000)`, `kind?`, `remind_at?: ISO` | 写 | 新建，`source='ai'`，带 `ai_run_id` |
| `update_item` | `id`, `content?`, `kind?`, `remind_at?`, `status?` | 写 | 局部更新 |
| `complete_item` | `id` | 写 | 置 done |
| `delete_item` | `id`, `confirm: true` | destructive | **默认不注册**，设置里开启后可用 |

返回统一为：

```json
{ "id": "...", "content": "...", "kind": "todo", "status": "open", "created_at": "2026-10-29T01:12:00.000Z", "remind_at": null }
```

约束：
- 单次 `limit` ≤ 50，`content` ≤ 2000 字符，防 AI 灌数据。
- 不返回数据库路径、总数统计以外的内部字段。
- `delete_item` 默认关闭；开启后也只做硬删且必须带 `confirm: true`，不做回收站（与主窗删除策略一致）。

### 9.4 并发与锁

- 两个进程都以 `PRAGMA journal_mode=WAL` 打开，`busy_timeout=3000`。
- SQLite 忙等待由 `busy_timeout=3000` 处理，无额外应用层自动重试一次的逻辑。MCP 创建前先解析提醒时间，内容与提醒一次 INSERT，非法提醒不留下半条记录。
- 不做长事务；单次调用只写一条记录。

### 9.5 权限与审计

- AI 写入的记录带 `source='ai'` + `ai_run_id`。
- 主窗用小标记区分 AI 记录。**未实现 / 后续规划**：“撤销这次 AI 写入”（按 `ai_run_id` 批量删）；MCP 删除是硬删除，不提供 GUI 的 5 秒撤销。
- 可选写入白名单（未来）：只允许 `note` 类型。

---

## 10. 可选：AI 润色

- 默认关闭；开启后浮窗与主窗输入区都出现「AI 润色」按钮，点击才调用（不自动识别时间词）。
- 结果只**回显到输入框**（同时切换待办/便签类型），用户按 Enter / 点「记录」才真正落库；不会再“润色完直接保存并关闭浮窗”。
- 浮窗里润色后提示「AI 已润色 · Enter 保存」；主窗里提示「AI 已润色，按 Enter 记录」。
- 默认 `https://api.deepseek.com/v1` + `deepseek-chat`（OpenAI 兼容，可在设置里改成任意端点与模型）。
- 调用 `/chat/completions`，要求返回 JSON：`{content, kind}`，只做“整理措辞 + 判定便签/待办”，不解析日期。
- 失败或超时（3s）时保留原文并提示「AI 润色失败，已保留原文」，**绝不丢用户输入**、也不会误保存。
- 只发送当前输入框文本（可多行，最多 2000 字符），不发送历史记录；API Key 用 Electron `safeStorage` 加密后存本地。
- 请求绑定发起时的草稿版本；编辑、保存或会话切换使旧结果失效。撤销润色同时恢复原文和原类型。
- 设置面板启用后显示配置与「测试连接」；连接测试发送固定句，不发送当前输入，10 秒超时。

---

## 11. 打包与分发

- `electron-builder` 目标 NSIS，`oneClick:false`、`perMachine:false`（按用户安装，免管理员），创建桌面 + 开始菜单快捷方式（AUMID 与快捷方式一致，通知才可显示）。
- 打包配置在 `electron-builder.yml`：`files` 只含 `out/**` 与 `package.json`（`!node_modules/**`），主/渲染/MCP 全部已由 electron-vite / esbuild 打包；`extraResources` 把 `resources/mcp` 放到安装目录 `resources\mcp`，不压进 asar。
- MCP 入口用 `esbuild` 打成单文件（SDK 与 `repo.ts` 一并打包）；SQLite 走 Electron 内置 `node:sqlite`，没有原生模块需要 unpack。
- 打包时用本地 `node_modules/electron/dist`（`electronDist`）避免重复下载；winCodeSign / NSIS 工具集可预置在 `ELECTRON_BUILDER_CACHE`，离线或 GitHub 慢时改走 `ELECTRON_BUILDER_BINARIES_MIRROR`。
- 不需要 `electron-rebuild`：无原生依赖，`node:sqlite` 随 Electron 运行时提供。
- 安装包未签名 → Windows SmartScreen 会提示“未知发布者”，自用可接受；对外分发再考虑证书。
- 卸载入口：安装后系统「设置 → 应用」会列出 TickNote；`build/installer.nsh` 额外在开始菜单生成“卸载 TickNote”快捷方式，应用内设置面板也有卸载按钮（便携版会提示删目录）。
- 主进程依赖必须内联：构建把 zod 打进 `out/main/index.js`，否则去掉 node_modules 后会报 `Cannot find module 'zod'`；preload/renderer 的依赖同样已 bundle。
- 体积：`electronLanguages` 只保留 `zh-CN / en-US`，NSIS 用 `compression: maximum`。0.1.1 安装包 `TickNote-0.1.1-Setup.exe` 约 108 MiB，主要体积来自 Electron 本体。
- 分发：`npm run dist` 生成 `release` 下的 NSIS 和 win-unpacked，`npm run pack:portable` 将 win-unpacked 打为 `release\TickNote-0.1.1-portable.zip`（解压后运行 TickNote.exe）；产物未签名。安装包与便携包不含用户数据。
- 图标使用 `build/icon.png`（256px，绿底便签）；首次启动生成数据库并执行随包编译的 `src/main/db/schema.ts` DDL，用 `PRAGMA user_version` 管理迁移版本。

---

## 12. 风险与验证清单

| 风险 | 触发条件 | 对策 | 验证方式 |
|---|---|---|---|
| 输入法候选框错位 | 透明无边框窗口 + 中文输入 | 不使用 `transparent`，用不透明圆角窗口 | 微软拼音、搜狗实机输入中文观察候选框位置 |
| 热键被占用 | 与微信/QQ/输入法/PowerToys 冲突 | 提示 + 设置页改键 + 托盘兜底 | 故意用系统已占用组合测试注册失败路径 |
| 多显示器定位错误 | 缩放比例不同 / 副屏在左侧 | `getDisplayNearestPoint` + 按 workArea 居中 | 双屏不同 DPI 下热键唤起 |
| `node:sqlite` 实验性 API | Electron 升级后行为变化 | 锁定 Electron 版本，SQL 全部隔离在 repo 层 | 升级前跑 `npm test` |
| 多进程写冲突 | App 与 MCP 同时写入 | WAL + busy_timeout + 单条事务 | 脚本并发写 100 条断言无丢失 |
| 中文搜索失效 | 使用默认分词器 | FTS5 `trigram` | 搜“周报”“会议”命中 |
| 包内 MCP 不可执行 | 被压进 asar / 依赖解析失败 | esbuild 单文件 + `extraResources` 放到 `resources\mcp` | 按 9.2 配置在 Cursor 里调用一次 |
| 通知不弹 | 未设 AUMID / 系统勿扰 / 通知被关 | 安装快捷方式与 AUMID 对齐；设置页提示检查系统通知 | 安装版与免安装版各测一次 toast |
| 自启失效 | 安全软件拦截 / 便携版路径变化 / 任务管理器禁用 | 以系统状态为准并提示；建议安装版 | 重启机器验证；任务管理器禁用后再看提示 |
| 数据损坏/误删 | 无备份 | 手动 JSON 记录备份/事务恢复 + 设置原子写入；每日自动备份未实现 | 手动删除后从备份恢复 |

---

## 13. 迭代计划与验收

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| P0 | 托盘 + 浮窗 + 主窗底部输入框 + 长记录截断与详情抽屉（只读）+ SQLite 增查 + 今日列表 | 热键唤起到保存 ≤ 1 秒；底部输入框可连续记录；长记录可点开看全文；重启后数据仍在 |
| P1 | 抽屉内编辑 / 提醒 / 完成 / 搜索 / 导出 Markdown | 抽屉内改内容可落库；设置提醒后到点弹系统通知且列表顺序不变；App 关闭期间错过的提醒在启动后合并提示；中文搜索命中；导出文件格式正确 |
| P2 | MCP stdio（6 个工具） | Cursor / Claude Desktop 能列出工具、创建并读回记录；App 未启动时同样可用 |
| P3 | 安装包 / 自启 / 设置页 / 可选 AI 润色 | 干净机器安装后可用；重启后自动进托盘且不弹主窗；SmartScreen 提示可绕过；API 失败不丢输入 |

> 以下为历史阶段计划与当时验证记录，保留原日期、版本及待测项，不作为 0.1.1 当前行为定义。每日自动备份、AI 批次撤销不在已实现范围。

### 0.1.1 当前验证（2026-10-30）

- 类型检查、lint、生产构建通过；Vitest 5 文件 8 用例通过；MCP 在 Node 与 Electron 运行时通过（含非法提醒不残留记录）。
- 隔离数据目录下，打包程序 9 项 UI 回归通过；JSON 备份合并/重复恢复/非法文件、真实 MCP 进程写入后的搜索刷新通过；浅色、深色及 720×520 布局已检查。
- 待人工：真实 Windows 通知送达、安装/卸载、自启与系统禁用、输入法、多显示器与 DPI。详见 [0.1.1 验证指南](docs/VALIDATION-0.1.1.md)。

### P0 验证记录（2026-10-29）

已自动验证：
- 类型检查、构建、DB 单测（分页 / FTS / 中文 2 字回退 / 状态 / 重开持久化）
- 渲染层浏览器验证（布局、提交、2 行截断、抽屉、筛选、checkbox）
- 实机：热键唤出浮窗 → 输入 → 回车 → 收起；主窗自动刷新；抽屉 Esc 关闭；勾选完成；中文搜索；关窗进托盘且进程存活；单实例唤起；重启数据仍在；主题切换与持久化；抽屉拖动
- 托盘图标已在 Windows 11 托盘溢出面板中确认可见（绿色便签图标）

人工验证通过（2026-10-29）：
- 托盘右键菜单：「打开浮窗 / 打开主窗 / 退出」均正常
- 中文输入法选词时按 Enter 只上屏、不提交，再按 Enter 正常保存

待人工验证（本环境无法自动完成）：
- **热键冲突**：需在已被占用的组合下确认记录仍可通过托盘完成（当前只有控制台日志，界面提示要等 P3 设置页）
- **多显示器 / 不同 DPI**：本机仅 1920×1080 单屏，无法验证副屏定位
- **“唤起 → 保存 ≤ 1 秒”**：为体感通过，未做精确计时

### P1 验证记录（2026-10-29）

已自动验证：
- 类型检查、构建通过；DB 单测新增：编辑内容刷新 `updated_at` 且 FTS 同步、硬删除及幂等、提醒到点命中 / 标记后不重复 / 改时间重置 `reminded_at` / 已完成不提醒 / 待提醒统计、导出用全量查询
- 实机（Electron + trial 数据目录）：
  - 抽屉内编辑正文，失焦保存成功，列表同步更新并出现「已保存」提示
  - 抽屉「今天18:00」把 `remind_at` 写入数据库，列表出现「提醒 18:00」标记并出现「清除」按钮
  - 「自定义」展开 datetime-local，改分钟后保存为「今天 18:28」并弹出 toast
  - 导出：5 条记录 → `notes-2026-10-29.md`，待办 `- [ ]` / `- [x]`、便签 `-`、提醒后缀 `· 提醒 18:28`，格式符合设计
  - 删除：新建测试记录 → 抽屉「删除」→ 二次确认 → 数据库查询为 0，列表与 toast 同步
  - 启动补提醒：把 4 条 open 记录的提醒设为过去 → 重启后 4 条 `reminded_at` 在同一时刻写入（合并处理生效）
  - 30 秒调度：把一条 open 记录的提醒设为当前时刻，约 12 秒后扫描命中并写入 `reminded_at`

待人工验证（需交互 / 等待 / 系统环境，明天按顺序验）：
- [ ] 到点提醒的 Windows toast 是否真实显示：本次实机截图未看到通知（未打包运行时可能因缺少开始菜单快捷方式 AUMID 或专注助手被静默），但 `reminded_at` 已正常写入
- [ ] 点击提醒通知唤起主窗并自动打开对应记录抽屉（`items:focus`）
- [ ] 同一轮 >3 条提醒合并成一条通知的正文与点击行为
- [ ] 托盘菜单「导出 Markdown」及导出后的气泡提示（UI 自动化无法打开托盘右键菜单）
- [ ] 抽屉编辑框内按 Esc：保存并关闭（验证过程中系统锁屏，未能完成该步）
- [ ] 自定义时间选择器用鼠标点选的体验（自动化只能通过键盘改分钟）

### P2 验证记录（2026-10-29）

已自动验证（`npm run test:mcp`，App 未启动）：
- `resources/mcp/server.js`（esbuild 单文件 1.3MB）可被 stdio 客户端连接：默认 5 个工具，`create_item` 返回 `source=ai`、写入 `ai_run_id`，中文搜索命中，`list_items` 范围/状态过滤，`update_item` 改内容+提醒，`complete_item` 置 done
- `settings.json` 的 `mcpDeleteEnabled=false` 时 `delete_item` 不可调用；改为 true 重新拉起后注册 6 个工具且可硬删除
- 用 Electron 运行时（`ELECTRON_RUN_AS_NODE=1` + `node_modules/electron/dist/electron.exe`）执行同一份单文件，工具与创建记录同样可用
- 打包版路径 `release\win-unpacked\TickNote.exe` + `resources\mcp\server.js`（`ELECTRON_RUN_AS_NODE=1`）连接成功，5 个工具、创建记录成功
- 设置面板勾选「MCP 删除工具」后 `settings.json` 变 true，MCP 客户端工具数变 6；取消勾选后恢复 5

待人工验证：
- [ ] 在 Cursor / Claude Desktop 按 9.2 配置后，能列出 6 个工具、创建并读回记录（App 关闭时也验证一次）
- [ ] 主窗里能看到 AI 写入的记录（`source=ai` 标记）

### P3 验证记录（2026-10-29）

已自动验证：
- 设置面板：顶部「设置」打开；热键 / 开机自启 / 浮窗失焦隐藏 / MCP 删除 / AI 配置分组均渲染；主题切换仍生效
- 热键录制：录到 `Control+Alt+N` 后 `settings.json` 与按钮同步更新，再录回 `Control+Shift+Space`；恢复后按热键能重新唤起浮窗
- AI 开关：开启后浮窗出现「AI 润色」按钮，关闭后消失；v1.4 起点击只回显润色结果，Enter 才落库；失败保留原文（回显流程待用真实 Key 或本地假接口复验）
- 浮窗失焦隐藏：开启时浮窗唤起后点击主窗会自动隐藏
- 设置持久化：`hotkey / hideCaptureOnBlur / mcpDeleteEnabled / aiEnabled / aiBaseUrl / aiModel` 均写入 `settings.json`
- AI 解析模块单测：合法 JSON → `{content,kind}`；HTTP 500 / 非 JSON / kind 非法 / 超时 → null；请求体含 model、temperature=0、当前文本，Authorization 为 Bearer Key
- 打包：`npm run dist` 产出 `release\TickNote-0.1.0-Setup.exe`（107.9MB）与 `win-unpacked`（311MB）；`app.asar` 仅 661KB（node_modules 已排除），`resources\mcp\server.js` 存在，使用自定义 256px 图标；未签名；`npm run pack:portable` 另出便携 zip
- 打包版冒烟：直接运行 `release\win-unpacked\TickNote.exe`（独立 `TICKNOTE_DATA`）主窗正常、图标正确、无 JS 报错。曾出现 `Cannot find module 'zod'`，已通过把 zod 内联进主进程 bundle 修复并复验
- 卸载入口：设置面板「卸载」为二次确认；开发/便携环境下点击后正确提示“便携版直接删除解压目录”；安装包已用 `build/installer.nsh` 打入开始菜单“卸载 TickNote”快捷方式（安装后表现待人工确认）
- 开发模式守卫：以 `electron .` 启动不会再写开机启动项（验证前误写入的 `com.quicknote.app` 启动项已清理，重启后未再出现）

待人工验证：
- [ ] 干净机器运行 `TickNote-0.1.0-Setup.exe` 安装（预期 SmartScreen “未知发布者”，可选“仍要运行”），确认桌面/开始菜单快捷方式与图标
- [ ] 安装后开始菜单出现“卸载 TickNote”，点击能拉起卸载程序；设置面板「卸载」也能打开同一卸载程序
- [ ] 安装版首次启动默认开启自启；重启系统后自动进托盘且不弹主窗（`--autostart`）
- [ ] 任务管理器 → 启动 禁用 TickNote 后，设置面板显示“已开启但被系统阻止”
- [ ] 真实键盘录制热键（含被占用组合的失败提示）；自动化注入组合键不稳定，未覆盖冲突路径
- [ ] 托盘菜单「设置」能打开设置面板
- [ ] 用真实 DeepSeek Key：点击 AI 后整理措辞并落库；断网 / 超时 3 秒后按原文存为便签
- [ ] 关闭「浮窗失焦隐藏」后点击别处，浮窗应保持（自动化只验证了开启态）
- [ ] 安装版通知 toast 实际显示（P1 同样遗留，AUMID 依赖快捷方式）

### UI 优化验证记录（2026-10-30，v1.7）

已自动验证：
- 类型检查、构建通过；Vitest 仓库用例新增清空断言：`clearAll()` 返回删除条数、列表/FTS/统计归零、重复清空返回 0、重开库仍为空；`test:mcp`、AI 解析用例均通过
- 浏览器（mock 数据，`out/renderer/main.html` 静态预览）逐项截图验证：
  - 顶部栏：品牌 + 搜索 + `⋯` + 设置；点 `⋯` 弹出菜单（导出 Markdown / 外观三 chip）
  - 导出弹窗：标题、单选范围、底部按钮正常；`Esc` 可关闭
  - 分组折叠：点「今天」分组头后记录隐藏、箭头变 `▸`；再点恢复
  - 键盘导航：列表空白处 `↓↓` 出现虚线光标行，`Enter` 打开「记录详情」，顶部显示 `‹ N / M ›`
  - 设置面板底部「危险操作」：清空全部记录 / 卸载 TickNote；点「清空」变为「确认清空？」（未执行最终确认）
- Electron 实机（`npm run build` 后 `electron .` + 独立 `TICKNOTE_DATA` 测试目录）：主窗正常启动、分组与提醒 tag 渲染正常、热键注册失败提示按预期输出
- 浮窗拖动/关闭（CDP 实测，2026-10-30）：浮窗内 `.capture-drag` 计算值 `-webkit-app-region: drag`、`.capture-close` 为 `no-drag`；点击关闭按钮后 `document.visibilityState` 由 visible → hidden，窗口高度随拖动条基准调整到 160
- 类型切换（浏览器 mock 实测，2026-10-30）：抽屉「类型」两个 chip 切换后高亮同步、行首图标由文档变复选框；重新打开仍保持新类型；「待办」筛选下切成便签后该条从列表移除、抽屉自动关闭；DB 单测覆盖 `repo.update({kind})` 保留状态与创建时间、FTS 仍可命中

待人工验证：
- [ ] 折叠状态刷新后是否保持（已写入 `localStorage.ticknote.collapsedDays`，浏览器内未跨会话复验）
- [ ] 真实数据下「清空全部记录」二次确认清空后，列表/统计/托盘角标同步为空
- [ ] 导出「仅今天」与「当前筛选」的实际文件名与内容范围
- [ ] 抽屉「上一条 / 下一条」在搜索/筛选结果中的边界（首/末条按钮禁用）
- [ ] 浮窗用鼠标拖到新位置后隐藏再唤起，是否停在上次位置（CDP 合成鼠标事件不触发原生拖动，无法自动化）
- [ ] 副屏拔掉后浮窗是否被夹回主屏工作区（需多显示器环境）


---

## 14. 已确认决策

| 项 | 决定 |
|---|---|
| 应用名 | TickNote，中文名「待办便签」；程序/安装包用 TickNote，窗口与界面显示中文名 |
| 默认热键 | `Ctrl+Shift+Space`，设置页支持录制式改键，注册失败立即提示 |
| 分组方式 | 只按创建日期分组（今天 / 昨天 / 更早），不做“逾期”分组 |
| 时间语义 | 不设 `due_at`；仅可选 `remind_at` 做系统通知，不参与排序 |
| 便签/待办 | 全部 / 待办 / 便签 / 已完成 / 提醒 |
| 浮窗失焦 | 默认自动隐藏 |
| 删除 | 列表与抽屉即时删除，统一 5 秒撤销，不做长期回收站 |
| 便签完成框 | 不显示，只有待办可勾选 |
| AI 默认服务 | DeepSeek（`api.deepseek.com/v1` + `deepseek-chat`），可改任意兼容端点 |
| AI 润色范围 | 只整理措辞与判定便签/待办，不解析日期；结果回显，用户确认后才记录 |
| 捕获时设日期 | 不提供，保持零摩擦；提醒在抽屉里设置 |
| 提醒预设 | 10 分钟后 / 1 小时后 / 今天或明天 18:00 / 明天 9:00 / 自定义并应用 / 清除 |
| 导出入口 | 主窗 `⋯` → 导出 Markdown + 托盘菜单；每次独立目录 |
| 长内容查看 | 列表行 2 行截断，点击整行打开右侧详情抽屉，不用居中弹窗 |
| 外观 | 跟随系统 / 浅色 / 深色，写入 settings.json，重启后保持；两个窗口同步 |
| 默认类型 | 待办（按钮顺序 待办 / 便签），便签需手动切换 |
| 开机自启 | 默认开启，`--autostart` 只进托盘不弹主窗；可在设置里关闭 |
| MCP 删除工具 | 默认关闭；开启后需重启 AI 客户端才生效 |
| AI Key 存储 | `safeStorage` 加密后写 settings.json；不可用时拒绝保存；不向 renderer 暴露密文 |
| 安装包 | NSIS 按用户安装（`%LOCALAPPDATA%\Programs\TickNote`），未签名，SmartScreen 提示可绕过 |
| 托盘常驻 | 关闭主窗只收起不退出，退出仅从托盘菜单 |

---

## 15. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-29 | v0.1 | 初稿：Electron + SQLite + MCP stdio |
| 2026-10-29 | v0.2 | 去掉 `due_at` 与“逾期/今天”分组，改为创建时间流水；提醒改为可选 `remind_at`；补充改键、AI 默认服务等决策 |
| 2026-10-29 | v0.3 | 自查修正：提醒重置与批量合并、列表分页、自动备份、删除口径、MCP esbuild 打包、复选框点击边界 |
| 2026-10-29 | v0.4 | P0 实现：SQLite 改用 Electron 内置 `node:sqlite`（本机无 MSVC）、新增 `items:changed` 事件、去掉默认菜单栏 |
| 2026-10-29 | v0.5 | 新增外观切换（跟随/浅色/深色，`nativeTheme` + settings.json 持久化）；修复热键尾键空格漏入浮窗 |
| 2026-10-29 | v0.6 | 待办/便签按钮改为“待办在前”，默认类型改为待办 |
| 2026-10-29 | v0.7 | 列表行首增加类型槽（待办复选框 / 便签文档图标），全部列表可区分类型 |
| 2026-10-29 | v0.8 | 列表由分隔行改为卡片式（圆角/边框/间距），日期分组头不再画分割线 |
| 2026-10-29 | v0.9 | P1 实现：抽屉内编辑（失焦 / Esc 保存）、二次确认删除、提醒预设与自定义 + 30 秒调度与启动补提醒、通知点击定位、Markdown 导出（主窗 + 托盘）；新增 `items:get/update/delete/set-reminder`、`export:markdown`、`items:focus`；待提醒统计只算未完成项 |
| 2026-10-29 | v1.0 | P2/P3 实现：MCP stdio 6 工具（默认关闭删除）、esbuild 单文件 + extraResources；设置面板（热键录制、开机自启、失焦隐藏、MCP 删除、AI 配置 + safeStorage）；浮窗 AI 按钮与 3 秒降级；electron-builder NSIS 安装包与图标；开发模式启动项守卫；新增 `autostart:get/set`、`ai:parse`、`settings:open` |
| 2026-10-30 | v1.1 | 体积优化：仅保留中英文语言包、NSIS 最大压缩（安装包 116MB → 107.8MB，免安装 311MB）；新增 `npm run pack:portable` 生成便携 zip（自用免签名分发路线） |
| 2026-10-30 | v1.2 | 修复安装版启动报 `Cannot find module 'zod'`：zod 改为内联进主进程 bundle；重新打包并冒烟验证通过 |
| 2026-10-30 | v1.3 | 新增卸载入口：设置面板「卸载 QuickNote」（二次确认，安装版打开卸载程序）、NSIS 开始菜单“卸载 QuickNote”快捷方式 |
| 2026-10-30 | v1.4 | AI 改为「AI 润色」：结果回显到输入框、Enter 才记录；浮窗与主窗输入区都加按钮；设置开启后才显示 AI 配置；文案同步调整 |
| 2026-10-30 | v1.5 | 更名 TickNote（中文：待办便签）：程序名/安装包/快捷方式为 TickNote，窗口与界面显示「待办便签」；数据目录改为 `%APPDATA%\TickNote`，首次启动自动从旧 `QuickNote` 目录迁移；MCP 默认路径与配置名同步更新 |
| 2026-10-30 | v1.6 | 修复设置面板打开时 toast 被遮罩挡住：toast 层级提高到 60（高于设置遮罩） |
| 2026-10-30 | v1.7 | UI 交互优化落地（第二批 + 第三批 9 项）：设置文案动作化重写；顶部栏把导出/外观收进 `⋯` 菜单；提醒 tag 跨天显示 `MM-DD HH:mm` 且过期弱色；抽屉加「上一条 / 下一条」与位置计数；导出弹窗支持范围（全部 / 当前筛选 / 仅今天）；`↑↓` 选行 + `Enter` 开抽屉；AI 润色可撤销/失败重试；日期分组可折叠并记忆在 `localStorage`；设置新增「清空全部记录」二次确认（`items:clear-all` + `repo.clearAll()`） |
| 2026-10-30 | v1.8 | 浮窗（无边框）新增 18px 拖动条（`-webkit-app-region: drag`）+ 右上角关闭 `×`（`hideCapture`，不退出应用）；拖动位置在本次运行内记忆，再次唤起沿用并对多显示器越界做 clamp；浮窗高度基准 94→120、主进程高度上限 210→240 |
| 2026-10-30 | v1.9 | 已记录条目支持在抽屉内切换「待办 / 便签」：新增 `items:set-kind`（zod 校验）、preload `setItemKind`、mock 同步；切换保留状态与创建时间，列表按当前筛选自动刷新 |
| 2026-10-30 | v1.10 | 开源化：主进程拆分为 `windows/tray/ipc/settings`，渲染层拆出 `components/` 与 `utils.ts`（main.tsx 1380→803 行）；去 QuickNote 化（appId `com.ticknote.app`、DB 改名 `ticknote.db` 并兼容迁移、localStorage key）；Electron 安全加固（CSP、`sandbox:true`、禁止新窗与跳转、preload 缺失时快速失败）；补充 MIT LICENSE、README 中英、CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/CHANGELOG、docs/ARCHITECTURE|MCP|PRIVACY、CI/Release 工作流、Issue/PR 模板、dependabot、oxlint/Prettier、Vitest 单测、`.editorconfig/.gitattributes/.nvmrc` |
| 2026-10-30 | v1.11 | 列表行内删除：悬停/选中显示 `×`，删除后 toast 提供 5 秒「撤销」（`items:restore-deleted` + `repo.restore`，按原 id/时间/状态/提醒写回）；主窗移除顶部「待办便签」品牌字；导出改为主窗弹文件夹选择框（托盘仍静默写上次目录） |
| 2026-10-30 | v1.12 | 搜索命中高亮：列表正文按查询词大小写不敏感地包 `<mark class="hit">`，支持一条内多次命中 |
| 2026-10-30 | v1.13 | 对应应用 0.1.1：草稿恢复与异步防覆盖、复合分页和字面搜索、2 秒外部写入刷新、独立导出目录、JSON 记录备份合并恢复、统一删除撤销、提醒筛选与显式应用、AI 连接测试和设置安全持久化；修复输入区重复深色焦点框、外观菜单换行、AI 润色按钮常驻高亮；同步 IPC/UI 规格、验证指南与截图，明确自动备份和 AI 批次撤销未实现，历史提案不视为现状 |

---

## 16. 历史交互与 UI 优化提案（非当前功能清单）

> 这是早期提案，不能将所有建议视为已实现。当前规格见第 6–8 节；例如独立「完成撤销」toast、「今晚 20:00」预设仍未实现，抽屉删除二次确认已由 5 秒撤销取代。

原提案按“收益/成本”排序：

### 第一批（低成本、手感收益最大）

1. **行内快捷删除**：行 hover / 选中时，行尾出现 `×`；点击直接删除并弹「已删除 · 撤销（5s）」，比二次确认更顺手；抽屉内保留现有二次确认作为兜底。
2. **完成可撤销**：勾选待办后 toast「已完成 · 撤销」；在「待办」筛选下条目消失时尤其需要，避免误点无路可退。
3. **搜索框增强**：加清除 `×`、结果条数提示、命中词高亮；`Esc` 先清搜索再关抽屉，减少“按 Esc 把抽屉关了”的误操作。
4. **空状态**：无记录时显示快捷键 `Ctrl+Shift+Space` 与一句示例；搜索无结果显示「清除搜索」按钮。
5. **文案统一**：输入区提示由「Enter 发送」改为「Enter 记录」；全站统一用“记录 / 润色 / 卸载”，不使用“发送/录入”。
6. **Toast 语义色**：成功用品牌绿，失败/警告用红色描边；当前所有提示都是绿色，容易把失败当成功。

### 第二批（信息架构与设置文案）

7. **顶部栏减负**：主题三个按钮收进设置（或做成单个图标循环切换）；「导出」移进 `…` 菜单，只留搜索 + 设置，减少视觉噪音。
8. **设置文案重写**（建议直接用）：
   - 全局热键：`按一次想用的组合键即可更换；被其他软件占用时会提示`
   - 开机自启：`登录 Windows 后自动在托盘运行，不弹出主窗口`
   - 浮窗失焦隐藏：`点到其他窗口时自动收起浮窗`
   - MCP 删除工具：`允许 AI 客户端删除记录；默认关闭，修改后需重启 AI 客户端`
   - AI 润色：`只在点击按钮时调用；结果先回显到输入框，确认后才保存`
   - 卸载：`打开系统卸载程序；卸载不会删除本地记录`
9. **提醒展示**：列表 tag 跨天时显示 `MM-DD HH:mm`；已提醒/已过期用弱色；抽屉预设补「今晚 20:00」；「清除提醒」从 chip 提升为独立按钮。
10. **抽屉导航**：加「上一条 / 下一条」；保存状态改为栏内常驻小字「已保存」，不再依赖 toast。

### 第三批（体验增强，可延后）

11. **键盘可达性**：实现设计里的 `↑ ↓` 移动选中、`Enter` 打开抽屉；行加 `role=button` 与 `aria-label`，删除按钮可 Tab 到达。
12. **分组折叠**：今天/昨天/更早可折叠，长列表更好扫。
13. **导出范围**：全部 / 当前筛选 / 当前日期三种，而不是永远导出全量。
14. **AI 润色增强**：一次「撤销润色」回到原文；失败时提供「重试」；主窗按钮与「记录」同级。
15. **数据管理**：设置里增加「清空全部记录」（双重确认），并明确说明卸载保留数据。

### 不建议做

- 回收站、批量选择、多级标签：与产品“零摩擦速记”定位冲突，数据量不大时收益低。
- 悬浮大弹窗、侧边导航：会打断流水式浏览。

