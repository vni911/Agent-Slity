import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ChildTurnSnapshotReadError, readChildTurnCollectionJson, saveChildTurnCollectionJson,
  parseChildTurnCollectionJson, summarizeChildTurnCollection } from "../../dist/index.js";

async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-reader-"));
  t.after(async () => { for (const name of await readdir(dir)) await unlink(join(dir, name)); await rmdir(dir); });
  return dir;
}
test("writer→public reader→summary가 상태·중복·미지원·null/0을 유지하고 파일을 변경하지 않는다", async t => {
  const dir = await directory(t), raw = await readFile(resolve("tests/fixtures/child-turn-collection-demo.json"), "utf8");
  const input = parseChildTurnCollectionJson(raw), path = join(dir, "snapshot.json");
  assert.equal((await saveChildTurnCollectionJson(input, path)).publication_status, "published");
  const before = await readFile(path), decoded = await readChildTurnCollectionJson(path);
  assert.deepEqual(decoded, input);
  const summary = summarizeChildTurnCollection(decoded);
  assert.equal(summary.collection.observations.turns, 2); assert.equal(summary.collection.observations.items, 4);
  assert.equal(summary.cleanup_status, "unknown"); assert.equal(summary.verification_status, "unverified");
  assert.deepEqual(await readFile(path), before); assert.deepEqual(await readdir(dir), ["snapshot.json"]);
  if (process.platform !== "win32") {
    const alias = join(dir, "alias.json"); await symlink(path, alias);
    assert.deepEqual(await readChildTurnCollectionJson(alias), input);
  }
});
test("원문·잘못된 형식·인코딩·없는 파일은 경로와 내용 없는 읽기 오류다", async t => {
  const dir = await directory(t);
  for (const [index, bytes] of [Buffer.from("PRIVATE_BAD_JSON"), Buffer.from([0xc3, 0x28]), Buffer.from("{}")].entries()) {
    const path = join(dir, `PRIVATE_${index}.json`); await writeFile(path, bytes);
    await assert.rejects(readChildTurnCollectionJson(path), error => error instanceof ChildTurnSnapshotReadError &&
      error.message === "turn 수집 JSON 파일을 읽을 수 없습니다." && !error.message.includes("PRIVATE_"));
    assert.deepEqual(await readFile(path), bytes);
  }
  await assert.rejects(readChildTurnCollectionJson(join(dir, "PRIVATE_MISSING")), error => error.code === "read_failed");
  await assert.rejects(readChildTurnCollectionJson(dir), error => error.code === "read_failed");
});
