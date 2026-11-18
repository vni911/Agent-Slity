import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { parseChildTurnCollectionJson } from "../core/child-turn-json-parse.js";
import { MAX_CHILD_TURN_JSON_BYTES } from "../core/child-turn-json-schema.js";
import { summarizeChildTurnCollection } from "../core/child-turn-summary.js";
import type { ChildTurnCollectionSummary } from "../core/child-turn-summary.js";

/** CLI 내부 전용이다. 원본 전체 바이트를 제한하고 열린 파일은 모든 경로에서 정리한다. */
export async function readChildTurnSummary(path: string): Promise<ChildTurnCollectionSummary> {
  const before = await stat(path);
  if (!before.isFile() || before.size > MAX_CHILD_TURN_JSON_BYTES) throw new TypeError();
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > MAX_CHILD_TURN_JSON_BYTES) throw new TypeError();
    const buffer = Buffer.alloc(64 * 1024), pieces: Buffer[] = [];
    let total = 0;
    for (;;) {
      const length = Math.min(buffer.length, MAX_CHILD_TURN_JSON_BYTES - total + 1);
      const { bytesRead } = await file.read(buffer, 0, length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_CHILD_TURN_JSON_BYTES) throw new TypeError();
      pieces.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    // BOM을 남겨 파서가 거부하게 한다. 잘못된 UTF-8은 대체 문자로 바꾸지 않는다.
    const json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(pieces, total));
    return summarizeChildTurnCollection(parseChildTurnCollectionJson(json));
  } finally { await file.close(); }
}
