export interface ThreadReadSource {
  format: "codex_app_server_thread_read";
  schema_reference: "0.166.0";
  source_id: string | null;
}

export type ThreadReadResult =
  | { kind: "thread"; source: ThreadReadSource; verification_status: "unverified"; thread_id: string;
      parent_thread_id: string | null; session_id: string | null; forked_from_id: string | null }
  | { kind: "unsupported"; source: ThreadReadSource; reason: "invalid_thread" };

function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try { return !Array.isArray(value); } catch { return false; }
}

function own(object: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function id(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** 입력 진위와 버전은 검증하지 않는다. 스키마 기준은 호출자가 선택한다. */
export function normalizeCodexThreadReadV0166(input: unknown, sourceId?: string): ThreadReadResult {
  if (sourceId !== undefined && (typeof sourceId !== "string" || sourceId.length < 1 || sourceId.length > 64 || /[^A-Za-z0-9_-]/.test(sourceId))) {
    throw new TypeError("출처 별칭은 영문자, 숫자, 밑줄, 하이픈 1~64자여야 합니다.");
  }
  const source: ThreadReadSource = { format: "codex_app_server_thread_read", schema_reference: "0.166.0", source_id: sourceId ?? null };
  const thread = isObject(input) ? own(input, "thread") : undefined;
  const threadId = isObject(thread) ? id(own(thread, "id")) : null;
  if (!isObject(thread) || threadId === null) return { kind: "unsupported", source, reason: "invalid_thread" };
  return {
    kind: "thread", source, verification_status: "unverified", thread_id: threadId,
    parent_thread_id: id(own(thread, "parentThreadId")), session_id: id(own(thread, "sessionId")),
    forked_from_id: id(own(thread, "forkedFromId")),
  };
}
