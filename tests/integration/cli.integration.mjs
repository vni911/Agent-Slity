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
  const input = '{"type":"thread.started","thread_id":"synthetic"}\n{"type":"item.started","item":{"type":"command_execution","command":"PRIVATE_COMMAND"}}\n{\n{"type":"future.event"}\n';
  await writeFile(path, input);
  try {
    const result = run([path, "sample_1"]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const json = JSON.parse(result.stdout);
    assert.equal(json.format, "agent-slity.normalization-results");
    assert.equal(json.version, 1);
    assert.deepEqual(json.results.map((entry) => entry.kind), ["event", "event", "diagnostic", "unsupported"]);
    assert.equal(json.results[0].event.source.source_id, "sample_1");
    assert.equal(json.results[0].event.thread_id, "synthetic");
    assert.equal(json.results[1].event.payload.item_type, "command_execution");
    assert.ok(!result.stdout.includes("PRIVATE_COMMAND"));
    assert.equal(json.results[2].code, "invalid_json");
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

test("도움말 옵션은 단독 실행 시 표준 출력과 종료 코드 0을 반환한다", () => {
  for (const option of ["--help", "-h"]) {
    const result = run([option]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /사용법/);
    assert.match(result.stdout, /1~64자/);
    assert.match(result.stdout, /표준 출력/);
    assert.match(result.stdout, /민감한 식별자/);
    assert.match(result.stdout, /원본과 다른 파일/);
    const mixed = run([option, "PRIVATE_EXTRA"]);
    assert.equal(mixed.status, 2);
    assert.equal(mixed.stdout, "");
    assert.ok(!mixed.stderr.includes("PRIVATE_EXTRA"));
    const trailing = run([resolve("tests/fixtures/demo.jsonl"), option]);
    assert.equal(trailing.status, 2);
    assert.equal(trailing.stdout, "");
  }
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

test("동일 출처로 지정한 여러 입력의 후보와 충돌을 원본 삭제 없이 표시한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-overlaps-"));
  const firstPath = join(dir, "first.jsonl");
  const secondPath = join(dir, "second.jsonl");
  const first = '{"type":"turn.started"}\n{"type":"turn.started"}\n\n';
  const second = '{"type":"turn.started"}\n{"type":"turn.completed"}\n\n';
  await writeFile(firstPath, first);
  await writeFile(secondPath, second);
  try {
    const result = run(["--overlaps", "sample", firstPath, secondPath]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const json = JSON.parse(result.stdout);
    assert.equal(json.format, "agent-slity.source-overlaps");
    assert.equal(json.version, 1);
    assert.deepEqual(json.inputs, [
      { input_index: 0, start_index: 0, result_count: 2 },
      { input_index: 1, start_index: 2, result_count: 2 },
    ]);
    assert.deepEqual(json.overlaps, [
      { source_id: "sample", line: 1, indices: [0, 2], status: "matching_normalized" },
      { source_id: "sample", line: 2, indices: [1, 3], status: "conflict" },
    ]);
    assert.ok(!result.stdout.includes(firstPath));
    assert.ok(!result.stdout.includes(secondPath));
    assert.equal(await readFile(firstPath, "utf8"), first);
    assert.equal(await readFile(secondPath, "utf8"), second);
  } finally {
    await unlink(firstPath);
    await unlink(secondPath);
    await rmdir(dir);
  }
});

test("중복 후보 조회의 인수·파일 오류는 부분 JSON과 원문 없이 실패한다", async () => {
  const fixture = resolve("tests/fixtures/demo.jsonl");
  const missingDir = await mkdtemp(join(tmpdir(), "agent-slity-overlap-missing-"));
  const missing = join(missingDir, "PRIVATE_MISSING.jsonl");
  try {
    const cases = [
      { args: ["--overlaps", "sample", fixture], status: 2 },
      { args: ["--overlaps", "PRIVATE/ALIAS", fixture, fixture], status: 1 },
      { args: ["--overlaps", "sample", fixture, missing], status: 1 },
    ];
    for (const testCase of cases) {
      const result = run(testCase.args);
      assert.equal(result.error, undefined);
      assert.equal(result.status, testCase.status);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes("PRIVATE"));
      assert.ok(!result.stderr.includes(missing));
    }
  } finally {
    await rmdir(missingDir);
  }
});
