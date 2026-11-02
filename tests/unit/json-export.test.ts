import { describe, expect, it } from "vitest";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportNormalizationJson, normalizeCodexExecLine, readJsonlFile } from "../../src/index.js";
import type { NormalizationResult } from "../../src/index.js";

describe("정규화 결과 JSON 내보내기", () => {
  it("빈 결과도 버전이 지정된 JSON으로 내보낸다", () => {
    expect(JSON.parse(exportNormalizationJson([]))).toEqual({
      format: "agent-slity.normalization-results", version: 1, results: [],
    });
  });

  it("여러 출처의 이벤트·진단·미지원과 중복 및 값을 순서대로 보존한다", () => {
    const completed = normalizeCodexExecLine({
      kind: "record", line: 1, value: { type: "turn.completed", usage: { input_tokens: 0, output_tokens: 3 } },
    }, "source_1");
    const diagnostic = normalizeCodexExecLine({ kind: "diagnostic", line: 2, code: "invalid_json" }, "source_1");
    const unsupported = normalizeCodexExecLine({ kind: "record", line: 1, value: { type: "future.event" } }, "source_2");
    const entries = [completed, diagnostic, completed, unsupported];
    const parsed: unknown = JSON.parse(exportNormalizationJson(entries));
    expect(parsed).toEqual({ format: "agent-slity.normalization-results", version: 1, results: entries });
    expect(completed.kind === "event" && completed.event.payload.usage.input_tokens).toBe(0);
    expect(completed.kind === "event" && completed.event.payload.usage.cached_input_tokens).toBeNull();
  });

  it("추가된 임의 원문 속성을 모든 수준에서 내보내지 않는다", () => {
    const result = normalizeCodexExecLine({ kind: "record", line: 1, value: { type: "thread.started" } });
    if (result.kind !== "event") throw new Error("이벤트가 아닙니다.");
    Object.assign(result, { extra: "PRIVATE_RECORD" });
    Object.assign(result.event, { message: "PRIVATE_MESSAGE" });
    Object.assign(result.event.source, { path: "PRIVATE_PATH" });
    Object.assign(result.event.payload, { command: "PRIVATE_COMMAND" });
    Object.assign(result.event.payload.usage, { extra: "PRIVATE_USAGE" });
    expect(exportNormalizationJson([result])).not.toContain("PRIVATE_");
  });

  it("항목 유형을 보존하고 이전 결과의 누락 필드는 null로 내보낸다", () => {
    const result = normalizeCodexExecLine({
      kind: "record", line: 1, value: { type: "item.started", item: { id: "synthetic-item", type: "command_execution" } },
    });
    if (result.kind !== "event") throw new Error("이벤트가 아닙니다.");
    const parsed = JSON.parse(exportNormalizationJson([result])) as { results: NormalizationResult[] };
    const first = parsed.results[0];
    expect(first?.kind === "event" && first.event.payload.item_type).toBe("command_execution");
    expect(first?.kind === "event" && first.event.payload.item_id).toBe("synthetic-item");
    delete result.event.payload.item_type;
    delete result.event.payload.item_id;
    const old = JSON.parse(exportNormalizationJson([result])) as { results: NormalizationResult[] };
    expect(old.results[0]?.kind === "event" && old.results[0].event.payload.item_type).toBeNull();
    expect(old.results[0]?.kind === "event" && old.results[0].event.payload.item_id).toBeNull();
    Object.assign(result.event.payload, { item_type: "PRIVATE_TYPE" });
    expect(() => exportNormalizationJson([result])).toThrow(TypeError);
  });

  it("항목 이벤트가 아닌 결과의 ID와 잘못된 ID는 거부한다", () => {
    const result = normalizeCodexExecLine({ kind: "record", line: 1, value: { type: "turn.started" } });
    if (result.kind !== "event") throw new Error("이벤트가 아닙니다.");
    result.event.payload.item_id = "fake-id";
    expect(() => exportNormalizationJson([result])).toThrow(TypeError);
    result.event.event_type = "item.started";
    result.event.payload.item_id = " ";
    expect(() => exportNormalizationJson([result])).toThrow(TypeError);
  });

  it("잘못된 값과 배열 구멍을 원문 없는 오류로 거부한다", () => {
    const invalid = normalizeCodexExecLine({ kind: "record", line: 1, value: { type: "thread.started" } });
    if (invalid.kind !== "event") throw new Error("이벤트가 아닙니다.");
    Object.assign(invalid.event.payload.usage, { input_tokens: { text: "PRIVATE_NESTED" } });
    expect(() => exportNormalizationJson([invalid])).toThrowError(/^유효하지 않은 정규화 결과입니다\.$/);
    expect(() => exportNormalizationJson(Array<NormalizationResult>(1))).toThrow(TypeError);
  });

  it("허용되지 않는 별칭·유형과 getter 예외를 원문 없이 거부한다", () => {
    const make = () => {
      const result = normalizeCodexExecLine({ kind: "record", line: 1, value: { type: "thread.started" } });
      if (result.kind !== "event") throw new Error("이벤트가 아닙니다.");
      return result;
    };
    const badSource = make();
    badSource.event.source.source_id = "private/path";
    const badType = make();
    badType.event.event_type = "PRIVATE_SYNTHETIC_TYPE";
    const getter = make();
    Object.defineProperty(getter.event, "thread_id", { get() { throw new Error("PRIVATE_SYNTHETIC_GETTER"); } });
    for (const input of [badSource, badType, getter]) {
      expect(() => exportNormalizationJson([input])).toThrowError(/^유효하지 않은 정규화 결과입니다\.$/);
    }
  });

  it("합성 JSONL을 읽어 정규화한 결과를 내보낸다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-slity-export-"));
    const path = join(dir, "synthetic.jsonl");
    await writeFile(path, '{"type":"thread.started","thread_id":"synthetic"}\n{\n');
    try {
      const entries: NormalizationResult[] = [];
      for await (const line of readJsonlFile(path)) entries.push(normalizeCodexExecLine(line, "sample"));
      const parsed = JSON.parse(exportNormalizationJson(entries)) as { results: NormalizationResult[] };
      expect(parsed.results).toEqual(entries);
      expect(parsed.results.map((entry) => entry.kind)).toEqual(["event", "diagnostic"]);
    } finally {
      await unlink(path);
      await rmdir(dir);
    }
  });
});
