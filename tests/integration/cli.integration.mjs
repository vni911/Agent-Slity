import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rmdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
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
  const input = '{"type":"thread.started","thread_id":"synthetic"}\n{"type":"item.started","item":{"id":"synthetic-item","type":"command_execution","command":"PRIVATE_COMMAND"}}\n{\n{"type":"future.event"}\n';
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
    assert.equal(json.results[1].event.payload.item_id, "synthetic-item");
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

test("항목 후보 조회는 역순·중복·유형과 스레드 차이를 보존한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-items-"));
  const path = join(dir, "input.jsonl");
  const input = [
    '{"type":"turn.started"}',
    '{"type":"item.completed","thread_id":"thread-b","item":{"id":"synthetic-item","type":"agent_message","text":"PRIVATE_MESSAGE"}}',
    '{"type":"item.started","thread_id":"thread-a","item":{"id":"synthetic-item","type":"command_execution","command":"PRIVATE_COMMAND"}}',
    '{"type":"item.started","thread_id":"thread-a","item":{"id":"synthetic-item","type":"command_execution"}}',
    '{"type":"item.started","item":{"type":"agent_message"}}',
    "{",
    '{"type":"future.event"}',
    "",
  ].join("\n");
  await writeFile(path, input);
  try {
    const result = run(["--items", path, "sample"]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      format: "agent-slity.item-observations", version: 1, verification_status: "unverified",
      groups: [{ source_id: "sample", item_id: "synthetic-item", observations: [
        { index: 1, line: 2, event_type: "item.completed", item_type: "agent_message", thread_id: "thread-b" },
        { index: 2, line: 3, event_type: "item.started", item_type: "command_execution", thread_id: "thread-a" },
        { index: 3, line: 4, event_type: "item.started", item_type: "command_execution", thread_id: "thread-a" },
      ] }], unassociated: [{ index: 4, reason: "missing_item_id", line: 5 }],
      diagnostics: [{ index: 5, line: 6, code: "invalid_json" }],
      unsupported: [{ index: 6, line: 7, reason: "unsupported_event_type" }],
      other_event_indices: [0],
    });
    assert.ok(!result.stdout.includes("PRIVATE_"));
    assert.ok(!result.stdout.includes(path));
    assert.equal(await readFile(path, "utf8"), input);
  } finally {
    await unlink(path);
    await rmdir(dir);
  }
});

test("항목 후보 조회의 인수·파일 오류는 원문과 부분 JSON 없이 실패한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-items-error-"));
  const missing = join(dir, "PRIVATE_MISSING.jsonl");
  const fixture = resolve("tests/fixtures/demo.jsonl");
  try {
    for (const testCase of [
      { args: ["--items", fixture], status: 2 },
      { args: ["--items", fixture, "PRIVATE/ALIAS"], status: 1 },
      { args: ["--items", missing, "sample"], status: 1 },
    ]) {
      const result = run(testCase.args);
      assert.equal(result.error, undefined);
      assert.equal(result.status, testCase.status);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes("PRIVATE"));
      assert.ok(!result.stderr.includes(missing));
    }
  } finally {
    await rmdir(dir);
  }
});

test("부모 후보 CLI는 역순·중복과 진단의 입력 위치를 보존한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-parents-"));
  const path = join(dir, "input.jsonl");
  const parent = '{"thread":{"id":"parent","parentThreadId":null,"cwd":"PRIVATE_PATH"}}';
  const input = ['{"thread":{"id":"child","parentThreadId":"parent"}}', '{', '', parent, parent,
    '{"thread":{"id":"orphan","parentThreadId":"missing"}}', '{}', ''].join("\n");
  await writeFile(path, input);
  try {
    const result = run(["--parents-jsonl", path, "sample"]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const json = JSON.parse(result.stdout);
    assert.equal(json.format, "agent-slity.parent-thread-candidates");
    assert.equal(json.verification_status, "unverified");
    assert.deepEqual(json.groups, [
      { source_id: "sample", parent_thread_id: "parent", child_indices: [0], parent_candidate_indices: [1, 2] },
      { source_id: "sample", parent_thread_id: "missing", child_indices: [3], parent_candidate_indices: [] },
    ]);
    assert.deepEqual(json.records.map(({ input_index, line }) => [input_index, line]), [[0, 1], [2, 4], [3, 5], [4, 6], [5, 7]]);
    assert.deepEqual(json.diagnostics, [{ input_index: 1, line: 2, code: "invalid_json" }]);
    assert.deepEqual(json.unassociated, [{ index: 1, reason: "missing_parent" }, { index: 2, reason: "missing_parent" }]);
    assert.deepEqual(json.unsupported_indices, [4]);
    assert.ok(!result.stdout.includes("PRIVATE_PATH"));
    assert.ok(!result.stdout.includes(path));
    assert.equal(await readFile(path, "utf8"), input);
    for (const args of [["--parents-jsonl", path, "PRIVATE/ALIAS"], ["--parents-jsonl", join(dir, "PRIVATE_MISSING"), "sample"]]) {
      const failure = run(args);
      assert.equal(failure.status, 1);
      assert.equal(failure.stdout, "");
      assert.ok(!failure.stderr.includes("PRIVATE"));
    }
    assert.equal(run(["--parents-jsonl", path]).status, 2);
  } finally {
    await unlink(path);
    await rmdir(dir);
  }
});

test("저장 항목 페이지 JSONL의 순서·중복·진단과 미확인을 보존한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-items-page-"));
  const path = join(dir, "input.jsonl");
  const page = '{"data":[{"turnId":"turn","item":{"type":"collabAgentToolCall","id":"item","senderThreadId":"parent","receiverThreadIds":["child"],"tool":"spawnAgent","status":"completed","prompt":"PRIVATE_PROMPT"}},{"item":{"type":"agentMessage","text":"PRIVATE_MESSAGE"}}],"nextCursor":"PRIVATE_CURSOR"}';
  const input = [page, page, '{"data":[]}', '{}', '{', ''].join("\n");
  await writeFile(path, input);
  try {
    const result = run(["--items-page-jsonl", path, "sample"]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const json = JSON.parse(result.stdout);
    assert.equal(json.format, "agent-slity.items-page-results");
    assert.equal(json.source_id, "sample");
    assert.deepEqual(json.results.map((entry) => [entry.line, entry.kind]), [[1, "page"], [2, "page"], [3, "page"], [4, "unsupported"], [5, "diagnostic"]]);
    assert.deepEqual({ ...json.results[1], line: 1 }, json.results[0]);
    assert.equal(json.results[0].next_page, "available");
    assert.equal(json.results[0].verification_status, "unverified");
    assert.deepEqual(json.results[0].items[0].receiver_thread_ids, ["child"]);
    assert.equal(json.results[0].items[1].kind, "unsupported");
    assert.equal(json.results[2].next_page, "unknown");
    assert.equal(json.results[3].reason, "invalid_page");
    assert.equal(json.results[4].code, "invalid_json");
    assert.ok(!result.stdout.includes("PRIVATE_"));
    assert.ok(!result.stdout.includes(path));
    assert.equal(await readFile(path, "utf8"), input);
    for (const args of [["--items-page-jsonl", path, "PRIVATE/ALIAS"], ["--items-page-jsonl", join(dir, "PRIVATE_MISSING"), "sample"]]) {
      const failure = run(args);
      assert.equal(failure.status, 1);
      assert.equal(failure.stdout, "");
      assert.ok(!failure.stderr.includes("PRIVATE"));
    }
    assert.equal(run(["--items-page-jsonl", path]).status, 2);
  } finally {
    await unlink(path);
    await rmdir(dir);
  }
});

test("스레드 조회 결과 JSONL의 순서·중복·진단을 보존하고 원문은 제외한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-thread-read-"));
  const path = join(dir, "input.jsonl");
  const item = '{"thread":{"id":"child","parentThreadId":"parent","sessionId":"session","forkedFromId":"fork","cwd":"PRIVATE_PATH"}}';
  const input = [item, item, '{"thread":{"id":"child","parentThreadId":"parent"}}', '{"thread":{}}', '{', ''].join("\n");
  await writeFile(path, input);
  try {
    const result = run(["--thread-read-jsonl", path, "sample"]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const json = JSON.parse(result.stdout);
    assert.equal(json.format, "agent-slity.thread-read-results");
    assert.equal(json.source_id, "sample");
    assert.deepEqual(json.results.map((entry) => [entry.line, entry.kind]), [[1, "thread"], [2, "thread"], [3, "thread"], [4, "unsupported"], [5, "diagnostic"]]);
    assert.equal(json.results[0].parent_thread_id, "parent");
    assert.equal(json.results[0].forked_from_id, "fork");
    assert.equal(json.results[0].verification_status, "unverified");
    assert.deepEqual({ ...json.results[1], line: 1 }, json.results[0]);
    assert.equal(json.results[2].session_id, null);
    assert.equal(json.results[3].reason, "invalid_thread");
    assert.equal(json.results[4].code, "invalid_json");
    assert.ok(!result.stdout.includes("PRIVATE_PATH"));
    assert.ok(!result.stdout.includes(path));
    assert.equal(await readFile(path, "utf8"), input);
    for (const args of [["--thread-read-jsonl", path, "PRIVATE/ALIAS"], ["--thread-read-jsonl", join(dir, "PRIVATE_MISSING"), "sample"]]) {
      const failure = run(args);
      assert.equal(failure.status, 1);
      assert.equal(failure.stdout, "");
      assert.ok(!failure.stderr.includes("PRIVATE"));
    }
    assert.equal(run(["--thread-read-jsonl", path]).status, 2);
  } finally {
    await unlink(path);
    await rmdir(dir);
  }
});

test("스레드 후보 조회는 명시적 ID·누락·역순·중복과 진단을 보존한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-threads-"));
  const path = join(dir, "input.jsonl");
  const input = [
    '{"type":"item.completed","thread_id":"child","item":{"id":"item-a","type":"agent_message","text":"PRIVATE_MESSAGE"}}',
    '{"type":"thread.started","thread_id":"root"}',
    '{"type":"turn.started"}',
    '{"type":"item.started","thread_id":"root","item":{"id":"item-b","type":"command_execution","command":"PRIVATE_COMMAND"}}',
    '{"type":"item.started","thread_id":"root","item":{"id":"item-b","type":"command_execution"}}',
    "{",
    '{"type":"future.event"}',
    "",
  ].join("\n");
  await writeFile(path, input);
  try {
    const result = run(["--threads", path, "sample"]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      format: "agent-slity.thread-observations", version: 1, verification_status: "unverified",
      groups: [
        { source_id: "sample", thread_id: "child", observations: [
          { index: 0, line: 1, event_type: "item.completed", item_id: "item-a", item_type: "agent_message" },
        ] },
        { source_id: "sample", thread_id: "root", observations: [
          { index: 1, line: 2, event_type: "thread.started", item_id: null, item_type: null },
          { index: 3, line: 4, event_type: "item.started", item_id: "item-b", item_type: "command_execution" },
          { index: 4, line: 5, event_type: "item.started", item_id: "item-b", item_type: "command_execution" },
        ] },
      ],
      unassociated: [{ index: 2, line: 3, event_type: "turn.started", item_id: null, item_type: null,
        source_id: "sample", thread_id: null, reason: "missing_thread_id" }],
      diagnostics: [{ index: 5, line: 6, source_id: "sample", code: "invalid_json" }],
      unsupported: [{ index: 6, line: 7, source_id: "sample", reason: "unsupported_event_type" }],
    });
    assert.ok(!result.stdout.includes("PRIVATE_"));
    assert.ok(!result.stdout.includes(path));
    assert.equal(await readFile(path, "utf8"), input);
  } finally {
    await unlink(path);
    await rmdir(dir);
  }
});

test("스레드 후보 조회의 인수·파일 오류는 원문과 부분 JSON 없이 실패한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-threads-error-"));
  const missing = join(dir, "PRIVATE_MISSING.jsonl");
  const fixture = resolve("tests/fixtures/demo.jsonl");
  try {
    for (const testCase of [
      { args: ["--threads", fixture], status: 2 },
      { args: ["--threads", fixture, "PRIVATE/ALIAS"], status: 1 },
      { args: ["--threads", missing, "sample"], status: 1 },
    ]) {
      const result = run(testCase.args);
      assert.equal(result.error, undefined);
      assert.equal(result.status, testCase.status);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes("PRIVATE"));
      assert.ok(!result.stderr.includes(missing));
    }
  } finally {
    await rmdir(dir);
  }
});

test("입력 요약은 중복을 포함한 정규화 결과와 진단·미지원을 집계한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-summary-"));
  const path = join(dir, "input.jsonl");
  const input = '{"type":"turn.started","text":"PRIVATE_MESSAGE"}\n\n{"type":"turn.started"}\n{\n{"type":"future.event"}\n';
  await writeFile(path, input);
  try {
    const result = run(["--summary", path]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      format: "agent-slity.input-summary", version: 1, verification_status: "unverified",
      count_semantics: "normalized_results_including_duplicates", total_results: 4,
      event_types: { "turn.started": 2 }, unsupported_reasons: { unsupported_event_type: 1 },
      diagnostic_codes: { invalid_json: 1 },
    });
    assert.ok(!result.stdout.includes(path));
    assert.ok(!result.stdout.includes("PRIVATE_MESSAGE"));
    assert.equal(await readFile(path, "utf8"), input);
  } finally {
    await unlink(path);
    await rmdir(dir);
  }
});

test("빈 입력 요약은 0과 빈 분류를 반환하고 잘못된 입력은 실패한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-empty-"));
  const path = join(dir, "empty.jsonl");
  const missing = join(dir, "PRIVATE_MISSING.jsonl");
  await writeFile(path, "\n");
  try {
    const result = run(["--summary", path]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      format: "agent-slity.input-summary", version: 1, verification_status: "unverified",
      count_semantics: "normalized_results_including_duplicates", total_results: 0,
      event_types: {}, unsupported_reasons: {}, diagnostic_codes: {},
    });
    const noPath = run(["--summary"]);
    assert.equal(noPath.status, 2);
    assert.equal(noPath.stdout, "");
    const absent = run(["--summary", missing]);
    assert.equal(absent.status, 1);
    assert.equal(absent.stdout, "");
    assert.ok(!absent.stderr.includes("PRIVATE_MISSING"));
    assert.equal(await readFile(path, "utf8"), "\n");
  } finally {
    await unlink(path);
    await rmdir(dir);
  }
});

test("명시적 저장은 새 파일에만 정규화 JSON을 쓰고 입력을 보존한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-output-"));
  const input = join(dir, "input.jsonl");
  const output = join(dir, "output.json");
  const original = '{"type":"thread.started","thread_id":"synthetic"}\n';
  await writeFile(input, original);
  try {
    const result = run(["--output", input, output, "sample"]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.ok(!result.stdout.includes(output));
    const json = JSON.parse(await readFile(output, "utf8"));
    assert.equal(json.format, "agent-slity.normalization-results");
    assert.equal(json.results[0].event.source.source_id, "sample");
    assert.equal(await readFile(input, "utf8"), original);
    if (process.platform !== "win32") assert.equal((await stat(output)).mode & 0o077, 0);
  } finally {
    await unlink(output);
    await unlink(input);
    await rmdir(dir);
  }
});

test("기존 파일과 입력 경로는 출력으로 덮어쓰지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-no-overwrite-"));
  const input = join(dir, "input.jsonl");
  const output = join(dir, "existing.json");
  const original = '{"type":"turn.started"}\n';
  await writeFile(input, original);
  await writeFile(output, "KEEP_EXISTING");
  try {
    for (const target of [input, output]) {
      const result = run(["--output", input, target]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes(target));
    }
    assert.equal(await readFile(input, "utf8"), original);
    assert.equal(await readFile(output, "utf8"), "KEEP_EXISTING");
  } finally {
    await unlink(output);
    await unlink(input);
    await rmdir(dir);
  }
});

test("입력 오류와 잘못된 별칭은 출력 파일을 만들지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-output-error-"));
  const output = join(dir, "not-created.json");
  const missing = join(dir, "PRIVATE_MISSING.jsonl");
  try {
    for (const args of [
      ["--output", missing, output],
      ["--output", resolve("tests/fixtures/demo.jsonl"), output, "PRIVATE/ALIAS"],
    ]) {
      const result = run(args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes("PRIVATE"));
      await assert.rejects(stat(output), { code: "ENOENT" });
    }
    assert.equal(run(["--output", missing]).status, 2);
  } finally {
    await rmdir(dir);
  }
});

test("기존 심볼릭 링크를 출력으로 덮어쓰지 않는다", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-output-link-"));
  const input = join(dir, "input.jsonl");
  const target = join(dir, "target.json");
  const link = join(dir, "link.json");
  await writeFile(input, '{"type":"turn.started"}\n');
  await writeFile(target, "KEEP_TARGET");
  await symlink(target, link);
  try {
    const result = run(["--output", input, link]);
    assert.equal(result.status, 1);
    assert.equal(await readFile(target, "utf8"), "KEEP_TARGET");
  } finally {
    await unlink(link);
    await unlink(target);
    await unlink(input);
    await rmdir(dir);
  }
});

test("Windows 대체 데이터 스트림을 출력으로 만들지 않는다", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-output-ads-"));
  const input = join(dir, "input.jsonl");
  const ads = `${input}:agenttest`;
  const original = '{"type":"turn.started"}\n';
  await writeFile(input, original);
  try {
    const result = run(["--output", input, ads]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.ok(!result.stderr.includes(ads));
    assert.equal(await readFile(input, "utf8"), original);
    await assert.rejects(stat(ads), { code: "ENOENT" });
    assert.equal(run(["--output", input, "NUL"]).status, 2);
  } finally {
    await unlink(input);
    await rmdir(dir);
  }
});
