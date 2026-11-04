import { describe, expect, it } from "vitest";
import { normalizeCodexItemsPageV0166 } from "../../src/index.js";

describe("저장 항목 페이지 정규화", () => {
  it("파일 변경 유형과 상태의 순서·중복만 보존하고 경로와 diff는 제외한다", () => {
    const change = (type: string) => ({ kind: { type, move_path: "PRIVATE_MOVE" }, path: "PRIVATE_PATH", diff: "PRIVATE_DIFF" });
    const result = normalizeCodexItemsPageV0166({ data: [{ turnId: "turn", startedAtMs: 0, item: { type: "fileChange", id: "item", status: "completed",
      changes: [change("add"), change("update"), change("delete"), change("add"), change("future"), null] } }] }, "sample");
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items).toEqual([{ index: 0, kind: "file_change", turn_id: "turn", item_id: "item", started_at_ms: 0,
      completed_at_ms: null, status: "completed", change_kinds: ["add", "update", "delete", "add", null, null] }]);
    expect(result.verification_status).toBe("unverified");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });

  it("변경 배열 전체 한도·누락·getter를 추론 없이 처리한다", () => {
    const entry = { item: { type: "fileChange", status: "future", changes: Array(10000).fill({ kind: { type: "add" } }) } };
    let called = false;
    const item = { type: "fileChange", status: "failed" };
    Object.defineProperty(item, "changes", { get() { called = true; throw new Error("PRIVATE"); } });
    const result = normalizeCodexItemsPageV0166({ data: [entry, entry, { item }, { item: { type: "fileChange", changes: [] } }] });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items[0]).toMatchObject({ status: null, change_kinds: Array(10000).fill("add") });
    expect(result.items[1]).toMatchObject({ change_kinds: null });
    expect(result.items[2]).toMatchObject({ status: "failed", change_kinds: null });
    expect(result.items[3]).toMatchObject({ change_kinds: [] });
    expect(called).toBe(false);
  });

  it("모든 파일 변경 상태를 보존하고 내부 getter를 실행하지 않는다", () => {
    let called = false;
    const change = {};
    const kind = {};
    Object.defineProperty(change, "kind", { get() { called = true; throw new Error("PRIVATE"); } });
    Object.defineProperty(kind, "type", { get() { called = true; throw new Error("PRIVATE"); } });
    const result = normalizeCodexItemsPageV0166({ data: ["inProgress", "completed", "failed", "declined"].map((status) =>
      ({ item: { type: "fileChange", status, changes: [change, { kind }] } })) });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items.map((item) => item.kind === "file_change" ? [item.status, item.change_kinds] : null)).toEqual(
      ["inProgress", "completed", "failed", "declined"].map((status) => [status, [null, null]]));
    expect(called).toBe(false);
  });
  it("명령 실행의 상태와 종료 코드만 보존하고 민감한 원문은 제외한다", () => {
    const entry = { turnId: "turn", startedAtMs: 0, completedAtMs: 12, item: { type: "commandExecution", id: "item",
      status: "completed", exitCode: 0, durationMs: 12, command: "PRIVATE_COMMAND", cwd: "PRIVATE_PATH", aggregatedOutput: "PRIVATE_OUTPUT" } };
    const result = normalizeCodexItemsPageV0166({ data: [entry, entry] }, "sample");
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items).toEqual([0, 1].map((index) => ({ index, kind: "command_execution", turn_id: "turn", item_id: "item",
      started_at_ms: 0, completed_at_ms: 12, status: "completed", exit_code: 0, duration_ms: 12 })));
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    expect(result.verification_status).toBe("unverified");
  });

  it("명령 메타데이터의 누락·범위·타입을 확인하고 상충 값은 추론하지 않는다", () => {
    const command = (status: unknown, exitCode: unknown, durationMs: unknown) => ({ item: { type: "commandExecution", status, exitCode, durationMs } });
    const result = normalizeCodexItemsPageV0166({ data: [command("failed", -2147483648, 0), command("declined", 2147483647, Number.MAX_SAFE_INTEGER),
      command("future", 2147483648, -1), command("completed", 1.5, Number.MAX_SAFE_INTEGER + 1), command(null, null, "12")] });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items.map((item) => item.kind === "command_execution" ? [item.status, item.exit_code, item.duration_ms] : null)).toEqual([
      ["failed", -2147483648, 0], ["declined", 2147483647, Number.MAX_SAFE_INTEGER], [null, null, null], ["completed", null, null], [null, null, null],
    ]);
  });

  it("명령 상태 inProgress를 보존하고 getter는 실행하지 않는다", () => {
    let called = false;
    const item = { type: "commandExecution", status: "inProgress" };
    Object.defineProperty(item, "exitCode", { get() { called = true; throw new Error("PRIVATE"); } });
    const result = normalizeCodexItemsPageV0166({ data: [{ item }] });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items[0]).toMatchObject({ kind: "command_execution", status: "inProgress", exit_code: null });
    expect(called).toBe(false);
  });
  it("명시된 시작·종료 밀리초만 보존하며 시간 순서를 추론하지 않는다", () => {
    const item = { type: "collabAgentToolCall" };
    let called = false;
    const getter = { item };
    Object.defineProperty(getter, "startedAtMs", { get() { called = true; throw new Error("PRIVATE"); } });
    const result = normalizeCodexItemsPageV0166({ data: [
      { item, startedAtMs: 100, completedAtMs: 0 },
      { item: { type: "subAgentActivity" }, startedAtMs: -1, completedAtMs: Number.MAX_SAFE_INTEGER },
      { item, startedAtMs: 1.5, completedAtMs: Number.MAX_SAFE_INTEGER + 1 },
      { item, startedAtMs: "12", completedAtMs: null }, getter,
    ] });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items.map((entry) => entry.kind === "unsupported" ? null : [entry.started_at_ms, entry.completed_at_ms])).toEqual([
      [100, 0], [-1, Number.MAX_SAFE_INTEGER], [null, null], [null, null], [null, null],
    ]);
    expect(called).toBe(false);
  });
  it("협업 호출의 명시적 필드와 중복을 보존하고 원문·커서는 제외한다", () => {
    const entry = { turnId: "turn", item: { type: "collabAgentToolCall", id: "item", senderThreadId: "sender",
      receiverThreadIds: ["receiver", "receiver"], tool: "spawnAgent", status: "completed", prompt: "PRIVATE_PROMPT" } };
    const result = normalizeCodexItemsPageV0166({ data: [entry, entry, { item: { type: "agentMessage", text: "PRIVATE_MESSAGE" } }], nextCursor: "PRIVATE_CURSOR" }, "sample");
    expect(result.kind).toBe("page");
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result).toEqual({ kind: "page", source_id: "sample", schema_reference: "0.166.0", verification_status: "unverified", next_page: "available", items: [
      { index: 0, kind: "collab", turn_id: "turn", item_id: "item", started_at_ms: null, completed_at_ms: null, sender_thread_id: "sender", receiver_thread_ids: ["receiver", "receiver"], tool: "spawnAgent", status: "completed" },
      { index: 1, kind: "collab", turn_id: "turn", item_id: "item", started_at_ms: null, completed_at_ms: null, sender_thread_id: "sender", receiver_thread_ids: ["receiver", "receiver"], tool: "spawnAgent", status: "completed" },
      { index: 2, kind: "unsupported" },
    ] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });

  it("누락·잘못된 값과 미지 유형을 추정하지 않는다", () => {
    const result = normalizeCodexItemsPageV0166({ data: [{ item: { type: "collabAgentToolCall", receiverThreadIds: [" ", 3], tool: "future", status: "future" } },
      { item: { type: "collabToolCall" } }, null] });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.next_page).toBe("unknown");
    expect(result.items).toEqual([{ index: 0, kind: "collab", turn_id: null, item_id: null, started_at_ms: null, completed_at_ms: null, sender_thread_id: null,
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

  it("협업 ID의 길이 경계와 반복된 초과 수신 ID를 자르지 않고 보존한다", () => {
    const maximum = "x".repeat(256);
    const tooLong = "x".repeat(257);
    const entry = { turnId: maximum, item: { type: "collabAgentToolCall", id: tooLong, senderThreadId: maximum,
      receiverThreadIds: [tooLong, maximum, tooLong] } };
    const result = normalizeCodexItemsPageV0166({ data: [entry, entry] });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items).toEqual([0, 1].map((index) => ({ index, kind: "collab", turn_id: maximum, item_id: null, started_at_ms: null, completed_at_ms: null,
      sender_thread_id: maximum, receiver_thread_ids: [null, maximum, null], tool: null, status: null })));
  });

  it("긴 ID가 만 개 반복되어도 초과 ID를 결과에 복사하지 않는다", () => {
    const tooLong = "x".repeat(100000);
    const entry = { turnId: tooLong, item: { type: "collabAgentToolCall", id: tooLong, senderThreadId: tooLong,
      receiverThreadIds: Array(10000).fill(tooLong) } };
    const result = normalizeCodexItemsPageV0166({ data: [entry] });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items[0]).toMatchObject({ turn_id: null, item_id: null, sender_thread_id: null });
    expect(result.items[0].kind === "collab" && result.items[0].receiver_thread_ids?.every((value) => value === null)).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(60000);
  });

  it("보충 평면 문자는 UTF-16 코드 단위로 계산한다", () => {
    const supplementary = String.fromCodePoint(0x1f600);
    const result = normalizeCodexItemsPageV0166({ data: [{ item: { type: "collabAgentToolCall",
      id: supplementary.repeat(128), receiverThreadIds: [supplementary.repeat(129)] } }] });
    if (result.kind !== "page" || result.items[0].kind !== "collab") throw new Error("협업 항목이 아닙니다.");
    expect(result.items[0].item_id).toBe(supplementary.repeat(128));
    expect(result.items[0].receiver_thread_ids).toEqual([null]);
  });

  it("하위 에이전트 활동과 명시된 설정만 순서·중복을 보존해 출력한다", () => {
    const entry = { turnId: "turn", item: { type: "subAgentActivity", id: "item", agentThreadId: "child",
      kind: "started", model: "model-x", reasoningEffort: "high", agentPath: "PRIVATE_PATH", text: "PRIVATE_TEXT" } };
    const result = normalizeCodexItemsPageV0166({ data: [entry, entry, { item: { type: "other" } }], nextCursor: null }, "sample");
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items).toEqual([
      { index: 0, kind: "subagent_activity", turn_id: "turn", item_id: "item", started_at_ms: null, completed_at_ms: null, agent_thread_id: "child", activity: "started", reported_model: "model-x", reported_reasoning_effort: "high" },
      { index: 1, kind: "subagent_activity", turn_id: "turn", item_id: "item", started_at_ms: null, completed_at_ms: null, agent_thread_id: "child", activity: "started", reported_model: "model-x", reported_reasoning_effort: "high" },
      { index: 2, kind: "unsupported" },
    ]);
    expect(result.verification_status).toBe("unverified");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });

  it("하위 에이전트 활동의 누락·유효하지 않은 값과 getter는 추정하지 않는다", () => {
    let called = false;
    const item = { type: "subAgentActivity", kind: "future", agentThreadId: " ", model: 5 };
    Object.defineProperty(item, "reasoningEffort", { get() { called = true; throw new Error("PRIVATE_GETTER"); } });
    const result = normalizeCodexItemsPageV0166({ data: [{ item }] });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items).toEqual([{ index: 0, kind: "subagent_activity", turn_id: null, item_id: null, started_at_ms: null, completed_at_ms: null,
      agent_thread_id: null, activity: null, reported_model: null, reported_reasoning_effort: null }]);
    expect(called).toBe(false);
    for (const activity of ["started", "interacted", "interrupted", "completed"]) {
      const pageResult = normalizeCodexItemsPageV0166({ data: [{ item: { type: "subAgentActivity", kind: activity } }] });
      expect(pageResult.kind === "page" && pageResult.items[0]).toMatchObject({ activity });
    }
  });

  it("활동 문자열을 256 UTF-16 코드 단위로 제한하고 초과를 null로 둔다", () => {
    const maximum = "x".repeat(256);
    const tooLong = "x".repeat(257);
    const result = normalizeCodexItemsPageV0166({ data: [{ turnId: tooLong, item: { type: "subAgentActivity",
      id: maximum, agentThreadId: tooLong, model: tooLong, reasoningEffort: maximum } }] });
    if (result.kind !== "page") throw new Error("페이지가 아닙니다.");
    expect(result.items[0]).toMatchObject({ turn_id: null, item_id: maximum, agent_thread_id: null,
      reported_model: null, reported_reasoning_effort: maximum });
  });
});
