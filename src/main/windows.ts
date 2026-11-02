import { BrowserWindow, nativeTheme, screen } from 'electron';
import { join } from 'node:path';
import { IPC } from '../shared/ipc';
import { consumeCloseToTrayHint, getSettings } from './settings';

let mainWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;
let isQuitting = false;
// 浮窗拖动位置：只在本次运行内记忆，重启后回到鼠标所在屏幕居中
let captureSessionPos: { x: number; y: number } | null = null;
let captureProgrammaticPos: { x: number; y: number } | null = null;
let onFirstCloseToTray: (() => void) | null = null;

export function getMainWindow(): BrowserWindow | null {
  // 窗口可能已被销毁（退出流程中），此时返回 null 而不是抛 "Object has been destroyed"
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

export function getCaptureWindow(): BrowserWindow | null {
  return captureWindow && !captureWindow.isDestroyed() ? captureWindow : null;
}

export function markQuitting(): void {
  isQuitting = true;
}

export function setFirstCloseToTrayHandler(handler: () => void): void {
  onFirstCloseToTray = handler;
}

function rendererUrl(page: 'main' | 'capture'): string | null {
  const base = process.env['ELECTRON_RENDERER_URL'];
  return base ? `${base}/${page}.html` : null;
}

function loadPage(win: BrowserWindow, page: 'main' | 'capture'): void {
  const url = rendererUrl(page);
  if (url) {
    void win.loadURL(url);
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`));
  }
}

// 禁止开新窗与页面跳转：这个应用没有任何外链需求
function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#171717' : '#f7f7f8';
}

export function applyWindowBackground(): void {
  getMainWindow()?.setBackgroundColor(windowBackground());
  getCaptureWindow()?.setBackgroundColor(windowBackground());
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: windowBackground(),
    title: '待办便签',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  loadPage(win, 'main');
  hardenWindow(win);

  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
    if (consumeCloseToTrayHint()) onFirstCloseToTray?.();
  });

  mainWindow = win;
  return win;
}

export function createCaptureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 620,
    height: 150,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  loadPage(win, 'capture');
  hardenWindow(win);
  // 与主窗一致：Alt+F4 / 系统关闭只隐藏，真正销毁只发生在退出流程。
  // 否则浮窗被销毁后引用残留，热键回调对已销毁窗口调用方法会抛错，浮窗永久失效
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on('blur', () => {
    if (getSettings().hideCaptureOnBlur && !win.isDestroyed()) win.hide();
  });
  // 记录用户拖动后的位置；程序自己定位产生的 move 事件忽略
  win.on('move', () => {
    if (!win.isVisible()) return;
    const [x, y] = win.getPosition();
    if (
      captureProgrammaticPos &&
      Math.abs(x - captureProgrammaticPos.x) <= 1 &&
      Math.abs(y - captureProgrammaticPos.y) <= 1
    ) {
      return;
    }
    captureSessionPos = { x, y };
  });

  captureWindow = win;
  return win;
}

function positionCaptureWindow(win: BrowserWindow): void {
  const bounds = win.getBounds();
  let nextX: number;
  let nextY: number;

  if (captureSessionPos) {
    // 沿用用户拖到的位置，但夹到当前显示器工作区内，避免拔掉副屏后窗口跑到屏外
    const display = screen.getDisplayNearestPoint(captureSessionPos);
    const area = display.workArea;
    nextX = Math.min(area.x + area.width - bounds.width, Math.max(area.x, captureSessionPos.x));
    nextY = Math.min(area.y + area.height - bounds.height, Math.max(area.y, captureSessionPos.y));
  } else {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x, y, width, height } = display.workArea;
    nextX = Math.round(x + (width - bounds.width) / 2);
    nextY = Math.round(y + height * 0.22);
  }

  captureProgrammaticPos = { x: nextX, y: nextY };
  win.setPosition(nextX, nextY, false);
}

export function toggleCapture(): void {
  const win = getCaptureWindow();
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
    return;
  }
  positionCaptureWindow(win);
  win.show();
  win.focus();
  win.webContents.send(IPC.captureShown);
}

export function showMainWindow(): void {
  const win = getMainWindow();
  if (!win) return;
  win.show();
  win.focus();
}
