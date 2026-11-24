import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
const exec = promisify(execFile);
async function cli(args) {
  try { return { ...await exec(process.execPath, [resolve('dist/cli/main.js'), ...args], { encoding: 'utf8' }), code: 0 }; }
  catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
}
test('CLI의 합성 실행과 비교는 실제 실행과 구분하고 원본을 유지한다', async () => {
  const path = 'tests/fixtures/team-request-demo.json', before = await readFile(path);
  const run = await cli(['--run-demo', path]), compare = await cli(['--compare-demo']);
  assert.equal(run.code, 0); assert.equal(compare.code, 0);
  const execution = JSON.parse(run.stdout), comparison = JSON.parse(compare.stdout);
  assert.equal(execution.synthetic, true); assert.equal(execution.status, 'completed'); assert.equal(execution.quality_basis, 'synthetic_fixture');
  assert.deepEqual(execution.steps.map(step => step.role), ['implementer', 'reviewer']);
  assert.equal(comparison.runs.length, 3); assert.equal(comparison.efficiency, null);
  assert.deepEqual(await readFile(path), before);
});
test('명시적 모델 호출 설정 없는 CLI는 프로세스를 실행하지 않고 실패한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slity-run-cli-')), path = join(dir, 'input.json');
  try {
    for (const body of [{}, { confirm_model_call: false, executable: 'PRIVATE_EXECUTABLE', task: 'PRIVATE_TASK' }]) {
      await writeFile(path, JSON.stringify(body)); const result = await cli(['--run-codex-team', path]);
      assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('PRIVATE_'));
    }
    for (const args of [['--compare-demo', 'extra'], ['--run-demo'], ['--run-codex-team', '-h']]) {
      const result = await cli(args); assert.equal(result.code, 2); assert.equal(result.stdout, '');
    }
    assert.deepEqual(await readdir(dir), ['input.json']);
  } finally { await unlink(path); await rmdir(dir); }
});
