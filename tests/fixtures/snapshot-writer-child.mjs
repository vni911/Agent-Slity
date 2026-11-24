import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const [mode, target] = process.argv.slice(2);
const originalOpen = fs.open, originalLink = fs.link;
const checkpoint = async name => {
  const proceed = new Promise(resolve => process.once("message", resolve));
  process.send({ checkpoint: name });
  await proceed;
};
if (mode === "mid_write") fs.open = async (...args) => {
  const handle = await originalOpen(...args), write = handle.write.bind(handle);
  handle.write = async (buffer, offset, length, position) => {
    const result = await write(buffer, offset, Math.max(1, Math.floor(length / 2)), position);
    await checkpoint("mid_write");
    return result;
  };
  return handle;
};
fs.link = async (...args) => {
  if (mode === "race" || mode === "before_publish") await checkpoint("before_publish");
  const result = await originalLink(...args);
  if (mode === "after_publish") await checkpoint("after_publish");
  return result;
};
syncBuiltinESMExports();
try {
  const { saveChildTurnCollectionJson } = await import("../../dist/index.js");
  const input = { initialization_error: "timeout", cleanup_status: "unknown", collection: null };
  const result = await saveChildTurnCollectionJson(input, target);
  process.send({ result }, () => process.disconnect());
} catch { process.stderr.write("SNAPSHOT_FIXTURE_FAILED\n"); process.exitCode = 2; process.disconnect(); }
