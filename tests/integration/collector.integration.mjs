import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { CodexReadTransport, collectCodexThreadPagesV0166 } from "../../dist/index.js";

const serverPath = resolve("tests/fixtures/synthetic-app-server.mjs");
const serverEnv = process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};

async function collect(scenario) {
  const child = spawn(process.execPath, [serverPath, scenario], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: serverEnv });
  const closed = new Promise((resolveClose, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  child.stderr.resume();
  const transport = new CodexReadTransport(child.stdout, child.stdin);
  try {
    await transport.initialize();
    const result = await collectCodexThreadPagesV0166(transport, "child", "sample");
    assert.equal(result.verification_status, "unverified");
    assert.equal(result.thread.thread_id, "child");
    assert.equal(result.pages.length, 2);
    assert.equal(result.pages[0].items[0].item_id, "item");
    assert.equal(result.pages[0].items[1].kind, "unsupported");
    assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
    return result;
  } finally {
    transport.close();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}

test("별도 합성 서버 프로세스의 분할 응답과 다중 페이지를 정규화한다", { timeout: 15000 }, async () => {
  const result = await collect("complete");
  assert.equal(result.status, "last_page");
  assert.equal(result.reason, "last_page");
  assert.equal(result.pages[1].items[0].item_id, "item");
});

test("반복 커서는 원문 없이 미완료로 표시한다", { timeout: 15000 }, async () => {
  const result = await collect("repeat");
  assert.equal(result.status, "partial");
  assert.equal(result.reason, "cursor_repeated");
});

test("서버 오류는 이미 수집한 페이지와 함께 원문 없이 남긴다", { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, [serverPath, "error"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: serverEnv });
  const closed = new Promise((resolveClose, reject) => {
    child.once("error", reject);
    child.once("close", resolveClose);
  });
  child.stderr.resume();
  const transport = new CodexReadTransport(child.stdout, child.stdin);
  try {
    await transport.initialize();
    const result = await collectCodexThreadPagesV0166(transport, "child", "sample");
    assert.equal(result.status, "partial");
    assert.equal(result.reason, "server_error");
    assert.equal(result.pages.length, 1);
    assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
  } finally {
    transport.close();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
});

test("합성 서버는 잘못된 페이지 커서를 거부한다", { timeout: 15000 }, () => {
  const input = [
    { id: 1, method: "initialize" }, { method: "initialized" },
    { id: 2, method: "thread/read", params: { threadId: "child", includeTurns: false } },
    { id: 3, method: "thread/items/list", params: { threadId: "child", limit: 100 } },
    { id: 4, method: "thread/items/list", params: { threadId: "child", limit: 100, cursor: "wrong" } },
  ].map((value) => JSON.stringify(value)).join("\n") + "\n";
  const result = spawnSync(process.execPath, [serverPath, "complete"], { input, encoding: "utf8", timeout: 10000, windowsHide: true, env: serverEnv });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.equal(result.stderr, "INVALID_SYNTHETIC_REQUEST\n");
});
