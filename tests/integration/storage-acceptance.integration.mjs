import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { findParentThreadCandidates, normalizeCodexThreadReadV0166, parseChildTurnCollectionJson,
  readChildTurnCollectionJson, saveChildTurnCollectionJson, summarizeChildTurnCollection } from "../../dist/index.js";

test("부모 스냅샷 도착 후 후보를 재계산해도 이전 부분 수집·파일·정리 unknown은 바뀌지 않는다", async t => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-storage-acceptance-"));
  t.after(async () => { for (const name of await readdir(dir)) await unlink(join(dir, name)); await rmdir(dir); });
  const fixture = await readFile(resolve("tests/fixtures/child-turn-collection-demo.json"), "utf8");
  const child = parseChildTurnCollectionJson(fixture), parent = parseChildTurnCollectionJson(fixture);
  child.collection.thread = normalizeCodexThreadReadV0166({ thread: { id: "child", parentThreadId: "parent", cwd: "PRIVATE_PATH" } }, "synthetic");
  child.collection.status = "partial"; child.collection.reason = "server_error"; child.collection.pages = child.collection.pages.slice(0, 1);
  parent.collection.thread = normalizeCodexThreadReadV0166({ thread: { id: "parent", parentThreadId: null } }, "synthetic");
  parent.cleanup_status = "exit_observed";
  const childFile = join(dir, "child.json"), parentFile = join(dir, "parent.json");
  const publication = await saveChildTurnCollectionJson(child, childFile);
  assert.equal(publication.publication_status, "published"); assert.equal(publication.temp_cleanup_status, "complete");
  const firstBytes = await readFile(childFile), before = await readChildTurnCollectionJson(childFile);
  const firstCandidates = findParentThreadCandidates([before.collection.thread]);
  assert.deepEqual(firstCandidates.groups, [{ source_id: "synthetic", parent_thread_id: "parent", child_indices: [0], parent_candidate_indices: [] }]);
  const firstSnapshot = structuredClone(firstCandidates);
  assert.equal((await saveChildTurnCollectionJson(parent, parentFile)).publication_status, "published");
  const loadedParent = await readChildTurnCollectionJson(parentFile), reloaded = await readChildTurnCollectionJson(childFile);
  const after = findParentThreadCandidates([reloaded.collection.thread, loadedParent.collection.thread, reloaded.collection.thread]);
  assert.deepEqual(after.groups, [{ source_id: "synthetic", parent_thread_id: "parent", child_indices: [0, 2], parent_candidate_indices: [1] }]);
  assert.equal(after.verification_status, "unverified");
  assert.deepEqual(firstCandidates, firstSnapshot); assert.deepEqual(await readFile(childFile), firstBytes); assert.deepEqual(reloaded, before);
  const summary = summarizeChildTurnCollection(reloaded);
  assert.equal(summary.collection.status, "partial"); assert.equal(summary.collection.reason, "server_error");
  assert.equal(summary.cleanup_status, "unknown");
  assert.equal(loadedParent.cleanup_status, "exit_observed");
  assert.ok(!firstBytes.includes(Buffer.from("PRIVATE_")));
  assert.deepEqual((await readdir(dir)).sort(), ["child.json", "parent.json"]);
});
