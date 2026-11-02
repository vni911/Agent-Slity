import type { EventSource, NormalizationResult, ObservedUsage } from "../core/events.js";
import type { JsonlReadResult } from "./jsonl-reader.js";

// 공식 문서에 직접 제시된 유형만 지원한다. 다른 유형은 미지원으로 남긴다.
const SUPPORTED_TYPES = new Set([
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "item.started",
  "item.completed",
  "error",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}

function own(object: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function usageOf(value: unknown): ObservedUsage {
  const usage = isObject(value) ? value : {};
  return {
    input_tokens: tokenCount(own(usage, "input_tokens")),
    cached_input_tokens: tokenCount(own(usage, "cached_input_tokens")),
    output_tokens: tokenCount(own(usage, "output_tokens")),
    reasoning_output_tokens: tokenCount(own(usage, "reasoning_output_tokens")),
  };
}

/** JSONL 리더 한 줄을 변환한다. 원본 값의 실제 실행 여부를 검증하지 않는다. */
export function normalizeCodexExecLine(input: JsonlReadResult): NormalizationResult {
  const source: EventSource = {
    format: "codex_exec_jsonl", line: input.line, source_id: null, format_version: null, collected_at: null,
  };
  if (input.kind === "diagnostic") {
    return { kind: "diagnostic", source, code: input.code };
  }
  if (!isObject(input.value)) {
    return { kind: "unsupported", source, reason: "invalid_record" };
  }
  const type = own(input.value, "type");
  if (typeof type !== "string" || !SUPPORTED_TYPES.has(type)) {
    return { kind: "unsupported", source, reason: "unsupported_event_type" };
  }
  const rawThreadId = own(input.value, "thread_id");
  const threadId = typeof rawThreadId === "string" && rawThreadId.trim().length > 0
    ? rawThreadId
    : null;

  return {
    kind: "event",
    event: {
      run_id: null,
      task_id: null,
      thread_id: threadId,
      parent_thread_id: null,
      agent_id: null,
      event_id: null,
      event_type: type,
      timestamp: null,
      source,
      verification_status: "unverified",
      // 공식 예시의 turn.completed 사용량만 보존한다. 집계하지 않는다.
      payload: { usage: usageOf(type === "turn.completed" ? own(input.value, "usage") : undefined) },
    },
  };
}
