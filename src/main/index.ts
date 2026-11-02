import { app, dialog, globalShortcut, Menu, nativeTheme, Notification, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IPC } from '../shared/ipc';
import type { ExportResult, ExportScope, Item, UninstallResult } from '../shared/types';
import { openRepo, type Repo } from './db/repo';
import { exportMarkdown } from './export/markdown';
import { setupIpc } from './ipc';
import {
  DEFAULT_SETTINGS,
  getSettings,
  loadSettings,
  setAutostartConfigured,
  setHotkeyRegistered,
} from './settings';
import { createTray, getTray, refreshTray } from './tray';
import {
  createCaptureWindow,
  createMainWindow,
  getMainWindow,
  markQuitting,
  setFirstCloseToTrayHandler,
  showMainWindow,
  toggleCapture,
} from './windows';

app.setName('TickNote');
// 便于测试与绿色版：允许用环境变量覆盖数据目录（必须在 ready 之前）
const dataDir = process.env['TICKNOTE_DATA'] ?? process.env['QUICKNOTE_DATA'];
if (dataDir) app.setPath('userData', dataDir);
// Windows 通知与托盘身份，必须与安装快捷方式的 AUMID 一致
app.setAppUserModelId('com.ticknote.app');

let repo: Repo;
let reminderTimer: NodeJS.Timeout | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
// 上次导出目录（本次运行内记忆）；首次默认 userData/export
let lastExportDir: string | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
  app.whenReady().then(bootstrap);
}

// 历史数据文件名是 quicknote.db（项目旧名），新目录统一叫 ticknote.db。
// 这里做一次幂等迁移：先处理同目录的旧文件名，再从旧的 QuickNote 数据目录整目录复制。
function migrateLegacyData(newDir: string): void {
  const targetDb = join(newDir, 'ticknote.db');
  if (existsSync(targetDb)) return;

  // 1) 早期 TickNote 版本仍写入 quicknote.db
  const sameDirLegacy = join(newDir, 'quicknote.db');
  if (existsSync(sameDirLegacy)) {
    try {
      for (const suffix of ['', '-wal', '-shm']) {
        const source = `${sameDirLegacy}${suffix}`;
        if (existsSync(source)) copyFileSync(source, `${targetDb}${suffix}`);
      }
      console.warn('[migrate] quicknote.db renamed to ticknote.db');
      return;
    } catch (error) {
      console.error('[migrate] rename in place failed', error);
    }
  }

  // 2) 项目更名前的 QuickNote 数据目录
  const legacyDir = join(dirname(newDir), 'QuickNote');
  if (newDir === legacyDir) return;
  const legacyDb = join(legacyDir, 'quicknote.db');
  if (!existsSync(legacyDb)) return;

  try {
    mkdirSync(newDir, { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) {
      const source = `${legacyDb}${suffix}`;
      if (existsSync(source)) copyFileSync(source, `${targetDb}${suffix}`);
    }
    const legacySettings = join(legacyDir, 'settings.json');
    if (existsSync(legacySettings)) copyFileSync(legacySettings, join(newDir, 'settings.json'));
    console.warn('[migrate] legacy QuickNote data copied to TickNote');
  } catch (error) {
    console.error('[migrate] failed', error);
  }
}

// NSIS 安装版会在安装目录生成卸载程序；便携版没有。旧版安装目录里可能仍叫 QuickNote
function findUninstaller(): string | null {
  if (!app.isPackaged) return null;
  const dir = dirname(process.execPath);
  for (const name of ['Uninstall TickNote.exe', 'Uninstall QuickNote.exe']) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function uninstallApp(): Promise<UninstallResult> {
  if (!app.isPackaged) return { available: false, opened: false, reason: 'dev' };
  const target = findUninstaller();
  if (!target) return { available: false, opened: false, reason: 'portable' };
  const error = await shell.openPath(target);
  const opened = error === '';
  if (opened) {
    // 主动退出释放安装目录文件，避免 NSIS 卸载时弹「文件被占用」；稍等让 IPC 结果先送回渲染层
    setTimeout(() => app.quit(), 800);
  }
  return { available: true, opened, reason: opened ? 'opened' : 'error' };
}

// 主窗导出先弹文件夹选择框；托盘快捷导出直接写到上次目录，减少打断
async function exportNow(scope: ExportScope = 'all', interactive = true): Promise<ExportResult | null> {
  const defaultDir = lastExportDir ?? join(app.getPath('userData'), 'export');
  let target = defaultDir;

  if (interactive) {
    const options: OpenDialogOptions = {
      title: '选择 Markdown 导出目录',
      buttonLabel: '导出到这里',
      defaultPath: defaultDir,
      properties: ['openDirectory', 'createDirectory'],
    };
    const parent = getMainWindow();
    const picked = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return null;
    target = picked.filePaths[0];
  }

  lastExportDir = target;
  return exportMarkdown(repo.allForExport(scope), target);
}

// 当前实际注册成功的热键：换绑失败时回滚用它，保证会话内浮窗始终唤得出
let activeHotkey: string | null = null;

// accelerator 非法时 globalShortcut.register 会直接抛错（例如手改 settings.json）
function tryRegisterHotkey(hotkey: string): boolean {
  try {
    return globalShortcut.register(hotkey, toggleCapture);
  } catch (error) {
    console.warn(`[hotkey] 热键无效: ${hotkey}`, error);
    return false;
  }
}

function registerHotkey(candidate?: string): boolean {
  globalShortcut.unregisterAll();
  const hotkey = candidate?.trim() || getSettings().hotkey || DEFAULT_SETTINGS.hotkey;
  const ok = tryRegisterHotkey(hotkey);
  if (ok) {
    activeHotkey = hotkey;
  } else {
    // 选定热键无效或被占用：回滚上一个可用热键（冷启动回退默认热键），避免一个热键都没有
    const fallback = activeHotkey && activeHotkey !== hotkey ? activeHotkey : DEFAULT_SETTINGS.hotkey;
    activeHotkey = fallback !== hotkey && tryRegisterHotkey(fallback) ? fallback : null;
    console.warn(`[hotkey] 注册失败，可能被占用: ${hotkey}`);
  }
  refreshTray();
  return ok;
}

function openSettingsPage(): void {
  showMainWindow();
  getMainWindow()?.webContents.send(IPC.settingsOpen);
}

function notifyItemsChanged(): void {
  refreshTray();
  getMainWindow()?.webContents.send(IPC.itemsChanged);
}

function focusItem(id: string): void {
  showMainWindow();
  getMainWindow()?.webContents.send(IPC.itemsFocus, { id });
}

function excerpt(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function showReminder(items: Item[], mode: 'normal' | 'missed'): void {
  if (items.length === 0 || !Notification.isSupported()) return;

  if (mode === 'missed') {
    // 启动时补提醒，合并成一条，不逐条弹
    const notice = new Notification({
      title: '待办便签提醒',
      body: `有 ${items.length} 条提醒已过期，打开主窗查看。`,
    });
    notice.on('click', () => focusItem(items[0].id));
    notice.show();
    return;
  }

  // 同一轮超过 3 条合并，避免批量刷屏
  if (items.length > 3) {
    const head = items
      .slice(0, 3)
      .map((item) => excerpt(item.content))
      .join('；');
    const notice = new Notification({
      title: '待办便签提醒',
      body: `${head} 等 ${items.length} 条`,
    });
    notice.on('click', () => focusItem(items[0].id));
    notice.show();
    return;
  }

  for (const item of items) {
    const notice = new Notification({ title: '待办便签提醒', body: excerpt(item.content) });
    notice.on('click', () => focusItem(item.id));
    notice.show();
  }
}

function scanReminders(mode: 'normal' | 'missed' = 'normal'): void {
  const due = repo.dueReminders(Date.now());
  if (due.length === 0) return;

  // 先落库再弹，避免重启或下一轮重复提醒
  repo.markReminded(
    due.map((item) => item.id),
    Date.now(),
  );
  refreshTray();
  getMainWindow()?.webContents.send(IPC.itemsChanged);
  showReminder(due, mode);
}

function startReminderScheduler(): void {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(() => {
    try {
      scanReminders('normal');
    } catch (error) {
      console.error('[reminder] scan failed', error);
    }
  }, 30_000);
}

function bootstrap(): void {
  Menu.setApplicationMenu(null);
  migrateLegacyData(app.getPath('userData'));
  loadSettings();
  nativeTheme.themeSource = getSettings().theme;

  // 安装版首次启动默认开启开机自启（提醒依赖托盘常驻）
  // process.defaultApp 为 true 表示以 `electron .` 开发模式运行，不能把 electron.exe 写进启动项
  // 便携形态（解压即用 zip / win-unpacked）没有 PORTABLE_EXECUTABLE_DIR 变量，
  // 用「exe 旁没有卸载程序」识别——NSIS 安装目录必有卸载器；便携目录可能被移动或删除，跳过默认自启
  const isPortable = Boolean(process.env['PORTABLE_EXECUTABLE_DIR']) || findUninstaller() === null;
  if (app.isPackaged && !isPortable && process.defaultApp !== true && !getSettings().autostartConfigured) {
    try {
      app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: ['--autostart'] });
    } catch (error) {
      console.error('[autostart] initial enable failed', error);
    }
    try {
      setAutostartConfigured();
    } catch (error) {
      console.error('[autostart] settings not saved', error);
    }
  }

  repo = openRepo(join(app.getPath('userData'), 'ticknote.db'));
  let dataVersion = repo.dataVersion();
  let day = new Date().toDateString();
  refreshTimer = setInterval(() => {
    try {
      const currentVersion = repo.dataVersion();
      const currentDay = new Date().toDateString();
      if (currentVersion !== dataVersion || currentDay !== day) {
        dataVersion = currentVersion;
        day = currentDay;
        notifyItemsChanged();
      }
    } catch (error) {
      console.error('[refresh] external change check failed', error);
    }
  }, 2000);

  createMainWindow();
  createCaptureWindow();
  createTray({ repo, exportNow, openSettingsPage });
  setFirstCloseToTrayHandler(() => {
    getTray()?.displayBalloon({
      title: '待办便签',
      content: '已在托盘常驻，按快捷键可随时记录。',
      iconType: 'info',
    });
  });

  setupIpc({
    repo,
    notifyItemsChanged,
    refreshTray,
    focusItem,
    exportNow,
    registerHotkey,
    uninstallApp,
  });

  setHotkeyRegistered(registerHotkey());

  const autostart = process.argv.includes('--autostart');
  if (!autostart) showMainWindow();

  // 启动时先补发错过的提醒（合并成一条），再进入 30 秒轮询
  try {
    scanReminders('missed');
  } catch (error) {
    console.error('[reminder] startup scan failed', error);
  }
  startReminderScheduler();

  app.on('activate', () => showMainWindow());
}

app.on('window-all-closed', () => {
  // 托盘常驻：不在窗口关闭时退出
});

app.on('before-quit', () => {
  markQuitting();
  // 兜底：清理阶段卡住时强制退出，避免留下无托盘的僵尸进程占用单实例锁（双击图标无法再启动）
  setTimeout(() => {
    console.error('[quit] graceful shutdown timed out, forcing exit');
    process.exit(0);
  }, 10_000);
});

app.on('will-quit', () => {
  if (reminderTimer) clearInterval(reminderTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  // 逐项容错：任何一步抛错都不允许中断退出（曾出现退出后进程残留、托盘消失的情况）
  try {
    globalShortcut.unregisterAll();
  } catch (error) {
    console.error('[quit] unregister shortcuts failed', error);
  }
  try {
    repo?.close();
  } catch (error) {
    console.error('[quit] close database failed', error);
  }
});
