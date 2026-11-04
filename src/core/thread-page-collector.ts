import { normalizeCodexThreadReadV0166 } from "../adapters/codex-app-server-thread-read.js";
import type { ThreadReadResult } from "../adapters/codex-app-server-thread-read.js";
import { normalizeCodexItemsPageV0166 } from "../adapters/codex-app-server-items.js";
import type { ItemsPageResult } from "../adapters/codex-app-server-items.js";
import { ReadTransportError } from "../adapters/codex-read-transport.js";

export interface ThreadReadClient {
  readThread(threadId: string, signal?: AbortSignal): Promise<unknown>;
  listItems(threadId: string, cursor?: string, signal?: AbortSignal): Promise<unknown>;
}
export type CollectionStop = "last_page" | "invalid_thread" | "thread_mismatch" | "invalid_page" | "cursor_unknown" |
  "cursor_invalid" | "cursor_repeated" | "page_limit" | "cancelled" | "timeout" | "server_error" | "transport_error";
export interface ThreadPageCollection {
  verification_status: "unverified";
  source_id: string;
  status: "last_page" | "partial";
  reason: CollectionStop;
  thread: ThreadReadResult | null;
  pages: ItemsPageResult[];
}

function own(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function pageSnapshot(value: unknown): { data: unknown; nextCursor: unknown } | null {
  if (typeof value !== "object" || value === null) return null;
  try {
    if (Array.isArray(value)) return null;
    return { data: own(value, "data"), nextCursor: own(value, "nextCursor") };
  } catch { return null; }
}

function withAbort<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new ReadTransportError("cancelled"));
  if (!signal) return request();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (action: () => void): void => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => finish(() => reject(new ReadTransportError("cancelled")));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    try { void request().then((value) => finish(() => resolve(value)), (error: unknown) => finish(() => reject(error))); }
    catch (error: unknown) { finish(() => reject(error)); }
  });
}

/** 이미 초기화된 읽기 클라이언트를 사용한다. 마지막 페이지도 전체 기록의 완전성을 보장하지 않는다. */
export async function collectCodexThreadPagesV0166(client: ThreadReadClient, threadId: string, sourceId: string,
  options: { maxPages?: number; signal?: AbortSignal } = {}): Promise<ThreadPageCollection> {
  if (typeof threadId !== "string" || threadId.trim().length === 0 || threadId.length > 65536) throw new TypeError("스레드 ID를 확인하세요.");
  if (typeof sourceId !== "string") throw new TypeError("출처 별칭을 확인하세요.");
  normalizeCodexThreadReadV0166(null, sourceId);
  const maxPages = options.maxPages ?? 10;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20) throw new RangeError("페이지 한도는 1~20이어야 합니다.");
  const result: ThreadPageCollection = { verification_status: "unverified", source_id: sourceId, status: "partial",
    reason: "transport_error", thread: null, pages: [] };
  const stop = (reason: CollectionStop): ThreadPageCollection => { result.reason = reason; return result; };
  const cancelled = (): boolean => options.signal?.aborted === true;
  try {
    if (cancelled()) return stop("cancelled");
    const thread = normalizeCodexThreadReadV0166(await withAbort(() => client.readThread(threadId, options.signal), options.signal), sourceId);
    result.thread = thread;
    if (cancelled()) return stop("cancelled");
    if (thread.kind !== "thread") return stop("invalid_thread");
    if (thread.thread_id !== threadId) return stop("thread_mismatch");
    const seen = new Set<string>();
    let cursor: string | undefined;
    while (result.pages.length < maxPages) {
      if (cancelled()) return stop("cancelled");
      const raw = await withAbort(() => client.listItems(threadId, cursor, options.signal), options.signal);
      const snapshot = pageSnapshot(raw);
      const page = normalizeCodexItemsPageV0166(snapshot, sourceId);
      result.pages.push(page);
      if (cancelled()) return stop("cancelled");
      if (page.kind !== "page") return stop("invalid_page");
      const next = snapshot?.nextCursor;
      if (next === null) { result.status = "last_page"; return stop("last_page"); }
      if (next === undefined) return stop("cursor_unknown");
      if (typeof next !== "string" || next.length === 0 || next.length > 65536) return stop("cursor_invalid");
      if (seen.has(next)) return stop("cursor_repeated");
      seen.add(next);
      cursor = next;
    }
    return stop("page_limit");
  } catch (error: unknown) {
    if (cancelled()) return stop("cancelled");
    if (error instanceof ReadTransportError) {
      if (error.code === "cancelled" || error.code === "timeout" || error.code === "server_error") return stop(error.code);
    }
    return stop("transport_error");
  }
}
