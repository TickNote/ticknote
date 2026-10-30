> [中文](PRIVACY.md) | English

# Privacy notice

> Applies to TickNote (待办便签) 0.1.0, the Windows desktop app and its built-in MCP server.

## In one sentence

TickNote is a local-first, single-machine tool: **it collects no telemetry and makes no background network calls**. The only outbound request comes from the “AI polish” feature that you enable yourself and trigger by clicking, and it sends just the current line of text to the endpoint you configured.

## What we collect

**Nothing.**

- No account system, no sign-in required.
- No telemetry, no analytics, no usage statistics, no crash reporting.
- No automatic update checks, no requests to any config delivery endpoint.
- No access to your contacts, no clipboard history scraping, no keyboard monitoring (the global hotkey registers exactly one key combination and records no other keys).

## Where your data lives

Everything is stored locally under `%APPDATA%\TickNote`:

| Content          | Path                                                    | Notes                                                                    |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Records database | `%APPDATA%\TickNote\ticknote.db` (plus `-wal` / `-shm`) | Plain SQLite; holds record text, kind, status and reminder time          |
| Settings         | `%APPDATA%\TickNote\settings.json`                      | Hotkey, theme, autostart state, AI endpoint and model, encrypted API key |
| Markdown export  | `%APPDATA%\TickNote\export\notes-YYYY-MM-DD.md`         | Generated only when you export; plain text                               |

- On first launch the app **copies** data from older versions (`%APPDATA%\QuickNote\quicknote.db`, or the legacy file name `quicknote.db` in the same directory) to the new location once; the old files are not deleted.
- The database is not encrypted; its safety depends on your Windows account and disk encryption (BitLocker is recommended). Any local program that can access the file can read your records.

## AI polish

Off by default. Only after you enable it in settings do the “AI polish” buttons appear in the popup and the main-window composer — and **a request is only sent when you click the button**.

- **What is sent**: only the line of text currently in the input box (max 2000 characters). No history, no other records, no statistics.
- **Where it goes**: the endpoint (`aiBaseUrl`) and model (`aiModel`) you configured in settings, through the OpenAI-compatible `/chat/completions` API. The defaults are `https://api.deepseek.com/v1` + `deepseek-chat`.
- **What is not sent**: the API key is used only as an `Authorization: Bearer` header to that endpoint; it is never written to logs or export files.
- **Request parameters**: `temperature: 0`, asking for a JSON `{content, kind}` in return; 3-second timeout. On failure or timeout the original text is kept.
- **Result handling**: the polished text is only echoed into the input box and can be undone; nothing is written to the database until you press `Enter` / click “记录”.

**How the API key is stored**:

- It is encrypted with Electron's `safeStorage.encryptString()` (protected by DPAPI on Windows), base64-encoded, and written to the `aiApiKeyEncrypted` field of `%APPDATA%\TickNote\settings.json`.
- The renderer only ever sees `aiApiKeySet: true/false` and never the plaintext; decryption happens in the main process only.
- If `safeStorage` is unavailable on the system (very rare), it degrades to `plain:<base64>` with an explicit prefix — that is encoding only, **not encryption**. The settings panel lets you clear the key at any time.
- Note: a local program that can read `settings.json` may also be able to decrypt the key through the same DPAPI, so protect your Windows account.

**Third-party services**: AI requests go directly from your computer to the provider you chose, without passing through TickNote's authors or any relay. How that provider handles the request content is governed by its own privacy policy and local law — evaluate that yourself.

## MCP

- The MCP server is a local **stdio process**: it listens on no port, does not use the network, and has no cloud relay.
- It reads and writes `%APPDATA%\TickNote\ticknote.db` directly, so a connected AI client can read, create and modify records; after you enable the “MCP delete tool” it can also hard-delete them.
- The MCP process itself sends no data anywhere; how the AI client uses the records afterwards, and whether it uploads them to a model provider, is up to that client and outside TickNote's control.
- Please do not connect TickNote's MCP configuration to a client you do not trust.

## Export files

- Export is **manually triggered** (main-window export dialog or tray menu) and always writes to `%APPDATA%\TickNote\export\`.
- The output is plain Markdown text (`notes-YYYY-MM-DD.md`) and contains no API key and no settings data.
- How exported files are later copied, uploaded or shared is your responsibility; the export directory is not encrypted either.

## Deleting data

| Need                                | How                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Clear all records but keep settings | Settings panel → “Danger zone” → “Clear all records” (two-step confirmation, hard delete, no recycle bin)                                       |
| Fully reset the app                 | Quit TickNote (tray menu “Quit”) and delete the whole `%APPDATA%\TickNote` directory                                                            |
| Uninstall the app                   | Use the system uninstaller for installed builds (settings panel or Start Menu “Uninstall TickNote”); **uninstalling does not delete your data** |
| Portable build                      | Just delete the unzipped directory; the data still lives in `%APPDATA%\TickNote` and must be deleted separately                                 |

- Old files created by the legacy import are not cleaned up automatically; to wipe everything, also check `%APPDATA%\QuickNote`.
- The database uses WAL mode, so make sure the app has exited before deleting, otherwise `-wal` / `-shm` files may be left behind.

## Changes and contact

This notice will be updated as features change; the history is recorded in [CHANGELOG.md](../CHANGELOG.md). For privacy questions, please open an issue in the repository: `https://github.com/TickNote/ticknote/issues`.
