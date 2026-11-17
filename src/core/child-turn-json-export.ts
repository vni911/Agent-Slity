import type { ChildTurnCollectionResult } from "./child-thread-collection.js";
import { copyChildTurnCollectionResult, MAX_CHILD_TURN_JSON_BYTES } from "./child-turn-json-schema.js";

/** 허용한 관측만 JSON으로 복사한다. 파일과 서버에는 접근하지 않는다. */
export function exportChildTurnCollectionJson(input: ChildTurnCollectionResult): string {
  try {
    const result = copyChildTurnCollectionResult(input);
    const json = JSON.stringify({ format: "agent-slity.child-turn-collection", version: 1,
      schema_reference: "0.166.0", verification_status: "unverified", result });
    if (Buffer.byteLength(json, "utf8") > MAX_CHILD_TURN_JSON_BYTES) throw new TypeError();
    return json;
  } catch { throw new TypeError("유효하지 않은 turn 수집 결과입니다."); }
}
