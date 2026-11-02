import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";

const cli = resolve("dist/cli/main.js");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10000 });
}

test("빌드된 CLI가 합성 입력을 읽고 진단까지 출력하며 원본을 보존한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-integration-"));
  const path = join(dir, "input.jsonl");
  const input = '{"type":"thread.started","thread_id":"synthetic"}\n{\n{"type":"future.event"}\n';
  await writeFile(path, input);
  try {
    const result = run([path, "sample_1"]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const json = JSON.parse(result.stdout);
    assert.equal(json.format, "agent-slity.normalization-results");
    assert.equal(json.version, 1);
    assert.deepEqual(json.results.map((entry) => entry.kind), ["event", "diagnostic", "unsupported"]);
    assert.equal(json.results[0].event.source.source_id, "sample_1");
    assert.equal(json.results[0].event.thread_id, "synthetic");
    assert.equal(json.results[1].code, "invalid_json");
    assert.equal(await readFile(path, "utf8"), input);
  } finally {
    await unlink(path);
    await rmdir(dir);
  }
});

test("인수 누락은 사용법과 종료 코드 2를 반환한다", () => {
  const result = run([]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /사용법/);
});

test("존재하지 않는 파일은 경로 없이 실패한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-missing-"));
  const path = join(dir, "PRIVATE_SYNTHETIC_MISSING.jsonl");
  try {
    const result = run([path]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr);
    assert.ok(!result.stderr.includes(path));
    assert.ok(!result.stderr.includes("PRIVATE_SYNTHETIC_MISSING"));
  } finally {
    await rmdir(dir);
  }
});

test("잘못된 별칭은 원문 없이 실패한다", () => {
  const result = run([resolve("tests/fixtures/demo.jsonl"), "PRIVATE/ALIAS"]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr);
  assert.ok(!result.stderr.includes("PRIVATE/ALIAS"));
});
