> [中文](CONTRIBUTING.md) | English

# Contributing guide

Thanks for wanting to improve TickNote (待办便签). It is a Windows-only Electron desktop app under the MIT license. Before changing anything, please read [docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md) and [DESIGN.md](DESIGN.md).

## Development environment

- **Windows 10 / 11 x64** (the tray, system notifications and NSIS packaging all depend on Windows).
- **Node.js >= 22** (`.nvmrc` pins 22). The database uses the built-in `node:sqlite`, so no MSVC is needed and there are no native modules.
- npm (the repo commits `package-lock.json`, so install with it).

```powershell
git clone https://github.com/TickNote/ticknote.git
cd ticknote
npm install
npm run dev
```

## Common commands

| Command                                                    | What it does                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                                              | electron-vite dev mode (main-process changes restart, renderer HMR) |
| `npm run build`                                            | Build main / preload / renderer into `out/`                         |
| `npm run build:mcp`                                        | Bundle the MCP server with esbuild → `resources/mcp/server.js`      |
| `npm run build:all`                                        | `build` + `build:mcp`                                               |
| `npm start`                                                | Run the already-built app (`electron .`)                            |
| `npm run typecheck`                                        | `tsc --noEmit`                                                      |
| `npm run lint` / `npm run format` / `npm run format:check` | oxlint / Prettier                                                   |
| `npm test`                                                 | `vitest run` + `npm run test:mcp`                                   |
| `npm run test:watch`                                       | vitest watch mode                                                   |
| `npm run test:mcp`                                         | MCP end-to-end test (run `build:mcp` first)                         |
| `npm run dist`                                             | `build:all` + electron-builder, output in `release/`                |
| `npm run pack:portable`                                    | Zip `release/win-unpacked` into a portable archive                  |

> `npm test` first runs `vitest run` (cases live in `tests/*.test.ts`, configured in `vitest.config.mts`), then the MCP end-to-end script. Anything involving MCP requires `npm run build:mcp` first, otherwise you are testing the stale `resources/mcp/server.js`.

## Directory layout (brief)

```
src/main/      Electron main process: windows, tray, hotkey, reminders, settings, export, uninstall, IPC, database
src/preload/   contextBridge allowlist (window.api)
src/renderer/  React 19, two entries main.html / capture.html
src/shared/    IPC channel names (ipc.ts) and DTOs (types.ts)
src/mcp/       stdio MCP server (standalone process, reuses main/db/repo.ts)
tests/         vitest cases (repo / export / ai-parse)
scripts/       MCP end-to-end and smoke scripts, portable packaging script
build/         icons and NSIS customization script
docs/          architecture, MCP and privacy docs
```

The root also contains `vitest.config.mts`, `.prettierrc`, `.prettierignore` and `.editorconfig`.

See [docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md) for the full tree and data flow.

## Code conventions

1. **SQL lives only in `src/main/db/repo.ts`.** IPC handlers and MCP tools both call repo; never assemble SQL anywhere else.
2. **Cross-process contracts live in `src/shared/`.** Channel names are referenced from the `IPC` constant, never written as literals; DTOs are imported from `types.ts`.
3. **The main process must validate input.** Every `ipcMain.handle` validates with zod, constraining string length, uuid and enums.
4. **preload exposes allowlisted methods only.** Never expose `ipcRenderer`, `require` or arbitrary channel calls; the renderer keeps `contextIsolation: true` / `nodeIntegration: false`.
5. **Prefer zero dependencies.** The database uses `node:sqlite`, the build uses electron-vite / esbuild; justify any new runtime dependency before adding it.
6. **Do not change DDL that has already shipped.** For schema changes, append a `SCHEMA_VERSION` migration branch.
7. **UI copy stays in Chinese.** Stay consistent with the existing interface (「记录」「润色」「卸载」 rather than 「发送」「录入」).
8. **Do not edit `DESIGN.md` to match the implementation.** When the implementation deviates from the design, explain why in the Issue/PR.

## Commit convention (condensed Conventional Commits)

Format:

```
<type>(<scope>): <subject>
```

Common types:

| type       | Purpose                             |
| ---------- | ----------------------------------- |
| `feat`     | New feature                         |
| `fix`      | Bug fix                             |
| `docs`     | Documentation only                  |
| `refactor` | Refactoring without behavior change |
| `perf`     | Performance improvement             |
| `test`     | Test-related                        |
| `build`    | Build / dependencies / packaging    |
| `ci`       | CI configuration                    |
| `chore`    | Miscellaneous (formatting, cleanup) |

Available scopes: `main`, `renderer`, `preload`, `db`, `mcp`, `export`, `ai`, `settings`, `docs`, `build`.

Examples:

```
feat(mcp): add kind filter to search_items
fix(renderer): refresh immediately with the current filter after switching kind in the drawer
docs(architecture): document the MCP database path resolution order
build: keep only the zh-CN / en-US locale packs
```

Requirements:

- The subject states “what was done” in one sentence, with no trailing period, and stays within 72 characters.
- One commit does one thing; do not mix formatting, refactoring and features.
- The body (optional) explains “why”; link Issues with `Closes #12`.

## New IPC checklist

- [ ] Add the channel name constant in `src/shared/ipc.ts`
- [ ] Add or reuse the DTO in `src/shared/types.ts`
- [ ] Add the data method in `src/main/db/repo.ts` (SQL only here)
- [ ] Register the handler in `setupIpc()` in `src/main/index.ts` and validate with zod
- [ ] Call `notifyItemsChanged()` after writes (refresh the tray + notify the main window)
- [ ] Expose the method in `src/preload/index.ts` (event-style APIs return an unsubscribe function)
- [ ] Add a same-named implementation to the mock in `src/renderer/src/api.ts` so browser preview keeps working
- [ ] Sync the channel table in `docs/ARCHITECTURE.md` and section 8 of `DESIGN.md`
- [ ] `npm run typecheck` passes

## New MCP tool checklist

- [ ] Use `registerTool` + a zod `inputSchema` in `src/mcp/server.ts`
- [ ] Call `repo` methods only, never write SQL
- [ ] Mark read operations with `annotations.readOnlyHint: true`; mark destructive ones with `destructiveHint: true`
- [ ] Return `ok(serialize(...))` / `fail(...)` with fields consistent with existing tools
- [ ] Leave irreversible operations such as delete unregistered by default, gated by the `settings.json` switch
- [ ] Update the tool table in `docs/MCP.md`
- [ ] Add an end-to-end assertion in `scripts/test-mcp.ts`
- [ ] `npm run build:mcp && npm run test:mcp` passes

## Testing and packaging

- Before submitting, at minimum run: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`. If you only touched MCP, run `npm run build:mcp && npm run test:mcp`.
- Unit tests live in `tests/` (`repo.test.ts`, `export.test.ts`, `ai-parse.test.ts`); `vitest.config.mts` targets `tests/**/*.test.ts`; use `npm run test:watch` to run them while editing.
- `scripts/` also holds standalone smoke scripts (`test-db.ts`, `test-ai.ts`) that you can run with `npx tsx scripts/test-db.ts`; the MCP end-to-end script is `scripts/test-mcp.ts`.
- Packaging verification:

  ```powershell
  npm run dist
  # Output: release\TickNote-<version>-Setup.exe and release\win-unpacked\
  npm run pack:portable
  # Output: release\TickNote-<version>-portable.zip
  ```

- After packaging, smoke test manually: open the main window, summon the popup with the hotkey and save a note, close to the tray, export Markdown, open the settings panel. If you changed MCP, connect once using `release\win-unpacked\TickNote.exe` + `resources\mcp\server.js` (`ELECTRON_RUN_AS_NODE=1`).

## Issue requirements

- **Bug**: use the bug report template and state the version, install method (Setup / portable / development), OS version, reproduction steps and expected result; attach logs or screenshots, but **never paste API keys or private records**.
- **Feature request**: use the feature request template; describe the use case first, then the expected behavior.
- Search existing issues first to avoid duplicates; one issue discusses one problem.
- For security vulnerabilities, do **not** open a public issue — report privately as described in [SECURITY.en.md](SECURITY.en.md).

## PR requirements

- Branch from the latest `main` and use the repo template for the PR description (what changed, related issue, how it was tested, screenshots).
- Keep the diff focused: no unrelated formatting or refactoring.
- Add tests for new behavior, or explain why it cannot be tested automatically; attach a screenshot or screen recording for UI changes.
- Make sure CI passes before merging (GitHub Actions runs `typecheck` / `lint` / `build:all` / `test` on `windows-latest`), and get at least one maintainer review.
- Before submitting, confirm that no generated files or local data were added to the repository.

## Files not to commit

The following are already in `.gitignore`; do not force-add them:

- `release/` (installers, `win-unpacked`, portable zips)
- `resources/mcp/server.js` (generated by `npm run build:mcp`)
- `out/`, `dist/`, `.vite/`, `coverage/`
- `.tmp/`, `.screenshots/`, `scripts/.cache/`
- `*.log`, `*.tsbuildinfo`

Also, local data (`ticknote.db`, `*.db-wal`, `*.db-shm`, `settings.json`) normally lives in `%APPDATA%\TickNote` rather than in the repository, but please do not copy it into the repo or paste it into issues / PRs either.

## License

By submitting code to this repository you agree to license your contribution under the [MIT License](LICENSE), with copyright held by TickNote Contributors.
