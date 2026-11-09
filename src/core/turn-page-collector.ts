import { normalizeCodexThreadReadV0166 } from "../adapters/codex-app-server-thread-read.js";
import type { ThreadReadResult } from "../adapters/codex-app-server-thread-read.js";
import { normalizeCodexTurnsPageV0166 } from "../adapters/codex-app-server-turns.js";
import type { TurnsPageResult } from "../adapters/codex-app-server-turns.js";
import { ReadTransportError } from "../adapters/codex-read-transport.js";
import type { CollectionStop } from "./thread-page-collector.js";

export interface TurnReadClient {
  readThread(threadId: string, signal?: AbortSignal): Promise<unknown>;
  listTurns(threadId: string, cursor?: string, signal?: AbortSignal): Promise<unknown>;
}
export interface TurnPageCollection {
  verification_status: "unverified";
  source_id: string;
  status: "last_page" | "partial";
  reason: CollectionStop;
  thread: ThreadReadResult | null;
  pages: TurnsPageResult[];
}
function own(value: object, key: string): unknown {
  try { const d = Object.getOwnPropertyDescriptor(value, key); return d && "value" in d ? d.value : undefined; } catch { return undefined; }
}
function withAbort<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new ReadTransportError("cancelled"));
  if (!signal) return request();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (action: () => void): void => {
      if (done) return;
      done = true; signal.removeEventListener("abort", abort); action();
    };
    const abort = () => finish(() => reject(new ReadTransportError("cancelled")));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try { void request().then(value => finish(() => resolve(value)), error => finish(() => reject(error))); }
    catch (error) { finish(() => reject(error)); }
  });
}

/** 초기화된 클라이언트의 full turn 페이지만 수집한다. last_page는 전체 기록 완전성의 증거가 아니다. */
export async function collectCodexTurnPagesV0166(client: TurnReadClient, threadId: string, sourceId: string,
  options: { maxPages?: number; signal?: AbortSignal } = {}): Promise<TurnPageCollection> {
  if (typeof threadId !== "string" || !threadId.trim() || threadId.length > 65536) throw new TypeError("스레드 ID를 확인하세요.");
  if (typeof sourceId !== "string") throw new TypeError("출처 별칭을 확인하세요.");
  normalizeCodexThreadReadV0166(null, sourceId);
  const maxPages = options.maxPages ?? 10;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20) throw new RangeError("페이지 한도는 1~20이어야 합니다.");
  const result: TurnPageCollection = { verification_status: "unverified", source_id: sourceId,
    status: "partial", reason: "transport_error", thread: null, pages: [] };
  const stop = (reason: CollectionStop): TurnPageCollection => { result.reason = reason; return result; };
  try {
    result.thread = normalizeCodexThreadReadV0166(await withAbort(() => client.readThread(threadId, options.signal), options.signal), sourceId);
    if (options.signal?.aborted) return stop("cancelled");
    if (result.thread.kind !== "thread") return stop("invalid_thread");
    if (result.thread.thread_id !== threadId) return stop("thread_mismatch");
    const seen = new Set<string>();
    let cursor: string | undefined;
    while (result.pages.length < maxPages) {
      const raw = await withAbort(() => client.listTurns(threadId, cursor, options.signal), options.signal);
      let snapshot: { data: unknown; nextCursor: unknown } | null = null;
      try { if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) snapshot = { data: own(raw, "data"), nextCursor: own(raw, "nextCursor") }; }
      catch { /* 손상된 입력은 invalid_page로 남긴다. */ }
      const page = normalizeCodexTurnsPageV0166(snapshot, sourceId);
      result.pages.push(page);
      if (options.signal?.aborted) return stop("cancelled");
      if (page.kind !== "page") return stop("invalid_page");
      const next = snapshot?.nextCursor;
      if (next === null) { result.status = "last_page"; return stop("last_page"); }
      if (next === undefined) return stop("cursor_unknown");
      if (typeof next !== "string" || next.length === 0 || next.length > 65536) return stop("cursor_invalid");
      if (seen.has(next)) return stop("cursor_repeated");
      seen.add(next); cursor = next;
    }
    return stop("page_limit");
  } catch (error: unknown) {
    if (options.signal?.aborted) return stop("cancelled");
    if (error instanceof ReadTransportError && ["cancelled", "timeout", "server_error"].includes(error.code)) {
      return stop(error.code as "cancelled" | "timeout" | "server_error");
    }
    return stop("transport_error");
  }
}
