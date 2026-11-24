import { describe, expect, it } from "vitest";
import { createNormalizationEvidenceReport, createChildTurnEvidenceReport, normalizeCodexExecLine,
  exportChildTurnCollectionJson, normalizeCodexThreadReadV0166, normalizeCodexTurnsPageV0166 } from "../../src/index.js";
import type { ChildTurnCollectionResult } from "../../src/index.js";

const event = (type = "turn.completed", usage: unknown = { input_tokens: 0, output_tokens: 3 }) =>
  normalizeCodexExecLine({ kind: "record", line: 1, value: { type, thread_id: "PRIVATE_THREAD", usage, text: "PRIVATE_RAW" } }, "PRIVATE_ALIAS");
const child = (pages: ReturnType<typeof normalizeCodexTurnsPageV0166>[]): ChildTurnCollectionResult => ({
  initialization_error: null, cleanup_status: "unknown", collection: { source_id: "sample", verification_status: "unverified", status: "partial", reason: "server_error",
    thread: normalizeCodexThreadReadV0166({ thread: { id: "PRIVATE_THREAD" } }, "sample"), pages },
});

describe("근거 기반 JSON 관측 보고서", () => {
  it("관측 수·보고 사용량·중복 후보만 내보내고 고유 수·품질·합산/절감은 unknown이다", () => {
    const records = [event(), event(), normalizeCodexExecLine({ kind: "diagnostic", line: 2, code: "invalid_json" }, "PRIVATE_ALIAS")];
    const before = structuredClone(records), report = createNormalizationEvidenceReport(records);
    expect(report.summary).toMatchObject({ records: 3, events: 2, diagnostics: 1, unsupported: 0 });
    expect(report.reported_usage).toEqual([0, 1].map(record_index => ({ record_index, input_tokens: 0, output_tokens: 3, cached_input_tokens: null, reasoning_output_tokens: null })));
    expect(report.findings[0]).toEqual({ rule_id: "source_position_overlap", rule_version: 1, evidence_level: "suspected", references: [0, 1].map(record_index => ({ kind: "record", record_index })) });
    expect(Object.values(report.unknown_metrics).every(value => value === null)).toBe(true);
    expect(report.unknown_metric_reasons.savings).toBe("no_controlled_baseline");
    expect(report.verification_status).toBe("unverified"); expect(JSON.stringify(report)).not.toContain("PRIVATE_");
    expect(records).toEqual(before);
  });

  it("상충 위치·보고된 오류·검증 미관측의 근거 수준을 구분한다", () => {
    const report = createNormalizationEvidenceReport([event("turn.started"), event("turn.failed")]);
    expect(report.findings.map(f => [f.rule_id, f.evidence_level])).toEqual([
      ["source_position_conflict", "suspected"], ["reported_execution_error", "input_observation"], ["validation_unobserved", "unknown"],
    ]);
    expect(report.findings[1].references).toEqual([{ kind: "record", record_index: 1 }]);
  });

  it("빈 입력과 미지원/진단을 실제 실행의0이나 검증 성공으로 바꾸지 않는다", () => {
    const empty = createNormalizationEvidenceReport([]);
    expect(empty.summary.records).toBe(0); expect(empty.unknown_metrics.unique_executions).toBeNull();
    expect(empty.reported_usage).toEqual([]); expect(empty.findings).toHaveLength(1);
    const report = createNormalizationEvidenceReport([normalizeCodexExecLine({ kind: "record", line: 1, value: { type: "future" } })]);
    expect(report.summary).toMatchObject({ records: 1, events: 0, unsupported: 1 }); expect(report.unknown_metrics.quality).toBeNull();
  });

  it("turn/item 위치·반복ID 후보·보고명령실패·협업tool 관측과 원문 제외를 유지한다", () => {
    const page = normalizeCodexTurnsPageV0166({ data: [{ id: "PRIVATE_TURN", status: "failed", itemsView: "full", items: [
      { type: "commandExecution", id: "PRIVATE_ITEM", status: "completed", exitCode: 2, command: "PRIVATE_COMMAND" },
      { type: "collabAgentToolCall", id: "PRIVATE_COLLAB", tool: "spawnAgent", senderThreadId: "PRIVATE_SENDER", receiverThreadIds: ["PRIVATE_CHILD"], status: "completed" },
      { type: "future", text: "PRIVATE_UNKNOWN" },
    ] }], nextCursor: "PRIVATE_CURSOR" }, "sample");
    const input = child([page, page]), before = structuredClone(input), report = createChildTurnEvidenceReport(input);
    expect(report.summary.collection?.observations).toMatchObject({ turns: 2, items: 6 });
    expect(report.summary.cleanup_status).toBe("unknown"); expect(report.summary.collection?.reason).toBe("server_error");
    expect(report.collaboration_tools).toEqual({ spawnAgent: 2 }); expect(report.reported_usage).toBeNull();
    expect(report.findings.find(f => f.rule_id === "repeated_turn_id")?.references).toEqual([
      { kind: "turn", page_index: 0, turn_index: 0 }, { kind: "turn", page_index: 1, turn_index: 0 },
    ]);
    expect(report.findings.find(f => f.rule_id === "reported_command_failure")?.references).toEqual([0, 1].map(page_index => ({ kind: "item", page_index, turn_index: 0, item_index: 0 })));
    expect(report.findings.filter(f => f.rule_id === "repeated_item_id")).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_"); expect(input).toEqual(before);
  });

  it("미지원 page만 있을 때와 지원된 빈 page의0을 구분한다", () => {
    const unsupported = createChildTurnEvidenceReport(child([normalizeCodexTurnsPageV0166({})]));
    expect(unsupported.summary.collection?.observations).toBeNull(); expect(unsupported.collaboration_tools).toBeNull();
    const empty = createChildTurnEvidenceReport(child([normalizeCodexTurnsPageV0166({ data: [], nextCursor: null })]));
    expect(empty.summary.collection?.observations?.turns).toBe(0); expect(empty.collaboration_tools).toEqual({});
    const failed = createChildTurnEvidenceReport({ initialization_error: "timeout", cleanup_status: "unknown", collection: null });
    expect(failed.summary.initialization_error).toBe("timeout"); expect(failed.summary.collection).toBeNull();
  });

  it("출처가 없는 ID만으로 후보를 만들거나 명령 exit0을 품질 성공으로 해석하지 않는다", () => {
    const page = normalizeCodexTurnsPageV0166({ data: [{ id: "same", status: "completed", itemsView: "full", items: [
      { type: "commandExecution", id: "same", status: "completed", exitCode: 0 },
    ] }], nextCursor: null });
    const report = createChildTurnEvidenceReport(child([page, page]));
    expect(report.findings).toHaveLength(1); expect(report.unknown_metrics.quality).toBeNull();
    expect(report.summary.collection?.observations?.turns).toBe(2);
  });

  it("손상 입력은 raw 오류 없이 거부하고 추가 입력 hook을 호출하지 않는다", () => {
    expect(() => createNormalizationEvidenceReport([{}] as never)).toThrowError(/^근거 보고서를 생성할 수 없습니다\.$/);
    expect(() => createChildTurnEvidenceReport({} as never)).toThrowError(/^근거 보고서를 생성할 수 없습니다\.$/);
    const records = [event()]; let calls = 0;
    Object.defineProperty(records[0], "toJSON", { value: () => { calls++; throw new Error("PRIVATE_HOOK"); } });
    Object.defineProperty(records[0], "extra", { get() { calls++; throw new Error("PRIVATE_HOOK"); } });
    createNormalizationEvidenceReport(records); expect(calls).toBe(0);
  });

  it("미지원 페이지를 건너뛰어도 근거의 실제 page 위치와 지원 범위를 유지한다", () => {
    const page = normalizeCodexTurnsPageV0166({ data: [{ id: "same", status: "completed", itemsView: "full", items: [] }], nextCursor: "next" }, "sample");
    const input = child([normalizeCodexTurnsPageV0166({}), page, page]);
    const report = createChildTurnEvidenceReport(input);
    expect(report.summary.collection?.pages).toEqual({ received: 3, supported: 2, unsupported: 1 });
    expect(report.findings[0].references).toEqual([1, 2].map(page_index => ({ kind: "turn", page_index, turn_index: 0 })));
    expect(report.summary.collection?.count_scope).toBe("supported_pages");
  });

  it("입력이 한도 안이어도 중복 근거로 출력16MiB가 넘으면 잘라내지 않고 거부한다", () => {
    const page = normalizeCodexTurnsPageV0166({ data: [], nextCursor: "next" }, "sample");
    if (page.kind !== "page") throw new Error();
    page.turns = Array.from({ length: 10000 }, (_, index) => ({ index, turn_id: "t", status: "failed", items_view: "full", items: [] }));
    const small = createChildTurnEvidenceReport(child([page]));
    expect(small.findings.find(f => f.rule_id === "reported_execution_error")?.references).toHaveLength(10000);
    const large = child(Array(20).fill(page));
    expect(Buffer.byteLength(exportChildTurnCollectionJson(large))).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(() => createChildTurnEvidenceReport(large)).toThrowError(/^근거 보고서를 생성할 수 없습니다\.$/);
  }, 30000);
});
