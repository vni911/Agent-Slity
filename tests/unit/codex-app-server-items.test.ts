import { describe, expect, it } from "vitest";
import { normalizeCodexItemsPageV0166 } from "../../src/index.js";

describe("저장 항목 페이지 정규화", () => {
  it("협업 호출의 명시적 필드와 중복을 보존하고 원문·커서는 제외한다", () => {
    const entry = { turnId: "turn", item: { type: "collabAgentToolCall", id: "item", senderThreadId: "sender",
      receiverThreadIds: ["receiver", "receiver"], tool: "spawnAgent", status: "completed", prompt: "PRIVATE_PROMPT" } };
    const result = normalizeCodexItemsPageV0166({ data: [entry, entry, { item: { type: "agentMessage", text: "PRIVATE_MESSAGE" } }], nextCursor: "PRIVATE_CURSOR" }, "sample");
    expect(result.kind).toBe("page");
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result).toEqual({ kind: "page", source_id: "sample", schema_reference: "0.166.0", verification_status: "unverified", next_page: "available", items: [
      { index: 0, kind: "collab", turn_id: "turn", item_id: "item", sender_thread_id: "sender", receiver_thread_ids: ["receiver", "receiver"], tool: "spawnAgent", status: "completed" },
      { index: 1, kind: "collab", turn_id: "turn", item_id: "item", sender_thread_id: "sender", receiver_thread_ids: ["receiver", "receiver"], tool: "spawnAgent", status: "completed" },
      { index: 2, kind: "unsupported" },
    ] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });

  it("누락·잘못된 값과 미지 유형을 추정하지 않는다", () => {
    const result = normalizeCodexItemsPageV0166({ data: [{ item: { type: "collabAgentToolCall", receiverThreadIds: [" ", 3], tool: "future", status: "future" } },
      { item: { type: "collabToolCall" } }, null] });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.next_page).toBe("unknown");
    expect(result.items).toEqual([{ index: 0, kind: "collab", turn_id: null, item_id: null, sender_thread_id: null,
      receiver_thread_ids: [null, null], tool: null, status: null }, { index: 1, kind: "unsupported" }, { index: 2, kind: "unsupported" }]);
    expect(normalizeCodexItemsPageV0166({ data: [], nextCursor: null })).toMatchObject({ kind: "page", next_page: "none" });
    expect(normalizeCodexItemsPageV0166({ data: [], nextCursor: "" })).toMatchObject({ kind: "page", next_page: "unknown" });
  });

  it("잘못된 페이지와 지나치게 큰 배열은 원문 없이 거부한다", () => {
    for (const input of [null, {}, { data: "PRIVATE" }, { data: new Array(10001) }]) {
      expect(normalizeCodexItemsPageV0166(input)).toEqual({ kind: "unsupported", source_id: null, schema_reference: "0.166.0", reason: "invalid_page" });
    }
    expect(() => normalizeCodexItemsPageV0166({}, "PRIVATE/ALIAS")).toThrowError(/^출처 별칭은 영문자, 숫자, 밑줄, 하이픈 1~64자여야 합니다\.$/);
  });

  it("getter와 해제된 프록시를 실행하거나 오류를 노출하지 않는다", () => {
    let called = false;
    const item = { type: "collabAgentToolCall" };
    Object.defineProperty(item, "id", { get() { called = true; throw new Error("PRIVATE"); } });
    const result = normalizeCodexItemsPageV0166({ data: [{ item }] });
    expect(result.kind === "page" && result.items[0]).toMatchObject({ item_id: null });
    expect(called).toBe(false);
    const { proxy, revoke } = Proxy.revocable([], {}); revoke();
    expect(normalizeCodexItemsPageV0166({ data: proxy }).kind).toBe("unsupported");
  });

  it("한 페이지의 수신 ID 전체 복사량을 제한하고 초과 항목을 누락으로 표시한다", () => {
    const entry = { item: { type: "collabAgentToolCall", receiverThreadIds: Array(10000).fill("receiver") } };
    const result = normalizeCodexItemsPageV0166({ data: [entry, entry, { item: { type: "collabAgentToolCall", receiverThreadIds: [] } }] });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items[0]).toMatchObject({ receiver_thread_ids: Array(10000).fill("receiver") });
    expect(result.items[1]).toMatchObject({ receiver_thread_ids: null });
    expect(result.items[2]).toMatchObject({ receiver_thread_ids: [] });
  });
});
