# TickNote

**Local-first quick notes and todos for Windows — with optional AI polish and MCP integration.**

TickNote (Chinese name 「待办便签」) is a tray-resident scratchpad. Press `Ctrl+Shift+Space`, type one line, hit `Enter`, and the popup disappears. Everything is stored in a single SQLite file on your machine, listed by creation date, and any MCP-capable AI client can read and write the same data.

<!-- TODO: add screenshots before launch -->

## Features

**Capture (global hotkey)**

- `Ctrl+Shift+Space` summons a frameless popup on the display under the mouse cursor; press it again to hide.
- `Enter` saves, `Shift+Enter` inserts a newline, `Esc` dismisses without saving.
- Drag the popup by its 18px top bar, close it with the `×` button (hides, does not quit). The position is remembered for the current session and clamped back into the work area.
- Hides automatically when it loses focus (can be turned off in settings).
- The last keypress of the hotkey is discarded if it leaks into the freshly focused input.

**Main window**

- Records grouped by creation date (Today / Yesterday / earlier), with collapsible groups.
- Full-text search over SQLite FTS5 with the `trigram` tokenizer (works for Chinese); queries shorter than 3 characters fall back to `LIKE`.
- Filter chips: All / Todos / Notes / Done, plus a `⋯` menu and a settings panel.
- Cards are truncated to 2 lines; click any row (or press `↑`/`↓` then `Enter`) to slide out the details drawer. There you can edit the text (saved on blur), switch note ↔ todo, set or clear a reminder, complete/restore, copy, and delete (two-step confirm).
- `Ctrl+N` focuses the composer; `Enter` saves and keeps the focus, `Shift+Enter` inserts a newline.
- Export Markdown to `%APPDATA%\TickNote\export\notes-YYYY-MM-DD.md` — scope: all records, the current filter, or today only. Export is also available from the tray menu.
- Reminders are scanned every 30 seconds and shown as Windows toast notifications; clicking one opens the matching record. Reminders missed while the app was closed are merged into a single notification at startup.

**Desktop integration**

- Tray-resident: closing the main window hides it; only the tray menu can quit.
- Launch at login (`--autostart`, tray only, no window) — enabled by default for installed builds, toggleable in settings.
- Follow-system / light / dark theme, persisted in `settings.json`.
- Settings panel: record a new global hotkey, hide-on-blur, MCP delete switch, AI polish configuration, clear all records, uninstall.

**AI polish (optional, off by default)**

- A button appears in the capture popup and the composer only after you enable it.
- Only the current line is sent, to the OpenAI-compatible endpoint and model you configure. The result is echoed back into the input with an undo option; nothing is saved until you press `Enter` / click save.
- If the request fails or times out (3s), your original text is kept.

## MCP

TickNote ships a built-in stdio MCP server that talks to the same SQLite database, so an AI client can use TickNote even when the app is not running. It exposes 6 tools:

| Tool            | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `create_item`   | Create a note or todo (records are tagged `source=ai`)                  |
| `list_items`    | List by creation-time range, status and kind                            |
| `search_items`  | Full-text search (FTS5 trigram)                                         |
| `update_item`   | Partially update content / kind / status / reminder                     |
| `complete_item` | Mark a record as done                                                   |
| `delete_item`   | Hard delete; **not registered by default**, must be enabled in settings |

See [docs/MCP.md](docs/MCP.md) for client configuration (Claude Desktop, Cursor), the database path resolution rules, and risk notes.

## Install

Download the latest build from the [Releases](https://github.com/TickNote/ticknote/releases) page. Two options:

1. **Installer** — `TickNote-x.y.z-Setup.exe` (NSIS, per-user install, no admin rights required, desktop + Start Menu shortcuts).
   The build is **not code-signed**, so Windows SmartScreen will show "Unknown publisher" / "Windows protected your PC". That is expected: choose _More info_ → _Run anyway_.
2. **Portable** — `TickNote-x.y.z-portable.zip`. Unzip anywhere and run `TickNote.exe`. No installer, no registry entries. If the zip came from the internet, unblock it first:
   ```powershell
   Unblock-File .\TickNote-x.y.z-portable.zip
   ```

Each release also ships `SHA256SUMS.txt` so you can verify the downloads.

Data lives in `%APPDATA%\TickNote`:

| Item            | Path                                                    |
| --------------- | ------------------------------------------------------- |
| Database        | `%APPDATA%\TickNote\ticknote.db` (plus `-wal` / `-shm`) |
| Settings        | `%APPDATA%\TickNote\settings.json`                      |
| Markdown export | `%APPDATA%\TickNote\export\`                            |

Uninstalling does **not** delete your records (`deleteAppDataOnUninstall: false` in the build config). Delete the folder above manually if you really want to start over.

## Requirements

- **Windows 10 / 11 x64.**
- For development: **Node.js >= 22** (`.nvmrc` pins 22). The database is the built-in `node:sqlite`, so there is no native module to compile.

## Development

```powershell
git clone https://github.com/TickNote/ticknote.git
cd ticknote
npm install
npm run dev
```

| Command                           | What it does                                                          |
| --------------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                     | electron-vite dev server with HMR                                     |
| `npm run build`                   | Build main / preload / renderer into `out/`                           |
| `npm run build:mcp`               | Bundle the MCP server into `resources/mcp/server.js` (gitignored)     |
| `npm run build:all`               | `build` + `build:mcp`                                                 |
| `npm start`                       | Run the already-built app (`electron .`)                              |
| `npm run typecheck`               | `tsc --noEmit`                                                        |
| `npm test`                        | `vitest run` + MCP end-to-end test (`scripts/test-mcp.ts`)            |
| `npm run test:mcp`                | MCP end-to-end test only (run `build:mcp` first)                      |
| `npm run dist`                    | Build everything and package with electron-builder into `release/`    |
| `npm run pack:portable`           | Zip `release/win-unpacked` into `release/TickNote-x.y.z-portable.zip` |
| `npm run lint` / `npm run format` | oxlint / Prettier                                                     |

More detail in [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy

TickNote is local-first:

- No telemetry, no analytics, no account, no crash reporting.
- No background network access. The **only** outbound request is AI polish, and only when you enable it and click the button.
- AI polish sends just the current line of text to the endpoint and model you configured (an OpenAI-compatible `/chat/completions` API). The API key is encrypted with Electron `safeStorage` and stored locally in `settings.json`.
- MCP is a local `stdio` process — no network listener, no cloud relay.

Full details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Status & limitations

- **Windows only.** Tray behavior, toast notifications and the NSIS installer are all Windows-specific.
- **Unsigned builds.** SmartScreen warnings are expected until code signing is set up.
- **AI needs your own key.** AI polish is off by default and requires an OpenAI-compatible endpoint plus an API key; the app never bundles or proxies credentials.
- **No recycle bin, no sync, no rich text.** Deletion is permanent; there is no cloud account, attachment or formatting support.
- **MCP delete is off by default.** It must be enabled in settings, and the AI client must be restarted afterwards.
- **Cross-process refresh is not real-time.** Records written by an MCP client while the main window is open are not pushed into it; switch filters or reopen the window to see them.
- **The UI is Chinese.** Product name is TickNote, but window titles, menus and labels are in Chinese (「待办便签」).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — process layout, IPC contract, database, security model, extension guide
- [docs/MCP.md](docs/MCP.md) — MCP server setup and tools
- [docs/PRIVACY.md](docs/PRIVACY.md) — data handling
- [DESIGN.md](DESIGN.md) — full product/design spec (Chinese)
- [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) · [CHANGELOG.md](CHANGELOG.md)

## License

MIT © TickNote Contributors. See [LICENSE](LICENSE).
