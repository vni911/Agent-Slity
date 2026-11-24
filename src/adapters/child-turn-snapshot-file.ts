import type { ChildTurnCollectionResult } from "../core/child-thread-collection.js";
import { exportChildTurnCollectionJson } from "../core/child-turn-json-export.js";
import { invalidSnapshotWriteResult, publishSnapshotJson } from "./snapshot-file-writer.js";
import type { SnapshotWriteResult } from "./snapshot-file-writer.js";
import { isSafeSnapshotPath } from "./snapshot-path.js";
export { isSafeSnapshotPath } from "./snapshot-path.js";
export interface ChildTurnSnapshotWriteResult {
  publication_status: SnapshotWriteResult["publication_status"];
  temp_cleanup_status: SnapshotWriteResult["temp_cleanup_status"];
  error: SnapshotWriteResult["error"];
  cleanup_errors: SnapshotWriteResult["cleanup_errors"];
}

/** 신뢰하는 기존 로컬 부모에 새 turn 스냅샷을 명시적으로 저장한다. */
export async function saveChildTurnCollectionJson(input: ChildTurnCollectionResult, path: string): Promise<ChildTurnSnapshotWriteResult> {
  let json: string;
  try {
    if (!isSafeSnapshotPath(path)) return invalidSnapshotWriteResult();
    json = exportChildTurnCollectionJson(input);
  } catch { return invalidSnapshotWriteResult(); }
  return publishSnapshotJson(json, path);
}
