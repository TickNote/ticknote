import { test, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const electron = vi.hoisted(() => ({
  directory: '',
  available: true,
  nativeTheme: { themeSource: 'system' },
}));
vi.mock('electron', () => ({
  app: { getPath: () => electron.directory },
  nativeTheme: electron.nativeTheme,
  safeStorage: {
    isEncryptionAvailable: () => electron.available,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, ''),
  },
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
import { applySettingsPatch, decryptAiKey, getSettings, loadSettings } from '../src/main/settings';

test('settings reject unencrypted keys, report write failure without committing, and recover a corrupt primary', () => {
  electron.directory = fs.mkdtempSync(join(tmpdir(), 'ticknote-settings-'));
  const path = join(electron.directory, 'settings.json');
  try {
    loadSettings();
    applySettingsPatch({ theme: 'dark', aiApiKey: 'test-only-key' });
    expect(decryptAiKey()).toBe('test-only-key');
    expect(getSettings()).not.toHaveProperty('aiApiKeyEncrypted');
    const stored = fs.readFileSync(path, 'utf8');
    electron.available = false;
    expect(() => applySettingsPatch({ aiApiKey: 'must-not-save', theme: 'light' })).toThrow('系统加密');
    expect(fs.readFileSync(path, 'utf8')).toBe(stored);
    expect(getSettings().theme).toBe('dark');
    electron.available = true;
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error('simulated disk failure');
    });
    expect(() => applySettingsPatch({ theme: 'light' })).toThrow('设置保存失败');
    expect(getSettings().theme).toBe('dark');
    expect(fs.readFileSync(path, 'utf8')).toBe(stored);
    applySettingsPatch({ theme: 'light' });
    fs.writeFileSync(path, '{broken');
    expect(loadSettings().theme).toBe('dark');
    expect(JSON.parse(fs.readFileSync(path, 'utf8')).theme).toBe('dark');
    expect(decryptAiKey()).toBe('test-only-key');
  } finally {
    electron.available = true;
    fs.rmSync(electron.directory, { recursive: true, force: true });
  }
});
