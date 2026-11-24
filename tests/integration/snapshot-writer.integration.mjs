import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rmdir, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { exportChildTurnCollectionJson, parseChildTurnCollectionJson, saveChildTurnCollectionJson } from "../../dist/index.js";

const init = { initialization_error: "timeout", cleanup_status: "unknown", collection: null };
const fixture = resolve("tests/fixtures/child-turn-collection-demo.json");
const env = process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-snapshot-"));
  t.after(async () => {
    for (const entry of await readdir(dir)) {
      const path = join(dir, entry), info = await lstat(path);
      if (info.isDirectory()) await rmdir(path); else await unlink(path);
    }
    await rmdir(dir);
  });
  return dir;
}
function start(t, mode, target) {
  const child = spawn(process.execPath, [resolve("tests/fixtures/snapshot-writer-child.mjs"), mode, target], {
    stdio: ["ignore", "ignore", "pipe", "ipc"], env, windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", bytes => { stderr += bytes.toString(); });
  const ready = new Promise(resolveReady => child.on("message", msg => { if (msg.checkpoint) resolveReady(msg.checkpoint); }));
  const result = new Promise(resolveResult => child.on("message", msg => { if (msg.result) resolveResult(msg.result); }));
  const closed = new Promise(resolveClose => child.once("close", (code, signal) => resolveClose({ code, signal, stderr })));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await closed; });
  return { child, ready, result, closed };
}
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } };

test("실제 파일에 수집 상태·중복·null/0을 저장하고 원본/원문을 보존 경계대로 처리한다", async t => {
  const dir = await directory(t), before = await readFile(fixture);
  let type = "unknown";
  try { const fs = await statfs(dir); if (fs.type) type = `0x${fs.type.toString(16)}`; } catch { /* 미관측은 unknown */ }
  t.diagnostic(JSON.stringify({ platform: process.platform, node: process.version, fs_type: type }));
  const complete = parseChildTurnCollectionJson(before.toString());
  const partial = structuredClone(complete);
  partial.collection.status = "partial"; partial.collection.reason = "cancelled";
  for (const [index, input] of [complete, partial, init].entries()) {
    Object.assign(input, { private: "PRIVATE_RAW" });
    const path = join(dir, `${index}.json`), bytes = Buffer.from(exportChildTurnCollectionJson(input));
    assert.deepEqual(await saveChildTurnCollectionJson(input, path), { publication_status: "published", temp_cleanup_status: "complete", error: null, cleanup_errors: [] });
    assert.deepEqual(await readFile(path), bytes);
    assert.deepEqual(parseChildTurnCollectionJson((await readFile(path)).toString()), JSON.parse(bytes.toString()).result);
    assert.ok(!bytes.includes(Buffer.from("PRIVATE_")));
    if (process.platform !== "win32") assert.equal((await lstat(path)).mode & 0o777, 0o600);
  }
  assert.deepEqual(await readFile(fixture), before);
  assert.deepEqual((await readdir(dir)).sort(), ["0.json", "1.json", "2.json"]);
});

test("기존 파일·디렉터리·원본은 덮어쓰지 않고 별도 파일의 같은 내용은 보존한다", async t => {
  const dir = await directory(t), old = join(dir, "old.json"), folder = join(dir, "folder");
  await writeFile(old, "UNCHANGED"); await mkdir(folder);
  assert.equal((await saveChildTurnCollectionJson(init, old)).error, "already_exists");
  assert.equal((await saveChildTurnCollectionJson(init, folder)).error, "invalid_input");
  assert.equal((await saveChildTurnCollectionJson(init, fixture)).error, "already_exists");
  assert.equal(await readFile(old, "utf8"), "UNCHANGED");
  if (process.platform !== "win32") {
    const alias = join(dir, "alias.json"); await symlink(old, alias);
    assert.equal((await saveChildTurnCollectionJson(init, alias)).error, "already_exists");
    assert.equal(await readFile(old, "utf8"), "UNCHANGED");
  }
  if (process.platform === "win32") for (const path of ["NUL", "CONIN$", "C:CONOUT$", `${old}:stream`, "\\\\?\\C:\\x", "\\\\host\\share\\x"]) {
    assert.equal((await saveChildTurnCollectionJson(init, path)).error, "invalid_input");
  }
  for (const name of ["a.json", "b.json"]) assert.equal((await saveChildTurnCollectionJson(init, join(dir, name))).publication_status, "published");
  assert.equal(await readFile(join(dir, "a.json"), "utf8"), await readFile(join(dir, "b.json"), "utf8"));
  assert.ok(!(await readdir(dir)).some(name => name.startsWith(".agent-slity-")));
});

test("정확히16MiB인 JSON은 LF 없이 저장해 기존 CLI로 읽고1byte 초과는 생성 전에 거부한다", { timeout: 30000 }, async t => {
  const dir = await directory(t), input = parseChildTurnCollectionJson(await readFile(fixture, "utf8"));
  const page = input.collection.pages[0], item = { ...page.turns[0].items[0], item_id: "x".repeat(256), turn_id: "x".repeat(256) };
  const turns = Array.from({ length: 20000 }, (_, i) => ({ index: i % 10000, turn_id: "x".repeat(256), status: "completed", items_view: "full", items: [item] }));
  const pages = [{ ...page, next_page: "available", turns: [] }, { ...page, next_page: "none", turns: [] }];
  input.collection.pages = pages;
  const set = count => { pages[0].turns = turns.slice(0, Math.min(10000, count)); pages[1].turns = turns.slice(10000, count); };
  const envelope = { format: "agent-slity.child-turn-collection", version: 1, schema_reference: "0.166.0", verification_status: "unverified", result: input };
  const limit = 16 * 1024 * 1024;
  let low = 0, high = 20000;
  while (low < high) { const mid = Math.ceil((low + high) / 2); set(mid); if (Buffer.byteLength(JSON.stringify(envelope)) <= limit) low = mid; else high = mid - 1; }
  set(low);
  const padding = limit - Buffer.byteLength(JSON.stringify(envelope));
  input.collection.thread.thread_id += "x".repeat(padding);
  const encoded = exportChildTurnCollectionJson(input);
  assert.equal(Buffer.byteLength(encoded), limit);
  const target = join(dir, "boundary.json");
  assert.equal((await saveChildTurnCollectionJson(input, target)).publication_status, "published");
  assert.deepEqual(await readFile(target), Buffer.from(encoded));
  const cli = spawnSync(process.execPath, [resolve("dist/cli/main.js"), "--child-turn-summary", target], { env, windowsHide: true, encoding: "utf8", timeout: 15000 });
  assert.equal(cli.status, 0); assert.equal(cli.stderr, "");
  assert.equal(JSON.parse(cli.stdout).collection.observations.turns, low);
  input.collection.thread.thread_id += "x";
  const rejected = join(dir, "over.json");
  assert.equal((await saveChildTurnCollectionJson(input, rejected)).error, "invalid_input");
  assert.equal(await exists(rejected), false);
});

test("두 프로세스가 같은 최종 이름으로 경쟁해도 하나만 완성된 파일을 게시한다", { timeout: 15000 }, async t => {
  const dir = await directory(t), target = join(dir, "race.json");
  const first = start(t, "race", target), second = start(t, "race", target);
  assert.deepEqual(await Promise.all([first.ready, second.ready]), ["before_publish", "before_publish"]);
  first.child.send("publish"); second.child.send("publish");
  const results = await Promise.all([first.result, second.result]);
  assert.deepEqual(results.map(r => r.publication_status).sort(), ["not_published", "published"]);
  assert.deepEqual(results.map(r => r.error).sort(), ["already_exists", null].sort());
  assert.ok(results.every(r => r.temp_cleanup_status === "complete"));
  for (const closed of await Promise.all([first.closed, second.closed])) assert.deepEqual(closed, { code: 0, signal: null, stderr: "" });
  assert.equal(await readFile(target, "utf8"), exportChildTurnCollectionJson(init));
  assert.deepEqual(await readdir(dir), ["race.json"]);
  const separate = ["a.json", "b.json"].map(name => start(t, "race", join(dir, name)));
  await Promise.all(separate.map(worker => worker.ready));
  for (const worker of separate) worker.child.send("publish");
  assert.ok((await Promise.all(separate.map(worker => worker.result))).every(result => result.publication_status === "published"));
  for (const worker of separate) assert.deepEqual(await worker.closed, { code: 0, signal: null, stderr: "" });
  assert.deepEqual((await readdir(dir)).sort(), ["a.json", "b.json", "race.json"]);
});

for (const mode of ["mid_write", "before_publish", "after_publish"]) {
  test(`합성 프로세스의 ${mode} 종료에서 최종 파일과 남은 임시 파일을 구분한다`, { timeout: 15000 }, async t => {
    const dir = await directory(t), target = join(dir, "snapshot.json"), worker = start(t, mode, target);
    assert.equal(await worker.ready, mode);
    worker.child.kill("SIGKILL"); await worker.closed;
    const names = await readdir(dir), temp = names.find(name => name.startsWith(".agent-slity-"));
    assert.ok(temp);
    const bytes = await readFile(join(dir, temp)), full = Buffer.from(exportChildTurnCollectionJson(init));
    if (mode === "mid_write") assert.ok(bytes.length > 0 && bytes.length < full.length);
    else assert.deepEqual(bytes, full);
    assert.equal(await exists(target), mode === "after_publish");
    if (mode === "after_publish") assert.deepEqual(await readFile(target), full);
    // 강제 종료된 호출은 반환값이 없다. 파일 존재로 성공 응답을 지어내지 않는다.
  });
}
