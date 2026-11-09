import { describe, expect, it } from "vitest";
import { normalizeCodexTurnsPageV0166 } from "../../src/index.js";

function turn(items: unknown[], extra: object = {}) {
  return { id: "turn", status: "completed", itemsView: "full", items, error: { message: "PRIVATE_ERROR" }, ...extra };
}
describe("full turn 페이지 정규화", () => {
  it("중복과 순서, 메시지 식별자와 항목 시각을 보존하고 원문을 제외한다", () => {
    const items = [{ type: "userMessage", id: "u", content: [{ text: "PRIVATE_MESSAGE" }], startedAtMs: 0 },
      { type: "agentMessage", id: "a", text: "PRIVATE_ANSWER", completedAtMs: 23 },
      { type: "commandExecution", id: "c", startedAtMs: 42, exitCode: 0, durationMs: 3, command: "PRIVATE_COMMAND" },
      { type: "future", text: "PRIVATE_UNKNOWN" }];
    const input = { data: [turn(items), turn(items)], nextCursor: "PRIVATE_CURSOR", backwardsCursor: "PRIVATE_BACKWARDS" };
    const result = normalizeCodexTurnsPageV0166(input, "sample");
    expect(result).toMatchObject({ kind: "page", verification_status: "unverified", next_page: "available",
      turns: [{ index: 0, turn_id: "turn", items: [{ kind: "user_message", index: 0, item_id: "u", started_at_ms: 0 },
        { kind: "agent_message", completed_at_ms: 23 }, { kind: "command_execution", started_at_ms: 42, exit_code: 0 }, { kind: "unsupported", index: 3 }] },
      { index: 1, turn_id: "turn" }] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });
  it("full이 아닌 view와 누락·손상·과도한 배열을 거부한다", () => {
    for (const data of [[turn([], { itemsView: "summary" })], [turn([], { itemsView: undefined })],
      [turn([], { items: null })], new Array(10001), [null]]) {
      expect(normalizeCodexTurnsPageV0166({ data, nextCursor: null })).toMatchObject({ kind: "unsupported", reason: "invalid_page" });
    }
    expect(normalizeCodexTurnsPageV0166({ data: [turn(new Array(6000)), turn(new Array(4001))] })).toMatchObject({ kind: "unsupported" });
  });
  it("출처 별칭을 검증하고 빈 마지막 페이지를 지원한다", () => {
    expect(() => normalizeCodexTurnsPageV0166(null, "bad/source")).toThrow(TypeError);
    expect(normalizeCodexTurnsPageV0166({ data: [], nextCursor: null }, "sample"))
      .toMatchObject({ kind: "page", turns: [], next_page: "none" });
  });
  it("getter를 실행하지 않고 누락된 시각을 null로 남긴다", () => {
    let calls = 0;
    const item = { type: "userMessage", id: "u", get startedAtMs() { calls++; throw new Error("PRIVATE_GETTER"); } };
    const response = normalizeCodexTurnsPageV0166({ data: [turn([item])], nextCursor: null });
    expect(response).toMatchObject({ turns: [{ items: [{ started_at_ms: null, completed_at_ms: null }] }] });
    expect(calls).toBe(0);
    expect(normalizeCodexTurnsPageV0166({ get data() { calls++; return []; } })).toMatchObject({ kind: "unsupported" });
    expect(calls).toBe(0);
  });
  it("협업 수신자와 파일 변경 배열의 예산을 turn 전체에서 공유한다", () => {
    const item = { type: "collabAgentToolCall", receiverThreadIds: new Array(6000).fill("child") };
    const result = normalizeCodexTurnsPageV0166({ data: [turn([item]), turn([item])], nextCursor: null });
    expect(result).toMatchObject({ turns: [{ items: [{ receiver_thread_ids: new Array(6000).fill("child") }] },
      { items: [{ receiver_thread_ids: null }] }] });
    const changes = { type: "fileChange", changes: Array.from({ length: 6000 }, () => ({ path: "PRIVATE_PATH", kind: { type: "add" } })) };
    const files = normalizeCodexTurnsPageV0166({ data: [turn([changes]), turn([changes])], nextCursor: null });
    expect(files).toMatchObject({ turns: [{ items: [{ change_kinds: new Array(6000).fill("add") }] },
      { items: [{ change_kinds: null }] }] });
    expect(JSON.stringify(files)).not.toContain("PRIVATE_");
  });
});
