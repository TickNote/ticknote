import { Menu, nativeImage, Tray } from 'electron';
import { app } from 'electron';
import type { ExportResult, ExportScope } from '../shared/types';
import type { Repo } from './db/repo';
import { getSettings } from './settings';
import { showMainWindow, toggleCapture } from './windows';

const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAZklEQVR42mNgGAVDCfDfqfhPDB4QS6nuGEotpsgh1LacZEcMqANoZTnRjhjZDsCnkVRAliMGtQPoEg2jDhhNhKNpYMAdgM8R1EoDZNcFA+6AYdEmGDpNsgFvlA6KZvmg6ZiMAloDAHtF4yxw+0uOAAAAAElFTkSuQmCC';

let tray: Tray | null = null;
let repoRef: Repo | null = null;
let exportNowRef: ((scope?: ExportScope) => ExportResult) | null = null;
let openSettingsRef: (() => void) | null = null;

function buildTrayMenu(): Menu {
  const settings = getSettings();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const stats = repoRef?.stats(todayStart.getTime()) ?? { todayOpenTodos: 0, pendingReminders: 0 };

  return Menu.buildFromTemplate([
    { label: '打开浮窗', accelerator: settings.hotkey, click: toggleCapture },
    { label: '打开主窗', click: showMainWindow },
    { type: 'separator' },
    { label: `今天未完成 ${stats.todayOpenTodos} 条`, enabled: false },
    { label: '导出 Markdown', click: exportFromTray },
    { label: '设置', click: () => openSettingsRef?.() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
}

function exportFromTray(): void {
  try {
    const result = exportNowRef?.('all');
    if (!result) return;
    tray?.displayBalloon({
      title: '待办便签',
      content: `已导出 ${result.count} 条记录，共 ${result.files.length} 个文件`,
      iconType: 'info',
    });
  } catch (error) {
    console.error('[export] failed', error);
    tray?.displayBalloon({ title: '导出失败', content: String(error), iconType: 'error' });
  }
}

export function refreshTray(): void {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const stats = repoRef?.stats(todayStart.getTime()) ?? { todayOpenTodos: 0, pendingReminders: 0 };
  tray.setToolTip(`待办便签 · 今天未完成 ${stats.todayOpenTodos} 条 · 待提醒 ${stats.pendingReminders} 条`);
}

export function createTray(options: {
  repo: Repo;
  exportNow: (scope?: ExportScope) => ExportResult;
  openSettingsPage: () => void;
}): Tray {
  repoRef = options.repo;
  exportNowRef = options.exportNow;
  openSettingsRef = options.openSettingsPage;

  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
  tray.setToolTip('待办便签');
  tray.on('click', () => showMainWindow());
  refreshTray();
  return tray;
}

export function getTray(): Tray | null {
  return tray;
}
