import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import { mkdir, mkdtemp, readFile, rm, realpath, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), env = { ...process.env, SLITY_SMOKE_TEST: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const dir = await mkdtemp(join(tmpdir(), 'slity-desktop-smoke-')), images = resolve('artifacts/smoke');
let app;
const errors = [];
try {
  const root = await realpath(process.cwd()), artifacts = resolve('artifacts');
  try { await mkdir(artifacts); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(artifacts), actual = await realpath(artifacts);
  if (info.isSymbolicLink() || !actual.startsWith(root + sep)) throw new Error('산출물 경계 오류');
  await mkdir(images, { recursive: true });
  if ((await lstat(images)).isSymbolicLink() || !(await realpath(images)).startsWith(actual + sep)) throw new Error('화면 경로 경계 오류');
  const packaged = process.argv[2] ? await realpath(resolve(process.argv[2])) : null;
  if (packaged && !packaged.startsWith(actual + sep)) throw new Error('패키지 경로가 작업 산출물 밖입니다.');
  app = await _electron.launch({ executablePath: packaged || require('electron'), args: [`--user-data-dir=${join(dir, 'profile')}`, ...(packaged ? [] : [resolve('desktop/main.cjs')])], env, chromiumSandbox: true, timeout: 30000 });
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(join(dir, 'profile')));
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByTestId('plan-button').waitFor();
  const security = await app.evaluate(({ BrowserWindow, app }) => {
    const window = BrowserWindow.getAllWindows()[0], prefs = window.webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, isolation: prefs.contextIsolation, node: prefs.nodeIntegration, noSandbox: app.commandLine.hasSwitch('no-sandbox') };
  });
  assert.deepEqual(security, { sandbox: true, isolation: true, node: false, noSandbox: false });
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(async () => { try { await window.agentSlity.save({ kind: ['report'] }); return false; } catch { return true; } }), true);
  assert.equal(await page.evaluate(async () => { try { await window.agentSlity.run({ provider: 'codex', confirm_model_call: false }); return false; } catch { return true; } }), true);
  await page.getByTestId('mode-small').click();
  await page.getByTestId('plan-button').click();
  await page.getByTestId('team-plan').waitFor();
  assert.ok((await page.getByTestId('team-plan').innerText()).length > 30);
  await page.getByTestId('run-button').click();
  await page.getByTestId('execution-result').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="execution-result"]')?.textContent.includes('합성 정답 검사 통과'));
  const run = await page.evaluate(async () => {
    const request = { format: 'agent-slity.team-request', version: 1, selection: { mode: 'full' }, constraints: { max_agents: 3 }, task: { independent_research: true, independent_review: true } };
    return window.agentSlity.run({ request, provider: 'synthetic', task: '2 + 2의 결과를 숫자 하나로 답하세요.', timeout_ms: 5000 });
  });
  assert.equal(run.status, 'completed'); assert.equal(run.synthetic, true); assert.equal(run.quality, 'passed'); assert.equal(run.steps.length, 3);
  const cancelled = await page.evaluate(async () => {
    const request = { format: 'agent-slity.team-request', version: 1, selection: { mode: 'full' }, constraints: { max_agents: 3 }, task: { independent_research: true, independent_review: true } };
    const pending = window.agentSlity.run({ request, provider: 'synthetic', task: '2 + 2의 결과를 숫자 하나로 답하세요.', timeout_ms: 5000 });
    await window.agentSlity.cancel(); return pending;
  });
  assert.equal(cancelled.status, 'cancelled');
  const comparison = await page.evaluate(() => window.agentSlity.compare({ timeout_ms: 5000 }));
  assert.equal(comparison.runs.length, 3); assert.equal(comparison.efficiency, null); assert.equal(comparison.synthetic, true);
  await page.getByTestId('tab-comparison').click();
  await page.getByTestId('compare-button').click();
  await page.getByTestId('comparison-result').waitFor();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, resolve('tests/fixtures/child-turn-collection-demo.json'));
  const opened = await page.evaluate(() => window.agentSlity.openSnapshot('turn'));
  assert.equal(opened.report.verification_status, 'unverified'); assert.equal(opened.report.unknown_metrics.quality, null);
  await page.getByTestId('tab-report').click();
  await page.getByTestId('snapshot-kind').selectOption('turn');
  await page.getByTestId('open-snapshot').click();
  await page.getByTestId('evidence-report').waitFor();
  const target = join(dir, 'report.json');
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, target);
  const saved = await page.evaluate(() => window.agentSlity.save({ kind: 'report' })); assert.equal(saved.saved, true);
  const bytes = await readFile(target);
  assert.equal(JSON.parse(bytes.toString('utf8')).format, 'agent-slity.evidence-report');
  assert.equal(await page.evaluate(async () => { try { await window.agentSlity.save({ kind: 'report' }); return false; } catch { return true; } }), true);
  assert.deepEqual(await readFile(target), bytes);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  await page.screenshot({ path: join(images, 'desktop-report.png'), fullPage: true });
  await page.getByTestId('tab-team').click();
  await page.screenshot({ path: join(images, 'desktop-team.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(images, 'desktop-narrow.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ desktop_smoke: 'passed', security, synthetic_roles: run.steps.length, cancelled: cancelled.status, comparison: comparison.runs.length, save_no_overwrite: true, screenshots: images, runtime: await app.evaluate(() => process.versions) }));
} finally {
  try { if (app) await app.close(); }
  finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep) || !basename(dir).startsWith('slity-desktop-smoke-')) throw new Error('임시 폴더 경계 오류');
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
