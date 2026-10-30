import { app, dialog, ipcMain } from 'electron';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IPC } from '../shared/ipc';
import type {
  AiParseResult,
  AutostartStatus,
  ExportResult,
  ExportScope,
  ListQuery,
  Settings,
  SettingsPatch,
  UninstallResult,
} from '../shared/types';
import type { Repo } from './db/repo';
import { backupSchema, itemSchema } from '../shared/validation';
import { parseNote } from './ai/parse';
import { applySettingsPatch, decryptAiKey, getSettings, setAutostartConfigured } from './settings';
import { applyWindowBackground, getCaptureWindow, showMainWindow } from './windows';

export interface IpcDependencies {
  repo: Repo;
  notifyItemsChanged: () => void;
  refreshTray: () => void;
  focusItem: (id: string) => void;
  exportNow: (scope?: ExportScope, interactive?: boolean) => Promise<ExportResult | null>;
  registerHotkey: () => void;
  uninstallApp: () => Promise<UninstallResult>;
}

function autostartStatus(): AutostartStatus {
  const info = app.getLoginItemSettings({ path: process.execPath, args: ['--autostart'] });
  return {
    openAtLogin: Boolean(info.openAtLogin),
    executableWillLaunchAtLogin: Boolean(info.executableWillLaunchAtLogin),
    blocked: Boolean(info.openAtLogin && !info.executableWillLaunchAtLogin),
    packaged: app.isPackaged,
  };
}

async function parseWithAi(content: string): Promise<AiParseResult | null> {
  const settings = getSettings();
  if (!settings.aiEnabled) return null;
  const key = decryptAiKey();
  if (!key) return null;
  return parseNote(content, {
    baseUrl: settings.aiBaseUrl,
    model: settings.aiModel,
    apiKey: key,
    timeoutMs: 3000,
  });
}

export function setupIpc(deps: IpcDependencies): void {
  const { repo } = deps;

  const createPayload = z.object({
    content: z.string().trim().min(1).max(2000),
    kind: z.enum(['note', 'todo']),
  });

  ipcMain.handle(IPC.itemsCreate, (_event, payload: unknown) => {
    const input = createPayload.parse(payload);
    const item = repo.create(input);
    deps.notifyItemsChanged();
    return item;
  });

  ipcMain.handle(IPC.itemsList, (_event, payload: unknown) => {
    const query = z
      .object({
        filter: z.enum(['all', 'todo', 'note', 'done', 'reminders']).default('all'),
        cursor: z.union([z.number(), z.object({ createdAt: z.number(), id: z.string().uuid() })]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .parse(payload ?? {}) as ListQuery;
    return repo.list(query);
  });

  ipcMain.handle(IPC.itemsSearch, (_event, payload: unknown) => {
    const input = z
      .object({ q: z.string().max(200), limit: z.number().min(1).max(50).optional() })
      .parse(payload);
    return repo.search(input.q, input.limit ?? 30);
  });

  ipcMain.handle(IPC.itemsComplete, (_event, payload: unknown) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(payload);
    const item = repo.setStatus(id, true);
    deps.notifyItemsChanged();
    return item;
  });

  ipcMain.handle(IPC.itemsRestore, (_event, payload: unknown) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(payload);
    const item = repo.setStatus(id, false);
    deps.notifyItemsChanged();
    return item;
  });

  ipcMain.handle(IPC.itemsGet, (_event, payload: unknown) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(payload);
    return repo.get(id);
  });

  ipcMain.handle(IPC.itemsUpdate, (_event, payload: unknown) => {
    const { id, content } = z
      .object({ id: z.string().uuid(), content: z.string().trim().min(1).max(2000) })
      .parse(payload);
    const item = repo.updateContent(id, content);
    // 内容修改不影响列表分页与统计，渲染层已本地更新，无需广播刷新
    deps.refreshTray();
    return item;
  });

  ipcMain.handle(IPC.itemsSetKind, (_event, payload: unknown) => {
    const { id, kind } = z.object({ id: z.string().uuid(), kind: z.enum(['note', 'todo']) }).parse(payload);
    const item = repo.update(id, { kind });
    // 切换类型会改变筛选结果，广播让各窗口重新拉取
    if (item) deps.notifyItemsChanged();
    return item;
  });

  ipcMain.handle(IPC.itemsDelete, (_event, payload: unknown) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(payload);
    const removed = repo.remove(id);
    deps.notifyItemsChanged();
    return removed;
  });

  // 行内删除的撤销：把完整记录按原 id / 时间写回
  ipcMain.handle(IPC.itemsRestoreDeleted, (_event, payload: unknown) => {
    const { item } = z.object({ item: itemSchema }).parse(payload);
    const restored = repo.restore(item);
    if (restored) deps.notifyItemsChanged();
    return restored;
  });

  ipcMain.handle(IPC.itemsClearAll, () => {
    const removed = repo.clearAll();
    deps.notifyItemsChanged();
    deps.refreshTray();
    return removed;
  });

  ipcMain.handle(IPC.itemsSetReminder, (_event, payload: unknown) => {
    const { id, remindAt } = z
      .object({ id: z.string().uuid(), remindAt: z.number().int().nonnegative().nullable() })
      .parse(payload);
    const item = repo.setReminder(id, remindAt);
    deps.refreshTray();
    return item;
  });

  ipcMain.handle(IPC.exportMarkdown, async (_event, payload: unknown) => {
    const { scope } = z
      .object({ scope: z.enum(['all', 'todo', 'note', 'done', 'reminders', 'today']).optional() })
      .parse(payload ?? {});
    return deps.exportNow(scope ?? 'all');
  });

  ipcMain.handle(IPC.backupExport, async () => {
    const picked = await dialog.showSaveDialog({
      title: '备份全部记录',
      defaultPath: join(app.getPath('documents'), `TickNote-backup-${Date.now()}.json`),
      filters: [{ name: 'TickNote 备份', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    const items = repo.allForExport();
    writeFileSync(
      picked.filePath,
      JSON.stringify(
        { format: 'ticknote-backup', version: 1, exportedAt: new Date().toISOString(), items },
        null,
        2,
      ),
      { encoding: 'utf8', flush: true },
    );
    return { path: picked.filePath, count: items.length };
  });

  ipcMain.handle(IPC.backupImport, async () => {
    const picked = await dialog.showOpenDialog({
      title: '恢复备份（合并记录，不覆盖已有内容）',
      properties: ['openFile'],
      filters: [{ name: 'TickNote 备份', extensions: ['json'] }],
    });
    const path = picked.filePaths[0];
    if (picked.canceled || !path) return null;
    if (statSync(path).size > 100 * 1024 * 1024) throw new Error('备份文件过大，请选择小于 100 MB 的文件');
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('备份文件无法读取或格式不正确，未导入任何记录');
    }
    const data = backupSchema.safeParse(raw);
    if (!data.success) throw new Error('备份格式不正确，未导入任何记录');
    const count = repo.importItems(data.data.items);
    deps.notifyItemsChanged();
    return { path, count };
  });

  ipcMain.handle(IPC.itemsStats, () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return repo.stats(todayStart.getTime());
  });

  ipcMain.handle(IPC.settingsGet, (): Settings => getSettings());

  ipcMain.handle(IPC.settingsSet, (_event, payload: unknown) => {
    const patch = z
      .object({
        theme: z.enum(['system', 'light', 'dark']).optional(),
        hotkey: z.string().min(1).max(64).optional(),
        hideCaptureOnBlur: z.boolean().optional(),
        mcpDeleteEnabled: z.boolean().optional(),
        aiEnabled: z.boolean().optional(),
        aiBaseUrl: z
          .string()
          .url('请输入有效的 http 或 https 接口地址')
          .max(500)
          .refine(
            (value) => ['http:', 'https:'].includes(new URL(value).protocol),
            '接口地址必须使用 http 或 https',
          )
          .optional(),
        aiModel: z.string().min(1).max(100).optional(),
        aiApiKey: z.string().max(500).nullable().optional(),
      })
      .parse(payload) as SettingsPatch;
    const next = applySettingsPatch(patch, { onHotkeyChange: deps.registerHotkey });
    applyWindowBackground();
    return next;
  });

  ipcMain.handle(IPC.autostartGet, () => autostartStatus());

  ipcMain.handle(IPC.autostartSet, (_event, payload: unknown) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(payload);
    try {
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--autostart'] });
      setAutostartConfigured();
    } catch (error) {
      console.error('[autostart] set failed', error);
    }
    return autostartStatus();
  });

  ipcMain.handle(IPC.aiParse, async (_event, payload: unknown) => {
    const { content } = z.object({ content: z.string().trim().min(1).max(2000) }).parse(payload);
    return parseWithAi(content);
  });

  ipcMain.handle(IPC.aiTest, async () => {
    if (!getSettings().aiEnabled) throw new Error('请先启用 AI 润色');
    const key = decryptAiKey();
    if (!key) throw new Error('API Key 未设置或无法解密，请重新保存');
    const settings = getSettings();
    const response = await fetch(`${settings.aiBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: settings.aiModel,
        messages: [{ role: 'user', content: '请回复 OK' }],
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`连接失败（HTTP ${response.status}），请检查地址、Key 和模型`);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    if (!data.choices?.[0]?.message?.content) throw new Error('接口返回格式不兼容，请检查地址和模型');
    return '连接成功，模型可用';
  });

  ipcMain.handle(IPC.appUninstall, async (): Promise<UninstallResult> => deps.uninstallApp());

  ipcMain.on(IPC.captureHide, () => {
    getCaptureWindow()?.hide();
  });

  ipcMain.on(IPC.captureResize, (_event, payload: unknown) => {
    const height = Math.min(330, Math.max(180, Number(payload) || 240));
    getCaptureWindow()?.setSize(620, Math.round(height), false);
  });

  ipcMain.on(IPC.windowOpenMain, () => {
    showMainWindow();
  });
}
