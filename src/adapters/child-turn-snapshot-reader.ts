import { resolve } from "node:path";
import type { ChildTurnCollectionResult } from "../core/child-thread-collection.js";
import { parseChildTurnCollectionJson } from "../core/child-turn-json-parse.js";
import { MAX_CHILD_TURN_JSON_BYTES } from "../core/child-turn-json-schema.js";
import { isSafeSnapshotPath } from "./snapshot-path.js";
import { readUtf8SnapshotFile } from "./snapshot-file-reader.js";

export class ChildTurnSnapshotReadError extends Error {
  constructor(readonly code: "invalid_input" | "read_failed" | "invalid_json") {
    super("turn 수집 JSON 파일을 읽을 수 없습니다.");
    this.name = "ChildTurnSnapshotReadError";
  }
}

/** 지정된 일반 파일 하나를 제한된 UTF-8로 읽고 기존 turn parser에 연결한다. 쓰기는 하지 않는다. */
export async function readChildTurnCollectionJson(path: string): Promise<ChildTurnCollectionResult> {
  let target: string;
  try {
    if (!isSafeSnapshotPath(path)) throw new TypeError();
    target = resolve(path);
  } catch { throw new ChildTurnSnapshotReadError("invalid_input"); }
  let json: string;
  try { ({ json } = await readUtf8SnapshotFile(target, MAX_CHILD_TURN_JSON_BYTES)); }
  catch { throw new ChildTurnSnapshotReadError("read_failed"); }
  try { return parseChildTurnCollectionJson(json); }
  catch { throw new ChildTurnSnapshotReadError("invalid_json"); }
}
