import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type {
  AiParseResult,
  AutostartStatus,
  CreateItemInput,
  ExportResult,
  ExportScope,
  Item,
  ItemKind,
  ListQuery,
  Settings,
  SettingsPatch,
  ThemePreference,
  UninstallResult,
} from '../shared/types';

const api = {
  createItem: (input: CreateItemInput): Promise<Item> => ipcRenderer.invoke(IPC.itemsCreate, input),
  listItems: (query: ListQuery): Promise<Item[]> => ipcRenderer.invoke(IPC.itemsList, query),
  searchItems: (q: string, limit?: number): Promise<Item[]> => ipcRenderer.invoke(IPC.itemsSearch, { q, limit }),
  getItem: (id: string): Promise<Item | null> => ipcRenderer.invoke(IPC.itemsGet, { id }),
  completeItem: (id: string): Promise<Item | null> => ipcRenderer.invoke(IPC.itemsComplete, { id }),
  restoreItem: (id: string): Promise<Item | null> => ipcRenderer.invoke(IPC.itemsRestore, { id }),
  updateItem: (id: string, content: string): Promise<Item | null> =>
    ipcRenderer.invoke(IPC.itemsUpdate, { id, content }),
  setItemKind: (id: string, kind: ItemKind): Promise<Item | null> =>
    ipcRenderer.invoke(IPC.itemsSetKind, { id, kind }),
  deleteItem: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.itemsDelete, { id }),
  restoreDeletedItem: (item: Item): Promise<Item | null> =>
    ipcRenderer.invoke(IPC.itemsRestoreDeleted, { item }),
  clearAllItems: (): Promise<number> => ipcRenderer.invoke(IPC.itemsClearAll),
  setReminder: (id: string, remindAt: number | null): Promise<Item | null> =>
    ipcRenderer.invoke(IPC.itemsSetReminder, { id, remindAt }),
  exportMarkdown: (scope: ExportScope = 'all'): Promise<ExportResult | null> =>
    ipcRenderer.invoke(IPC.exportMarkdown, { scope }),
  stats: (): Promise<{ todayOpenTodos: number; pendingReminders: number }> =>
    ipcRenderer.invoke(IPC.itemsStats),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch: SettingsPatch): Promise<Settings> => ipcRenderer.invoke(IPC.settingsSet, patch),
  setTheme: (theme: ThemePreference): Promise<Settings> =>
    ipcRenderer.invoke(IPC.settingsSet, { theme }),
  getAutostart: (): Promise<AutostartStatus> => ipcRenderer.invoke(IPC.autostartGet),
  setAutostart: (enabled: boolean): Promise<AutostartStatus> =>
    ipcRenderer.invoke(IPC.autostartSet, { enabled }),
  aiParse: (content: string): Promise<AiParseResult | null> => ipcRenderer.invoke(IPC.aiParse, { content }),
  uninstallApp: (): Promise<UninstallResult> => ipcRenderer.invoke(IPC.appUninstall),
  hideCapture: (): void => {
    ipcRenderer.send(IPC.captureHide);
  },
  resizeCapture: (height: number): void => {
    ipcRenderer.send(IPC.captureResize, height);
  },
  openMain: (): void => {
    ipcRenderer.send(IPC.windowOpenMain);
  },
  onCaptureShown: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on(IPC.captureShown, handler);
    return () => ipcRenderer.removeListener(IPC.captureShown, handler);
  },
  onItemsChanged: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on(IPC.itemsChanged, handler);
    return () => ipcRenderer.removeListener(IPC.itemsChanged, handler);
  },
  onItemsFocus: (listener: (id: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { id: string }) => listener(payload.id);
    ipcRenderer.on(IPC.itemsFocus, handler);
    return () => ipcRenderer.removeListener(IPC.itemsFocus, handler);
  },
  onOpenSettings: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on(IPC.settingsOpen, handler);
    return () => ipcRenderer.removeListener(IPC.settingsOpen, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
