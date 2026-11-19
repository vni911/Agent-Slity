import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { collectTurnsFromChildV0166, exportChildTurnCollectionJson, parseChildTurnCollectionJson,
  summarizeChildTurnCollection } from "../../dist/index.js";

test("연결 종료 후 새 연결의 처음부터 재수집은 기존 부분 결과·역순·중복·null/0을 보존한다", { timeout: 15000 }, async t => {
  const start = mode => {
    const child = spawn(process.execPath, [resolve("tests/fixtures/synthetic-reconnect-server.mjs"), mode], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
    });
    const closed = new Promise(resolveClose => child.once("close", (code, signal) => resolveClose({ code, signal })));
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    });
    return { child, closed };
  };
  const first = start("disconnect");
  const partial = await collectTurnsFromChildV0166(first.child, "child", "synthetic");
  assert.deepEqual(await first.closed, { code: 0, signal: null });
  assert.equal(partial.initialization_error, null);
  assert.equal(partial.cleanup_status, "exit_observed");
  assert.equal(partial.collection.status, "partial");
  assert.equal(partial.collection.reason, "transport_error");
  assert.equal(partial.collection.pages.length, 1);
  const previous = structuredClone(partial);
  const saved = exportChildTurnCollectionJson(partial);

  // 자동 재연결이 아니다. 호출자가 새 프로세스를 생성하고 새 수집을 시작한다.
  const second = start("complete");
  assert.notEqual(second.child, first.child);
  const complete = await collectTurnsFromChildV0166(second.child, "child", "synthetic");
  await second.closed;
  assert.equal(complete.initialization_error, null);
  assert.equal(complete.cleanup_status, "exit_observed");
  assert.equal(complete.collection.status, "last_page");
  assert.equal(complete.collection.reason, "last_page");
  assert.equal(complete.collection.pages.length, 2);
  assert.deepEqual(partial, previous);
  assert.equal(exportChildTurnCollectionJson(partial), saved);
  assert.deepEqual(parseChildTurnCollectionJson(saved), previous);
  assert.deepEqual(complete.collection.pages[0], partial.collection.pages[0]);
  const turns = complete.collection.pages.flatMap(page => page.turns);
  assert.deepEqual(turns.map(turn => [turn.index, turn.turn_id, turn.status]), [
    [0, "later", "completed"], [1, "earlier", "interrupted"], [0, "later", "completed"],
  ]);
  assert.deepEqual(turns[0], turns[2]);
  assert.deepEqual(turns.map(turn => turn.items[0].started_at_ms), [20, 0, 20]);
  assert.deepEqual(turns[0].items, [
    { index: 0, kind: "user_message", turn_id: "later", item_id: "message", started_at_ms: 20, completed_at_ms: null },
    { index: 1, kind: "command_execution", turn_id: "later", item_id: "command", started_at_ms: 0, completed_at_ms: 0,
      status: "completed", exit_code: 0, duration_ms: 0 },
  ]);
  assert.deepEqual(turns[1].items, [
    { index: 0, kind: "user_message", turn_id: "earlier", item_id: "earlier-message", started_at_ms: 0, completed_at_ms: null },
    { index: 1, kind: "unsupported" },
  ]);
  const summary = summarizeChildTurnCollection(complete);
  assert.equal(summary.verification_status, "unverified");
  assert.deepEqual(summary.collection.pages, { received: 2, supported: 2, unsupported: 0 });
  assert.deepEqual(summary.collection.observations, {
    turns: 3, items: 6,
    turn_statuses: { inProgress: 0, completed: 2, failed: 0, interrupted: 1, unknown: 0 },
    item_kinds: { user_message: 3, agent_message: 0, collab: 0, subagent_activity: 0,
      command_execution: 2, file_change: 0, unsupported: 1 },
  });
  const oldSummary = summarizeChildTurnCollection(parseChildTurnCollectionJson(saved));
  assert.equal(oldSummary.collection.status, "partial");
  assert.equal(oldSummary.collection.reason, "transport_error");
  assert.equal(oldSummary.collection.observations.turns, 2);
  assert.equal(oldSummary.collection.observations.items, 4);
  assert.deepEqual(parseChildTurnCollectionJson(exportChildTurnCollectionJson(complete)), complete);
  assert.ok(!JSON.stringify([partial, complete, summary, oldSummary]).includes("PRIVATE_"));
});
