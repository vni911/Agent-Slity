import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { exportNormalizationJson, findSourceOverlaps, groupThreadObservations, normalizeCodexExecLine, readJsonlFile,
  saveNormalizationJson, readNormalizationJson, saveChildTurnCollectionJson, readChildTurnCollectionJson } from "../../dist/index.js";

async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-normal-file-"));
  t.after(async () => { for (const name of await readdir(dir)) await unlink(join(dir, name)); await rmdir(dir); });
  return dir;
}
const event = () => normalizeCodexExecLine({ kind: "record", line: 1, value: { type: "item.completed", thread_id: "thread", item: { id: "item", type: "agent_message" } } }, "sample");
test("JSONL 가져오기→새 파일 저장→읽기→후보 재계산에서 원본·위치·상태를 보존한다", async t => {
  const dir = await directory(t), source = join(dir, "source.jsonl"), target = join(dir, "snapshot.json");
  const bytes = '{"type":"thread.started","thread_id":"thread"}\n{"type":"turn.completed","thread_id":"thread","usage":{"input_tokens":0}}\nPRIVATE_BAD\n{"type":"future","text":"PRIVATE_RAW"}\n';
  await writeFile(source, bytes);
  const records = []; for await (const line of readJsonlFile(source)) records.push(normalizeCodexExecLine(line, "sample"));
  const before = structuredClone(records);
  assert.equal((await saveNormalizationJson(records, target)).publication_status, "published");
  assert.deepEqual(await readNormalizationJson(target), records);
  const restored = await readNormalizationJson(target);
  assert.deepEqual(groupThreadObservations(restored), groupThreadObservations(before));
  assert.equal(findSourceOverlaps([...records, ...restored]).length, 4);
  assert.equal((await saveNormalizationJson(restored, target)).error, "already_exists");
  assert.equal(await readFile(source, "utf8"), bytes);
  assert.equal(await readFile(target, "utf8"), exportNormalizationJson(before));
  assert.ok(!(await readFile(target, "utf8")).includes("PRIVATE_"));
  assert.deepEqual(records, before); assert.deepEqual((await readdir(dir)).sort(), ["snapshot.json", "source.jsonl"]);
});
test("turn과 정규화 JSON을 암묵적으로 변환하지 않고 빈 기록·별도 파일 중복을 유지한다", async t => {
  const dir = await directory(t), normal = join(dir, "normal.json"), turn = join(dir, "turn.json");
  assert.equal((await saveNormalizationJson([], normal)).publication_status, "published");
  assert.deepEqual(await readNormalizationJson(normal), []);
  assert.equal((await saveChildTurnCollectionJson({ initialization_error: "timeout", cleanup_status: "unknown", collection: null }, turn)).publication_status, "published");
  await assert.rejects(readNormalizationJson(turn), error => error.code === "invalid_json");
  await assert.rejects(readChildTurnCollectionJson(normal), error => error.code === "invalid_json");
  const duplicate = join(dir, "duplicate.json");
  assert.equal((await saveNormalizationJson([], duplicate)).publication_status, "published");
  assert.equal(await readFile(normal, "utf8"), await readFile(duplicate, "utf8"));
});
test("정규화 JSON16MiB 경계는 LF 없이 저장해 읽고 초과는 거부한다", { timeout: 30000 }, async t => {
  const dir = await directory(t), records = Array.from({ length: 200 }, event), limit = 16 * 1024 * 1024;
  let remaining = limit - Buffer.byteLength(exportNormalizationJson(records)), overflow;
  for (const record of records) {
    for (const key of ["thread_id", "item_id"]) {
      const object = key === "thread_id" ? record.event : record.event.payload;
      const count = Math.min(65536 - object[key].length, remaining);
      object[key] += "x".repeat(count); remaining -= count;
      if (count && object[key].length < 65536) overflow = [object, key];
    }
  }
  assert.equal(remaining, 0); assert.ok(overflow);
  const json = exportNormalizationJson(records), target = join(dir, "boundary.json");
  assert.equal(Buffer.byteLength(json), limit);
  assert.equal((await saveNormalizationJson(records, target)).publication_status, "published");
  assert.equal(await readFile(target, "utf8"), json);
  assert.deepEqual(await readNormalizationJson(target), records);
  overflow[0][overflow[1]] += "x";
  const rejected = join(dir, "over.json");
  assert.equal((await saveNormalizationJson(records, rejected)).error, "invalid_input");
  await writeFile(rejected, json + " ");
  await assert.rejects(readNormalizationJson(rejected), error => error.code === "read_failed");
});
