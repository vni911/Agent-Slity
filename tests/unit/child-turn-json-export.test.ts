import { describe, expect, it } from "vitest";
import { exportChildTurnCollectionJson, normalizeCodexThreadReadV0166, normalizeCodexTurnsPageV0166 } from "../../src/index.js";
import type { ChildTurnCollectionResult } from "../../src/index.js";

const message = { type: "userMessage", id: "user", content: [{ text: "PRIVATE_MESSAGE" }], startedAtMs: 0 };
function make(items: unknown[] = [message]): ChildTurnCollectionResult {
  return { initialization_error: null, cleanup_status: "unknown", collection: {
    source_id: "sample", verification_status: "unverified", status: "last_page", reason: "last_page",
    thread: normalizeCodexThreadReadV0166({ thread: { id: "thread", parentThreadId: null, sessionId: "session", cwd: "PRIVATE_PATH" } }, "sample"),
    pages: [normalizeCodexTurnsPageV0166({ data: [{ id: "turn", status: "completed", itemsView: "full", items }], nextCursor: null }, "sample")],
  } };
}
const encode = (input: unknown) => exportChildTurnCollectionJson(input as ChildTurnCollectionResult);
const reject = (input: unknown) => expect(() => encode(input)).toThrowError(/^유효하지 않은 turn 수집 결과입니다\.$/);

describe("자식 turn 수집 결과 JSON 내보내기", () => {
  it("초기화 오류와 종료 미관측을 별개로 보존한다", () => {
    for (const initialization_error of ["cancelled", "timeout", "server_error", "invalid_input", "transport_error"] as const) {
      const result: ChildTurnCollectionResult = { initialization_error, cleanup_status: "unknown", collection: null };
      expect(JSON.parse(encode(result))).toEqual({ format: "agent-slity.child-turn-collection", version: 1,
        schema_reference: "0.166.0", verification_status: "unverified", result });
    }
  });

  it("지원하는 모든 item 관측과 null·0·순서 및 중복을 보존한다", () => {
    const items = [message, { type: "agentMessage", id: "agent", text: "PRIVATE_TEXT" },
      { type: "commandExecution", id: "command", status: "completed", exitCode: 0, durationMs: 0, command: "PRIVATE_COMMAND" },
      { type: "fileChange", id: "file", status: "completed", changes: [{ path: "PRIVATE_PATH", kind: { type: "add" } }, { kind: { type: "delete" } }] },
      { type: "collabAgentToolCall", id: "collab", senderThreadId: "parent", receiverThreadIds: ["child", "child"], tool: "spawnAgent", status: "completed", prompt: "PRIVATE_PROMPT" },
      { type: "subAgentActivity", id: "activity", agentThreadId: "child", kind: "started", model: "synthetic-model", reasoningEffort: "high", agentPath: "PRIVATE_PATH" },
      { type: "future", text: "PRIVATE_UNKNOWN" }, message];
    const input = make(items);
    const result = JSON.parse(encode(input));
    expect(result.result).toEqual(input);
    expect(result.result.collection.pages[0].turns[0].items.map((x: { kind: string }) => x.kind))
      .toEqual(["user_message", "agent_message", "command_execution", "file_change", "collab", "subagent_activity", "unsupported", "user_message"]);
    expect(encode(input)).not.toContain("PRIVATE_");
  });

  it("이전 페이지가 있는 부분 결과의 모든 중단 사유를 바꾸지 않는다", () => {
    for (const reason of ["invalid_thread", "thread_mismatch", "invalid_page", "cursor_unknown", "cursor_invalid", "cursor_repeated",
      "page_limit", "cancelled", "timeout", "server_error", "transport_error"] as const) {
      const input = make();
      if (!input.collection) throw new Error("합성 결과 없음");
      input.collection.status = "partial"; input.collection.reason = reason;
      expect(JSON.parse(encode(input)).result).toEqual(input);
    }
  });

  it("여러 페이지의 중복과 미지원 페이지를 보존한다", () => {
    const input = make();
    if (!input.collection) throw new Error("합성 결과 없음");
    const first = input.collection.pages[0];
    if (first.kind !== "page") throw new Error("합성 페이지 없음");
    first.next_page = "available";
    input.collection.pages.push({ ...first, next_page: "none" });
    expect(JSON.parse(encode(input)).result).toEqual(input);
    input.collection.status = "partial"; input.collection.reason = "invalid_page";
    input.collection.pages[1] = { kind: "unsupported", source_id: "sample", schema_reference: "0.166.0", reason: "invalid_page" };
    expect(JSON.parse(encode(input)).result).toEqual(input);
  });

  it("이전 thread 결과의 누락된 parent 상태를 unknown으로 표시한다", () => {
    const input = make();
    if (input.collection?.thread?.kind !== "thread") throw new Error("합성 스레드 없음");
    delete input.collection.thread.parent_thread_id_status;
    expect(JSON.parse(encode(input)).result.collection.thread.parent_thread_id_status).toBe("unknown");
  });

  it("스레드 미지원과 조회 전 실패 및 빈 마지막 페이지를 보존한다", () => {
    const input = make();
    if (!input.collection) throw new Error("합성 결과 없음");
    input.collection.status = "partial"; input.collection.reason = "invalid_thread";
    input.collection.thread = normalizeCodexThreadReadV0166(null, "sample"); input.collection.pages = [];
    expect(JSON.parse(encode(input)).result).toEqual(input);
    input.collection.thread = null; input.collection.reason = "transport_error";
    expect(JSON.parse(encode(input)).result).toEqual(input);
    const empty = make();
    empty.collection!.pages = [normalizeCodexTurnsPageV0166({ data: [], nextCursor: null }, "sample")];
    expect(JSON.parse(encode(empty)).result).toEqual(empty);
  });

  it("식별자와 보고된 설정은 의도적으로 보존하며 비밀 탐지를 주장하지 않는다", () => {
    const input = make([{ type: "subAgentActivity", id: "PRIVATE_ALLOWED_ID", model: "PRIVATE_ALLOWED_MODEL" }]);
    const json = encode(input);
    expect(json).toContain("PRIVATE_ALLOWED_ID"); expect(json).toContain("PRIVATE_ALLOWED_MODEL");
  });

  it("모든 수준의 추가 원문과 toJSON·iterator를 실행하거나 복사하지 않는다", () => {
    const input = make();
    let calls = 0;
    const toJSON = () => { calls++; return "PRIVATE_TO_JSON"; };
    const page = input.collection?.pages[0];
    if (!input.collection || page?.kind !== "page" || input.collection.thread?.kind !== "thread") throw new Error("합성 결과 없음");
    const objects = [input, input.collection, input.collection.thread, input.collection.thread.source, page, page.turns[0], page.turns[0].items[0]];
    for (const value of objects) Object.assign(value, { toJSON, message: "PRIVATE_EXTRA", path: "PRIVATE_PATH", cursor: "PRIVATE_CURSOR" });
    for (const array of [input.collection.pages, page.turns, page.turns[0].items]) {
      Object.assign(array, { toJSON });
      Object.defineProperty(array, Symbol.iterator, { value: () => { calls++; throw new Error("PRIVATE_ITERATOR"); } });
    }
    const json = encode(input);
    expect(json).not.toContain("PRIVATE_"); expect(calls).toBe(0);
    expect(JSON.parse(json).result.collection.pages[0].turns[0].items).toHaveLength(1);
  });

  it("필수 getter와 배열 구멍을 실행 없이 고정 오류로 거부한다", () => {
    let calls = 0;
    const input = make();
    Object.defineProperty(input, "cleanup_status", { get() { calls++; return "exit_observed"; } });
    reject(input); expect(calls).toBe(0);
    const holes = make();
    if (!holes.collection) throw new Error("합성 결과 없음");
    holes.collection.pages = new Array(1); reject(holes);
    const extra = make();
    Object.defineProperty(extra, "stderr", { get() { calls++; throw new Error("PRIVATE_STDERR"); } });
    encode(extra); expect(calls).toBe(0);
  });

  it("잘못된 상태·출처·schema·검증 표시와 큰 식별자를 거부한다", () => {
    reject(null); reject([]); reject({ initialization_error: null, cleanup_status: "unknown", collection: null });
    for (const patch of [{ cleanup_status: "PRIVATE_STATUS" }, { initialization_error: "PRIVATE_ERROR" }]) reject({ ...make(), ...patch });
    for (const patch of [{ source_id: "PRIVATE/PATH" }, { verification_status: "verified" }, { status: "partial", reason: "last_page" }, { thread: null }]) {
      const input = make(); Object.assign(input.collection!, patch); reject(input);
    }
    const long = make();
    if (long.collection?.thread?.kind !== "thread") throw new Error("합성 스레드 없음");
    long.collection.thread.thread_id = "x".repeat(65537); reject(long);
    const wrongSchema = make(); Object.assign(wrongSchema.collection!.pages[0], { schema_reference: "future" }); reject(wrongSchema);
    const verifiedPage = make(); Object.assign(verifiedPage.collection!.pages[0], { verification_status: "verified" }); reject(verifiedPage);
    const wrongItem = make(); const p = wrongItem.collection!.pages[0];
    if (p.kind !== "page") throw new Error("합성 페이지 없음");
    Object.assign(p.turns[0].items[0], { item_id: "x".repeat(257) }); reject(wrongItem);
    const revoked = Proxy.revocable({}, {}); revoked.revoke(); reject(revoked.proxy);
  });

  it("Proxy가 읽기 사이에 항목 판별자를 바꾸면 다른 종류로 내보내지 않는다", () => {
    const input = make(); const p = input.collection!.pages[0];
    if (p.kind !== "page") throw new Error("합성 페이지 없음");
    let reads = 0;
    const changing = new Proxy({ index: 0 }, { getOwnPropertyDescriptor(target, key) {
      if (key === "kind") return { configurable: true, value: reads++ === 0 ? "unsupported" : "collab" };
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    Object.assign(p.turns[0], { items: [changing] }); reject(input);
  });

  it("페이지 수와 페이지별 turn·합산 item·중첩 배열 예산을 제한한다", () => {
    const input = make(), page = input.collection!.pages[0];
    if (page.kind !== "page") throw new Error("합성 페이지 없음");
    const manyPages = make(); manyPages.collection!.pages = new Array(21).fill(page); reject(manyPages);
    page.turns = new Array(10001).fill(page.turns[0]); reject(input);
    const itemInput = make(), itemPage = itemInput.collection!.pages[0];
    if (itemPage.kind !== "page") throw new Error("합성 페이지 없음");
    const sample = itemPage.turns[0].items[0];
    itemPage.turns = [6000, 4001].map((count, index) => ({ index, turn_id: "turn", status: "completed", items_view: "full",
      items: Array.from({ length: count }, (_, i) => ({ ...sample, index: i })) }));
    reject(itemInput);
    for (const kind of ["collab", "file_change"]) {
      const child = make(); const p = child.collection!.pages[0];
      if (p.kind !== "page") throw new Error("합성 페이지 없음");
      const common = { index: 0, kind, turn_id: "turn", item_id: "item", started_at_ms: null, completed_at_ms: null, status: "completed" };
      const items = [6000, 4001].map((count, index) => kind === "collab" ? { ...common, index, tool: "spawnAgent", sender_thread_id: null,
        receiver_thread_ids: new Array(count).fill(null) } : { ...common, index, change_kinds: new Array(count).fill(null) });
      Object.assign(p.turns[0], { items }); reject(child);
    }
  });

  it("16MiB를 초과하는 UTF-8 결과는 잘라내지 않고 실패한다", () => {
    const input = make(); const p = input.collection!.pages[0];
    if (p.kind !== "page") throw new Error("합성 페이지 없음");
    const long = "가".repeat(256);
    p.turns = Array.from({ length: 10000 }, (_, index) => ({ index, turn_id: long, status: "completed", items_view: "full",
      items: [{ index: 0, kind: "user_message", turn_id: long, item_id: long, started_at_ms: null, completed_at_ms: null }] }));
    reject(input);
  });
});
