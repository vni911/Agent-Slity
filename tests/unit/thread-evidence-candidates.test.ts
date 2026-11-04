import { describe, expect, it } from "vitest";
import { findThreadEvidenceCandidates, normalizeCodexItemsPageV0166, normalizeCodexThreadReadV0166 } from "../../src/index.js";

describe("스레드 관측 일치 후보", () => {
  it("같은 출처와 ID만 연결하고 위치와 중복을 보존한다", () => {
    const thread = normalizeCodexThreadReadV0166({ thread: { id: "child" } }, "sample");
    const threads = [thread, thread, normalizeCodexThreadReadV0166({ thread: { id: "child" } }, "other"),
      normalizeCodexThreadReadV0166({ thread: { id: "child" } })];
    const page = normalizeCodexItemsPageV0166({ data: [
      { item: { type: "collabAgentToolCall", senderThreadId: "child", receiverThreadIds: ["child", null, "child"] } },
      { item: { type: "subAgentActivity", agentThreadId: "child" } },
    ] }, "sample");
    const before = JSON.stringify([threads, page]);
    expect(findThreadEvidenceCandidates(threads, [page])).toEqual({ verification_status: "unverified", groups: [{
      source_id: "sample", thread_id: "child", thread_indices: [0, 1], item_references: [
        { page_index: 0, item_index: 0, role: "sender", receiver_index: null },
        { page_index: 0, item_index: 0, role: "receiver", receiver_index: 0 },
        { page_index: 0, item_index: 0, role: "receiver", receiver_index: 2 },
        { page_index: 0, item_index: 1, role: "activity", receiver_index: null },
      ],
    }] });
    expect(JSON.stringify([threads, page])).toBe(before);
  });

  it("출처·ID 누락, 지원하지 않는 관측 및 다른 출처는 연결하지 않는다", () => {
    const thread = normalizeCodexThreadReadV0166({ thread: { id: "one" } }, "sample");
    const pages = [normalizeCodexItemsPageV0166(null, "sample"),
      normalizeCodexItemsPageV0166({ data: [{ item: { type: "subAgentActivity", agentThreadId: "one" } }] }, "other"),
      normalizeCodexItemsPageV0166({ data: [{ item: { type: "subAgentActivity", agentThreadId: "one" } }] }),
      normalizeCodexItemsPageV0166({ data: [{ item: { type: "subAgentActivity" } }, { item: { type: "other" } }] }, "sample")];
    expect(findThreadEvidenceCandidates([thread, normalizeCodexThreadReadV0166(null, "sample")], pages).groups).toEqual([]);
  });

  it("여러 페이지와 다른 ID의 입력 위치를 각각 보존한다", () => {
    const threads = ["one", "two", "absent"].map((id) => normalizeCodexThreadReadV0166({ thread: { id } }, "sample"));
    const page = (id: string) => normalizeCodexItemsPageV0166({ data: [{ item: { type: "subAgentActivity", agentThreadId: id } }] }, "sample");
    const result = findThreadEvidenceCandidates(threads, [page("two"), page("one"), page("two")]);
    expect(result.groups.map(({ thread_id, thread_indices, item_references }) => ({ thread_id, thread_indices, item_references }))).toEqual([
      { thread_id: "one", thread_indices: [0], item_references: [{ page_index: 1, item_index: 0, role: "activity", receiver_index: null }] },
      { thread_id: "two", thread_indices: [1], item_references: [
        { page_index: 0, item_index: 0, role: "activity", receiver_index: null },
        { page_index: 2, item_index: 0, role: "activity", receiver_index: null },
      ] },
    ]);
    expect(findThreadEvidenceCandidates([], []).groups).toEqual([]);
  });
});
