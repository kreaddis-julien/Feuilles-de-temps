import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_DEV = process.argv.includes('--dev');
const PORT = 3001;

const POPUP_WIDTH = 340;
const POPUP_HEIGHT = 420;

let mainWindow = null;
let popupWindow = null;
let tray = null;

function frontendUrl(hash = '') {
  if (IS_DEV) return `http://localhost:5173/${hash}`;
  return `http://localhost:${PORT}/${hash}`;
}

// ── Embedded server (replaces the Tauri sidecar binary) ────────────────────

async function startServer() {
  const { createApp } = await import('./server-bundle.mjs');

  // Same directory the old Tauri app used (appId com.timesheet.tracker),
  // so existing timesheet data is picked up as-is.
  const dataDir = IS_DEV
    ? path.join(__dirname, '../data')
    : path.join(app.getPath('appData'), 'com.timesheet.tracker');
  fs.mkdirSync(dataDir, { recursive: true });

  const staticDir = IS_DEV ? undefined : path.join(__dirname, '../client/dist');
  const server = createApp(dataDir, { staticDir });

  await new Promise((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', resolve).on('error', reject);
  });
  console.log(`Server running on http://127.0.0.1:${PORT} (data: ${dataDir})`);
}

// ── Windows ─────────────────────────────────────────────────────────────────

// Renderer windows may only display the local frontend
function hardenWebContents(win) {
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost:')) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: 'Tempo',
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
    },
  });
  hardenWebContents(mainWindow);
  mainWindow.loadURL(frontendUrl());
  // Tray app: closing the window hides it instead of quitting
  mainWindow.on('close', (e) => {
    if (!app.isQuittingForReal) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
    },
  });
  // Visible on all spaces, above the menu bar, without stealing focus disruptively
  popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popupWindow.setAlwaysOnTop(true, 'pop-up-menu');
  hardenWebContents(popupWindow);
  popupWindow.loadURL(frontendUrl('#/tray-popup'));
  // Hide when it loses focus (replaces the NSPanel delegate)
  popupWindow.on('blur', () => popupWindow.hide());
  popupWindow.on('close', (e) => {
    if (!app.isQuittingForReal) {
      e.preventDefault();
      popupWindow.hide();
    }
  });
}

function togglePopup(trayBounds) {
  if (!popupWindow) return;
  if (popupWindow.isVisible()) {
    popupWindow.hide();
    return;
  }
  if (trayBounds && trayBounds.width > 0) {
    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
    let x = Math.round(trayBounds.x + trayBounds.width / 2 - POPUP_WIDTH / 2);
    const y = Math.round(trayBounds.y + trayBounds.height + 4);
    // Keep the popup inside the screen
    const maxX = display.workArea.x + display.workArea.width - POPUP_WIDTH - 8;
    x = Math.min(Math.max(x, display.workArea.x + 8), maxX);
    popupWindow.setPosition(x, y, false);
  }
  popupWindow.show();
  popupWindow.focus();
}

// ── Tray ─────────────────────────────────────────────────────────────────────

async function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Ouvrir',
      click: () => {
        if (!mainWindow) createMainWindow();
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: 'Quitter',
      click: () => {
        app.isQuittingForReal = true;
        app.quit();
      },
    },
  ]);
}

async function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icons/tray-icon@2x.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  // No setContextMenu here: on macOS it would open the menu on every click.
  // Left click toggles the popup; right click opens the menu explicitly.
  tray.setIgnoreDoubleClickEvents(true);
  tray.on('click', (_event, bounds) => togglePopup(bounds));
  tray.on('right-click', async () => {
    tray.popUpContextMenu(await buildTrayMenu());
  });
}

// ── IPC (replaces Tauri commands) ───────────────────────────────────────────

ipcMain.on('set-tray-title', (_event, title) => {
  if (tray) tray.setTitle(title ? ` ${title}` : '');
});

ipcMain.on('close-tray-popup', () => {
  if (popupWindow) popupWindow.hide();
});

ipcMain.on('open-main-window', () => {
  if (popupWindow) popupWindow.hide();
  if (!mainWindow) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
});

// ── App lifecycle ────────────────────────────────────────────────────────────

app.isQuittingForReal = false;

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (err) {
    console.error('Server failed to start:', err);
    dialog.showErrorBox('Tempo', `Le serveur local n'a pas pu demarrer (port ${PORT} occupe ?)\n\n${err.message}`);
    app.exit(1);
    return;
  }

  if (app.dock) app.dock.show();
  createMainWindow();
  createPopupWindow();
  await createTray();

  // Autostart at login (replaces tauri-plugin-autostart)
  if (!IS_DEV) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
    mainWindow.show();
  });
});

// Tray app: keep running when all windows are closed
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  app.isQuittingForReal = true;
});
