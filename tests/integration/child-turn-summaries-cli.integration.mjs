import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const cli = resolve("dist/cli/main.js"), fixture = resolve("tests/fixtures/child-turn-collection-demo.json");
const limit = 16 * 1024 * 1024;
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10000 });
const demo = async () => JSON.parse(await readFile(fixture, "utf8"));
async function withInputs(contents, action) {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-child-batch-"));
  const paths = contents.map((_, index) => join(dir, "PRIVATE_" + index + ".json"));
  for (let i = 0; i < paths.length; i++) await writeFile(paths[i], contents[i]);
  try { return await action(paths, dir); }
  finally { for (const path of paths) await unlink(path); await rmdir(dir); }
}
function success(result) {
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, "");
  assert.ok(result.stdout.endsWith("\n")); assert.equal(result.stdout.trim().split("\n").length, 1);
  assert.ok(!result.stdout.includes("PRIVATE_"));
  return JSON.parse(result.stdout);
}
function failure(result, code = 1) {
  assert.equal(result.error, undefined); assert.equal(result.status, code); assert.equal(result.stdout, "");
  assert.equal(result.stderr, code === 2 ? "사용법: --child-turn-summaries <JSON 파일> [JSON 파일 ...] (최대8개)\n" :
    "수집 JSON 묶음을 요약할 수 없습니다. 파일·UTF-8·형식·크기·전체 한도를 확인하세요.\n");
}
async function unchanged(paths, contents, dir) {
  for (let i = 0; i < paths.length; i++) {
    assert.deepEqual(await readFile(paths[i]), Buffer.isBuffer(contents[i]) ? contents[i] : Buffer.from(contents[i]));
  }
  assert.deepEqual((await readdir(dir)).sort(), paths.map(path => path.split(/[\\/]/).at(-1)).sort());
}

test("여러 파일의 상태·null/0·중복을 입력 인덱스별로 보존하며 합산하지 않는다", async () => {
  const normal = await demo(), collection = normal.result.collection;
  normal.private = "PRIVATE_MESSAGE"; collection.source_id = "PRIVATE_ALIAS";
  collection.thread.thread_id = "PRIVATE_THREAD";
  const init = { ...normal, result: { initialization_error: "server_error", cleanup_status: "unknown", collection: null } };
  const partial = { ...normal, result: { ...normal.result, collection: { ...collection, status: "partial", reason: "cancelled", pages: [] } } };
  const empty = { ...normal, result: { ...normal.result, cleanup_status: "exit_observed",
    collection: { ...collection, pages: [{ ...collection.pages[1], turns: [] }] } } };
  const contents = [normal, init, partial, empty].map(value => JSON.stringify(value, null, 2) + "\r\n");
  await withInputs(contents, async (paths, dir) => {
    const batch = success(run(["--child-turn-summaries", ...paths, paths[0]]));
    assert.deepEqual(Object.keys(batch).sort(), ["format", "version", "schema_reference", "verification_status", "count_semantics", "inputs"].sort());
    assert.equal(batch.format, "agent-slity.child-turn-summaries"); assert.equal(batch.version, 1);
    assert.equal(batch.schema_reference, "0.166.0"); assert.equal(batch.verification_status, "unverified");
    assert.equal(batch.count_semantics, "per_input_including_duplicates");
    assert.deepEqual(batch.inputs.map(x => x.input_index), [0, 1, 2, 3, 4]);
    assert.deepEqual(batch.inputs[0].summary, batch.inputs[4].summary);
    assert.equal(batch.inputs[0].summary.collection.observations.turns, 2);
    assert.equal(batch.inputs[0].summary.collection.observations.items, 4);
    assert.equal(batch.inputs[1].summary.initialization_error, "server_error");
    assert.equal(batch.inputs[1].summary.collection, null);
    assert.equal(batch.inputs[2].summary.collection.reason, "cancelled");
    assert.equal(batch.inputs[2].summary.collection.observations, null);
    assert.equal(batch.inputs[3].summary.cleanup_status, "exit_observed");
    assert.equal(batch.inputs[3].summary.collection.observations.turns, 0);
    assert.equal(batch.inputs[3].summary.collection.observations.items, 0);
    assert.deepEqual(success(run(["--child-turn-summary", paths[0]])), batch.inputs[0].summary);
    await unchanged(paths, contents, dir);
  });
});

test("1개와8개 경계를 허용하고9개는 부분 출력 없이 인수 오류로 거부한다", async () => {
  const contents = [await readFile(fixture)];
  await withInputs(contents, async (paths, dir) => {
    for (const count of [1, 8]) {
      const batch = success(run(["--child-turn-summaries", ...Array(count).fill(paths[0])]));
      assert.equal(batch.inputs.length, count);
      assert.deepEqual(batch.inputs.map(x => x.input_index), Array.from({ length: count }, (_, i) => i));
    }
    failure(run(["--child-turn-summaries", ...Array(9).fill(paths[0])]), 2);
    await unchanged(paths, contents, dir);
  });
});

test("뒤쪽 파일의 인코딩·형식·읽기 실패 때 앞 요약도 출력하지 않는다", async () => {
  const valid = await readFile(fixture);
  await withInputs([valid, "PRIVATE_INVALID"], async (paths, dir) => {
    for (const bytes of ["PRIVATE_INVALID_JSON", "\uFEFF" + valid.toString("utf8"), Buffer.from([0xff]),
      JSON.stringify({ ...await demo(), version: 2 }), ""]) {
      await writeFile(paths[1], bytes);
      failure(run(["--child-turn-summaries", ...paths]));
      assert.deepEqual(await readFile(paths[0]), valid);
      assert.deepEqual(await readFile(paths[1]), Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    }
    failure(run(["--child-turn-summaries", paths[0], join(dir, "PRIVATE_MISSING.json")]));
    failure(run(["--child-turn-summaries", paths[0], dir]));
    assert.equal((await readdir(dir)).length, 2);
  });
});

test("반복 지정한 입력도 전체64MiB에 다시 세고 경계 이후의 파일은 전체 실패로 처리한다", async () => {
  const small = await readFile(fixture), large = Buffer.concat([small, Buffer.alloc(limit - small.length, 32)]);
  await withInputs([large, small], async (paths, dir) => {
    const full = Array(4).fill(paths[0]);
    assert.equal(success(run(["--child-turn-summaries", ...full])).inputs.length, 4);
    failure(run(["--child-turn-summaries", ...full, paths[1]]));
    await unchanged(paths, [large, small], dir);
  });
});

test("전체 예산이 남아도 뒤쪽 파일16MiB+1byte는 거부하고 단일 명령의 한도도 유지한다", async () => {
  const small = await readFile(fixture), large = Buffer.concat([small, Buffer.alloc(limit - small.length + 1, 32)]);
  await withInputs([small, large], async (paths, dir) => {
    failure(run(["--child-turn-summaries", ...paths]));
    const single = run(["--child-turn-summary", paths[1]]);
    assert.equal(single.error, undefined); assert.equal(single.status, 1); assert.equal(single.stdout, "");
    assert.equal(single.stderr, "수집 JSON을 요약할 수 없습니다. 파일·UTF-8·형식·크기를 확인하세요.\n");
    await unchanged(paths, [small, large], dir);
  });
});

test("전체 인수를 먼저 검사하고 도움말에 개수·전체 한도를 표시한다", async () => {
  const contents = [await readFile(fixture)];
  await withInputs(contents, async (paths, dir) => {
    failure(run(["--child-turn-summaries"]), 2);
    for (const tail of ["", "-h", "--help", "--output"]) failure(run(["--child-turn-summaries", paths[0], tail]), 2);
    if (process.platform === "win32") {
      for (const path of ["NUL", "CONIN$", "C:CONOUT$", "C:conin$.", paths[0] + ":PRIVATE_ADS", "\\\\.\\pipe\\PRIVATE_PIPE"]) {
        failure(run(["--child-turn-summaries", paths[0], path]), 2);
      }
    }
    const help = run(["--help"]);
    assert.equal(help.status, 0); assert.equal(help.stderr, "");
    assert.ok(help.stdout.includes("--child-turn-summaries")); assert.ok(help.stdout.includes("1~8개"));
    assert.ok(help.stdout.includes("전체64MiB"));
    await unchanged(paths, contents, dir);
  });
});
