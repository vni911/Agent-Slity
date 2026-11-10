import { createInterface } from "node:readline";
import process from "node:process";
const scenario = process.argv[2];
if (scenario === "ignore_term") { process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); }
let phase = "initialize", page = 0;
function send(message) {
  const line = JSON.stringify(message) + "\n", cut = Math.floor(line.length / 2);
  process.stdout.write(line.slice(0, cut));
  setTimeout(() => process.stdout.write(line.slice(cut)), 5);
}
createInterface({ input: process.stdin }).on("line", line => {
  const r = JSON.parse(line);
  if (phase === "initialize" && r.method === "initialize") {
    if (scenario === "init_error") { send({ id: r.id, error: { message: "PRIVATE_INIT" } }); return; }
    phase = "initialized"; send({ id: r.id, result: {} });
  } else if (phase === "initialized" && r.method === "initialized") phase = "thread";
  else if (phase === "thread" && r.method === "thread/read" && r.params?.threadId === "child") {
    phase = "turns"; send({ id: r.id, result: { thread: { id: "child", cwd: "PRIVATE_PATH" } } });
  } else if (phase === "turns" && r.method === "thread/turns/list" && r.params?.threadId === "child" &&
    r.params?.itemsView === "full" && r.params?.sortDirection === "asc" && r.params?.limit === 100 &&
    (page === 0 ? r.params?.cursor === undefined : r.params?.cursor === "PRIVATE_CURSOR")) {
    page++;
    if (scenario === "hang" && page === 2) { process.stderr.write("SYNTHETIC_TURN_STARTED\n"); return; }
    if (page === 2 && scenario === "error") send({ id: r.id, error: { message: "PRIVATE_SERVER_ERROR" } });
    else send({ id: r.id, result: { data: [{ id: "turn", status: "completed", itemsView: "full",
      items: [{ type: "userMessage", id: "item", content: [{ type: "text", text: "PRIVATE_MESSAGE" }] }] }],
    nextCursor: page === 1 ? "PRIVATE_CURSOR" : null } });
  } else { process.stderr.write("INVALID_SYNTHETIC_REQUEST\n"); process.exit(2); }
});
