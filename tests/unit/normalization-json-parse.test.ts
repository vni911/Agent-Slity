import { describe, expect, it } from "vitest";
import { exportNormalizationJson, normalizeCodexExecLine, parseNormalizationJson } from "../../src/index.js";
import { serializeNormalizationSnapshot } from "../../src/core/normalization-json-parse.js";

const event = () => normalizeCodexExecLine({ kind: "record", line: 1,
  value: { type: "turn.completed", thread_id: "thread", usage: { input_tokens: 0, output_tokens: 3 }, text: "PRIVATE_RAW" } }, "synthetic");
const encode = (value: unknown) => JSON.stringify({ format: "agent-slity.normalization-results", version: 1, results: value });
const reject = (json: unknown) => expect(() => parseNormalizationJson(json as string)).toThrowError(/^유효하지 않은 정규화 JSON입니다\.$/);

describe("정규화 JSON의 제한된 검증 파서", () => {
  it("event·diagnostic·unsupported와 null/0·순서·중복을 왕복 보존한다", () => {
    const records = [event(), normalizeCodexExecLine({ kind: "diagnostic", line: 2, code: "invalid_json" }, "synthetic"),
      normalizeCodexExecLine({ kind: "record", line: 3, value: { type: "future", text: "PRIVATE_RAW" } }, "synthetic"), event()];
    const json = exportNormalizationJson(records), parsed = parseNormalizationJson(json);
    expect(parsed).toEqual(records); expect(parsed[0]).not.toBe(records[0]);
    expect(exportNormalizationJson(parsed)).toBe(json);
    expect(serializeNormalizationSnapshot(records).json).toBe(json);
    expect(json).not.toContain("PRIVATE_");
  });

  it("추가 원문과 프로토타입 관련 키를 복사하지 않고 이전 선택 item 필드는 null로 보완한다", () => {
    const record = event();
    if (record.kind !== "event") throw new Error();
    delete record.event.payload.item_type; delete record.event.payload.item_id;
    Object.assign(record, { text: "PRIVATE_EXTRA", constructor: { secret: "PRIVATE_SECRET" } });
    const json = encode([record]), parsed = parseNormalizationJson(json);
    expect(exportNormalizationJson(parsed)).not.toContain("PRIVATE_");
    expect(parsed[0].kind === "event" && parsed[0].event.payload.item_type).toBeNull();
    expect(JSON.parse(json)["results"][0].text).toBe("PRIVATE_EXTRA");
    if (record.kind !== "event") throw new Error();
    record.event.payload.item_type = undefined; record.event.payload.item_id = undefined;
    expect(serializeNormalizationSnapshot([record]).json).toBe(exportNormalizationJson([record]));
  });

  it("getter·iterator·toJSON을 호출하지 않고 내부 serializer가 허용 필드만 처리한다", () => {
    const records = [event()]; let calls = 0;
    Object.defineProperty(records, Symbol.iterator, { value: () => { calls++; throw new Error("PRIVATE_ITERATOR"); } });
    Object.defineProperty(records[0], "toJSON", { value: () => { calls++; throw new Error("PRIVATE_JSON"); } });
    Object.defineProperty(records[0], "extra", { get() { calls++; throw new Error("PRIVATE_GETTER"); } });
    expect(serializeNormalizationSnapshot(records).results).toHaveLength(1);
    Object.defineProperty(records[0], "kind", { get() { calls++; throw new Error("PRIVATE_KIND"); } });
    expect(() => serializeNormalizationSnapshot(records)).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it("잘못된 envelope·배열·버전·필수 값은 고정 오류다", () => {
    for (const value of [undefined, {}, new String("{}"), "", "{}", "[]", "\ufeff{}", "PRIVATE_BAD",
      JSON.stringify({ format: "other", version: 1, results: [] }), JSON.stringify({ format: "agent-slity.normalization-results", version: 2, results: [] }), encode({}), encode([{}])]) reject(value);
    const wrong = event(); if (wrong.kind !== "event") throw new Error();
    wrong.event.payload.usage.input_tokens = -1; reject(encode([wrong]));
    wrong.event.payload.usage.input_tokens = null; wrong.event.verification_status = "confirmed" as "unverified"; reject(encode([wrong]));
  });

  it("10000개 레코드와65536자 경계는 허용하고 초과를 거부한다", () => {
    const record = event(); if (record.kind !== "event") throw new Error();
    expect(parseNormalizationJson(encode(Array(10000).fill(record)))).toHaveLength(10000);
    reject(encode(Array(10001).fill(record)));
    record.event.thread_id = "x".repeat(65536); expect(parseNormalizationJson(encode([record]))).toEqual([record]);
    record.event.thread_id += "x"; reject(encode([record]));
  });

  it("UTF-8 실제16MiB 경계를 처리하고 canonical 출력의 예산 초과도 거부한다", () => {
    const base = encode([event()]), limit = 16 * 1024 * 1024;
    const exact = base + " ".repeat(limit - Buffer.byteLength(base));
    expect(parseNormalizationJson(exact)).toEqual([event()]); reject(exact + " ");
    const record = event(); if (record.kind !== "event") throw new Error();
    record.event.thread_id = "가".repeat(65536);
    expect(() => serializeNormalizationSnapshot(Array(100).fill(record))).toThrow(TypeError);
  });

  it("입력을 바꾸지 않고 출력 변경이나 JSON 중복 키를 출처 인증으로 해석하지 않는다", () => {
    const json = exportNormalizationJson([event()]), first = parseNormalizationJson(json);
    first.length = 0; expect(parseNormalizationJson(json)).toHaveLength(1);
    expect(parseNormalizationJson('{"format":"agent-slity.normalization-results","version":2,"version":1,"results":[]}')).toEqual([]);
  });

  it("기존의 모든 지원 이벤트 유형을 왕복하고 이름으로 ID나 사용량을 추정하지 않는다", () => {
    const records = ["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.completed", "error"].map(type =>
      normalizeCodexExecLine({ kind: "record", line: 1, value: { type, thread_id: "thread", name: "PRIVATE_NAME",
        item: { id: "item", type: "agent_message", text: "PRIVATE_MESSAGE" } } }, "synthetic"));
    const json = exportNormalizationJson(records);
    expect(parseNormalizationJson(json)).toEqual(records);
    expect(serializeNormalizationSnapshot(records).json).toBe(json);
    expect(json).not.toContain("PRIVATE_");
  });
});
