import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { CodexReadTransport, collectCodexTurnPagesV0166, collectTurnsFromChildV0166, collectFromChildV0166 } from "../../dist/index.js";

for (const scenario of ["complete", "error"]) {
  test(`합성 turn 서버의 분할 응답과 ${scenario === "complete" ? "마지막 페이지" : "후속 페이지 오류"}를 처리한다`, { timeout: 15000 }, async () => {
    const child = spawn(process.execPath, [resolve("tests/fixtures/synthetic-turn-server.mjs"), scenario], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
    });
    const closed = new Promise((resolveClose, reject) => { child.once("error", reject); child.once("close", resolveClose); });
    child.stderr.resume();
    const transport = new CodexReadTransport(child.stdout, child.stdin);
    try {
      await transport.initialize();
      const result = await collectCodexTurnPagesV0166(transport, "child", "synthetic");
      assert.equal(result.reason, scenario === "complete" ? "last_page" : "server_error");
      assert.equal(result.status, scenario === "complete" ? "last_page" : "partial");
      assert.equal(result.pages.length, scenario === "complete" ? 2 : 1);
      assert.equal(result.pages[0].turns[0].items[0].kind, "user_message");
      assert.equal(result.pages[0].turns[0].items[0].item_id, "item");
      assert.equal(result.verification_status, "unverified");
      assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
    } finally {
      transport.close();
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    }
  });
}

const server = resolve("tests/fixtures/synthetic-turn-server.mjs");
const env = process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
const start = scenario => spawn(process.execPath, [server, scenario], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env });

test("이미 close된 실제 spawn 실패 객체를 두 자식 API가 종료 관측으로 오판하지 않는다", { timeout: 15000 }, async () => {
  for (const collect of [collectFromChildV0166, collectTurnsFromChildV0166]) {
    const child = spawn(resolve("tests/fixtures/PRIVATE_MISSING_BINARY"), [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env });
    child.once("error", () => {});
    await new Promise(resolveClose => child.once("close", resolveClose));
    const result = await collect(child, "child", "synthetic", { cleanupTimeoutMs: 1, forceKillOnTimeout: true });
    assert.equal(result.initialization_error, "transport_error");
    assert.equal(result.cleanup_status, "unknown");
    assert.equal(child.listenerCount("error"), 0);
    assert.equal(child.listenerCount("close"), 0);
  }
});

for (const forceKillOnTimeout of [false, true]) {
  test(`SIGTERM 무시 자식의 명시적 강제 종료 ${forceKillOnTimeout ? "허용" : "미허용"}을 구분한다`,
    { timeout: 15000, skip: process.platform === "win32" }, async () => {
      const child = start("ignore_term");
      const closed = new Promise((resolveClose, reject) => { child.once("error", reject); child.once("close", resolveClose); });
      try {
        const result = await collectTurnsFromChildV0166(child, "child", "synthetic", { cleanupTimeoutMs: 100, forceKillOnTimeout });
        assert.equal(result.collection.status, "last_page");
        assert.equal(result.cleanup_status, forceKillOnTimeout ? "exit_observed" : "unknown");
        assert.equal(child.signalCode, forceKillOnTimeout ? "SIGKILL" : null);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await closed;
      }
    });
}

test("turn 자식 수집은 정상과 후속 오류에서 결과를 보존하고 직접 자식을 정리한다", { timeout: 15000 }, async () => {
  for (const scenario of ["complete", "error"]) {
    const result = await collectTurnsFromChildV0166(start(scenario), "child", "synthetic");
    assert.equal(result.initialization_error, null);
    assert.equal(result.cleanup_status, "exit_observed");
    assert.equal(result.collection.reason, scenario === "complete" ? "last_page" : "server_error");
    assert.equal(result.collection.pages.length, scenario === "complete" ? 2 : 1);
    assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
  }
});

test("초기화 오류와 유효하지 않은 입력은 원문 없이 직접 자식을 정리한다", { timeout: 15000 }, async () => {
  for (const [scenario, thread, expected] of [["init_error", "child", "server_error"], ["complete", "", "invalid_input"]]) {
    const result = await collectTurnsFromChildV0166(start(scenario), thread, "synthetic");
    assert.equal(result.initialization_error, expected);
    assert.equal(result.collection, null);
    assert.equal(result.cleanup_status, "exit_observed");
    assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
  }
});

test("후속 turn 요청 취소 시 이전 페이지와 종료 관측을 보존한다", { timeout: 15000 }, async () => {
  const child = start("hang");
  const marker = new Promise(resolveMarker => child.stderr.once("data", data => resolveMarker(data.toString("utf8"))));
  const controller = new AbortController();
  const pending = collectTurnsFromChildV0166(child, "child", "synthetic", { signal: controller.signal });
  let timer;
  try {
    const text = await Promise.race([marker, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("합성 요청 대기 시간 초과")), 5000); })]);
    assert.equal(text, "SYNTHETIC_TURN_STARTED\n");
    controller.abort();
    const result = await pending;
    assert.equal(result.collection.reason, "cancelled");
    assert.equal(result.collection.pages.length, 1);
    assert.equal(result.cleanup_status, "exit_observed");
  } finally { clearTimeout(timer); controller.abort(); await pending; }
});

test("turn 자식의 spawn 실패와 이미 종료된 경우를 구분한다", { timeout: 15000 }, async () => {
  const missing = spawn(resolve("tests/fixtures/PRIVATE_MISSING_BINARY"), [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env });
  const failed = await collectTurnsFromChildV0166(missing, "child", "synthetic");
  assert.equal(failed.initialization_error, "transport_error");
  assert.equal(failed.cleanup_status, "unknown");
  assert.ok(!JSON.stringify(failed).includes("PRIVATE_"));
  const exited = spawn(process.execPath, ["-e", ""], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env });
  exited.stdout.resume(); exited.stderr.resume();
  await new Promise((resolveClose, reject) => { exited.once("error", reject); exited.once("close", resolveClose); });
  const result = await collectTurnsFromChildV0166(exited, "child", "synthetic");
  assert.equal(result.initialization_error, "transport_error");
  assert.equal(result.cleanup_status, "exit_observed");
});
