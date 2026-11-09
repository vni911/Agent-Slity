import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { CodexReadTransport, collectCodexTurnPagesV0166 } from "../../dist/index.js";

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
