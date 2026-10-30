import { app, ipcMain } from 'electron';
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
import { parseNote } from './ai/parse';
import {
  applySettingsPatch,
  decryptAiKey,
  getSettings,
  setAutostartConfigured,
} from './settings';
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
        filter: z.enum(['all', 'todo', 'note', 'done']).default('all'),
        cursor: z.number().optional(),
        limit: z.number().min(1).max(50).optional(),
      })
      .parse(payload ?? {}) as ListQuery;
    return repo.list(query);
  });

  ipcMain.handle(IPC.itemsSearch, (_event, payload: unknown) => {
    const input = z.object({ q: z.string().max(200), limit: z.number().min(1).max(50).optional() }).parse(payload);
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
      .object({ scope: z.enum(['all', 'todo', 'note', 'done', 'today']).optional() })
      .parse(payload ?? {});
    return deps.exportNow(scope ?? 'all');
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
        aiBaseUrl: z.string().min(1).max(500).optional(),
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

  ipcMain.handle(IPC.appUninstall, async (): Promise<UninstallResult> => deps.uninstallApp());

  ipcMain.on(IPC.captureHide, () => {
    getCaptureWindow()?.hide();
  });

  ipcMain.on(IPC.captureResize, (_event, payload: unknown) => {
    const height = Math.min(240, Math.max(120, Number(payload) || 150));
    getCaptureWindow()?.setSize(620, Math.round(height), false);
  });

  ipcMain.on(IPC.windowOpenMain, () => {
    showMainWindow();
  });
}
