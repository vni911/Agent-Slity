import type { NormalizationResult } from "./events.js";
import { exportNormalizationJson } from "./json-export.js";

export const MAX_NORMALIZATION_JSON_BYTES = 16 * 1024 * 1024;
const MAX_RECORDS = 10000, MAX_STRING = 65536;
const prefix = '{"format":"agent-slity.normalization-results","version":1,"results":[';
function invalid(): never { throw new TypeError("유효하지 않은 정규화 JSON입니다."); }
function own(value: unknown, key: string, optional = false): unknown {
  if (typeof value !== "object" || value === null) invalid();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor && optional) return null;
  if (!descriptor || !("value" in descriptor)) invalid();
  return optional && descriptor.value === undefined ? null : descriptor.value;
}
function scalar(value: unknown): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string" && value.length <= MAX_STRING) return value;
  return invalid();
}
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const copy: Record<string, unknown> = {};
  for (const key of keys) copy[key] = scalar(own(value, key));
  return copy;
}
const sourceKeys = ["format", "line", "source_id", "format_version", "collected_at"];
function copyRecord(input: unknown): object {
  const kind = own(input, "kind");
  if (kind === "diagnostic" || kind === "unsupported") return {
    kind, source: fields(own(input, "source"), sourceKeys),
    ...fields(input, [kind === "diagnostic" ? "code" : "reason"]),
  };
  if (kind !== "event") invalid();
  const event = own(input, "event"), payload = own(event, "payload");
  return { kind, event: {
    ...fields(event, ["run_id", "task_id", "thread_id", "parent_thread_id", "agent_id", "event_id", "event_type", "timestamp", "verification_status"]),
    source: fields(own(event, "source"), sourceKeys), payload: {
      item_type: scalar(own(payload, "item_type", true)), item_id: scalar(own(payload, "item_id", true)),
      usage: fields(own(payload, "usage"), ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens"]),
    },
  } };
}

/** 새 snapshot용 내부 검증·직렬화이며 기존 exporter의 허용 범위는 바꾸지 않는다. */
export function serializeNormalizationSnapshot(input: unknown): { json: string; results: NormalizationResult[] } {
  try {
    if (!Array.isArray(input)) invalid();
    const count = own(input, "length");
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > MAX_RECORDS) invalid();
    const results: NormalizationResult[] = [], parts: string[] = [];
    let bytes = Buffer.byteLength(prefix) + 2;
    for (let index = 0; index < count; index++) {
      const safe = copyRecord(own(input, String(index)));
      // own-data 복사본만 기존 exporter로 검증하고 입력 hook은 전달하지 않는다.
      const checked = JSON.parse(exportNormalizationJson([safe as NormalizationResult])) as { results: NormalizationResult[] };
      const result = checked.results[0], part = JSON.stringify(result);
      bytes += Buffer.byteLength(part) + (index === 0 ? 0 : 1);
      if (bytes > MAX_NORMALIZATION_JSON_BYTES) invalid();
      results.push(result); parts.push(part);
    }
    return { json: prefix + parts.join(",") + "]}", results };
  } catch { return invalid(); }
}

/** primitive JSON 문자열을 제한 안에서 읽고 허용한 정규화 관측만 새로 반환한다. */
export function parseNormalizationJson(json: string): NormalizationResult[] {
  try {
    if (typeof json !== "string" || Buffer.byteLength(json, "utf8") > MAX_NORMALIZATION_JSON_BYTES) invalid();
    const value: unknown = JSON.parse(json);
    if (own(value, "format") !== "agent-slity.normalization-results" || own(value, "version") !== 1) invalid();
    return serializeNormalizationSnapshot(own(value, "results")).results;
  } catch { return invalid(); }
}
