import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { MAX_CHILD_TURN_JSON_BYTES } from "../core/child-turn-json-schema.js";

/** CLI와 라이브러리가 공유하는 내부 byte reader. 경로와 공개 오류는 호출자가 처리한다. */
export async function readUtf8SnapshotFile(path: string, maxBytes: number): Promise<{ json: string; bytes: number }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_CHILD_TURN_JSON_BYTES) throw new TypeError();
  const before = await stat(path);
  if (!before.isFile() || before.size > maxBytes) throw new TypeError();
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > maxBytes) throw new TypeError();
    const buffer = Buffer.alloc(64 * 1024), pieces: Buffer[] = [];
    let total = 0;
    for (;;) {
      const length = Math.min(buffer.length, maxBytes - total + 1);
      const { bytesRead } = await file.read(buffer, 0, length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new TypeError();
      pieces.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(pieces, total));
    return { json, bytes: total };
  } finally { await file.close(); }
}
