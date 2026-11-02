import { describe, expect, it } from "vitest";
import { findSourceOverlaps, normalizeCodexExecLine } from "../../src/index.js";
import type { JsonlReadResult } from "../../src/index.js";

function entry(value: unknown, line: number, sourceId?: string) {
  const record: JsonlReadResult = { kind: "record", line, value };
  return normalizeCodexExecLine(record, sourceId);
}

describe("출처 위치 중복 후보", () => {
  it("같은 별칭·줄의 정규화 결과를 원래 인덱스로 표시하고 입력을 보존한다", () => {
    const a = entry({ type: "turn.started" }, 1, "source_a");
    const b = entry({ type: "turn.started" }, 2, "source_a");
    const differentSource = entry({ type: "turn.started" }, 1, "source_b");
    const unknown = entry({ type: "turn.started" }, 1);
    const input = [a, b, differentSource, unknown, a, unknown];
    const before = JSON.stringify(input);
    expect(findSourceOverlaps(input)).toEqual([{ source_id: "source_a", line: 1, indices: [0, 4], status: "matching_normalized" }]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("같은 위치에 서로 다른 결과가 하나라도 있으면 전체를 충돌로 표시한다", () => {
    const a = entry({ type: "turn.started" }, 3, "source_a");
    const b = entry({ type: "turn.completed" }, 3, "source_a");
    expect(findSourceOverlaps([a, a, b, a])).toEqual([
      { source_id: "source_a", line: 3, indices: [0, 1, 2, 3], status: "conflict" },
    ]);
  });

  it("진단과 미지원 결과도 묶고 그룹은 최초 등장 순서를 따른다", () => {
    const diagnostic = normalizeCodexExecLine({ kind: "diagnostic", line: 2, code: "invalid_json" }, "a");
    const unsupported = entry({ type: "future.event" }, 1, "b");
    expect(findSourceOverlaps([diagnostic, unsupported, unsupported, diagnostic])).toEqual([
      { source_id: "a", line: 2, indices: [0, 3], status: "matching_normalized" },
      { source_id: "b", line: 1, indices: [1, 2], status: "matching_normalized" },
    ]);
  });

  it("원문이 달라도 정규화 결과가 같을 수 있으므로 후보만 반환한다", () => {
    const first = entry({ type: "item.started", item: { type: "command_execution", command: "PRIVATE_A" } }, 4, "a");
    const second = entry({ type: "item.started", item: { type: "command_execution", command: "PRIVATE_B" } }, 4, "a");
    const input = [first, second];
    const result = findSourceOverlaps(input);
    expect(result).toEqual([{ source_id: "a", line: 4, indices: [0, 1], status: "matching_normalized" }]);
    expect(input).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });

  it("잘못된 입력은 원문 없는 오류로 거부한다", () => {
    const invalid = entry({ type: "turn.started" }, 1, "a");
    if (invalid.kind !== "event") throw new Error("이벤트가 아닙니다.");
    Object.assign(invalid.event, { event_type: "PRIVATE_INVALID" });
    expect(() => findSourceOverlaps([invalid])).toThrowError(/^유효하지 않은 정규화 결과입니다\.$/);
    expect(findSourceOverlaps([])).toEqual([]);
  });
});
