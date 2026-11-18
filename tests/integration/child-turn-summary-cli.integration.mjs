import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const cli = resolve("dist/cli/main.js"), fixture = resolve("tests/fixtures/child-turn-collection-demo.json");
const limit = 16 * 1024 * 1024;
const error = "수집 JSON을 요약할 수 없습니다. 파일·UTF-8·형식·크기를 확인하세요.\n";
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10000 });
const demo = async () => JSON.parse(await readFile(fixture, "utf8"));
async function withInput(bytes, action) {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-child-summary-")), path = join(dir, "PRIVATE_INPUT.json");
  await writeFile(path, bytes);
  try { return await action(path, dir); }
  finally { await unlink(path); await rmdir(dir); }
}
function success(result) {
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, "");
  assert.ok(result.stdout.endsWith("\n")); assert.equal(result.stdout.trim().split("\n").length, 1);
  return JSON.parse(result.stdout);
}
function failure(result, status = 1) {
  assert.equal(result.error, undefined); assert.equal(result.status, status); assert.equal(result.stdout, "");
  assert.equal(result.stderr, status === 1 ? error : "사용법: --child-turn-summary <JSON 파일>\n");
  assert.ok(!result.stderr.includes("PRIVATE_"));
}

test("빌드된 CLI가 합성 수집 JSON의 중복과 미지원 item을 요약한다", async () => {
  const before = await readFile(fixture), json = success(run(["--child-turn-summary", fixture]));
  assert.deepEqual(json, {
    format: "agent-slity.child-turn-summary", version: 1, schema_reference: "0.166.0",
    verification_status: "unverified", initialization_error: null, cleanup_status: "unknown",
    collection: { status: "last_page", reason: "last_page", thread_kind: "thread",
      pages: { received: 2, supported: 2, unsupported: 0 }, count_scope: "supported_pages",
      observations: { turns: 2, items: 4,
        turn_statuses: { inProgress: 0, completed: 2, failed: 0, interrupted: 0, unknown: 0 },
        item_kinds: { user_message: 2, agent_message: 0, collab: 0, subagent_activity: 0,
          command_execution: 0, file_change: 0, unsupported: 2 } } },
  });
  assert.deepEqual(await readFile(fixture), before);
});

test("pretty JSON과 추가 원문을 읽되 ID·별칭·원문 없이 출력하고 새 파일을 만들지 않는다", async () => {
  const input = await demo(), collection = input.result.collection;
  collection.source_id = "PRIVATE_ALIAS"; collection.thread.thread_id = "PRIVATE_THREAD";
  collection.thread.source.source_id = "PRIVATE_ALIAS";
  collection.thread.cwd = "PRIVATE_PATH";
  for (const page of collection.pages) {
    page.source_id = "PRIVATE_ALIAS";
    page.turns[0].turn_id = "PRIVATE_TURN";
    Object.assign(page.turns[0].items[0], { turn_id: "PRIVATE_TURN", item_id: "PRIVATE_ITEM",
      message: "PRIVATE_MESSAGE", command: "PRIVATE_COMMAND", started_at_ms: 123456789 });
  }
  const bytes = Buffer.from(JSON.stringify(input, null, 2) + "\r\n");
  await withInput(bytes, async (path, dir) => {
    const result = run(["--child-turn-summary", path]), json = success(result);
    assert.equal(json.collection.observations.turns, 2);
    assert.ok(!result.stdout.includes("PRIVATE_")); assert.ok(!result.stdout.includes("123456789"));
    assert.ok(!result.stdout.includes(path));
    assert.deepEqual(await readFile(path), bytes);
    assert.deepEqual(await readdir(dir), ["PRIVATE_INPUT.json"]);
  });
});

test("초기화 실패·partial과 미관측 null·빈 page의0도 형식이 올바르면 종료코드0으로 요약한다", async () => {
  const input = await demo(), collection = input.result.collection;
  const cases = [
    { result: { initialization_error: "server_error", cleanup_status: "unknown", collection: null }, observations: null },
    { result: { ...input.result, collection: { ...collection, status: "partial", reason: "cancelled", pages: [] } }, observations: null },
    { result: { ...input.result, collection: { ...collection, status: "partial", reason: "invalid_page", pages: [
      { kind: "unsupported", source_id: "synthetic", schema_reference: "0.166.0", reason: "invalid_page" },
    ] } }, observations: null },
    { result: { ...input.result, collection: { ...collection, pages: [{ ...collection.pages[1], turns: [] }] } },
      observations: { turns: 0, items: 0 } },
  ];
  for (const scenario of cases) {
    const bytes = Buffer.from(JSON.stringify({ ...input, result: scenario.result }));
    await withInput(bytes, async path => {
      const json = success(run(["--child-turn-summary", path]));
      assert.equal(json.initialization_error, scenario.result.initialization_error);
      assert.equal(json.cleanup_status, scenario.result.cleanup_status);
      if (scenario.result.collection === null) assert.equal(json.collection, null);
      else {
        assert.equal(json.collection.status, scenario.result.collection.status);
        assert.equal(json.collection.reason, scenario.result.collection.reason);
        if (scenario.observations === null) assert.equal(json.collection.observations, null);
        else {
          assert.equal(json.collection.observations.turns, 0); assert.equal(json.collection.observations.items, 0);
        }
      }
      assert.deepEqual(await readFile(path), bytes);
    });
  }
});

test("빈 파일·BOM·손상 UTF-8·JSONL·형식 오류는 부분 JSON과 원문 없이 실패한다", async () => {
  const input = await demo(), valid = JSON.stringify(input);
  const invalidUtf8 = Buffer.concat([Buffer.from(valid.slice(0, -1) + ',"extra":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
  const cases = ["", " \n", "PRIVATE_INVALID_JSON", "\uFEFF" + valid, valid + "\n" + valid, invalidUtf8,
    JSON.stringify({ ...input, version: 2 }), JSON.stringify({ ...input, verification_status: "verified" }),
    JSON.stringify({ ...input, result: { ...input.result, cleanup_status: "PRIVATE_STATUS" } }),
    JSON.stringify({ format: "agent-slity.normalization-results", version: 1, results: [] })];
  for (const bytes of cases) {
    await withInput(bytes, async (path, dir) => {
      failure(run(["--child-turn-summary", path]));
      assert.deepEqual(await readFile(path), Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
      assert.deepEqual(await readdir(dir), ["PRIVATE_INPUT.json"]);
    });
  }
});

test("없는 파일과 디렉터리는 고정 오류로 실패한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-child-summary-missing-"));
  try {
    failure(run(["--child-turn-summary", join(dir, "PRIVATE_MISSING.json")]));
    failure(run(["--child-turn-summary", dir]));
    assert.deepEqual(await readdir(dir), []);
  } finally { await rmdir(dir); }
});

test("원본 바이트16MiB 경계는 허용하고1byte 초과는 거부한다", async () => {
  const compact = JSON.stringify({ ...await demo(), extra: "가".repeat(1000) });
  const bytes = Buffer.concat([Buffer.from(compact), Buffer.alloc(limit - Buffer.byteLength(compact), 32)]);
  await withInput(bytes, async path => {
    assert.equal(success(run(["--child-turn-summary", path])).collection.observations.items, 4);
    const tooLarge = Buffer.concat([bytes, Buffer.from(" ")]);
    await writeFile(path, tooLarge);
    failure(run(["--child-turn-summary", path]));
    assert.deepEqual(await readFile(path), tooLarge);
  });
});

test("추가 인수와 출력 지정을 거부하고 도움말에 새 범위를 표시한다", async () => {
  await withInput(await readFile(fixture), async (path, dir) => {
    for (const args of [["--child-turn-summary"], ["--child-turn-summary", ""], ["--child-turn-summary", "-h"],
      ["--child-turn-summary", path, "--help"], ["--child-turn-summary", path, "PRIVATE_ALIAS"],
      ["--child-turn-summary", path, "--output", join(dir, "PRIVATE_OUTPUT.json")]]) failure(run(args), 2);
    const help = run(["--help"]);
    assert.equal(help.status, 0); assert.equal(help.stderr, "");
    assert.ok(help.stdout.includes("--child-turn-summary <JSON 파일>"));
    assert.ok(help.stdout.includes("BOM 없음")); assert.ok(help.stdout.includes("16 MiB"));
    assert.deepEqual(await readdir(dir), ["PRIVATE_INPUT.json"]);
  });
});

test("명시한 일반 파일의 symlink는 읽되 변경하지 않는다", { skip: process.platform === "win32" }, async () => {
  await withInput(await readFile(fixture), async (path, dir) => {
    const link = join(dir, "PRIVATE_LINK.json");
    await symlink(path, link);
    try {
      assert.equal(success(run(["--child-turn-summary", link])).collection.observations.turns, 2);
      assert.equal((await lstat(link)).isSymbolicLink(), true);
    } finally { await unlink(link); }
  });
});

test("POSIX FIFO는 open 대기 없이 거부한다", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-child-summary-fifo-")), path = join(dir, "PRIVATE_FIFO");
  execFileSync("mkfifo", [path]);
  try { failure(run(["--child-turn-summary", path])); }
  finally { await unlink(path); await rmdir(dir); }
});

test("Windows 장치·확장 경로·ADS는 읽지 않고 인수 오류로 반환한다", { skip: process.platform !== "win32" }, async () => {
  await withInput(await readFile(fixture), async path => {
    for (const target of ["NUL", "CON.txt", "COM1", "CONIN$", "CONOUT$", "conin$.", "conout$ ",
      "C:CONIN$", "C:CONOUT$", "C:conin$.", "C:conout$ ",
      "\\\\.\\pipe\\PRIVATE_PIPE", "\\\\?\\C:\\PRIVATE\\input.json", path + ":PRIVATE_ADS"]) {
      failure(run(["--child-turn-summary", target]), 2);
    }
  });
});
