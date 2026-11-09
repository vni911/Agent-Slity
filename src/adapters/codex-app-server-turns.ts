import { normalizeCodexItemsPageV0166 } from "./codex-app-server-items.js";
import type { ItemsPageResult } from "./codex-app-server-items.js";

type ExistingItem = Extract<ItemsPageResult, { kind: "page" }>["items"][number];
export type TurnItemObservation = ExistingItem | { index: number; kind: "user_message" | "agent_message";
  turn_id: string | null; item_id: string | null; started_at_ms: number | null; completed_at_ms: number | null };
export interface TurnObservation {
  index: number;
  turn_id: string | null;
  status: string | null;
  items_view: "full";
  items: TurnItemObservation[];
}
export type TurnsPageResult =
  | { kind: "page"; source_id: string | null; schema_reference: "0.166.0"; verification_status: "unverified";
      next_page: "available" | "none" | "unknown"; turns: TurnObservation[] }
  | { kind: "unsupported"; source_id: string | null; schema_reference: "0.166.0"; reason: "invalid_page" };

function object(value: unknown): value is Record<string, unknown> {
  try { return typeof value === "object" && value !== null && !Array.isArray(value); } catch { return false; }
}
function own(value: object, key: string): unknown {
  try { const d = Object.getOwnPropertyDescriptor(value, key); return d && "value" in d ? d.value : undefined; } catch { return undefined; }
}
function length(value: unknown): number | null {
  try {
    if (!Array.isArray(value)) return null;
    const n = own(value, "length");
    return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 10000 ? n : null;
  } catch { return null; }
}
function id(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256 ? value : null;
}
function time(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** full turn 페이지 전용이다. 메시지 내용과 turn 오류 원문은 복사하지 않는다. */
export function normalizeCodexTurnsPageV0166(input: unknown, sourceId?: string): TurnsPageResult {
  // 기존 정규화기와 같은 출처 검증 및 페이지 전체의 중첩 관측량 제한을 사용한다.
  normalizeCodexItemsPageV0166(null, sourceId);
  const invalid = (): TurnsPageResult => ({ kind: "unsupported", source_id: sourceId ?? null,
    schema_reference: "0.166.0", reason: "invalid_page" });
  const data = object(input) ? own(input, "data") : undefined;
  const n = length(data);
  if (!object(input) || n === null || !data || typeof data !== "object") return invalid();
  const turns: TurnObservation[] = [];
  const entries: { turnId: string | null; item: unknown; startedAtMs: unknown; completedAtMs: unknown }[] = [];
  const sizes: number[] = [];
  for (let index = 0; index < n; index++) {
    const turn = own(data, String(index));
    if (!object(turn) || own(turn, "itemsView") !== "full") return invalid();
    const items = own(turn, "items"), count = length(items);
    if (count === null || !items || typeof items !== "object" || entries.length + count > 10000) return invalid();
    const turnId = id(own(turn, "id")), status = own(turn, "status");
    turns.push({ index, turn_id: turnId, status: typeof status === "string" &&
      ["completed", "interrupted", "failed", "inProgress"].includes(status) ? status : null, items_view: "full", items: [] });
    sizes.push(count);
    for (let i = 0; i < count; i++) {
      const item = own(items, String(i));
      entries.push({ turnId, item, startedAtMs: object(item) ? own(item, "startedAtMs") : undefined,
        completedAtMs: object(item) ? own(item, "completedAtMs") : undefined });
    }
  }
  const normalized = normalizeCodexItemsPageV0166({ data: entries, nextCursor: null }, sourceId);
  if (normalized.kind !== "page") return invalid();
  let offset = 0;
  for (let t = 0; t < turns.length; t++) {
    for (let i = 0; i < sizes[t]; i++, offset++) {
      const entry = entries[offset], item = entry.item;
      const type = object(item) ? own(item, "type") : undefined;
      if (type === "userMessage" || type === "agentMessage") {
        turns[t].items.push({ index: i, kind: type === "userMessage" ? "user_message" : "agent_message",
          turn_id: entry.turnId, item_id: object(item) ? id(own(item, "id")) : null,
          started_at_ms: time(entry.startedAtMs), completed_at_ms: time(entry.completedAtMs) });
      } else turns[t].items.push({ ...normalized.items[offset], index: i });
    }
  }
  const cursor = own(input, "nextCursor");
  return { kind: "page", source_id: sourceId ?? null, schema_reference: "0.166.0", verification_status: "unverified",
    next_page: cursor === null ? "none" : typeof cursor === "string" && cursor.length > 0 ? "available" : "unknown", turns };
}
