import { createInterface } from "node:readline";
import process from "node:process";

const scenario = process.argv[2];
let page = 0;
let phase = "initialize";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  const data = `${JSON.stringify(message)}\n`;
  const cut = Math.floor(data.length / 2);
  process.stdout.write(data.slice(0, cut));
  setTimeout(() => process.stdout.write(data.slice(cut)), 5);
}

lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (phase === "initialize" && request.method === "initialize" && request.id === 1) {
    phase = "initialized";
    if (scenario === "init_error") send({ id: request.id, error: { message: "PRIVATE_INIT_ERROR" } });
    else send({ id: request.id, result: {} });
  } else if (phase === "initialized" && request.method === "initialized" && request.id === undefined) {
    phase = "thread";
  } else if (phase === "thread" && request.method === "thread/read" && request.params?.threadId === "child" && request.params?.includeTurns === false) {
    phase = "items";
    if (scenario === "exit") process.exit(3);
    else if (scenario === "hang") process.stderr.write("SYNTHETIC_READ_STARTED\n");
    else send({ id: request.id, result: { thread: { id: "child", parentThreadId: "parent", cwd: "PRIVATE_PATH" } } });
  } else if (phase === "items" && request.method === "thread/items/list" && request.params?.threadId === "child" &&
    request.params?.limit === 100 && (page === 0 ? request.params?.cursor === undefined : request.params?.cursor === "PRIVATE_CURSOR")) {
    page++;
    if (scenario === "error" && page === 2) {
      send({ id: request.id, error: { code: -32000, message: "PRIVATE_SERVER_ERROR" } });
      return;
    }
    const nextCursor = page === 1 || scenario === "repeat" ? "PRIVATE_CURSOR" : null;
    send({ id: request.id, result: { data: [{ turnId: "turn", item: { type: "collabAgentToolCall", id: "item",
      senderThreadId: "parent", receiverThreadIds: ["child"], tool: "spawnAgent", status: "completed", prompt: "PRIVATE_PROMPT" } },
    { item: { type: "future", text: "PRIVATE_MESSAGE" } }], nextCursor } });
  } else {
    process.stderr.write("INVALID_SYNTHETIC_REQUEST\n");
    lines.close();
    process.stdin.destroy();
    process.exitCode = 2;
  }
});
