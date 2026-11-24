import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createNormalizationEvidenceReport, createChildTurnEvidenceReport, normalizeCodexExecLine,
  saveNormalizationJson, readNormalizationJson, saveChildTurnCollectionJson, readChildTurnCollectionJson,
  parseChildTurnCollectionJson } from "../../dist/index.js";

test("저장된 두 형식에서 JSON 보고서를 만들어도 파일·수집 상태·unknown을 바꾸지 않는다", async t => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-report-"));
  t.after(async () => { for (const name of await readdir(dir)) await unlink(join(dir, name)); await rmdir(dir); });
  const normal = join(dir, "normal.json"), turn = join(dir, "turn.json");
  const event = normalizeCodexExecLine({ kind: "record", line: 1, value: { type: "turn.failed", thread_id: "PRIVATE_THREAD" } }, "PRIVATE_ALIAS");
  await saveNormalizationJson([event, event], normal);
  const snapshot = parseChildTurnCollectionJson(await readFile(resolve("tests/fixtures/child-turn-collection-demo.json"), "utf8"));
  await saveChildTurnCollectionJson(snapshot, turn);
  const before = await Promise.all([normal, turn].map(path => readFile(path)));
  const reports = [createNormalizationEvidenceReport(await readNormalizationJson(normal)), createChildTurnEvidenceReport(await readChildTurnCollectionJson(turn))];
  assert.equal(reports[0].summary.records, 2);
  assert.equal(reports[1].summary.cleanup_status, "unknown");
  assert.equal(reports[1].summary.collection.observations.turns, 2);
  for (const report of reports) {
    const json = JSON.stringify(report);
    assert.equal(report.format, "agent-slity.evidence-report"); assert.equal(report.verification_status, "unverified");
    assert.deepEqual(JSON.parse(json), report); assert.ok(!json.includes("PRIVATE_"));
    assert.equal(report.unknown_metrics.total_tokens, null); assert.equal(report.unknown_metrics.quality, null);
    assert.equal(report.findings.at(-1).evidence_level, "unknown");
  }
  assert.deepEqual(await Promise.all([normal, turn].map(path => readFile(path))), before);
  assert.deepEqual((await readdir(dir)).sort(), ["normal.json", "turn.json"]);
});
