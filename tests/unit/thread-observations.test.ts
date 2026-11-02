import { describe, expect, it } from "vitest";
import { groupThreadObservations, normalizeCodexExecLine } from "../../src/index.js";

function record(value: unknown, line: number, alias?: string) {
  return normalizeCodexExecLine({ kind: "record", line, value }, alias);
}

describe("스레드 관측 근거 후보", () => {
  it("명시적 ID와 출처가 같으면 관측 순서·중복과 항목 근거를 보존한다", () => {
    const item = record({ type: "item.completed", thread_id: "thread-a", item: {
      id: "item-1", type: "agent_message", text: "PRIVATE_MESSAGE",
    } }, 8, "source_a");
    const start = record({ type: "thread.started", thread_id: "thread-a" }, 2, "source_a");
    const input = [item, start, item];
    const before = JSON.stringify(input);
    const result = groupThreadObservations(input);
    expect(result).toEqual({
      verification_status: "unverified", groups: [{ source_id: "source_a", thread_id: "thread-a", observations: [
        { index: 0, line: 8, event_type: "item.completed", item_id: "item-1", item_type: "agent_message" },
        { index: 1, line: 2, event_type: "thread.started", item_id: null, item_type: null },
        { index: 2, line: 8, event_type: "item.completed", item_id: "item-1", item_type: "agent_message" },
      ] }], unassociated: [], diagnostics: [], unsupported: [],
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_MESSAGE");
  });

  it("다른 출처·ID는 합치지 않으며 ID 없는 후속 이벤트에 전파하지 않는다", () => {
    const start = record({ type: "thread.started", thread_id: "same" }, 1, "source_a");
    const missing = record({ type: "item.started", item: { id: "item-1", type: "command_execution" } }, 2, "source_a");
    const otherSource = record({ type: "thread.started", thread_id: "same" }, 1, "source_b");
    const otherThread = record({ type: "thread.started", thread_id: "different" }, 3, "source_a");
    const result = groupThreadObservations([start, missing, otherSource, otherThread]);
    expect(result.groups.map((g) => [g.source_id, g.thread_id])).toEqual([
      ["source_a", "same"], ["source_b", "same"], ["source_a", "different"],
    ]);
    expect(result.unassociated).toEqual([{ index: 1, line: 2, event_type: "item.started", item_id: "item-1",
      item_type: "command_execution", source_id: "source_a", thread_id: null, reason: "missing_thread_id" }]);
  });

  it("ID 또는 출처 누락과 손상·미지원 위치를 보존한다", () => {
    const missingSource = record({ type: "thread.started", thread_id: "known" }, 1);
    const missingBoth = record({ type: "turn.started" }, 2);
    const diagnostic = normalizeCodexExecLine({ kind: "diagnostic", line: 3, code: "invalid_json" }, "a");
    const unsupported = record({ type: "future.event", text: "PRIVATE_TEXT" }, 3, "b");
    const noSourceDiagnostic = normalizeCodexExecLine({ kind: "diagnostic", line: 3, code: "invalid_utf8" });
    const result = groupThreadObservations([missingSource, missingBoth, diagnostic, unsupported, noSourceDiagnostic]);
    expect(result.groups).toEqual([]);
    expect(result.unassociated.map((x) => [x.index, x.line, x.thread_id, x.reason])).toEqual([
      [0, 1, "known", "missing_source"], [1, 2, null, "missing_both"],
    ]);
    expect(result.diagnostics).toEqual([
      { index: 2, line: 3, source_id: "a", code: "invalid_json" },
      { index: 4, line: 3, source_id: null, code: "invalid_utf8" },
    ]);
    expect(result.unsupported).toEqual([{ index: 3, line: 3, source_id: "b", reason: "unsupported_event_type" }]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TEXT");
  });

  it("잘못된 결과를 원문 없는 오류로 거부한다", () => {
    const invalid = record({ type: "thread.started", thread_id: "thread" }, 1, "source");
    if (invalid.kind !== "event") throw new Error("이벤트가 아닙니다.");
    Object.assign(invalid.event, { thread_id: { value: "PRIVATE_ID" } });
    expect(() => groupThreadObservations([invalid])).toThrowError(/^유효하지 않은 정규화 결과입니다\.$/);
    expect(groupThreadObservations([])).toEqual({ verification_status: "unverified", groups: [], unassociated: [], diagnostics: [], unsupported: [] });
  });
});
