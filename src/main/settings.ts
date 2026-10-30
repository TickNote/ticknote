import { app, nativeTheme, safeStorage } from 'electron';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
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
const storedSchema = z.object({
  hotkey: z.string().min(1).max(64).optional(),
  closeToTrayHintShown: z.boolean().optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  hideCaptureOnBlur: z.boolean().optional(),
  mcpDeleteEnabled: z.boolean().optional(),
  aiEnabled: z.boolean().optional(),
  aiBaseUrl: z.string().min(1).max(500).optional(),
  aiModel: z.string().min(1).max(100).optional(),
  autostartConfigured: z.boolean().optional(),
  aiApiKeyEncrypted: z.string().nullable().optional(),
});
let settings: Settings = { ...DEFAULT_SETTINGS };
let aiApiKeyEncrypted: string | null = null;
export function getSettings(): Settings {
  return { ...settings };
}
export function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function persist(next: Settings, encrypted: string | null): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  const path = settingsPath();
  const temporary = `${path}.${randomUUID()}.tmp`;
  const { aiApiKeySet: _keySet, hotkeyRegistered: _registered, ...stored } = next;
  try {
    writeFileSync(temporary, JSON.stringify({ ...stored, aiApiKeyEncrypted: encrypted }, null, 2), {
      encoding: 'utf8',
      flush: true,
    });
    if (existsSync(path)) {
      let valid = true;
      try {
        const previous = storedSchema.parse(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')));
        valid = !previous.aiApiKeyEncrypted?.startsWith('plain:');
      } catch {
        valid = false;
      }
      if (valid) copyFileSync(path, `${path}.bak`);
    }
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* temporary may not exist */
    }
    console.error('[settings] save failed', error);
    throw new Error('设置保存失败，请检查磁盘空间及数据目录权限后重试');
  }
}
export function loadSettings(): Settings {
  settings = { ...DEFAULT_SETTINGS };
  aiApiKeyEncrypted = null;
  for (const path of [settingsPath(), `${settingsPath()}.bak`]) {
    try {
      const { aiApiKeyEncrypted: encrypted, ...stored } = storedSchema.parse(
        JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')),
      );
      aiApiKeyEncrypted = encrypted ?? null;
      if (aiApiKeyEncrypted?.startsWith('plain:')) {
        const legacy = Buffer.from(aiApiKeyEncrypted.slice(6), 'base64').toString('utf8');
        aiApiKeyEncrypted = safeStorage.isEncryptionAvailable()
          ? safeStorage.encryptString(legacy).toString('base64')
          : null;
      }
      settings = { ...DEFAULT_SETTINGS, ...stored, aiApiKeySet: Boolean(aiApiKeyEncrypted) };
      if (path.endsWith('.bak') || encrypted?.startsWith('plain:')) {
        persist(settings, aiApiKeyEncrypted);
        if (encrypted?.startsWith('plain:')) copyFileSync(settingsPath(), `${settingsPath()}.bak`);
      }
      break;
    } catch (error) {
      if (existsSync(path)) console.error('[settings] load/recover failed', error);
    }
  }
  return getSettings();
}
export function saveSettings(): void {
  persist(settings, aiApiKeyEncrypted);
}
export function decryptAiKey(): string | null {
  if (!aiApiKeyEncrypted || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(aiApiKeyEncrypted, 'base64'));
  } catch {
    return null;
  }
}
export interface SettingsHooks {
  onHotkeyChange?: () => void;
}
export function applySettingsPatch(patch: SettingsPatch, hooks: SettingsHooks = {}): Settings {
  const { aiApiKey, ...changes } = patch;
  const next = { ...settings, ...changes };
  let encrypted = aiApiKeyEncrypted;
  if (aiApiKey !== undefined) {
    if (!aiApiKey?.trim()) encrypted = null;
    else {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('系统加密暂不可用，API Key 未保存，请稍后重试');
      encrypted = safeStorage.encryptString(aiApiKey.trim()).toString('base64');
    }
    next.aiApiKeySet = Boolean(encrypted);
  }
  persist(next, encrypted);
  const hotkeyChanged = settings.hotkey !== next.hotkey;
  settings = next;
  aiApiKeyEncrypted = encrypted;
  if (hotkeyChanged) hooks.onHotkeyChange?.();
  nativeTheme.themeSource = settings.theme;
  return getSettings();
}
export function setHotkeyRegistered(value: boolean): void {
  settings.hotkeyRegistered = value;
}
export function setAutostartConfigured(): void {
  const next = { ...settings, autostartConfigured: true };
  persist(next, aiApiKeyEncrypted);
  settings = next;
}
export function consumeCloseToTrayHint(): boolean {
  if (settings.closeToTrayHintShown) return false;
  const next = { ...settings, closeToTrayHintShown: true };
  try {
    persist(next, aiApiKeyEncrypted);
    settings = next;
  } catch {
    /* Still allow hiding the window. */
  }
  return true;
}
