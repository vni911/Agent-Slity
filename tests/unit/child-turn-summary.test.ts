import { describe, expect, it } from "vitest";
import { exportChildTurnCollectionJson, normalizeCodexThreadReadV0166, normalizeCodexTurnsPageV0166,
  parseChildTurnCollectionJson, summarizeChildTurnCollection } from "../../src/index.js";
import type { ChildTurnCollectionResult, ChildTurnObservationCounts } from "../../src/index.js";

function make(): ChildTurnCollectionResult {
  return { initialization_error: null, cleanup_status: "unknown", collection: {
    source_id: "sample", verification_status: "unverified", status: "last_page", reason: "last_page",
    thread: normalizeCodexThreadReadV0166({ thread: { id: "thread" } }, "sample"),
    pages: [normalizeCodexTurnsPageV0166({ data: [{ id: "turn", status: "completed", itemsView: "full",
      items: [{ type: "userMessage", id: "message", content: [{ text: "PRIVATE_MESSAGE" }] }] }], nextCursor: null }, "sample")],
  } };
}
const summarize = (input: unknown) => summarizeChildTurnCollection(input as ChildTurnCollectionResult);
const reject = (input: unknown) => expect(() => summarize(input))
  .toThrowError(new TypeError("유효하지 않은 turn 수집 요약 입력입니다."));
const empty: ChildTurnObservationCounts = { turns: 0, items: 0,
  turn_statuses: { inProgress: 0, completed: 0, failed: 0, interrupted: 0, unknown: 0 },
  item_kinds: { user_message: 0, agent_message: 0, collab: 0, subagent_activity: 0,
    command_execution: 0, file_change: 0, unsupported: 0 } };

describe("자식 turn 수집 결과 읽기 전용 요약", () => {
  it("정상 수집의 형식과 수집·정리 상태 및 관측 범위를 명시한다", () => {
    expect(summarize(make())).toEqual({ format: "agent-slity.child-turn-summary", version: 1,
      schema_reference: "0.166.0", verification_status: "unverified", initialization_error: null, cleanup_status: "unknown",
      collection: { status: "last_page", reason: "last_page", thread_kind: "thread",
        pages: { received: 1, supported: 1, unsupported: 0 }, count_scope: "supported_pages",
        observations: { turns: 1, items: 1,
          turn_statuses: { ...empty.turn_statuses, completed: 1 }, item_kinds: { ...empty.item_kinds, user_message: 1 } } } });
  });

  it("모든 turn 상태와 item 유형을 분류하고 중복 page·ID·항목을 입력 횟수대로 센다", () => {
    const input = make(), collection = input.collection!;
    const items = [
      { type: "userMessage", id: "same" }, { type: "agentMessage", id: "same" },
      { type: "collabAgentToolCall", id: "same" }, { type: "subAgentActivity", id: "same" },
      { type: "commandExecution", id: "same", status: "completed" },
      { type: "fileChange", id: "same", status: "completed" },
      { type: "future", id: "same" }, { type: "userMessage", id: "same" },
    ];
    const data = ["inProgress", "completed", "failed", "interrupted", "future"].map((status, i) =>
      ({ id: "same", status, itemsView: "full", items: i === 0 ? items : [] }));
    const page = normalizeCodexTurnsPageV0166({ data, nextCursor: "PRIVATE_CURSOR" }, "sample");
    collection.status = "partial"; collection.reason = "page_limit"; collection.pages = [page, page];
    expect(summarize(input).collection).toEqual({ status: "partial", reason: "page_limit", thread_kind: "thread",
      pages: { received: 2, supported: 2, unsupported: 0 }, count_scope: "supported_pages",
      observations: { turns: 10, items: 16,
        turn_statuses: { inProgress: 2, completed: 2, failed: 2, interrupted: 2, unknown: 2 },
        item_kinds: { user_message: 4, agent_message: 2, collab: 2, subagent_activity: 2,
          command_execution: 2, file_change: 2, unsupported: 2 } } });
  });

  it("초기화 실패를 수집 0으로 바꾸지 않고 모든 오류·정리 상태를 유지한다", () => {
    for (const initialization_error of ["cancelled", "timeout", "server_error", "invalid_input", "transport_error"] as const) {
      for (const cleanup_status of ["unknown", "exit_observed"] as const) {
        const result = summarize({ initialization_error, cleanup_status, collection: null });
        expect(result.initialization_error).toBe(initialization_error);
        expect(result.cleanup_status).toBe(cleanup_status); expect(result.collection).toBeNull();
      }
    }
  });

  it("모든 partial 사유와 이미 관측한 수를 보존한다", () => {
    for (const reason of ["invalid_thread", "thread_mismatch", "invalid_page", "cursor_unknown", "cursor_invalid",
      "cursor_repeated", "page_limit", "cancelled", "timeout", "server_error", "transport_error"] as const) {
      const input = make(); input.collection!.status = "partial"; input.collection!.reason = reason;
      expect(summarize(input).collection).toMatchObject({ status: "partial", reason, observations: { turns: 1, items: 1 } });
    }
  });

  it("조회 전 실패·미지원 스레드와 미지원 page 내부의 누락 수는 null로 남긴다", () => {
    const input = make(), collection = input.collection!;
    collection.status = "partial"; collection.reason = "server_error"; collection.pages = []; collection.thread = null;
    expect(summarize(input).collection).toMatchObject({ thread_kind: "unknown",
      pages: { received: 0, supported: 0, unsupported: 0 }, observations: null });
    collection.thread = normalizeCodexThreadReadV0166(null, "sample"); collection.reason = "invalid_thread";
    expect(summarize(input).collection).toMatchObject({ thread_kind: "unsupported", observations: null });
    collection.thread = make().collection!.thread; collection.reason = "invalid_page";
    collection.pages = [normalizeCodexTurnsPageV0166(null, "sample")];
    expect(summarize(input).collection).toMatchObject({ thread_kind: "thread",
      pages: { received: 1, supported: 0, unsupported: 1 }, observations: null });
  });

  it("유효한 빈 page의 관측 0을 null과 구분한다", () => {
    const input = make(), collection = input.collection!;
    collection.pages = [normalizeCodexTurnsPageV0166({ data: [], nextCursor: null }, "sample")];
    expect(summarize(input).collection!.observations).toEqual(empty);
    collection.status = "partial"; collection.reason = "invalid_page";
    collection.pages.push(normalizeCodexTurnsPageV0166(null, "sample"));
    expect(summarize(input).collection).toMatchObject({
      pages: { received: 2, supported: 1, unsupported: 1 }, observations: empty });
  });

  it("미지원 page를 누락된 turn/item의 0으로 세지 않고 지원 page만 집계한다", () => {
    const input = make(), collection = input.collection!;
    collection.status = "partial"; collection.reason = "invalid_page";
    collection.pages.push(normalizeCodexTurnsPageV0166(null, "sample"));
    expect(summarize(input).collection).toMatchObject({ count_scope: "supported_pages",
      pages: { received: 2, supported: 1, unsupported: 1 }, observations: { turns: 1, items: 1 } });
  });

  it("ID·별칭·보고된 설정·시각·추가 원문과 입력 hook을 요약으로 복사하거나 실행하지 않는다", () => {
    const input = make(), collection = input.collection!, thread = collection.thread!, page = collection.pages[0];
    if (thread.kind !== "thread" || page.kind !== "page") throw new Error("합성 관측 없음");
    collection.source_id = "PRIVATE_ALIAS"; thread.thread_id = "PRIVATE_THREAD";
    const observed = normalizeCodexTurnsPageV0166({ data: [{ id: "PRIVATE_TURN", itemsView: "full", items: [
      { type: "subAgentActivity", id: "PRIVATE_ITEM", model: "PRIVATE_MODEL", reasoningEffort: "PRIVATE_SETTING", startedAtMs: 123456789 },
    ] }], nextCursor: null }, "PRIVATE_ALIAS");
    collection.pages = [observed];
    if (observed.kind !== "page") throw new Error("합성 페이지 없음");
    let calls = 0;
    const hooks = { toJSON() { calls++; throw new Error("PRIVATE_HOOK"); }, command: "PRIVATE_COMMAND", path: "PRIVATE_PATH" };
    for (const object of [input, collection, thread, thread.source, observed, observed.turns[0], observed.turns[0].items[0]]) {
      Object.assign(object, hooks);
      Object.defineProperty(object, "stderr", { get() { calls++; return "PRIVATE_STDERR"; } });
    }
    for (const array of [collection.pages, observed.turns, observed.turns[0].items]) {
      Object.assign(array, hooks);
      Object.defineProperty(array, Symbol.iterator, { value: () => { calls++; throw new Error("PRIVATE_ITERATOR"); } });
    }
    const json = JSON.stringify(summarize(input));
    expect(calls).toBe(0); expect(json).not.toContain("PRIVATE_"); expect(json).not.toContain("123456789");
    for (const key of ["source_id", "thread_id", "turn_id", "item_id", "reported_model", "started_at_ms", "stderr"]) {
      expect(json).not.toContain('"' + key + '"');
    }
  });

  it("동결된 입력을 변경하지 않고 출력 변경도 다음 요약이나 입력에 전파하지 않는다", () => {
    const input = make(), before = exportChildTurnCollectionJson(input);
    function freeze(value: unknown): void {
      if (typeof value !== "object" || value === null) return;
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    freeze(input);
    const summary = summarize(input);
    summary.collection!.pages.received = 99;
    summary.collection!.observations!.item_kinds.user_message = 99;
    expect(summarize(input).collection).toMatchObject({ pages: { received: 1 }, observations: { items: 1, item_kinds: { user_message: 1 } } });
    expect(exportChildTurnCollectionJson(input)).toBe(before);
  });

  it("export→parse 뒤에도 같은 관측 요약을 반환한다", () => {
    const input = make();
    expect(summarize(parseChildTurnCollectionJson(exportChildTurnCollectionJson(input)))).toEqual(summarize(input));
  });

  it("turn 상태 null은 unknown으로 세고 필수 status 속성의 누락은 거부한다", () => {
    const input = make(), page = input.collection!.pages[0];
    if (page.kind !== "page") throw new Error("합성 페이지 없음");
    page.turns[0].status = null;
    expect(summarize(input).collection!.observations!.turn_statuses.unknown).toBe(1);
    Reflect.deleteProperty(page.turns[0], "status");
    reject(input);
  });

  it("손상된 필수 값과 getter를 원문 없는 고정 오류로 거부한다", () => {
    for (const input of [null, undefined, [], {}, { ...make(), cleanup_status: "PRIVATE_STATUS" },
      { ...make(), initialization_error: "PRIVATE_ERROR" }, { ...make(), collection: null }]) reject(input);
    const input = make();
    Object.assign(input.collection!, { source_id: "PRIVATE/PATH" }); reject(input);
    let calls = 0;
    const getter = make();
    Object.defineProperty(getter, "cleanup_status", { get() { calls++; throw new Error("PRIVATE_ACCESSOR"); } });
    reject(getter); expect(calls).toBe(0);
    const revoked = Proxy.revocable({}, {}); revoked.revoke(); reject(revoked.proxy);
  });

  it("공유 페이지 예산 경계는 집계하고 초과는 잘라내지 않고 거부한다", () => {
    const input = make(), collection = input.collection!, page = collection.pages[0];
    if (page.kind !== "page") throw new Error("합성 페이지 없음");
    collection.status = "partial"; collection.reason = "page_limit";
    collection.pages = Array(20).fill(page);
    expect(summarize(input).collection).toMatchObject({ pages: { received: 20, supported: 20 }, observations: { turns: 20, items: 20 } });
    collection.pages.push(page); reject(input);
    collection.pages = [page];
    page.turns[0].items = Array.from({ length: 10000 }, (_, index) => ({ index, kind: "unsupported" as const }));
    expect(summarize(input).collection!.observations!.item_kinds.unsupported).toBe(10000);
    page.turns[0].items.push({ index: 10000, kind: "unsupported" }); reject(input);
    page.turns[0].items = [];
    page.turns = Array.from({ length: 10001 }, (_, index) => ({ index, turn_id: null, status: null, items_view: "full", items: [] }));
    reject(input);
  });
});
