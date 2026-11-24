import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, unlink, rmdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { preparePackageOutput } from '../../scripts/package-path.mjs';

test('패키지 출력은 단일 안전 이름으로 제한하고 기존 폴더를 보존한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slity-package-boundary-'));
  try {
    for (const name of ['../escape', 'a/b', 'a\\b', 'CON', 'AUX.txt', 'trailing.', '.', '']) await assert.rejects(preparePackageOutput(root, name));
    const output = await preparePackageOutput(root, 'AgentSlity-final'); await mkdir(output);
    const path = join(output, 'keep.txt'); await writeFile(path, 'keep');
    await assert.rejects(preparePackageOutput(root, 'AgentSlity-final'));
    assert.equal(await readFile(path, 'utf8'), 'keep'); await unlink(path); await rmdir(output);
  } finally { await rmdir(join(root, 'artifacts')); await rmdir(root); }
});
test('artifacts junction이나symlink가 작업 경계 밖을 가리키면 복사 전에 거부한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slity-package-link-')), outside = await mkdtemp(join(tmpdir(), 'slity-package-outside-'));
  const link = join(root, 'artifacts'), marker = join(outside, 'keep.txt');
  try {
    await writeFile(marker, 'original'); await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(preparePackageOutput(root, 'AgentSlity-final'));
    assert.equal(await readFile(marker, 'utf8'), 'original');
  } finally { await unlink(link); await unlink(marker); await rmdir(root); await rmdir(outside); }
});
