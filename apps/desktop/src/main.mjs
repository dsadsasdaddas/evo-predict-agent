import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

const API_PORT = Number(process.env.EVOMATE_API_PORT || 8787);
const WEB_PORT = Number(process.env.EVOMATE_WEB_PORT || 3333);
const API_URL = process.env.EVOMATE_API_URL || `http://127.0.0.1:${API_PORT}`;
const WEB_URL = process.env.EVOMATE_WEB_URL || `http://localhost:${WEB_PORT}`;
const ELECTRON_WEB_URL = withQuery(WEB_URL, { shell: 'electron' });
const DESKTOP_DEVTOOLS = process.env.EVOMATE_DESKTOP_DEVTOOLS === '1';
const childProcesses = [];

let mainWindow = null;

app.setName('EvoMate');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    installMenu();
    mainWindow = createWindow();
    mainWindow.loadURL(loadingDataUrl('Starting EvoMate local runtime…'));

    try {
      await ensureRuntime();
      await mainWindow.loadURL(ELECTRON_WEB_URL);
      if (DESKTOP_DEVTOOLS) mainWindow.webContents.openDevTools({ mode: 'detach' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await mainWindow.loadURL(errorDataUrl(message));
      dialog.showErrorBox('EvoMate failed to start', message);
    }
  });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
});

app.on('before-quit', () => {
  for (const child of childProcesses) {
    if (!child.killed) child.kill('SIGTERM');
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 760,
    title: 'EvoMate Desktop',
    backgroundColor: '#050505',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

async function ensureRuntime() {
  await ensureService({
    name: 'EvoMate API',
    url: `${API_URL}/health`,
    command: npmCommand(),
    args: ['run', 'evomate:api'],
    env: {
      EVOMATE_PROJECT_ROOT: repoRoot,
      EVOMATE_API_PORT: String(API_PORT),
      EVOMAP_LLM_DISABLED: process.env.EVOMAP_LLM_DISABLED || '1'
    },
    timeoutMs: 20_000
  });

  await ensureService({
    name: 'EvoMate Web',
    url: WEB_URL,
    command: npmCommand(),
    args: ['run', 'evomate:web'],
    env: {
      EVOMATE_WEB_PORT: String(WEB_PORT),
      NEXT_PUBLIC_EVOMATE_API_URL: API_URL
    },
    timeoutMs: 35_000
  });
}

async function ensureService(options) {
  if (await isReachable(options.url)) return { alreadyRunning: true };

  const child = spawn(options.command, options.args, {
    cwd: repoRoot,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  childProcesses.push(child);

  child.stdout.on('data', (chunk) => logChild(options.name, chunk));
  child.stderr.on('data', (chunk) => logChild(options.name, chunk));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[${options.name}] exited with code ${code}`);
  });

  await waitUntilReachable(options.url, options.timeoutMs, options.name);
  return { alreadyRunning: false };
}

async function isReachable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 700);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitUntilReachable(url, timeoutMs, name) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(url)) return;
    await delay(400);
  }
  throw new Error(`${name} did not become reachable at ${url} within ${timeoutMs}ms`);
}

function installMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'EvoMate',
      submenu: [
        {
          label: 'Reload Control Plane',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.loadURL(ELECTRON_WEB_URL)
        },
        {
          label: 'Open in Browser',
          click: () => shell.openExternal(WEB_URL)
        },
        {
          label: 'Open Hook Queue Folder',
          click: () => shell.openPath(path.join(repoRoot, 'memory/evomate/hooks'))
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function logChild(name, chunk) {
  const text = chunk.toString().trim();
  if (!text) return;
  for (const line of text.split('\n')) console.log(`[${name}] ${line}`);
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withQuery(url, entries) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(entries)) parsed.searchParams.set(key, value);
  return parsed.toString();
}

function loadingDataUrl(message) {
  return htmlDataUrl(`
    <main>
      <div class="orb"></div>
      <p class="eyebrow">EvoMate Desktop</p>
      <h1>${escapeHtml(message)}</h1>
      <p>Starting local API on ${escapeHtml(API_URL)} and control plane on ${escapeHtml(WEB_URL)}.</p>
      <div class="bar"><span></span></div>
    </main>
  `);
}

function errorDataUrl(message) {
  return htmlDataUrl(`
    <main>
      <p class="eyebrow error">Startup error</p>
      <h1>EvoMate runtime did not start.</h1>
      <pre>${escapeHtml(message)}</pre>
      <p>Run <code>npm run evomate:api</code> and <code>EVOMATE_WEB_PORT=${WEB_PORT} npm run evomate:web</code> manually to inspect logs.</p>
    </main>
  `);
}

function htmlDataUrl(body) {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; background: #050505; color: #fff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body::before { content: ""; position: fixed; inset: 0; background: radial-gradient(circle at 30% 20%, rgba(25,230,255,.16), transparent 28%), radial-gradient(circle at 75% 30%, rgba(131,243,177,.09), transparent 24%); }
    main { position: relative; display: flex; min-height: 100vh; flex-direction: column; align-items: center; justify-content: center; padding: 48px; text-align: center; box-sizing: border-box; }
    .orb { width: 88px; height: 88px; border-radius: 999px; border: 1px solid rgba(25,230,255,.32); box-shadow: 0 0 80px rgba(25,230,255,.32), inset 0 0 40px rgba(25,230,255,.12); margin-bottom: 28px; animation: pulse 1.6s ease-in-out infinite alternate; }
    .eyebrow { color: #19e6ff; text-transform: uppercase; letter-spacing: .28em; font-size: 12px; }
    .eyebrow.error { color: #ff7d7d; }
    h1 { max-width: 820px; margin: 12px 0; font-size: clamp(34px, 6vw, 72px); line-height: .95; letter-spacing: -.07em; }
    p { max-width: 720px; color: rgba(255,255,255,.52); line-height: 1.7; }
    code, pre { color: #83f3b1; }
    pre { max-width: 820px; overflow: auto; padding: 18px; border: 1px solid rgba(255,255,255,.1); border-radius: 18px; background: rgba(255,255,255,.04); text-align: left; }
    .bar { width: min(480px, 70vw); height: 6px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.08); margin-top: 24px; }
    .bar span { display: block; width: 38%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #19e6ff, #83f3b1); animation: slide 1.2s ease-in-out infinite; }
    @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(280%); } }
    @keyframes pulse { from { transform: scale(.94); opacity: .7; } to { transform: scale(1.04); opacity: 1; } }
  </style>
</head>
<body>${body}</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
