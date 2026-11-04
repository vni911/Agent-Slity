const TOOLS = new Set(["spawnAgent", "sendInput", "resumeAgent", "wait", "closeAgent", "sendMessage", "followupTask", "interruptAgent", "listAgents"]);
const STATUSES = new Set(["inProgress", "completed", "failed", "interrupted"]);
const ACTIVITIES = new Set(["started", "interacted", "interrupted", "completed"]);
const LIMIT = 10000;

export interface CollabItemObservation {
  index: number;
  kind: "collab";
  turn_id: string | null;
  item_id: string | null;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  sender_thread_id: string | null;
  receiver_thread_ids: (string | null)[] | null;
  tool: string | null;
  status: string | null;
}
export interface SubagentActivityObservation {
  index: number;
  kind: "subagent_activity";
  turn_id: string | null;
  item_id: string | null;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  agent_thread_id: string | null;
  activity: string | null;
  reported_model: string | null;
  reported_reasoning_effort: string | null;
}
export type ItemsPageResult =
  | { kind: "page"; source_id: string | null; schema_reference: "0.166.0"; verification_status: "unverified";
      next_page: "available" | "none" | "unknown"; items: (CollabItemObservation | SubagentActivityObservation | { index: number; kind: "unsupported" })[] }
  | { kind: "unsupported"; source_id: string | null; schema_reference: "0.166.0"; reason: "invalid_page" };

function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try { return !Array.isArray(value); } catch { return false; }
}
function own(value: object, key: string): unknown {
  try { const d = Object.getOwnPropertyDescriptor(value, key); return d && "value" in d ? d.value : undefined; }
  catch { return undefined; }
}
function boundedValue(value: unknown): string | null {
  return typeof value === "string" && value.length <= 256 && value.trim().length > 0 ? value : null;
}
function arrayLength(value: unknown): number | null {
  try {
    if (!Array.isArray(value)) return null;
    const length: unknown = own(value, "length");
    return typeof length === "number" && Number.isSafeInteger(length) && length >= 0 && length <= LIMIT ? length : null;
  } catch { return null; }
}
function receivers(value: unknown, remaining: number): (string | null)[] | null {
  const length = arrayLength(value);
  if (length === null || length > remaining || !value || typeof value !== "object") return null;
  return Array.from({ length }, (_, i) => boundedValue(own(value, String(i))));
}
function allowed(value: unknown, values: Set<string>): string | null {
  return typeof value === "string" && values.has(value) ? value : null;
}
function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** 전체 스키마·출처·실행의 진위는 확인하지 않는다. 입력은 JSON-RPC의 result 객체다. */
export function normalizeCodexItemsPageV0166(input: unknown, sourceId?: string): ItemsPageResult {
  if (sourceId !== undefined && (typeof sourceId !== "string" || sourceId.length < 1 || sourceId.length > 64 || /[^A-Za-z0-9_-]/.test(sourceId))) {
    throw new TypeError("출처 별칭은 영문자, 숫자, 밑줄, 하이픈 1~64자여야 합니다.");
  }
  const source_id = sourceId ?? null;
  const data = isObject(input) ? own(input, "data") : undefined;
  const length = arrayLength(data);
  if (!isObject(input) || length === null || !data || typeof data !== "object") {
    return { kind: "unsupported", source_id, schema_reference: "0.166.0", reason: "invalid_page" };
  }
  const cursor = own(input, "nextCursor");
  const next_page = cursor === null ? "none" : typeof cursor === "string" && cursor.length > 0 ? "available" : "unknown";
  const items: (CollabItemObservation | SubagentActivityObservation | { index: number; kind: "unsupported" })[] = [];
  let remainingReceivers = LIMIT;
  for (let index = 0; index < length; index++) {
    const entry = own(data, String(index));
    const item = isObject(entry) ? own(entry, "item") : undefined;
    if (!isObject(entry) || !isObject(item)) {
      items.push({ index, kind: "unsupported" });
      continue;
    }
    const type = own(item, "type");
    if (type === "subAgentActivity") {
      items.push({ index, kind: "subagent_activity", turn_id: boundedValue(own(entry, "turnId")), item_id: boundedValue(own(item, "id")),
        started_at_ms: timestamp(own(entry, "startedAtMs")), completed_at_ms: timestamp(own(entry, "completedAtMs")),
        agent_thread_id: boundedValue(own(item, "agentThreadId")), activity: allowed(own(item, "kind"), ACTIVITIES),
        reported_model: boundedValue(own(item, "model")), reported_reasoning_effort: boundedValue(own(item, "reasoningEffort")) });
      continue;
    }
    if (type !== "collabAgentToolCall") {
      items.push({ index, kind: "unsupported" });
      continue;
    }
    const receiverIds = receivers(own(item, "receiverThreadIds"), remainingReceivers);
    if (receiverIds) remainingReceivers -= receiverIds.length;
    items.push({ index, kind: "collab", turn_id: boundedValue(own(entry, "turnId")), item_id: boundedValue(own(item, "id")),
      started_at_ms: timestamp(own(entry, "startedAtMs")), completed_at_ms: timestamp(own(entry, "completedAtMs")),
      sender_thread_id: boundedValue(own(item, "senderThreadId")), receiver_thread_ids: receiverIds,
      tool: allowed(own(item, "tool"), TOOLS), status: allowed(own(item, "status"), STATUSES) });
  }
  return { kind: "page", source_id, schema_reference: "0.166.0", verification_status: "unverified", next_page, items };
}
