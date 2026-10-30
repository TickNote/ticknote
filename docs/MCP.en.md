> [中文](MCP.md) | English

# MCP integration

TickNote ships a built-in stdio MCP server so that any AI client supporting the Model Context Protocol (Claude Desktop, Cursor, Trae, WorkBuddy, DeepSeek Harness, etc.) can read and write the same local records.

## Copy this prompt to your AI

> Works with Trae, WorkBuddy, DeepSeek Harness, Claude Code, Cursor, and any client that can edit its own config. Just paste this like a normal chat message.

```text
Help me hook up TickNote's MCP so you can read and write my notes and todos.
TickNote is installed somewhere on this Windows machine, but I don't remember where — please find it (it may be in the local Programs folder, or a portable build unzipped anywhere).
Then set it up in this client under the name "ticknote". Local stdio only; don't download or replace any files.
When it works, create a note called "MCP connection test" to confirm writes, and tell me which file you changed and whether I need to restart the client.
```

### If the AI cannot find it

Run this and paste the output to the AI:

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Programs", "$env:USERPROFILE\Downloads", "$env:ProgramFiles" `
  -Recurse -Filter TickNote.exe -ErrorAction SilentlyContinue |
  Select-Object -First 5 -ExpandProperty FullName
```

`server.js` is always next to it in `resources\mcp\server.js`.

## Purpose

- **Capture even when the app is closed**: when the app is not running, the MCP process opens the database itself and reads/writes directly.
- **Let AI organize your records**: turn scattered quick notes into lists, search history, mark items as done.
- **Single source of truth**: humans and AI share `ticknote.db` — there is no second store and nothing goes through the cloud.

The MCP server and the main process are two separate processes that access the same database file concurrently through SQLite WAL.

```
AI client ──stdio──> TickNote.exe (ELECTRON_RUN_AS_NODE=1) ──> %APPDATA%\TickNote\ticknote.db
```

## How to launch it

The installer bundles the Electron runtime, so **users do not need to install Node separately**, and the app does not need to be running. The client configuration is essentially:

- `command`: the full path to `TickNote.exe`;
- `args`: the full path to `resources\mcp\server.js`;
- `env`: `ELECTRON_RUN_AS_NODE=1` (makes Electron run that script in Node mode).

| Scenario                | command                                          | args                                                             |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| Installed (default dir) | `%LOCALAPPDATA%\Programs\TickNote\TickNote.exe`  | `%LOCALAPPDATA%\Programs\TickNote\resources\mcp\server.js`       |
| Portable                | `<unzipped dir>\TickNote.exe`                    | `<unzipped dir>\resources\mcp\server.js`                         |
| Development             | `<repo>\node_modules\electron\dist\electron.exe` | `<repo>\resources\mcp\server.js` (run `npm run build:mcp` first) |

> If you changed the install directory, use the real path instead. NSIS installs **per user**, so the default is `%LOCALAPPDATA%\Programs\TickNote`.

## Claude Desktop configuration

Config file: `%APPDATA%\Claude\claude_desktop_config.json`

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

After saving, quit Claude Desktop completely (also from the tray) and reopen it — only then does TickNote show up in the tool list.

## Cursor configuration

Global config file: `%USERPROFILE%\.cursor\mcp.json`; it can also live in the project at `.cursor\mcp.json`.

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

Replace the path placeholders with real values: `<用户名>` is your Windows account name; if you installed elsewhere, change `AppData\\Local\\Programs\\TickNote`. Backslashes in JSON must be written as `\\`.

## Trae configuration

Trae supports two locations; pick one:

| Scope | File | When to use |
| --- | --- | --- |
| Project | `<project root>\.trae\mcp.json` | only this project |
| Global | `%APPDATA%\Trae\User\mcp.json` | reused across projects (Settings → MCP → Open config file shows the real path) |

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

After saving, reload the window (`Developer: Reload Window`) or restart Trae; the MCP panel should show `ticknote` as connected.

## WorkBuddy configuration

WorkBuddy (Tencent) uses the standard `mcpServers` JSON:

| Scope | File |
| --- | --- |
| User | `%USERPROFILE%\.workbuddy\mcp.json` |
| Project | `<project>\.workbuddy\mcp.json` |

Or use the UI: sidebar "Plugins" → "MCP Servers" → "Configure MCP", and paste:

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

Green status means connected; red means the path or JSON is invalid. Restart WorkBuddy or reload its MCP servers after editing.

## DeepSeek Harness (dsh) configuration

DeepSeek Harness stores MCP servers in the user profile patch:

```
%USERPROFILE%\.dsh\profiles\dsh-cli\cordis.patch.yml
```

When `DSH_HOME` is set, use `$DSH_HOME/profiles/dsh-cli/cordis.patch.yml` instead. Append:

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

Single-quoted YAML keeps Windows backslashes literal. Restart dsh (or reload the profile) and run `/mcp` to inspect the server and its tools; they are exposed as `mcp__ticknote__<tool>`.

## Other stdio clients

Any client that understands `mcpServers` (Claude Code, Windsurf, Cline, Continue, etc.) can reuse the JSON above. The three things that matter: `command` → `TickNote.exe`, `args` → `resources\mcp\server.js`, and `env` → `ELECTRON_RUN_AS_NODE=1`.

## Tool list

6 tools in total; `delete_item` is not registered by default.

| Tool            | Input                                                                                                   | Annotations | Behavior                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `create_item`   | `content`: 1–2000 characters; `kind`: defaults to `todo`; `remind_at`: optional ISO time                | write       | Create a record with `source='ai'` and a new `ai_run_id`               |
| `list_items`    | `from` / `to`: ISO time; `status`: `open` / `done`; `kind`: `note` / `todo`; `limit`: 1–50 (default 20) | read-only   | List by creation time, newest first                                    |
| `search_items`  | `q`: 1–200 characters; `limit`: 1–50 (default 20)                                                       | read-only   | FTS5 trigram full-text search; falls back to `LIKE` below 3 characters |
| `update_item`   | `id`; `content?`; `kind?`; `status?`; `remind_at?` (pass `null` to clear)                               | write       | Partial update; changing the reminder resets `reminded_at`             |
| `complete_item` | `id`                                                                                                    | write       | Mark as done                                                           |
| `delete_item`   | `id`; `confirm: true` (literal, must be `true`)                                                         | destructive | Hard delete, no recycle bin; **not registered by default**             |

The return format is always JSON text (`content[0].text`); a single record looks like:

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

- List/search return `{ "count": N, "items": [...] }`.
- On error the tool returns `isError: true` plus an error text (for example an invalid time format or a missing record).
- At most 50 records per call and 2000 characters per record, to keep AI from flooding the database.

### Enabling the delete tool

1. TickNote main window → “Settings” → turn on “MCP delete tool” (writes `mcpDeleteEnabled: true` into `settings.json`).
2. **Restart the AI client** (each client spawns its own MCP process; without a restart the tool is not re-registered).
3. The client's tool list should then contain the 6th tool, `delete_item`.

Disabling works the same way: uncheck the option, restart the client, and `delete_item` disappears.

## Database path

The default is `%APPDATA%\TickNote\ticknote.db`. The server resolves it in this order:

1. The `TICKNOTE_DB` environment variable (full file path, highest priority).
2. `ticknote.db` under the `TICKNOTE_DATA` environment variable (data directory); if only the legacy `quicknote.db` exists, that file is used. The legacy variable name `QUICKNOTE_DATA` is accepted.
3. `%APPDATA%\TickNote\ticknote.db`; if it does not exist, fall back to `quicknote.db` in the same directory, then to `%APPDATA%\QuickNote\quicknote.db`.
4. Last resort: `~/.ticknote/ticknote.db`.

To point at another database (a test database, for example), add environment variables to the client configuration:

```json
"env": {
  "ELECTRON_RUN_AS_NODE": "1",
  "TICKNOTE_DATA": "C:\\Users\\<用户名>\\AppData\\Roaming\\TickNote"
}
```

Note: the delete switch is read from the `settings.json` in the **directory that contains the database file**. If you point `TICKNOTE_DB` at another directory, that directory needs a matching `settings.json` too.

## Risk notes

- **AI can read and write your local records.** Once connected, the client can create, modify and complete records, and permanently delete them after you enable the delete tool.
- **Deletion cannot be undone.** `delete_item` is a hard delete with no recycle bin; enable it only on clients you trust, and only for as long as you need it.
- **Records leave the machine.** MCP itself does not use the network, but how the AI client uses the record text afterwards — and whether it sends it to a model provider — is decided by that client and its privacy policy. Do not hand sensitive content to an untrusted client.
- **No authentication layer.** The stdio server runs with the current user's privileges, so any local program that can launch that process can access the database; it listens on no port and offers no remote access.
- **AI writes are tagged.** `source='ai'` makes them easy to spot in the main window, but MCP writes are not pushed to an already-open main window in real time — switch filters or reopen the window to see them.
- **Reminders are not shown by MCP.** Due notifications depend on the TickNote main process running (tray resident).

## Troubleshooting

| Symptom                            | What to check                                                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client shows no tools              | Check that the `command` / `args` paths exist; quit the client completely and reopen it; confirm `ELECTRON_RUN_AS_NODE=1` is in `env`                                                               |
| Process exits immediately          | In PowerShell set `$env:ELECTRON_RUN_AS_NODE=1` first, then run `TickNote.exe resources\mcp\server.js` and read stderr; a successful start prints `[mcp] ticknote server ready, db=..., delete=...` |
| No records can be read             | Verify the database path (look at `db=` in the startup log); installed and portable builds share `%APPDATA%\TickNote`                                                                               |
| Delete tool is missing             | Turn on “MCP delete tool” in settings and restart the client; remember the switch is read from the `settings.json` next to the database directory                                                   |
| Main window unchanged after writes | Expected behavior; switch filters or reopen the main window                                                                                                                                         |

## Local verification

```powershell
npm run build:mcp   # produces resources/mcp/server.js (already gitignored)
npm run test:mcp    # runs create / list / search / update / complete / delete through an stdio client
```

`scripts/test-mcp.ts` calls the 5 default tools in order through an stdio client, then verifies the delete switch. The script creates a database in the system temp directory and points the server at it through the `TICKNOTE_DB` environment variable, so it never touches the real records in `%APPDATA%\TickNote`.
