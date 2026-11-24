import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const exec = promisify(execFile);
async function cli(args) {
  try { return { ...await exec(process.execPath, [resolve("dist/cli/main.js"), ...args], { encoding: "utf8", maxBuffer: 1024 * 1024 }), code: 0 }; }
  catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
}
const request = () => ({ format: "agent-slity.team-request", version: 1, selection: { mode: "solo" },
  constraints: { max_agents: 3 }, task: { independent_research: false, independent_review: false } });
async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-team-plan-"));
  t.after(async () => { for (const name of await readdir(dir)) await unlink(join(dir, name)); await rmdir(dir); });
  return { dir, path: join(dir, "request.json") };
}
test("실제 CLI의 JSON/text는 명시 선택과 추천을 구분하고 입력을 변경하지 않는다", async t => {
  const { dir, path } = await workspace(t);
  const input = JSON.parse(await readFile("tests/fixtures/team-request-demo.json", "utf8"));
  input.raw = "PRIVATE_TEXT\u001b[31m"; input.credentials = "PRIVATE_CREDENTIAL";
  await writeFile(path, JSON.stringify(input)); const before = await readFile(path);
  const json = await cli(["--team-plan", path]), text = await cli(["--team-plan-text", path]);
  assert.equal(json.code, 0); assert.equal(text.code, 0); assert.equal(json.stderr, ""); assert.equal(text.stderr, "");
  const plan = JSON.parse(json.stdout);
  assert.equal(plan.selection.mode, "small"); assert.equal(plan.selection.agent_count, 2);
  assert.equal(plan.recommendation.candidate.mode, "full"); assert.equal(plan.recommendation.candidate.agent_count, 3);
  assert.equal(plan.execution_status, "not_started"); assert.equal(plan.unknown_metrics.efficiency, null);
  assert.ok(text.stdout.includes("명시적 선택: small · 2명")); assert.ok(text.stdout.includes("추천 후보: full · 3명"));
  for (const output of [json.stdout, text.stdout]) { assert.ok(!output.includes("PRIVATE_")); assert.ok(!output.includes("\u001b")); }
  assert.deepEqual(await readFile(path), before); assert.deepEqual(await readdir(dir), ["request.json"]);
});
test("추천 unknown·예산 차단도 유효한 출력이며 manual 순서를 보존한다", async t => {
  const { path } = await workspace(t);
  for (const expected of ["suggested", "unknown", "budget_blocked"]) {
    const input = request(); input.task.independent_research = true;
    input.task.independent_review = expected === "unknown" ? null : true;
    input.constraints.max_agents = expected === "budget_blocked" ? 1 : 3;
    await writeFile(path, JSON.stringify(input));
    const result = await cli(["--team-plan", path]); assert.equal(result.code, 0);
    const plan = JSON.parse(result.stdout); assert.equal(plan.recommendation.status, expected);
    assert.equal(plan.selection.mode, "solo"); assert.equal(plan.execution_status, "not_started");
    const text = await cli(["--team-plan-text", path]); assert.equal(text.code, 0); assert.ok(text.stdout.includes("시작하지 않음"));
  }
  const input = request(); input.selection = { mode: "manual", roles: ["reviewer", "implementer"] };
  await writeFile(path, JSON.stringify(input));
  const result = await cli(["--team-plan", path]); assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout).selection.roles, ["reviewer", "implementer"]);
});
test("64KiB 원본 경계와 UTF-8/BOM/형식 오류는 고정 오류·빈 stdout으로 처리한다", async t => {
  const { path } = await workspace(t), json = JSON.stringify({ ...request(), extra: "한글" });
  const exact = json + " ".repeat(64 * 1024 - Buffer.byteLength(json));
  await writeFile(path, exact);
  for (const mode of ["--team-plan", "--team-plan-text"]) assert.equal((await cli([mode, path])).code, 0);
  for (const bytes of [Buffer.from(exact + " "), Buffer.from("\uFEFF" + json), Buffer.from([0xff]), Buffer.from("{"),
    Buffer.from('{"format":"PRIVATE_SECRET"}'), Buffer.from(JSON.stringify({ ...request(), selection: { mode: "full" }, constraints: { max_agents: 1 } }))]) {
    await writeFile(path, bytes);
    for (const mode of ["--team-plan", "--team-plan-text"]) {
      const result = await cli([mode, path]); assert.equal(result.code, 1); assert.equal(result.stdout, "");
      assert.equal(result.stderr, "팀 구성 계획을 만들 수 없습니다. 파일·UTF-8·형식·크기를 확인하세요.\n");
    }
    assert.deepEqual(await readFile(path), bytes);
  }
});
test("잘못된 인수와 없는 파일/디렉터리에서 경로를 출력하지 않는다", async t => {
  const { dir } = await workspace(t);
  for (const mode of ["--team-plan", "--team-plan-text"]) {
    for (const args of [[mode], [mode, "-h"], [mode, "PRIVATE_PATH", "extra"]]) {
      const result = await cli(args); assert.equal(result.code, 2); assert.equal(result.stdout, ""); assert.ok(!result.stderr.includes("PRIVATE_"));
    }
    for (const path of [dir, join(dir, "PRIVATE_MISSING")]) {
      const result = await cli([mode, path]); assert.equal(result.code, 1); assert.equal(result.stdout, ""); assert.ok(!result.stderr.includes("PRIVATE_"));
    }
  }
  assert.deepEqual(await readdir(dir), []);
});
