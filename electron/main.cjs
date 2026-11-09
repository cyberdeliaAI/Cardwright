'use strict';
const { app, BrowserWindow, Menu, dialog, session, shell, screen, Notification } = require('electron');
const path = require('node:path');
const { startBackend } = require('./backend.cjs');
const { applicationUrl, externalUrl, permissionAllowed, contentPolicy } = require('./security.cjs');
const { windowSize, rememberWindowSize } = require('./preferences.cjs');
const { createUpdateChecker } = require('./updates.cjs');
const packageInfo = require('../package.json');

app.setName('Cardwright');
if (process.env.CARDWRIGHT_PROFILE) app.setPath('userData', path.resolve(process.env.CARDWRIGHT_PROFILE));
app.enableSandbox();
let window, backend, origin, updates, quitting = false;
const smoke = !!process.env.CARDWRIGHT_SMOKE_REPORT && !!process.env.CARDWRIGHT_PROFILE;

function openExternal(value) {
  const safe = externalUrl(value);
  if (safe) shell.openExternal(safe).catch(() => dialog.showErrorBox('Could not open link', 'Open the Cardwright GitHub page in your browser.'));
}
async function checkUpdates(manual = false) {
  const info = await updates.check(manual);
  installMenu();
  if (manual && window && !window.isDestroyed()) {
    const result = await dialog.showMessageBox(window, { type: 'info', title: 'Cardwright updates',
      message: info.error || (info.available ? `Cardwright ${info.latest.version} is available. You are using ${info.current}.` : `You are using Cardwright ${info.current}. No newer stable release was found.`),
      buttons: info.available ? ['View release', 'Later'] : ['OK'], defaultId: info.available ? 1 : 0, cancelId: info.available ? 1 : 0 });
    if (info.available && result.response === 0) openExternal(info.latest.url);
  } else if (info.available && info.notified !== info.latest.version && Notification.isSupported()) {
    const notice = new Notification({ title: `Cardwright ${info.latest.version} is available`, body: 'View the release to download the new version. Installation is your choice.' });
    notice.on('click', () => openExternal(info.latest.url)); notice.show(); updates.markNotified();
  }
}
function installMenu() {
  const info = updates.state;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : [{ label: 'File', submenu: [{ role: 'quit' }] }]),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'Cardwright User Guide', click: () => openExternal('https://github.com/cyberdeliaAI/Cardwright/blob/main/USER_GUIDE.md') },
      { label: 'Cardwright on GitHub', click: () => openExternal('https://github.com/cyberdeliaAI/Cardwright') },
      { type: 'separator' }, { label: 'Check for Updates…', click: () => checkUpdates(true) },
      { label: 'Automatically check for updates', type: 'checkbox', checked: info.automatic, click: item => updates.setAutomatic(item.checked) },
      ...(info.available ? [{ label: `Download Cardwright ${info.latest.version}…`, click: () => openExternal(info.latest.url) }] : []),
    ] },
  ]));
}
function createWindow() {
  const sizeFile = path.join(app.getPath('userData'), 'window.json');
  window = new BrowserWindow({ ...windowSize(sizeFile, screen.getPrimaryDisplay().workArea), show: false,
    title: 'Cardwright', backgroundColor: '#111416', icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: { partition: 'persist:cardwright', nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: !app.isPackaged } });
  rememberWindowSize(window, sizeFile);
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  contents.on('will-navigate', (event, url) => { if (!applicationUrl(url, origin)) { event.preventDefault(); openExternal(url); } });
  contents.on('will-redirect', (event, url) => { if (!applicationUrl(url, origin)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('render-process-gone', () => { if (!quitting) dialog.showErrorBox('Cardwright stopped', 'The application window stopped unexpectedly. Restart Cardwright; your saved card remains in this profile.'); app.quit(); });
  window.once('ready-to-show', () => { if (!smoke) window.show(); });
  window.on('closed', () => { window = null; app.quit(); });
  if (smoke) require('./smoke.cjs').install({ app, window, backend, origin, version: packageInfo.version });
  window.loadURL(origin).catch(error => { dialog.showErrorBox('Could not open Cardwright', error.message); app.quit(); });
}

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => backend?.stop());
app.on('window-all-closed', () => app.quit());
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const { startServer } = await import('../server.mjs');
    backend = await startBackend({ startServer, version: packageInfo.version,
      port: Number(process.env.CARDWRIGHT_PORT ?? 8787), onShutdown: () => app.quit() });
    origin = backend.origin;
    const ses = session.fromPartition('persist:cardwright');
    ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => permissionAllowed(contents, permission, details?.requestingUrl || requestingOrigin, details, origin));
    ses.setPermissionRequestHandler((contents, permission, callback, details) => callback(permissionAllowed(contents, permission, details?.requestingUrl || contents?.getURL(), details, origin)));
    ses.setDevicePermissionHandler(() => false);
    ses.webRequest.onHeadersReceived({ urls: [origin + '/*'] }, (details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentPolicy] } }));
    ses.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try { const url = new URL(details.url); allowed = url.origin === origin || url.protocol === 'data:' || (url.protocol === 'blob:' && url.origin === origin); } catch { /* Deny unknown protocols. */ }
      callback({ cancel: !allowed });
    });
    ses.on('will-download', (event, item, contents) => {
      if (contents !== window?.webContents || !item.getURL().startsWith(`blob:${origin}/`)) { event.preventDefault(); return; }
      const filename = path.basename(item.getFilename()).replace(/[\\/\x00-\x1f]/g, '_');
      item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), filename) });
    });
    updates = createUpdateChecker(path.join(app.getPath('userData'), 'updates.json'), packageInfo.version);
    app.setAboutPanelOptions({ applicationName: 'Cardwright', applicationVersion: packageInfo.version, copyright: 'Cyberdelia · MIT License' });
    installMenu(); createWindow();
    if (!smoke) checkUpdates().catch(() => {});
  }).catch(error => {
    if (smoke) { require('node:fs').writeFileSync(process.env.CARDWRIGHT_SMOKE_REPORT, JSON.stringify({ ok: false, error: error.message })); app.exit(1); }
    else { dialog.showErrorBox('Could not start Cardwright', error.message); app.quit(); }
  });
}
