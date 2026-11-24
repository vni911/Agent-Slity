const { app, BrowserWindow, ipcMain, dialog, protocol, session } = require('electron');
const { readFile } = require('node:fs/promises');
const { join, resolve, basename, extname, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const root = resolve(__dirname, '..'), assets = join(root, 'dist-desktop'), origin = 'slity://app', home = origin + '/index.html';
protocol.registerSchemesAsPrivileged([{ scheme: 'slity', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'";
let window, active = null, executable = null, workspace = null;
const saved = { report: null, execution: null, comparison: null };
function idle() { if (active) throw new Error('진행 중인 실행을 먼저 마치거나 취소하세요.'); }
function sender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== home) throw new Error('허용되지 않은 요청입니다.');
}
async function start() {
  const core = await import(pathToFileURL(join(root, 'dist/index.js')).href);
  const { isSafeSnapshotPath } = await import(pathToFileURL(join(root, 'dist/adapters/snapshot-path.js')).href);
  const { publishSnapshotJson } = await import(pathToFileURL(join(root, 'dist/adapters/snapshot-file-writer.js')).href);
  protocol.handle('slity', async request => {
    try {
      const url = new URL(request.url), target = resolve(assets, '.' + decodeURIComponent(url.pathname));
      if (url.protocol !== 'slity:' || url.hostname !== 'app' || url.port || url.username || url.password || request.method !== 'GET' || !target.startsWith(assets + sep)) return new Response('차단됨', { status: 403 });
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(target)];
      if (!mime) return new Response('없음', { status: 404 });
      return new Response(await readFile(target), { headers: { 'Content-Type': mime, 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response('없음', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(origin + '/') }));
  window = new BrowserWindow({ title: 'Agent Slity', width: 1280, height: 900, minWidth: 390, minHeight: 600, show: process.env.SLITY_SMOKE_TEST !== '1',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== home) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const methods = {
    plan: value => core.createTeamPlan(value),
    openSnapshot: async kind => {
      idle(); if (!['normalization', 'turn'].includes(kind)) throw new Error();
      const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: '지원 스냅샷 JSON', extensions: ['json'] }] });
      if (selected.canceled || !selected.filePaths[0]) return null;
      const path = selected.filePaths[0];
      saved.report = kind === 'normalization' ? core.createNormalizationEvidenceReport(await core.readNormalizationJson(path)) : core.createChildTurnEvidenceReport(await core.readChildTurnCollectionJson(path));
      return { report: saved.report, name: basename(path) };
    },
    chooseExecutable: async () => {
      idle(); const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Codex 실행 파일', extensions: ['exe'] }] } : {}) });
      if (selected.canceled || !selected.filePaths[0]) return null;
      if (!isSafeSnapshotPath(selected.filePaths[0]) || /\.(?:cmd|bat)$/i.test(selected.filePaths[0])) throw new Error();
      executable = selected.filePaths[0]; return { name: basename(executable) };
    },
    chooseWorkspace: async () => {
      idle(); const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      if (selected.canceled || !selected.filePaths[0]) return null;
      if (!isSafeSnapshotPath(selected.filePaths[0])) throw new Error();
      workspace = selected.filePaths[0]; return { name: basename(workspace) };
    },
    run: async value => {
      idle(); if (!value || !['synthetic', 'codex'].includes(value.provider)) throw new Error();
      core.createTeamPlan(value.request);
      if (value.provider === 'codex' && (value.confirm_model_call !== true || !executable || !workspace)) throw new Error();
      active = new AbortController();
      try {
        saved.execution = await core.executeTeam(value.request, { provider: value.provider, task: value.task, timeout_ms: value.timeout_ms,
          executable, cwd: workspace, signal: active.signal, onProgress: step => { if (!window.isDestroyed()) window.webContents.send('slity:progress', step); } });
        return saved.execution;
      } finally { active = null; }
    },
    compare: async value => {
      idle(); active = new AbortController();
      try { saved.comparison = await core.compareSyntheticTeams({ timeout_ms: value?.timeout_ms, signal: active.signal,
        onProgress: step => { if (!window.isDestroyed()) window.webContents.send('slity:progress', step); } }); return saved.comparison; }
      finally { active = null; }
    },
    cancel: () => { if (!active) return false; active.abort(); return true; },
    save: async value => {
      idle(); if (!value || typeof value.kind !== 'string' || !Object.hasOwn(saved, value.kind) || !saved[value.kind]) throw new Error();
      const selected = await dialog.showSaveDialog(window, { defaultPath: `agent-slity-${value.kind}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (selected.canceled || !selected.filePath) return { saved: false, name: null };
      const result = await publishSnapshotJson(JSON.stringify(saved[value.kind]), selected.filePath);
      if (result.publication_status !== 'published') throw new Error();
      return { saved: true, name: basename(selected.filePath), publication_status: result.publication_status, temp_cleanup_status: result.temp_cleanup_status };
    },
  };
  for (const [name, handler] of Object.entries(methods)) ipcMain.handle('slity:' + name, async (event, value) => {
    sender(event); try { return await handler(value); } catch { throw new Error(name === 'save' ? '저장하지 못했거나 상태 확인이 필요합니다. 대상 파일이 생겼을 수 있습니다.' : '요청을 처리하지 못했습니다. 입력 형식·제한·실행 파일과 작업 폴더를 확인하세요.'); }
  });
  window.on('close', event => {
    if (active) { event.preventDefault(); active.abort(); const poll = setInterval(() => { if (!active) { clearInterval(poll); window.close(); } }, 50); poll.unref(); }
  });
  await window.loadURL(home);
}
app.whenReady().then(start).catch(() => { console.error('데스크톱을 시작하지 못했습니다. 빌드와 의존성을 확인하세요.'); app.exit(1); });
app.on('window-all-closed', () => app.quit());
