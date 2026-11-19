import { createInterface } from "node:readline";

// 연결마다 초기화와 첫 페이지부터의 요청 순서를 검사하는 합성 서버다.
const mode = process.argv[2];
if (!["disconnect", "complete"].includes(mode)) process.exit(2);
let phase = "initialize", page = 0;
const later = { id: "later", status: "completed", itemsView: "full", items: [
  { type: "userMessage", id: "message", startedAtMs: 20, content: [{ text: "PRIVATE_MESSAGE" }] },
  { type: "commandExecution", id: "command", status: "completed", startedAtMs: 0, completedAtMs: 0,
    exitCode: 0, durationMs: 0, command: "PRIVATE_COMMAND", cwd: "PRIVATE_PATH" },
] };
const earlier = { id: "earlier", status: "interrupted", itemsView: "full", items: [
  { type: "userMessage", id: "earlier-message", startedAtMs: 0, content: [{ text: "PRIVATE_EARLIER_MESSAGE" }] },
  { type: "futureItem", text: "PRIVATE_UNKNOWN" },
] };
const send = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + "\n");
createInterface({ input: process.stdin }).on("line", line => {
  const r = JSON.parse(line);
  if (phase === "initialize" && r.method === "initialize") {
    phase = "initialized";
    send(r.id, {});
  } else if (phase === "initialized" && r.method === "initialized") phase = "thread";
  else if (phase === "thread" && r.method === "thread/read" && r.params?.threadId === "child") {
    phase = "turns";
    send(r.id, { thread: { id: "child", cwd: "PRIVATE_PATH" } });
  } else if (phase === "turns" && page < 2 && r.method === "thread/turns/list" &&
    r.params?.threadId === "child" && r.params?.itemsView === "full" &&
    r.params?.sortDirection === "asc" && r.params?.limit === 100 &&
    (page === 0 ? r.params?.cursor === undefined : r.params?.cursor === "PRIVATE_CURSOR")) {
    page++;
    // 첫 페이지를 소비한 뒤 두 번째 요청에서 실제 파이프 EOF를 발생시킨다.
    if (mode === "disconnect" && page === 2) { process.exitCode = 0; process.stdin.destroy(); return; }
    send(r.id, { data: page === 1 ? [later, earlier] : [later], nextCursor: page === 1 ? "PRIVATE_CURSOR" : null });
  } else { process.stderr.write("INVALID_SYNTHETIC_REQUEST\n"); process.exit(2); }
});
