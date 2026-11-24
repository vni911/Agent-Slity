import { mkdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export async function preparePackageOutput(root, name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,78}[A-Za-z0-9_-])?$/.test(name) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) throw new Error('패키지 이름이 유효하지 않습니다.');
  const workspace = await realpath(resolve(root)), artifacts = join(workspace, 'artifacts');
  try { await mkdir(artifacts); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(artifacts), actual = await realpath(artifacts);
  if (!info.isDirectory() || info.isSymbolicLink() || !actual.startsWith(workspace + sep)) throw new Error('패키지 부모 경로가 안전하지 않습니다.');
  const output = join(actual, name);
  try { await lstat(output); throw new Error('패키지 폴더가 이미 있습니다. 새 이름으로 빌드하세요.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return output;
}
