import { app, dialog, globalShortcut, Menu, nativeTheme, Notification, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IPC } from '../shared/ipc';
import type { ExportResult, ExportScope, Item, UninstallResult } from '../shared/types';
import { openRepo, type Repo } from './db/repo';
import { exportMarkdown } from './export/markdown';
import { setupIpc } from './ipc';
import { getSettings, loadSettings, setAutostartConfigured, setHotkeyRegistered } from './settings';
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
  return { available: true, opened: error === '', reason: error === '' ? 'opened' : 'error' };
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

function registerHotkey(): void {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(getSettings().hotkey, toggleCapture);
  setHotkeyRegistered(ok);
  if (!ok) {
    console.warn(`[hotkey] 注册失败，可能被占用: ${getSettings().hotkey}`);
  }
  refreshTray();
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
  if (app.isPackaged && process.defaultApp !== true && !getSettings().autostartConfigured) {
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

  registerHotkey();

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
});

app.on('will-quit', () => {
  if (reminderTimer) clearInterval(reminderTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  globalShortcut.unregisterAll();
  repo?.close();
});
