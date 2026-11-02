import type { EventSource, NormalizationResult, ObservedUsage } from "./events.js";

function invalid(): never {
  throw new TypeError("유효하지 않은 정규화 결과입니다.");
}

function nullableString(value: unknown): string | null {
  return value === null || typeof value === "string" ? value : invalid();
}

function nullableCount(value: unknown): number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    ? value : invalid();
}

function sourceOf(source: EventSource): EventSource {
  if (!source || source.format !== "codex_exec_jsonl" || !Number.isSafeInteger(source.line) || source.line < 1 ||
      source.format_version !== null || source.collected_at !== null) invalid();
  const sourceId = nullableString(source.source_id);
  if (sourceId !== null && (sourceId.length < 1 || sourceId.length > 64 || /[^A-Za-z0-9_-]/.test(sourceId))) invalid();
  return {
    format: "codex_exec_jsonl", line: source.line, source_id: sourceId,
    format_version: null, collected_at: null,
  };
}

function usageOf(usage: ObservedUsage): ObservedUsage {
  if (!usage) invalid();
  return {
    input_tokens: nullableCount(usage.input_tokens), cached_input_tokens: nullableCount(usage.cached_input_tokens),
    output_tokens: nullableCount(usage.output_tokens), reasoning_output_tokens: nullableCount(usage.reasoning_output_tokens),
  };
}

/** 정규화 결과를 메모리의 JSON 문자열로 반환하며 파일을 쓰지 않는다. */
export function exportNormalizationJson(results: readonly NormalizationResult[]): string {
  try {
    return serialize(results);
  } catch {
    return invalid();
  }
}

function serialize(results: readonly NormalizationResult[]): string {
  if (!Array.isArray(results)) invalid();
  const entries: NormalizationResult[] = Array.from(results, (result): NormalizationResult => {
    if (!result || typeof result !== "object") return invalid();
    if (result.kind === "diagnostic") {
      if (!["invalid_json", "invalid_utf8", "line_too_long"].includes(result.code)) invalid();
      return { kind: "diagnostic", source: sourceOf(result.source), code: result.code };
    }
    if (result.kind === "unsupported") {
      if (!["invalid_record", "unsupported_event_type"].includes(result.reason)) invalid();
      return { kind: "unsupported", source: sourceOf(result.source), reason: result.reason };
    }
    if (result.kind !== "event" || !result.event || !result.event.payload) return invalid();
    const e = result.event;
    if (e.run_id !== null || e.task_id !== null || e.parent_thread_id !== null || e.agent_id !== null ||
        e.event_id !== null || e.timestamp !== null || e.verification_status !== "unverified" ||
        !["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.completed", "error"].includes(e.event_type)) invalid();
    const itemType = e.payload.item_type ?? null;
    const itemId = nullableString(e.payload.item_id ?? null);
    if (itemType !== null && (itemType !== "command_execution" && itemType !== "agent_message" ||
        e.event_type !== "item.started" && e.event_type !== "item.completed")) invalid();
    if (itemId !== null && (itemId.trim().length === 0 ||
        e.event_type !== "item.started" && e.event_type !== "item.completed")) invalid();
    return { kind: "event", event: {
      run_id: null, task_id: null, thread_id: nullableString(e.thread_id), parent_thread_id: null,
      agent_id: null, event_id: null, event_type: e.event_type, timestamp: null,
      source: sourceOf(e.source), verification_status: "unverified", payload: { item_type: itemType, item_id: itemId, usage: usageOf(e.payload.usage) },
    } };
  });
  return JSON.stringify({ format: "agent-slity.normalization-results", version: 1, results: entries });
}
