> 中文 | [English](MCP.en.md)

# MCP 集成

TickNote 内置一个 stdio MCP server，让任何支持 Model Context Protocol 的 AI 客户端（Claude Desktop、Cursor、Trae、WorkBuddy、DeepSeek Harness 等）读写同一份本地记录。

## 懒人版：把这段话直接发给 AI

> 适用于 Trae、WorkBuddy、DeepSeek Harness、Claude Code、Cursor 等能修改本地配置的客户端。复制下面整段发给 AI，它会自己找路径、写配置、重载并验证，不用你手填 JSON。

```text
请帮我在这台 Windows 电脑上接入 TickNote 的本地 MCP 服务（stdio），并完成验证。

1. 传输方式必须是 stdio，不要用 HTTP / SSE；服务名用 ticknote。
2. 安装版默认路径：
   command: C:\Users\<你的用户名>\AppData\Local\Programs\TickNote\TickNote.exe
   args: ["C:\Users\<你的用户名>\AppData\Local\Programs\TickNote\resources\mcp\server.js"]
   env: { "ELECTRON_RUN_AS_NODE": "1" }
   如果这两个文件不存在，请先在本机搜索 TickNote.exe（便携版可能解压在任何目录），server.js 一定在同目录的 resources\mcp\server.js；不要从网上下载或替换文件。
3. 请修改你当前客户端实际读取的 MCP 配置：
   - Trae：项目 .trae/mcp.json，或全局 %APPDATA%\Trae\User\mcp.json
   - WorkBuddy：~/.workbuddy/mcp.json
   - DeepSeek Harness：$DSH_HOME/profiles/dsh-cli/cordis.patch.yml
   - 其他客户端：对应的 mcpServers 配置
   不要修改 TickNote 的数据库或记录。
4. 保存后请重启或重载 MCP 进程，然后列出工具。预期至少 5 个：create_item、list_items、search_items、update_item、complete_item；如果 TickNote 设置里开启了「MCP 删除工具」，还会多一个 delete_item（共 6 个）。
5. 请创建一个测试便签「MCP 接入测试」，再用 search_items 搜索确认写入成功。
6. 最后告诉我：改了哪个文件、是否需要我手动重启客户端、工具数量和测试结果。
```

### 先确认两个路径

如果你不想让 AI 自己找，先在 PowerShell 里跑一遍：

```powershell
$exe = @(
  "$env:LOCALAPPDATA\Programs\TickNote\TickNote.exe",
  "$env:ProgramFiles\TickNote\TickNote.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $exe) {
  $exe = (Get-ChildItem "$env:LOCALAPPDATA\Programs", "$env:USERPROFILE\Downloads" `
    -Recurse -Filter TickNote.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1).FullName
}

$server = Join-Path (Split-Path $exe) 'resources\mcp\server.js'
$exe
$server
Test-Path $server
```

把输出的两个路径填到客户端配置即可。

## 用途

- **不在电脑前也能记**：App 没启动时，MCP 进程自己打开数据库，直接读写。
- **让 AI 整理你的记录**：把零散速记汇总成清单、检索历史、标记完成。
- **单一数据源**：人和 AI 共用 `ticknote.db`，没有第二套存储，也不经过云端。

MCP server 与主进程是两个独立进程，通过 SQLite WAL 并发访问同一个数据库文件。

```
AI 客户端 ──stdio──> TickNote.exe (ELECTRON_RUN_AS_NODE=1) ──> %APPDATA%\TickNote\ticknote.db
```

## 启动方式

安装包自带 Electron 运行时，**用户不需要额外安装 Node**，也不需要 App 正在运行。客户端配置的本质是：

- `command`：`TickNote.exe` 的完整路径；
- `args`：`resources\mcp\server.js` 的完整路径；
- `env`：`ELECTRON_RUN_AS_NODE=1`（让 Electron 以 Node 模式执行该脚本）。

| 场景               | command                                          | args                                                       |
| ------------------ | ------------------------------------------------ | ---------------------------------------------------------- |
| 安装版（默认目录） | `%LOCALAPPDATA%\Programs\TickNote\TickNote.exe`  | `%LOCALAPPDATA%\Programs\TickNote\resources\mcp\server.js` |
| 便携版             | `<解压目录>\TickNote.exe`                        | `<解压目录>\resources\mcp\server.js`                       |
| 开发模式           | `<仓库>\node_modules\electron\dist\electron.exe` | `<仓库>\resources\mcp\server.js`（先 `npm run build:mcp`） |

> 安装时如果改过安装目录，请把路径换成实际位置。NSIS 是**按用户安装**，默认在 `%LOCALAPPDATA%\Programs\TickNote`。

## Claude Desktop 配置

配置文件：`%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ticknote": {
      "command": "C:\\Users\\<用户名>\\AppData\\Local\\Programs\\TickNote\\TickNote.exe",
      "args": ["C:\\Users\\<用户名>\\AppData\\Local\\Programs\\TickNote\\resources\\mcp\\server.js"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1"
      }
    }
  }
}
```

保存后完全退出 Claude Desktop（托盘里也要退出）再重新打开，才能在工具列表中看到 TickNote。

## Cursor 配置

全局配置文件：`%USERPROFILE%\.cursor\mcp.json`；也可以放在项目的 `.cursor\mcp.json`。

```json
{
  "mcpServers": {
    "ticknote": {
      "command": "C:\\Users\\<用户名>\\AppData\\Local\\Programs\\TickNote\\TickNote.exe",
      "args": ["C:\\Users\\<用户名>\\AppData\\Local\\Programs\\TickNote\\resources\\mcp\\server.js"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1"
      }
    }
  }
}
```

路径占位符请替换成实际值：`<用户名>` 是你的 Windows 账户名；若装在别处，改 `AppData\\Local\\Programs\\TickNote`。JSON 里反斜杠必须写成 `\\`。

## Trae 配置

Trae 支持两种位置，二选一：

| 级别 | 文件路径 | 适用 |
| --- | --- | --- |
| 项目级 | `<项目根目录>\.trae\mcp.json` | 只在当前项目生效 |
| 全局 | `%APPDATA%\Trae\User\mcp.json` | 所有项目复用（Settings → MCP → Open config file 可确认实际路径） |

```json
{
  "mcpServers": {
    "ticknote": {
      "command": "C:\\Users\\<用户名>\\AppData\\Local\\Programs\\TickNote\\TickNote.exe",
      "args": ["C:\\Users\\<用户名>\\AppData\\Local\\Programs\\TickNote\\resources\\mcp\\server.js"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1"
      }
    }
  }
}
```

保存后重载窗口（命令面板 `Developer: Reload Window`）或重启 Trae，在 MCP 面板里应看到 `ticknote` 为已连接。

## WorkBuddy 配置

WorkBuddy（腾讯）的 MCP 配置是标准 `mcpServers` JSON：

| 级别 | 文件路径 |
| --- | --- |
| 用户级 | `%USERPROFILE%\.workbuddy\mcp.json` |
| 项目级 | `<项目目录>\.workbuddy\mcp.json` |

也可以在 UI 里走：侧边栏「插件」→ 右上角「MCP 服务器」→「配置 MCP」，把下面 JSON 粘进去：

```json
{
  "mcpServers": {
    "ticknote": {
      "command": "C:\\Users\\<用户名>\\AppData\\Local\\Programs\\TickNote\\TickNote.exe",
      "args": ["C:\\Users\\<用户名>\\AppData\\Local\\Programs\\TickNote\\resources\\mcp\\server.js"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1"
      }
    }
  }
}
```

保存后看状态灯：绿色表示连接成功；红色表示路径或 JSON 有问题。改完配置通常需要重启 WorkBuddy 或重新加载 MCP 服务器。

## DeepSeek Harness（dsh）配置

DeepSeek Harness 的 MCP 配置写在用户 profile 的 YAML 补丁里：

```
%USERPROFILE%\.dsh\profiles\dsh-cli\cordis.patch.yml
```

如果设置了 `DSH_HOME`，则文件在 `$DSH_HOME/profiles/dsh-cli/cordis.patch.yml`。在文件里追加：

```yaml
- insert:
    - id: mcp-ticknote
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: ticknote
        command: 'C:\Users\<用户名>\AppData\Local\Programs\TickNote\TickNote.exe'
        args:
          - 'C:\Users\<用户名>\AppData\Local\Programs\TickNote\resources\mcp\server.js'
        env:
          ELECTRON_RUN_AS_NODE: '1'
```

YAML 里用单引号包住 Windows 路径，反斜杠不用转义。保存后重启 dsh（或重载 profile），在会话里执行 `/mcp` 查看已连接的服务器和工具数量；工具会以 `mcp__ticknote__<tool>` 的形式出现。

## 其他 stdio 客户端

凡是支持 `mcpServers` 的客户端（Claude Code、Windsurf、Cline、Continue 等），把上面「Claude Desktop」那段 JSON 粘到它的 MCP 配置里即可；关键是三项：`command` 指向 `TickNote.exe`、`args` 指向 `resources\mcp\server.js`、`env` 里有 `ELECTRON_RUN_AS_NODE=1`。

## 工具清单

共 6 个工具，`delete_item` 默认不注册。

| 工具            | 入参                                                                                                  | 注解        | 行为                                            |
| --------------- | ----------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------- |
| `create_item`   | `content`：1–2000 字符；`kind`：默认 `todo`；`remind_at`：可选 ISO 时间                               | 写          | 新建记录，`source='ai'`，并写入一个 `ai_run_id` |
| `list_items`    | `from` / `to`：ISO 时间；`status`：`open` / `done`；`kind`：`note` / `todo`；`limit`：1–50（默认 20） | read-only   | 按创建时间倒序列出                              |
| `search_items`  | `q`：1–200 字符；`limit`：1–50（默认 20）                                                             | read-only   | FTS5 trigram 全文检索；不足 3 字符时走 `LIKE`   |
| `update_item`   | `id`；`content?`；`kind?`；`status?`；`remind_at?`（传 `null` 清除）                                  | 写          | 局部更新；改提醒会重置 `reminded_at`            |
| `complete_item` | `id`                                                                                                  | 写          | 置为已完成                                      |
| `delete_item`   | `id`；`confirm: true`（字面量，必须为 `true`）                                                        | destructive | 硬删除，无回收站；**默认不注册**                |

返回格式统一为 JSON 文本（`content[0].text`），单条记录形如：

```json
{
  "id": "3f1c0a2e-...",
  "content": "周五前给测试同事发构建包",
  "kind": "todo",
  "status": "open",
  "created_at": "2026-10-30T02:15:00.000Z",
  "updated_at": "2026-10-30T02:15:00.000Z",
  "remind_at": null,
  "source": "ai"
}
```

- 列表/搜索返回 `{ "count": N, "items": [...] }`。
- 出错时返回 `isError: true` 和一段错误文本（例如时间格式非法、记录不存在）。
- 单次最多返回 50 条，单条内容最多 2000 字符，用于防止 AI 灌数据。

### 开启删除工具

1. TickNote 主窗 →「设置」→ 打开「MCP 删除工具」（写入 `settings.json` 的 `mcpDeleteEnabled: true`）。
2. **重启 AI 客户端**（MCP 进程由客户端各自拉起，不重启不会重新注册工具）。
3. 客户端工具列表中应出现第 6 个工具 `delete_item`。

关闭同理：取消勾选后重启客户端，`delete_item` 消失。

## 数据库路径

默认读取 `%APPDATA%\TickNote\ticknote.db`。server 的解析优先级：

1. 环境变量 `TICKNOTE_DB`（完整文件路径，优先级最高）。
2. 环境变量 `TICKNOTE_DATA`（数据目录）下的 `ticknote.db`；若只有旧的 `quicknote.db` 则用旧文件。兼容旧变量名 `QUICKNOTE_DATA`。
3. `%APPDATA%\TickNote\ticknote.db`；若不存在则依次回退到同目录的 `quicknote.db`、旧目录 `%APPDATA%\QuickNote\quicknote.db`。
4. 兜底：`~/.ticknote/ticknote.db`。

需要指向别的数据库（例如测试库）时，在客户端配置里加环境变量：

```json
"env": {
  "ELECTRON_RUN_AS_NODE": "1",
  "TICKNOTE_DATA": "C:\\Users\\<用户名>\\AppData\\Roaming\\TickNote"
}
```

注意：删除开关是从**数据库文件所在目录**的 `settings.json` 读取的。若把 `TICKNOTE_DB` 指到别的目录，那里也需要有对应的 `settings.json`。

## 风险提示

- **AI 可以读写你的本地记录。** 连接后，客户端既能创建、修改、完成记录，也能在你开启删除工具后永久删除记录。
- **删除不可撤销。** `delete_item` 是硬删除，没有回收站；建议只在信任的客户端上、必要时短暂开启。
- **记录会离开本机。** MCP 本身不联网，但 AI 客户端拿到记录文本后如何使用、是否发送给模型服务商，由客户端与其隐私政策决定。不要把敏感内容交给不可信的客户端。
- **没有鉴权层。** stdio server 以当前用户权限运行，本机任何能启动该进程的程序都能访问数据库；它不监听端口，也不提供远程访问。
- **AI 写入会被标记。** `source='ai'` 便于在主窗区分，但 MCP 写入不会实时推送到已打开的主窗——切换筛选或重开窗口才能看到。
- **提醒不会由 MCP 弹出。** 到点通知依赖 TickNote 主进程运行（托盘常驻）。

## 排障

| 现象             | 排查                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 客户端看不到工具 | 检查 `command` / `args` 路径是否存在；完全退出客户端再重开；确认 `env` 里有 `ELECTRON_RUN_AS_NODE=1`                                                                          |
| 启动即退出       | 在 PowerShell 里先 `$env:ELECTRON_RUN_AS_NODE=1`，再运行 `TickNote.exe resources\mcp\server.js` 查看 stderr；启动成功会打印 `[mcp] ticknote server ready, db=..., delete=...` |
| 读不到记录       | 确认数据库路径（看启动日志里的 `db=`）；安装版与便携版共用 `%APPDATA%\TickNote`                                                                                               |
| 删除工具不存在   | 设置里开启「MCP 删除工具」并重启客户端；注意开关是按数据库目录的 `settings.json` 读取的                                                                                       |
| 写入后主窗没变化 | 预期行为，切换筛选/重开主窗即可                                                                                                                                               |

## 本地验证

```powershell
npm run build:mcp   # 生成 resources/mcp/server.js（已 gitignore）
npm run test:mcp    # 用 stdio 客户端跑一遍 create / list / search / update / complete / delete
```

`scripts/test-mcp.ts` 会通过 stdio 客户端依次调用 5 个默认工具，再验证删除开关。脚本在系统临时目录里建库，并通过环境变量 `TICKNOTE_DB` 指向它，不会影响 `%APPDATA%\TickNote` 中的真实记录。
