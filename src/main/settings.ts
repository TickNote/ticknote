import { app, nativeTheme, safeStorage } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings, SettingsPatch } from '../shared/types';

export const DEFAULT_SETTINGS: Settings = {
  hotkey: 'Control+Shift+Space',
  closeToTrayHintShown: false,
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

let settings: Settings = { ...DEFAULT_SETTINGS };
// AI Key 用 safeStorage 加密后 base64 存 settings.json，不直接落明文
let aiApiKeyEncrypted: string | null = null;

export function getSettings(): Settings {
  return settings;
}

export function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<Settings> & {
      aiApiKeyEncrypted?: string | null;
    };
    aiApiKeyEncrypted = raw.aiApiKeyEncrypted ?? null;
    const persisted: Partial<Settings> = { ...raw };
    delete persisted.aiApiKeySet;
    delete persisted.hotkeyRegistered;
    settings = { ...DEFAULT_SETTINGS, ...persisted, aiApiKeySet: Boolean(aiApiKeyEncrypted) };
  } catch {
    aiApiKeyEncrypted = null;
    settings = { ...DEFAULT_SETTINGS };
  }
  return settings;
}

export function saveSettings(): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    const persisted: Record<string, unknown> = { ...settings, aiApiKeyEncrypted };
    delete persisted.aiApiKeySet;
    delete persisted.hotkeyRegistered;
    writeFileSync(settingsPath(), JSON.stringify(persisted, null, 2), 'utf8');
  } catch (error) {
    console.error('[settings] save failed', error);
  }
}

export function decryptAiKey(): string | null {
  if (!aiApiKeyEncrypted) return null;
  try {
    if (aiApiKeyEncrypted.startsWith('plain:')) {
      return Buffer.from(aiApiKeyEncrypted.slice(6), 'base64').toString('utf8');
    }
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(aiApiKeyEncrypted, 'base64'));
  } catch (error) {
    console.error('[ai] decrypt key failed', error);
    return null;
  }
}

function encryptAiKey(key: string): string {
  if (safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(key).toString('base64');
  // safeStorage 不可用时降级，前缀标明是明文编码，避免误以为已加密
  return `plain:${Buffer.from(key, 'utf8').toString('base64')}`;
}

export interface SettingsHooks {
  onHotkeyChange?: () => void;
}

export function applySettingsPatch(patch: SettingsPatch, hooks: SettingsHooks = {}): Settings {
  if (patch.theme !== undefined) settings.theme = patch.theme;
  if (patch.hideCaptureOnBlur !== undefined) settings.hideCaptureOnBlur = patch.hideCaptureOnBlur;
  if (patch.mcpDeleteEnabled !== undefined) settings.mcpDeleteEnabled = patch.mcpDeleteEnabled;
  if (patch.aiEnabled !== undefined) settings.aiEnabled = patch.aiEnabled;
  if (patch.aiBaseUrl !== undefined) settings.aiBaseUrl = patch.aiBaseUrl;
  if (patch.aiModel !== undefined) settings.aiModel = patch.aiModel;
  if (patch.aiApiKey !== undefined) {
    if (patch.aiApiKey === null || patch.aiApiKey.trim() === '') {
      aiApiKeyEncrypted = null;
      settings.aiApiKeySet = false;
    } else {
      aiApiKeyEncrypted = encryptAiKey(patch.aiApiKey.trim());
      settings.aiApiKeySet = true;
    }
  }
  if (patch.hotkey !== undefined && patch.hotkey !== settings.hotkey) {
    settings.hotkey = patch.hotkey;
    hooks.onHotkeyChange?.();
  }
  saveSettings();
  nativeTheme.themeSource = settings.theme;
  return settings;
}

export function setHotkeyRegistered(value: boolean): void {
  settings.hotkeyRegistered = value;
}

export function setAutostartConfigured(): void {
  settings.autostartConfigured = true;
  saveSettings();
}

// 关闭主窗时只提示一次“已常驻托盘”
export function consumeCloseToTrayHint(): boolean {
  if (settings.closeToTrayHintShown) return false;
  settings.closeToTrayHintShown = true;
  saveSettings();
  return true;
}
