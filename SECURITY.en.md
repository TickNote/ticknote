> [中文](SECURITY.md) | English

# Security policy

TickNote (待办便签) is a local-first Windows desktop app: no server, no account, no cloud sync. Its security boundary is mainly around **local processes** and **local data**.

## Supported versions

- Only the **latest release** is maintained (currently `0.1.x`).
- Older versions do not receive separate security patches; if you find a problem, upgrade to the latest version and retest.
- Commits on the development branch (`main`) are also evaluated, but no fix timeline is promised.

## Reporting a vulnerability

**Please do not open a public issue, and do not post details to discussion forums or social media.**

Report it through GitHub's private security advisories:

```
https://github.com/TickNote/ticknote/security/advisories/new
```

(You can also click “Report a vulnerability” on the Security tab of the repository.)

Please include as much of the following as you can:

- The TickNote version (settings panel / installer file name);
- The install method: Setup installer, portable zip, or development mode;
- Your Windows version and architecture;
- The type of issue and its impact (for example: can records be read, can arbitrary code be executed, does it require local user interaction?);
- Reproduction steps or a minimal PoC (code snippets are fine, but **do not attach real API keys or private records**);
- How you would like to be disclosed / credited (optional).

Maintainers will evaluate and reply as soon as possible; after a fix is released, we will confirm the public disclosure date and credit with you. **No fixed response time is promised**, but every report is taken seriously.

## Security model at a glance

| Item              | Notes                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process isolation | The renderer has `contextIsolation` and `sandbox` on, `nodeIntegration` off, and can only call the main process through allowlisted preload methods; windows deny new windows and page navigation |
| CSP               | Both HTML entries carry a minimal Content-Security-Policy; the renderer loads no remote resources                                                                                                 |
| IPC validation    | Every main-process handler validates its input with zod (length, uuid, enums)                                                                                                                     |
| Data storage      | `%APPDATA%\TickNote\ticknote.db` is **plaintext** SQLite, unencrypted                                                                                                                             |
| Database access   | Only the main process and the MCP process open the database (WAL + `busy_timeout`)                                                                                                                |
| Network           | The only outbound request is user-triggered AI polish; no telemetry, no auto-update                                                                                                               |
| API key           | Encrypted with Electron `safeStorage` and stored in `settings.json`; the renderer can only see whether it is set                                                                                  |
| MCP               | Local stdio, no network listener, no authentication; the delete tool is off by default                                                                                                            |
| Code signing      | Currently **unsigned**                                                                                                                                                                            |

## How the AI key is stored, and what to watch out for

- On save, `safeStorage.encryptString()` is called (protected by DPAPI on Windows), the result is base64-encoded and written to the `aiApiKeyEncrypted` field of `%APPDATA%\TickNote\settings.json`.
- Decryption happens only in the main process; the renderer only gets `aiApiKeySet: true/false`.
- If `safeStorage` is unavailable, it degrades to `plain:<base64>` (encoding only, not encryption); the settings panel says so explicitly and the key can be cleared at any time.
- **Risk**: a program that can read your Windows user directory, or that runs as your user, may also be able to decrypt the key through the same DPAPI; protect your account and enable disk encryption (BitLocker).
- The key is only sent as a Bearer header to the AI endpoint you configured; it is never written to logs or export files.
- When reporting a problem, **clear the key first** before attaching `settings.json`, or paste only the field names.

## MCP deletion risks

- `delete_item` is **not registered by default**. The tool only appears after you turn on “MCP delete tool” in settings (`mcpDeleteEnabled: true`) and restart the AI client.
- Even when enabled, the call must include `confirm: true`, and it is a **hard delete** — no recycle bin, no undo.
- The MCP server runs with the current Windows user's privileges, with no authentication layer and no sandbox. Any local program that can launch that process can read and write the database.
- The MCP process reads the delete switch from the `settings.json` **in the database's directory**; if you use a custom `TICKNOTE_DB`, make sure the settings in that directory are what you expect.
- Only connect AI clients you trust to TickNote; if you do not need MCP, just remove the `ticknote` entry from the client configuration.
- Recommendation: keep the delete tool off in daily use; turn it on temporarily when you need cleanup, then turn it off and restart the client.

## Unsigned installers

- The released `TickNote-x.y.z-Setup.exe` and portable zip are **not code-signed**, so Windows SmartScreen shows “Unknown publisher” / “Windows protected your PC”. This is expected and does not mean the file was tampered with, but it does mean **the system cannot verify the origin for you**.
- Download only from the Releases page of this repository; every release ships a `SHA256SUMS.txt` so you can verify it yourself:

  ```powershell
  Get-FileHash .\TickNote-x.y.z-Setup.exe -Algorithm SHA256
  Get-Content .\SHA256SUMS.txt
  ```

- If the portable zip came from the internet, run `Unblock-File .\TickNote-x.y.z-portable.zip` before unzipping.
- Until a code-signing certificate is configured, the SmartScreen warning cannot be technically eliminated; evaluate for yourself whether you trust the build source.

## Out of scope

- SmartScreen / antivirus warnings about unsigned programs (a distribution policy matter, not a vulnerability).
- Reminders not being shown because of system Do Not Disturb or disabled notifications.
- Global hotkey conflicts with other software (a feature limitation, handled as a regular bug).
- Data handling and availability issues of third-party AI providers (DeepSeek, OpenAI-compatible endpoints, etc.).
- Attacks performed with the local user's privileges already in hand (reading `ticknote.db` directly, for example), unless a privilege escalation can be demonstrated.
- Known vulnerabilities in dependencies: these are tracked through Dependabot; if they affect an exploitable path in TickNote, report them through the private channel above.

## Hardening plan (known improvements)

- Continue tightening `'unsafe-inline'` in the CSP (currently kept for Vite injection and inline styles; see [docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md#8-security-model) for details).
- Configure code signing for release artifacts.
- Provide an optional encrypted storage scheme for the database.

---

Related documents: [docs/PRIVACY.en.md](docs/PRIVACY.en.md) · [docs/MCP.en.md](docs/MCP.en.md) · [docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md)
