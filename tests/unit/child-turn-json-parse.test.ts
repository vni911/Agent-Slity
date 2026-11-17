import { describe, expect, it, vi } from "vitest";
import { exportChildTurnCollectionJson, normalizeCodexThreadReadV0166, normalizeCodexTurnsPageV0166,
  parseChildTurnCollectionJson } from "../../src/index.js";
import type { ChildTurnCollectionResult } from "../../src/index.js";

const limit = 16 * 1024 * 1024;
function make(): ChildTurnCollectionResult {
  const items = [
    { type: "userMessage", id: "user", content: [{ text: "PRIVATE_MESSAGE" }], startedAtMs: 0 },
    { type: "agentMessage", id: "agent", text: "PRIVATE_TEXT", completedAtMs: -1 },
    { type: "commandExecution", id: "command", status: "completed", exitCode: 0, durationMs: 0, command: "PRIVATE_COMMAND" },
    { type: "fileChange", id: "file", status: "completed", changes: [{ path: "PRIVATE_PATH", kind: { type: "add" } }] },
    { type: "collabAgentToolCall", id: "collab", senderThreadId: "parent", receiverThreadIds: ["child", "child"],
      tool: "spawnAgent", status: "completed" },
    { type: "subAgentActivity", id: "activity", agentThreadId: "child", kind: "started", model: "synthetic-model", reasoningEffort: "high" },
    { type: "future", content: "PRIVATE_UNKNOWN" },
    { type: "userMessage", id: "user" },
  ];
  return { initialization_error: null, cleanup_status: "unknown", collection: {
    source_id: "sample", verification_status: "unverified", status: "last_page", reason: "last_page",
    thread: normalizeCodexThreadReadV0166({ thread: { id: "thread", parentThreadId: null, sessionId: "session" } }, "sample"),
    pages: [normalizeCodexTurnsPageV0166({ data: [{ id: "turn", status: "completed", itemsView: "full", items }], nextCursor: null }, "sample")],
  } };
}
function document() {
  return { format: "agent-slity.child-turn-collection", version: 1, schema_reference: "0.166.0",
    verification_status: "unverified", result: make() };
}
const parse = (input: unknown) => parseChildTurnCollectionJson(input as string);
function reject(input: unknown) {
  expect(() => parse(input)).toThrowError(new TypeError("유효하지 않은 turn 수집 JSON입니다."));
}

describe("자식 turn 수집 JSON 다시 읽기", () => {
  it("모든 지원 유형과 미지원 위치·null·0·순서·중복을 왕복 보존한다", () => {
    const input = make(), json = exportChildTurnCollectionJson(input), result = parse(json);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(exportChildTurnCollectionJson(result)).toBe(json);
    const page = result.collection!.pages[0];
    if (page.kind !== "page") throw new Error("합성 페이지 없음");
    expect(page.turns[0].items.map(x => x.kind)).toEqual([
      "user_message", "agent_message", "command_execution", "file_change", "collab", "subagent_activity", "unsupported", "user_message",
    ]);
    expect(page.turns[0].items[0]).toMatchObject({ started_at_ms: 0, completed_at_ms: null });
    expect(page.turns[0].items[1]).toMatchObject({ completed_at_ms: -1 });
    expect(page.turns[0].items[2]).toMatchObject({ exit_code: 0, duration_ms: 0 });
    expect(json).not.toContain("PRIVATE_");
  });

  it("모든 초기화 오류와 직접 자식 정리 상태를 별개로 보존한다", () => {
    for (const initialization_error of ["cancelled", "timeout", "server_error", "invalid_input", "transport_error"] as const) {
      for (const cleanup_status of ["unknown", "exit_observed"] as const) {
        const result: ChildTurnCollectionResult = { initialization_error, cleanup_status, collection: null };
        expect(parse(exportChildTurnCollectionJson(result))).toEqual(result);
      }
    }
  });

  it("부분 수집 사유를 보존하고 미지원 페이지·중복 페이지를 제거하지 않는다", () => {
    for (const reason of ["invalid_thread", "thread_mismatch", "invalid_page", "cursor_unknown", "cursor_invalid",
      "cursor_repeated", "page_limit", "cancelled", "timeout", "server_error", "transport_error"] as const) {
      const result = make(), collection = result.collection!;
      collection.status = "partial"; collection.reason = reason;
      collection.pages.push(collection.pages[0], normalizeCodexTurnsPageV0166(null, "sample"));
      expect(parse(exportChildTurnCollectionJson(result))).toEqual(result);
    }
  });

  it("조회 전 실패·미지원 스레드·빈 마지막 페이지와 이전 누락 상태를 읽는다", () => {
    const result = make(), collection = result.collection!;
    collection.pages = []; collection.thread = null; collection.status = "partial"; collection.reason = "transport_error";
    expect(parse(exportChildTurnCollectionJson(result))).toEqual(result);
    collection.thread = normalizeCodexThreadReadV0166(null, "sample"); collection.reason = "invalid_thread";
    expect(parse(exportChildTurnCollectionJson(result))).toEqual(result);
    const old = make();
    if (old.collection!.thread?.kind !== "thread") throw new Error("합성 스레드 없음");
    delete old.collection!.thread.parent_thread_id_status;
    old.collection!.pages = [normalizeCodexTurnsPageV0166({ data: [], nextCursor: null }, "sample")];
    const parsed = parse(JSON.stringify({ ...document(), result: old }));
    expect(parsed.collection!.thread).toMatchObject({ parent_thread_id_status: "unknown" });
    expect(parsed.collection!.pages).toEqual(old.collection!.pages);
  });

  it("알려진 필드의 식별자·보고된 설정은 비밀 탐지 없이 보존한다", () => {
    const input = make(), page = input.collection!.pages[0];
    if (page.kind !== "page") throw new Error("합성 페이지 없음");
    Object.assign(page.turns[0].items[5], { item_id: "PRIVATE_ALLOWED_ID", reported_model: "PRIVATE_ALLOWED_MODEL" });
    const result = parse(JSON.stringify({ ...document(), result: input }));
    expect(JSON.stringify(result)).toContain("PRIVATE_ALLOWED_ID");
    expect(JSON.stringify(result)).toContain("PRIVATE_ALLOWED_MODEL");
  });

  it("추가 원문·toJSON·프로토타입 속성을 모든 객체 수준에서 복사하지 않는다", () => {
    const input = document(), result = input.result, collection = result.collection!, thread = collection.thread!;
    const page = collection.pages[0];
    if (thread.kind !== "thread" || page.kind !== "page") throw new Error("합성 관측 없음");
    for (const object of [input, result, collection, thread, thread.source, page, page.turns[0], ...page.turns[0].items]) {
      Object.assign(object, { message: "PRIVATE_EXTRA", path: "PRIVATE_PATH", cursor: "PRIVATE_CURSOR", toJSON: "PRIVATE_TOJSON" });
      Object.defineProperty(object, "__proto__", { enumerable: true, value: { polluted: "PRIVATE_PROTO" } });
      Object.defineProperty(object, "constructor", { enumerable: true, value: { prototype: { polluted: "PRIVATE_CONSTRUCTOR" } } });
    }
    const parsed = parse(JSON.stringify(input));
    expect(parsed).toEqual(make());
    expect(JSON.stringify(parsed)).not.toContain("PRIVATE_");
    expect(Object.hasOwn(parsed, "__proto__")).toBe(false);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("비문자열과 JSON 구문 오류를 원문 없이 거부한다", () => {
    let calls = 0;
    const object = { toString() { calls++; return "PRIVATE_COERCION"; } };
    const proxy = new Proxy({}, { get() { calls++; throw new Error("PRIVATE_TRAP"); } });
    for (const value of [null, undefined, 1, true, {}, [], Buffer.from("{}"), new String("{}"), object, proxy]) reject(value);
    for (const json of ["", "PRIVATE_INVALID", "\uFEFF{}", '{"private":"PRIVATE_TRUNCATED"', "{}\n{}", "[]", "null", "1"]) reject(json);
    expect(calls).toBe(0);
  });

  it("envelope의 형식·버전·schema·unverified·result를 필수 검사한다", () => {
    for (const key of ["format", "version", "schema_reference", "verification_status", "result"]) {
      const input = { ...document() } as Record<string, unknown>; delete input[key]; reject(JSON.stringify(input));
    }
    for (const patch of [
      { format: "codex_app_server" }, { version: 2 }, { version: "1" }, { schema_reference: "future" },
      { verification_status: "verified" }, { result: null }, { result: [] },
    ]) reject(JSON.stringify({ ...document(), ...patch }));
  });

  it("손상된 상태·별칭·위치·값과 모순된 마지막 페이지 판정을 거부한다", () => {
    for (const patch of [{ initialization_error: null, collection: null }, { cleanup_status: "done" },
      { initialization_error: "server_error" }]) reject(JSON.stringify({ ...document(), result: { ...make(), ...patch } }));
    for (const patch of [{ source_id: "PRIVATE/PATH" }, { verification_status: "verified" }, { status: "partial", reason: "last_page" },
      { thread: null }, { pages: [] }]) {
      const input = document(); Object.assign(input.result.collection!, patch); reject(JSON.stringify(input));
    }
    for (const patch of [{ index: 1 }, { kind: "future" }, { item_id: "x".repeat(257) }, { started_at_ms: 1.5 }]) {
      const input = document(), page = input.result.collection!.pages[0];
      if (page.kind !== "page") throw new Error("합성 페이지 없음");
      Object.assign(page.turns[0].items[0], patch); reject(JSON.stringify(input));
    }
    const input = document(), page = input.result.collection!.pages[0];
    Object.assign(page, { next_page: "available" }); reject(JSON.stringify(input));
    Object.assign(page, { next_page: "none", schema_reference: "future" }); reject(JSON.stringify(input));
  });

  it("공유 검증기의 페이지·turn·합산 item·중첩 예산 초과를 거부한다", () => {
    const input = document(), collection = input.result.collection!, page = collection.pages[0];
    if (page.kind !== "page") throw new Error("합성 페이지 없음");
    collection.status = "partial"; collection.reason = "page_limit";
    collection.pages = Array(21).fill(page); reject(JSON.stringify(input));
    collection.pages = [page];
    const turn = page.turns[0];
    page.turns = Array.from({ length: 10001 }, (_, index) => ({ ...turn, index, items: [] }));
    reject(JSON.stringify(input));
    page.turns = [turn];
    turn.items = Array.from({ length: 10001 }, (_, index) => ({ index, kind: "unsupported" as const }));
    reject(JSON.stringify(input));
    for (const kind of ["collab", "file_change"]) {
      Object.assign(turn, { items: [6000, 4001].map((count, index) => kind === "collab" ? {
        index, kind, turn_id: null, item_id: null, started_at_ms: null, completed_at_ms: null, sender_thread_id: null,
        receiver_thread_ids: Array(count).fill(null), tool: "spawnAgent", status: "completed",
      } : { index, kind, turn_id: null, item_id: null, started_at_ms: null, completed_at_ms: null,
        change_kinds: Array(count).fill(null), status: "completed" }) });
      reject(JSON.stringify(input));
    }
  });

  it("16MiB 경계는 허용하고 UTF-8 바이트 초과는 JSON.parse 전에 거부한다", () => {
    const json = JSON.stringify(document());
    expect(parse(json + " ".repeat(limit - Buffer.byteLength(json)))).toEqual(make());
    const parser = vi.spyOn(JSON, "parse");
    try {
      reject(json + " ".repeat(limit - Buffer.byteLength(json) + 1));
      reject('"' + "가".repeat(Math.ceil(limit / 3)) + '"');
      expect(parser).not.toHaveBeenCalled();
    } finally { parser.mockRestore(); }
  });
});
