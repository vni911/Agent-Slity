import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { collectTurnsFromChildV0166, exportChildTurnCollectionJson, parseChildTurnCollectionJson,
  summarizeChildTurnCollection } from "../../dist/index.js";

for (const scenario of ["complete", "error", "hang"]) {
  test(`별도 합성 자식의 ${scenario} 수집·정리 상태를 JSON으로 내보내고 다시 읽어 요약한다`, { timeout: 15000 }, async () => {
    const child = spawn(process.execPath, [resolve("tests/fixtures/synthetic-turn-server.mjs"), scenario], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
    });
    const closed = new Promise((resolveClose, reject) => { child.once("error", reject); child.once("close", resolveClose); });
    const controller = new AbortController();
    let marker = "";
    if (scenario === "hang") child.stderr.on("data", chunk => {
      marker += chunk.toString("utf8");
      if (marker.includes("SYNTHETIC_TURN_STARTED\n")) controller.abort();
    });
    try {
      const result = await collectTurnsFromChildV0166(child, "child", "synthetic", { signal: controller.signal });
      const json = exportChildTurnCollectionJson(result), parsed = JSON.parse(json);
      assert.deepEqual(parsed.result, result);
      assert.deepEqual(parseChildTurnCollectionJson(json), result);
      assert.equal(exportChildTurnCollectionJson(parseChildTurnCollectionJson(json)), json);
      const summary = summarizeChildTurnCollection(parseChildTurnCollectionJson(json));
      assert.deepEqual(summary, summarizeChildTurnCollection(result));
      assert.equal(summary.format, "agent-slity.child-turn-summary");
      assert.equal(summary.verification_status, "unverified");
      assert.equal(summary.initialization_error, result.initialization_error);
      assert.equal(summary.cleanup_status, result.cleanup_status);
      assert.equal(summary.collection.status, result.collection.status);
      assert.equal(summary.collection.reason, result.collection.reason);
      const count = scenario === "complete" ? 2 : 1;
      assert.deepEqual(summary.collection.pages, { received: count, supported: count, unsupported: 0 });
      assert.equal(summary.collection.observations.turns, count);
      assert.equal(summary.collection.observations.items, count);
      assert.equal(summary.collection.observations.item_kinds.user_message, count);
      assert.equal(summary.collection.observations.turn_statuses.completed, count);
      assert.ok(!JSON.stringify(summary).includes("PRIVATE_"));
      assert.equal(parsed.format, "agent-slity.child-turn-collection");
      assert.equal(parsed.verification_status, "unverified");
      assert.equal(parsed.result.cleanup_status, "exit_observed");
      assert.equal(parsed.result.collection.pages.length, scenario === "complete" ? 2 : 1);
      assert.equal(parsed.result.collection.reason, scenario === "complete" ? "last_page" : scenario === "error" ? "server_error" : "cancelled");
      assert.ok(!json.includes("PRIVATE_"));
    } finally {
      controller.abort();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    }
  });
}
