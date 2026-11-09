// 합성 전용 격리 컨테이너에서만 수동 실행한다. 개인 HOME을 연결하지 않는다.
import fs from "node:fs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { CodexReadTransport, collectCodexTurnPagesV0166 } from "../../dist/index.js";

assert.equal(process.getuid(), 1000);
assert.equal(fs.existsSync("/var/run/docker.sock"), false);
const base = "/tmp/synthetic/.codex", id = "01900000-0000-7000-8000-000000000001";
const timestamp = "2026-11-09T00:00:00.000Z", dir = base + "/sessions/2026/11/09";
fs.mkdirSync(dir, { recursive: true });
const records = [{ timestamp, type: "session_meta", payload: { id, timestamp, cwd: "/tmp/synthetic",
  originator: "codex_cli_rs", cli_version: "0.166.0", source: "cli", model_provider: "openai" } }];
for (let i = 0; i < 101; i++) {
  const turn = "turn-" + i;
  const add = payload => records.push({ timestamp, type: "event_msg", payload });
  add({ type: "task_started", turn_id: turn, started_at: 1794182400 + i, model_context_window: 258400 });
  for (let j = 0; j < 2; j++) add({ type: "user_message", message: "PRIVATE_SYNTHETIC_" + i + "_" + j,
    images: null, local_images: [], text_elements: [] });
  add({ type: "task_complete", turn_id: turn, last_agent_message: null, completed_at: 1794182501 + i, duration_ms: 1000 });
}
const fixture = dir + "/rollout-2026-11-09T00-00-00-" + id + ".jsonl";
const original = records.map(x => JSON.stringify(x)).join("\n") + "\n";
fs.writeFileSync(fixture, original);
const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"],
  env: { PATH: process.env.PATH, HOME: "/tmp/synthetic", CODEX_HOME: base } });
const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
child.stderr.resume();
child.stdin.on("error", () => {});
const requests = [], tap = new PassThrough();
tap.on("data", chunk => requests.push(JSON.parse(chunk.toString("utf8"))));
tap.pipe(child.stdin);
const transport = new CodexReadTransport(child.stdout, tap);
try {
  await transport.initialize();
  const result = await collectCodexTurnPagesV0166(transport, id, "synthetic");
  assert.equal(result.status, "last_page");
  assert.equal(result.verification_status, "unverified");
  assert.deepEqual(result.pages.map(p => p.turns.length), [100, 1]);
  assert.deepEqual(result.pages.flatMap(p => p.turns.map(t => t.turn_id)), Array.from({ length: 101 }, (_, i) => "turn-" + i));
  assert.equal(result.pages.flatMap(p => p.turns.flatMap(t => t.items)).length, 202);
  assert.ok(result.pages.every(p => p.turns.every(t => t.items.every(item => item.kind === "user_message"))));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
  assert.deepEqual(requests.map(r => r.method), ["initialize", "initialized", "thread/read", "thread/turns/list", "thread/turns/list"]);
  assert.equal(typeof requests[4].params.cursor, "string");
  assert.equal(fs.readFileSync(fixture, "utf8"), original);
  console.log(JSON.stringify({ status: result.status, turn_pages: [100, 1], messages: 202, verification_status: result.verification_status,
    source_unchanged: true, methods: requests.map(r => r.method) }));
} finally {
  transport.close(); child.stdin.destroy();
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await closed;
}
