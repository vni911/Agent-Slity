import { describe, expect, it } from "vitest";
import { findParentThreadCandidates, normalizeCodexThreadReadV0166 } from "../../src/index.js";

function thread(id: string, parent: string | null, source?: string) {
  return normalizeCodexThreadReadV0166({ thread: { id, parentThreadId: parent, sessionId: "shared", forkedFromId: "fork" } }, source);
}

describe("부모 스레드 관측 후보", () => {
  it("역순·중복·상충된 관측을 위치와 함께 보존한다", () => {
    const input = [thread("child", "parent", "a"), thread("parent", null, "a"), thread("parent", null, "a"),
      thread("child", "other", "a"), thread("parent", null, "b"), thread("other", "other", "a")];
    expect(findParentThreadCandidates(input)).toEqual({ verification_status: "unverified", groups: [
      { source_id: "a", parent_thread_id: "parent", child_indices: [0], parent_candidate_indices: [1, 2] },
      { source_id: "a", parent_thread_id: "other", child_indices: [3, 5], parent_candidate_indices: [5] },
    ], unassociated: [{ index: 1, reason: "missing_parent", parent_thread_id_status: "explicit_null" }, { index: 2, reason: "missing_parent", parent_thread_id_status: "explicit_null" },
      { index: 4, reason: "missing_parent", parent_thread_id_status: "explicit_null" }], unsupported_indices: [] });
  });

  it("출처·부모 누락과 후보가 없는 상태를 분리하고 포크·세션으로 관계를 추정하지 않는다", () => {
    const result = findParentThreadCandidates([thread("child", "missing", "a"), thread("x", null, "a"),
      thread("child", "x"), thread("x", null), normalizeCodexThreadReadV0166({}, "a")]);
    expect(result.groups).toEqual([{ source_id: "a", parent_thread_id: "missing", child_indices: [0], parent_candidate_indices: [] }]);
    expect(result.unassociated).toEqual([{ index: 1, reason: "missing_parent", parent_thread_id_status: "explicit_null" },
      { index: 2, reason: "missing_source", parent_thread_id_status: "present" }, { index: 3, reason: "missing_both", parent_thread_id_status: "explicit_null" }]);
    expect(result.unsupported_indices).toEqual([4]);
  });

  it("출처가 다르면 같은 ID도 후보로 연결하지 않는다", () => {
    const result = findParentThreadCandidates([thread("child", "parent", "a"), thread("parent", null, "b")]);
    expect(result.groups[0]?.parent_candidate_indices).toEqual([]);
  });

  it("동일한 자식 관측의 중복을 제거하지 않는다", () => {
    const child = thread("child", "parent", "a");
    const result = findParentThreadCandidates([child, child, thread("parent", null, "a")]);
    expect(result.groups).toEqual([{ source_id: "a", parent_thread_id: "parent", child_indices: [0, 1], parent_candidate_indices: [2] }]);
  });

  it("누락된 이전 상태와 모순된 상태를 추정하지 않는다", () => {
    const old = thread("old", null, "a");
    const invalid = thread("invalid", null, "a");
    const omitted = normalizeCodexThreadReadV0166({ thread: { id: "omitted" } }, "a");
    if (old.kind !== "thread" || invalid.kind !== "thread") throw new Error("스레드가 아닙니다.");
    delete old.parent_thread_id_status;
    invalid.parent_thread_id_status = "present";
    const result = findParentThreadCandidates([old, invalid, omitted]);
    expect(result.unassociated).toEqual([0, 1, 2].map((index) => ({ index, reason: "missing_parent", parent_thread_id_status: "unknown" })));
  });

  it("후보 그룹은 상태의 진위를 판단하지 않고 명시된 ID만 비교한다", () => {
    const child = thread("child", "parent", "a");
    if (child.kind !== "thread") throw new Error("스레드가 아닙니다.");
    child.parent_thread_id_status = "explicit_null";
    expect(findParentThreadCandidates([child, thread("parent", null, "a")]).groups)
      .toEqual([{ source_id: "a", parent_thread_id: "parent", child_indices: [0], parent_candidate_indices: [1] }]);
  });
});
