export type ItemKind = 'note' | 'todo';
export type ItemStatus = 'open' | 'done';
export type ItemSource = 'human' | 'ai';
export type ListFilter = 'all' | 'todo' | 'note' | 'done' | 'reminders';

export const CONTENT_LIMIT = 2000;

export interface ItemCursor {
  createdAt: number;
  id: string;
}

export interface ItemStats {
  todayOpenTodos: number;
  openTodos: number;
  pendingReminders: number;
}

export interface Item {
  id: string;
  content: string;
  kind: ItemKind;
  status: ItemStatus;
  remindAt: number | null;
  remindedAt: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  source: ItemSource;
}

export interface ListQuery {
  filter: ListFilter;
  cursor?: number | ItemCursor;
  limit?: number;
}

export interface CreateItemInput {
  content: string;
  kind: ItemKind;
  source?: ItemSource;
  remindAt?: number | null;
}

export type ThemePreference = 'system' | 'light' | 'dark';
export type ExportScope = ListFilter | 'today';

export interface BackupResult {
  path: string;
  count: number;
}

export interface ExportResult {
  dir: string;
  files: string[];
  count: number;
}

export interface SettingsPatch {
  theme?: ThemePreference;
  hotkey?: string;
  hideCaptureOnBlur?: boolean;
  mcpDeleteEnabled?: boolean;
  aiEnabled?: boolean;
  aiBaseUrl?: string;
  aiModel?: string;
  aiApiKey?: string | null;
}

export interface AutostartStatus {
  openAtLogin: boolean;
  executableWillLaunchAtLogin: boolean;
  blocked: boolean;
  packaged: boolean;
}

export interface AiParseResult {
  content: string;
  kind: ItemKind;
}

export interface UninstallResult {
  available: boolean;
  opened: boolean;
  reason: 'dev' | 'portable' | 'error' | 'opened';
}

export interface Settings {
  hotkey: string;
  closeToTrayHintShown: boolean;
  theme: ThemePreference;
  hideCaptureOnBlur: boolean;
  mcpDeleteEnabled: boolean;
  aiEnabled: boolean;
  aiBaseUrl: string;
  aiModel: string;
  aiApiKeySet: boolean;
  hotkeyRegistered: boolean;
  autostartConfigured: boolean;
}
