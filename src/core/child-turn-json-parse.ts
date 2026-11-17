import type { ChildTurnCollectionResult } from "./child-thread-collection.js";
import { copyChildTurnCollectionResult, MAX_CHILD_TURN_JSON_BYTES } from "./child-turn-json-schema.js";

/** version 1 문자열의 허용 관측을 새 객체로 읽는다. 파일과 서버에는 접근하지 않는다. */
export function parseChildTurnCollectionJson(json: string): ChildTurnCollectionResult {
  try {
    if (typeof json !== "string" || Buffer.byteLength(json, "utf8") > MAX_CHILD_TURN_JSON_BYTES) throw new TypeError();
    const value: unknown = JSON.parse(json);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError();
    const read = (key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
    if (read("format") !== "agent-slity.child-turn-collection" || read("version") !== 1 ||
        read("schema_reference") !== "0.166.0" || read("verification_status") !== "unverified") throw new TypeError();
    return copyChildTurnCollectionResult(read("result"));
  } catch { throw new TypeError("유효하지 않은 turn 수집 JSON입니다."); }
}
