let input = "";
for await (const chunk of process.stdin) input += chunk;
const mode = process.argv[2] ?? "success";
if (mode === "hang") { process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); }
else if (mode === "overflow") process.stdout.write("x".repeat(1024 * 1024 + 1));
else if (mode === "utf8") process.stdout.write(Buffer.from([0xff]));
else if (mode === "invalid") process.stdout.write("PRIVATE_INVALID_JSON\n");
else if (mode === "unknown") process.stdout.write('{"type":"PRIVATE_NEW_PROTOCOL"}\n');
else if (mode === "failed") { process.stderr.write("PRIVATE_STDERR"); process.exitCode = 7; }
else {
  const lines = [
    { type: "thread.started", thread_id: "PRIVATE_THREAD" },
    { type: "turn.started" },
    { type: "item.completed", item: { type: "agent_message", text: input.includes("HANDOFF_SENTINEL") ? "전달 확인" : "합성 응답 한글" } },
    { type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 3 } },
  ].map(value => JSON.stringify(value)).join("\n");
  const bytes = Buffer.from(lines, "utf8");
  for (let index = 0; index < bytes.length; index += 7) process.stdout.write(bytes.subarray(index, index + 7));
}
