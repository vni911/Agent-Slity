import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const cli = resolve("dist/cli/main.js");
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10000 });

test("두 합성 JSONL의 위치·진단·중복 후보를 읽기 전용으로 출력한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-evidence-"));
  const threads = join(dir, "threads.jsonl");
  const pages = join(dir, "pages.jsonl");
  const threadInput = '{"thread":{"id":"child","secret":"PRIVATE_THREAD"}}\n{\n{"thread":{"id":"child"}}\n';
  const pageInput = '{\n{"data":[{"item":{"type":"collabAgentToolCall","senderThreadId":"parent","receiverThreadIds":["child","child"],"prompt":"PRIVATE_PROMPT"}}],"nextCursor":null}\n';
  await writeFile(threads, threadInput);
  await writeFile(pages, pageInput);
  try {
    const result = run(["--thread-evidence-jsonl", threads, pages, "sample"]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.ok(!result.stdout.includes("PRIVATE_"));
    const output = JSON.parse(result.stdout);
    assert.equal(output.format, "agent-slity.thread-evidence-candidates");
    assert.equal(output.verification_status, "unverified");
    assert.deepEqual(output.thread_records.map((record) => record.line), [1, 3]);
    assert.deepEqual(output.page_records.map((record) => record.line), [2]);
    assert.deepEqual(output.diagnostics, [{ input: "threads", line: 2, code: "invalid_json" }, { input: "pages", line: 1, code: "invalid_json" }]);
    assert.deepEqual(output.groups[0].thread_indices, [0, 1]);
    assert.deepEqual(output.groups[0].item_references.map((ref) => ref.receiver_index), [0, 1]);
    assert.equal(await readFile(threads, "utf8"), threadInput);
    assert.equal(await readFile(pages, "utf8"), pageInput);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("인수·별칭·두 번째 파일 오류는 부분 결과와 경로를 노출하지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-evidence-"));
  const threads = join(dir, "threads.jsonl");
  const missing = join(dir, "PRIVATE_MISSING.jsonl");
  await writeFile(threads, '{"thread":{"id":"PRIVATE_ID"}}\n');
  try {
    for (const [args, status] of [
      [["--thread-evidence-jsonl", threads], 2],
      [["--thread-evidence-jsonl", threads, missing, "bad/alias"], 1],
      [["--thread-evidence-jsonl", threads, missing, "sample"], 1],
    ]) {
      const result = run(args);
      assert.equal(result.status, status);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes("PRIVATE_"));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("미지원 레코드와 다중 페이지의 인덱스 및 빈 입력을 구분한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-evidence-"));
  const threads = join(dir, "threads.jsonl");
  const pages = join(dir, "pages.jsonl");
  await writeFile(threads, '{}\n{\n{"thread":{"id":"child"}}\n');
  await writeFile(pages, '{}\n{\n{"data":[{"item":{"type":"subAgentActivity","agentThreadId":"child"}}],"nextCursor":null}\n');
  try {
    let result = run(["--thread-evidence-jsonl", threads, pages, "sample"]);
    assert.equal(result.status, 0);
    let output = JSON.parse(result.stdout);
    assert.equal(output.thread_records[0].result.kind, "unsupported");
    assert.equal(output.page_records[0].result.kind, "unsupported");
    assert.deepEqual(output.groups[0].thread_indices, [1]);
    assert.equal(output.groups[0].item_references[0].page_index, 1);
    assert.equal(output.thread_records[1].line, 3);
    assert.equal(output.page_records[1].line, 3);
    await writeFile(threads, "");
    await writeFile(pages, "");
    result = run(["--thread-evidence-jsonl", threads, pages, "sample"]);
    assert.equal(result.status, 0);
    output = JSON.parse(result.stdout);
    assert.deepEqual([output.thread_records, output.page_records, output.diagnostics, output.groups], [[], [], [], []]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("어느 입력이든 크기 제한 초과 시 부분 출력 없이 실패한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-evidence-"));
  const threads = join(dir, "threads.jsonl");
  const pages = join(dir, "pages.jsonl");
  const oversized = Buffer.alloc(16 * 1024 * 1024 + 1, 0x20);
  try {
    await writeFile(threads, "");
    await writeFile(pages, oversized.subarray(0, oversized.length - 1));
    const boundary = run(["--thread-evidence-jsonl", threads, pages, "sample"]);
    assert.equal(boundary.status, 0);
    assert.equal(JSON.parse(boundary.stdout).diagnostics[0].code, "line_too_long");
    for (const oversizedFile of [threads, pages]) {
      await writeFile(threads, '{"thread":{"id":"PRIVATE_ID"}}\n');
      await writeFile(pages, '{"data":[],"nextCursor":null}\n');
      await writeFile(oversizedFile, oversized);
      const result = run(["--thread-evidence-jsonl", threads, pages, "sample"]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes("PRIVATE_"));
      assert.ok(!result.stderr.includes(dir));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
