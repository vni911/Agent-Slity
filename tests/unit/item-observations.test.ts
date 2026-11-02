import { describe, expect, it } from "vitest";
import { groupItemObservations, normalizeCodexExecLine } from "../../src/index.js";

function item(type: string, id: unknown, itemType: string, line: number, alias?: string) {
  return normalizeCodexExecLine({ kind: "record", line, value: { type, item: { id, type: itemType, text: "PRIVATE_TEXT" } } }, alias);
}

describe("항목 관측 근거 후보", () => {
  it("완료가 먼저 와도 관측 순서와 중복·유형 차이를 보존한다", () => {
    const completed = item("item.completed", "same", "agent_message", 8, "source_a");
    const started = item("item.started", "same", "command_execution", 4, "source_a");
    const input = [completed, started, started];
    const before = JSON.stringify(input);
    expect(groupItemObservations(input)).toEqual({
      verification_status: "unverified",
      groups: [{ source_id: "source_a", item_id: "same", observations: [
        { index: 0, line: 8, event_type: "item.completed", item_type: "agent_message", thread_id: null },
        { index: 1, line: 4, event_type: "item.started", item_type: "command_execution", thread_id: null },
        { index: 2, line: 4, event_type: "item.started", item_type: "command_execution", thread_id: null },
      ] }], unassociated: [],
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(groupItemObservations(input))).not.toContain("PRIVATE_TEXT");
  });

  it("서로 다른 명시적 스레드 ID를 보존하고 연결을 확정하지 않는다", () => {
    const a = normalizeCodexExecLine({ kind: "record", line: 1, value: {
      type: "item.started", thread_id: "thread-a", item: { id: "same", type: "command_execution" },
    } }, "source");
    const b = normalizeCodexExecLine({ kind: "record", line: 2, value: {
      type: "item.completed", thread_id: "thread-b", item: { id: "same", type: "command_execution" },
    } }, "source");
    const result = groupItemObservations([a, b]);
    expect(result.groups[0]?.observations.map((entry) => entry.thread_id)).toEqual(["thread-a", "thread-b"]);
    expect(result.verification_status).toBe("unverified");
  });

  it("다른 출처나 항목 ID는 합치지 않고 단일 기록도 보존한다", () => {
    const a = item("item.started", "same", "future_type", 1, "a");
    const b = item("item.started", "same", "agent_message", 1, "b");
    const c = item("item.completed", "other", "agent_message", 2, "a");
    const result = groupItemObservations([a, b, c]);
    expect(result.groups.map((group) => [group.source_id, group.item_id])).toEqual([["a", "same"], ["b", "same"], ["a", "other"]]);
    expect(result.groups[0]?.observations[0]?.item_type).toBeNull();
    expect(result.groups.every((group) => group.observations.length === 1)).toBe(true);
  });

  it("누락 사유를 구분하고 다른 유형의 결과는 항목으로 취급하지 않는다", () => {
    const noSource = item("item.started", "a", "agent_message", 1);
    const noId = item("item.started", null, "agent_message", 2, "source");
    const neither = item("item.completed", " ", "agent_message", 3);
    const turn = normalizeCodexExecLine({ kind: "record", line: 4, value: { type: "turn.started" } }, "source");
    const diagnostic = normalizeCodexExecLine({ kind: "diagnostic", line: 5, code: "invalid_json" }, "source");
    const unsupported = normalizeCodexExecLine({ kind: "record", line: 6, value: { type: "future.event" } }, "source");
    expect(groupItemObservations([noSource, noId, neither, turn, diagnostic, unsupported])).toEqual({
      verification_status: "unverified", groups: [], unassociated: [
        { index: 0, reason: "missing_source" }, { index: 1, reason: "missing_item_id" }, { index: 2, reason: "missing_both" },
      ],
    });
  });

  it("잘못된 정규화 결과는 원문 없이 거부한다", () => {
    const invalid = item("item.started", "a", "agent_message", 1, "source");
    if (invalid.kind !== "event") throw new Error("이벤트가 아닙니다.");
    Object.assign(invalid.event.payload, { item_id: { text: "PRIVATE_ITEM" } });
    expect(() => groupItemObservations([invalid])).toThrowError(/^유효하지 않은 정규화 결과입니다\.$/);
    expect(groupItemObservations([])).toEqual({ verification_status: "unverified", groups: [], unassociated: [] });
  });
});
