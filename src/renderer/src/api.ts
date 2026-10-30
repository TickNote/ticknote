import type { Api } from '../../preload';
import type { Item, ItemKind, ListQuery, Settings, ThemePreference } from '../../shared/types';

function createMockApi(): Api {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const listeners = new Set<() => void>();
  const focusListeners = new Set<(id: string) => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let theme: ThemePreference = 'system';
  const settings: Settings = {
    hotkey: 'Control+Shift+Space',
    closeToTrayHintShown: true,
    theme: 'system',
    hideCaptureOnBlur: true,
    mcpDeleteEnabled: false,
    aiEnabled: false,
    aiBaseUrl: 'https://api.deepseek.com/v1',
    aiModel: 'deepseek-chat',
    aiApiKeySet: false,
    hotkeyRegistered: true,
    autostartConfigured: false,
  };
  let items: Item[] = [
    makeItem(
      '和张工确认接口字段，顺便问下周三评审的时间，另外周五的构建包要提前一天给测试，避免又卡在最后',
      'note',
      now - 60 * 1000,
    ),
    makeItem('整理本周延期事项', 'todo', now - 65 * 60 * 1000, 'ai'),
    makeItem('给测试同事发构建包', 'todo', now - 600 * 60 * 1000, 'human', 'done'),
    makeItem('客户反馈的两个小问题', 'note', now - day - 6 * 60 * 60 * 1000),
    makeItem('评审材料周五前整理好', 'note', now - 3 * day),
  ];

  function makeItem(
    content: string,
    kind: ItemKind,
    createdAt: number,
    source: 'human' | 'ai' = 'human',
    status: 'open' | 'done' = 'open',
  ): Item {
    return {
      id: crypto.randomUUID(),
      content,
      kind,
      status,
      remindAt: null,
      remindedAt: null,
      createdAt,
      updatedAt: createdAt,
      completedAt: status === 'done' ? createdAt : null,
      source,
    };
  }

  return {
    async createItem(input) {
      const item = makeItem(input.content, input.kind, Date.now(), input.source ?? 'human');
      items = [item, ...items];
      notify();
      return item;
    },
    async listItems(query: ListQuery) {
      const limit = query.limit ?? 30;
      let rows = [...items].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
      if (query.filter === 'todo') rows = rows.filter((i) => i.kind === 'todo' && i.status === 'open');
      if (query.filter === 'note') rows = rows.filter((i) => i.kind === 'note');
      if (query.filter === 'done') rows = rows.filter((i) => i.status === 'done');
      if (query.filter === 'reminders') rows = rows.filter((i) => i.remindAt !== null && i.status === 'open');
      const cursor = query.cursor;
      if (typeof cursor === 'number') rows = rows.filter((i) => i.createdAt < cursor);
      else if (cursor)
        rows = rows.filter(
          (i) => i.createdAt < cursor.createdAt || (i.createdAt === cursor.createdAt && i.id < cursor.id),
        );
      return rows.slice(0, limit);
    },
    async searchItems(q) {
      const text = q.trim();
      if (!text) return [];
      return items.filter((i) => i.content.includes(text));
    },
    async getItem(id) {
      return items.find((i) => i.id === id) ?? null;
    },
    async updateItem(id, content) {
      items = items.map((i) => (i.id === id ? { ...i, content, updatedAt: Date.now() } : i));
      notify();
      return items.find((i) => i.id === id) ?? null;
    },
    async setItemKind(id, nextKind) {
      items = items.map((i) => (i.id === id ? { ...i, kind: nextKind, updatedAt: Date.now() } : i));
      notify();
      return items.find((i) => i.id === id) ?? null;
    },
    async deleteItem(id) {
      const existed = items.some((i) => i.id === id);
      items = items.filter((i) => i.id !== id);
      notify();
      return existed;
    },
    async restoreDeletedItem(item) {
      items = [...items.filter((i) => i.id !== item.id), item].sort((a, b) => b.createdAt - a.createdAt);
      notify();
      return items.find((i) => i.id === item.id) ?? null;
    },
    async clearAllItems() {
      const count = items.length;
      items = [];
      notify();
      return count;
    },
    async setReminder(id, remindAt) {
      items = items.map((i) =>
        i.id === id ? { ...i, remindAt, remindedAt: null, updatedAt: Date.now() } : i,
      );
      notify();
      return items.find((i) => i.id === id) ?? null;
    },
    async exportMarkdown(scope = 'all') {
      const dir = 'mock-export';
      const suffix = scope === 'all' ? '' : `-${scope}`;
      return { dir, files: [`notes-2026-10-29${suffix}.md`], count: items.length };
    },
    async exportBackup() {
      return { path: 'mock-backup.json', count: items.length };
    },
    async importBackup() {
      return { path: 'mock-backup.json', count: 0 };
    },
    async testAi() {
      return '浏览器预览不发送 AI 请求，请在桌面应用测试';
    },
    async completeItem(id) {
      items = items.map((i) =>
        i.id === id ? { ...i, status: 'done', completedAt: Date.now(), updatedAt: Date.now() } : i,
      );
      notify();
      return items.find((i) => i.id === id) ?? null;
    },
    async restoreItem(id) {
      items = items.map((i) =>
        i.id === id ? { ...i, status: 'open', completedAt: null, updatedAt: Date.now() } : i,
      );
      notify();
      return items.find((i) => i.id === id) ?? null;
    },
    async stats() {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      return {
        openTodos: items.filter((i) => i.kind === 'todo' && i.status === 'open').length,
        todayOpenTodos: items.filter(
          (i) => i.kind === 'todo' && i.status === 'open' && i.createdAt >= todayStart.getTime(),
        ).length,
        pendingReminders: items.filter((i) => i.remindAt && !i.remindedAt && i.status === 'open').length,
      };
    },
    async getSettings() {
      return { ...settings, theme };
    },
    async updateSettings(patch) {
      if (patch.theme) theme = patch.theme;
      if (patch.hotkey !== undefined) settings.hotkey = patch.hotkey;
      if (patch.hideCaptureOnBlur !== undefined) settings.hideCaptureOnBlur = patch.hideCaptureOnBlur;
      if (patch.mcpDeleteEnabled !== undefined) settings.mcpDeleteEnabled = patch.mcpDeleteEnabled;
      if (patch.aiEnabled !== undefined) settings.aiEnabled = patch.aiEnabled;
      if (patch.aiBaseUrl !== undefined) settings.aiBaseUrl = patch.aiBaseUrl;
      if (patch.aiModel !== undefined) settings.aiModel = patch.aiModel;
      if (patch.aiApiKey !== undefined) settings.aiApiKeySet = Boolean(patch.aiApiKey);
      return { ...settings, theme };
    },
    async getAutostart() {
      return {
        openAtLogin: false,
        executableWillLaunchAtLogin: false,
        blocked: false,
        packaged: false,
      };
    },
    async setAutostart(enabled) {
      return {
        openAtLogin: enabled,
        executableWillLaunchAtLogin: enabled,
        blocked: false,
        packaged: false,
      };
    },
    async aiParse() {
      return null;
    },
    async uninstallApp() {
      return { available: false, opened: false, reason: 'portable' as const };
    },
    async setTheme(next) {
      theme = next;
      const root = document.documentElement;
      if (next === 'system') delete root.dataset.theme;
      else root.dataset.theme = next;
      return { ...settings, theme };
    },
    hideCapture() {},
    resizeCapture() {},
    openMain() {},
    onCaptureShown() {
      return () => {};
    },
    onItemsChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onItemsFocus(listener) {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
    onOpenSettings() {
      return () => {};
    },
  };
}

export const usingMock = !window.api;
// 打包后（file://）若 preload 未加载，绝不能静默退回假数据；浏览器预览（http）仍用 mock
if (!window.api && location.protocol === 'file:') {
  throw new Error('TickNote preload 未加载：window.api 不可用，请检查安装包完整性');
}
export const api: Api = window.api ?? createMockApi();

declare global {
  interface Window {
    api?: Api;
  }
}
