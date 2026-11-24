import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { normalizeCodexExecLine, saveNormalizationJson, exportChildTurnCollectionJson,
  normalizeCodexTurnsPageV0166 } from "../../dist/index.js";

const exec = promisify(execFile);
async function cli(args) {
  try { const result = await exec(process.execPath, [resolve("dist/cli/main.js"), ...args], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }); return { ...result, code: 0 }; }
  catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
}
test("실제 CLI가 두 스냅샷의 JSON·HTML을 출력하고 파일을 변경하지 않는다", async t => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-report-cli-"));
  t.after(async () => { for (const name of await readdir(dir)) await unlink(join(dir, name)); await rmdir(dir); });
  const normal = join(dir, "normal.json");
  await saveNormalizationJson([normalizeCodexExecLine({ kind: "record", line: 1, value: { type: "turn.failed", thread_id: "PRIVATE_THREAD" } }, "PRIVATE_ALIAS")], normal);
  const turn = join(dir, "turn.json");
  await writeFile(turn, await readFile("tests/fixtures/child-turn-collection-demo.json"));
  const before = await Promise.all([normal, turn].map(path => readFile(path)));
  for (const [kind, path] of [["normalization", normal], ["turn", turn]]) {
    for (const mode of ["--report", "--report-html"]) {
      const result = await cli([mode, kind, path]);
      assert.equal(result.code, 0); assert.equal(result.stderr, ""); assert.ok(!result.stdout.includes("PRIVATE_"));
      if (mode === "--report") { const report = JSON.parse(result.stdout); assert.equal(report.format, "agent-slity.evidence-report"); assert.equal(report.unknown_metrics.quality, null); }
      else { assert.ok(result.stdout.startsWith("<!doctype html>")); assert.ok(result.stdout.includes("미검증 · unverified")); }
    }
  }
  assert.deepEqual(await Promise.all([normal, turn].map(path => readFile(path))), before);
  assert.deepEqual((await readdir(dir)).sort(), ["normal.json", "turn.json"]);
});
test("CLI 오류는 경로·원문·부분 결과를 출력하지 않는다", async t => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-report-invalid-"));
  t.after(async () => { for (const name of await readdir(dir)) await unlink(join(dir, name)); await rmdir(dir); });
  const path = join(dir, "PRIVATE_PATH.json");
  for (const bytes of [Buffer.from('{"PRIVATE_SECRET":true}'), Buffer.from([0xff]), Buffer.alloc(16 * 1024 * 1024 + 1, 32)]) {
    await writeFile(path, bytes);
    for (const mode of ["--report", "--report-html"]) {
      const result = await cli([mode, "normalization", path]);
      assert.equal(result.code, 1); assert.equal(result.stdout, ""); assert.ok(!result.stderr.includes("PRIVATE_"));
    }
  }
  const missing = await cli(["--report", "turn", join(dir, "PRIVATE_MISSING")]);
  assert.equal(missing.code, 1); assert.equal(missing.stdout, ""); assert.ok(!missing.stderr.includes("PRIVATE_"));
});
test("유효한 초기화 실패·부분 수집·지원 범위 없음·빈 관측을 보고서 성공과 구분한다", async t => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-report-states-"));
  const path = join(dir, "states.json");
  t.after(async () => { await unlink(path); await rmdir(dir); });
  const collection = pages => ({ verification_status: "unverified", source_id: "synthetic", status: "partial", reason: "server_error", thread: null, pages });
  const cases = [
    { initialization_error: "timeout", cleanup_status: "unknown", collection: null },
    { initialization_error: null, cleanup_status: "unknown", collection: collection([]) },
    { initialization_error: null, cleanup_status: "unknown", collection: collection([normalizeCodexTurnsPageV0166({})]) },
    { initialization_error: null, cleanup_status: "unknown", collection: collection([normalizeCodexTurnsPageV0166({ data: [], nextCursor: null })]) },
  ];
  for (const [index, input] of cases.entries()) {
    await writeFile(path, exportChildTurnCollectionJson(input));
    const json = await cli(["--report", "turn", path]), html = await cli(["--report-html", "turn", path]);
    assert.equal(json.code, 0); assert.equal(html.code, 0);
    const report = JSON.parse(json.stdout);
    assert.equal(report.summary.initialization_error, input.initialization_error);
    assert.equal(report.summary.cleanup_status, "unknown"); assert.equal(report.unknown_metrics.quality, null);
    if (index === 0) { assert.equal(report.summary.collection, null); assert.ok(html.stdout.includes("timeout")); }
    else {
      assert.equal(report.summary.collection.status, "partial"); assert.ok(html.stdout.includes("partial"));
      assert.equal(report.summary.collection.observations?.turns ?? null, index === 3 ? 0 : null);
    }
  }
});
test("JSON 보고서는 허용돼도 HTML 본문이16MiB를 넘으면 부분 HTML 없이 실패한다", { timeout: 30000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-report-html-budget-"));
  const path = join(dir, "snapshot.json");
  t.after(async () => { await unlink(path); await rmdir(dir); });
  const pages = Array.from({ length: 20 }, (_, pageIndex) => ({
    ...normalizeCodexTurnsPageV0166({ data: [], nextCursor: "next" }, "synthetic"),
    turns: Array.from({ length: 6500 }, (_, index) => ({ index, turn_id: `t${Math.floor(pageIndex / 2)}-${index}`,
      status: "completed", items_view: "full", items: [] })),
  }));
  const json = exportChildTurnCollectionJson({ initialization_error: null, cleanup_status: "unknown",
    collection: { verification_status: "unverified", source_id: "synthetic", status: "partial", reason: "server_error", thread: null, pages } });
  assert.ok(Buffer.byteLength(json) < 16 * 1024 * 1024);
  await writeFile(path, json);
  const allowed = await cli(["--report", "turn", path]);
  assert.equal(allowed.code, 0); assert.ok(Buffer.byteLength(allowed.stdout) <= 16 * 1024 * 1024);
  const rejected = await cli(["--report-html", "turn", path]);
  assert.equal(rejected.code, 1); assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr, "근거 보고서를 생성할 수 없습니다. 파일·UTF-8·형식·크기를 확인하세요.\n");
  assert.deepEqual(await readdir(dir), ["snapshot.json"]);
});
