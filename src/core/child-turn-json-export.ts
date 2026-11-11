import type { ChildTurnCollectionResult } from "./child-thread-collection.js";

type Snapshot = Record<string, unknown>;
type Decoder = (value: unknown) => unknown;
type Budget = { items: number; receivers: number; changes: number };
const MAX_BYTES = 16 * 1024 * 1024;
const STOPS = ["last_page", "invalid_thread", "thread_mismatch", "invalid_page", "cursor_unknown", "cursor_invalid",
  "cursor_repeated", "page_limit", "cancelled", "timeout", "server_error", "transport_error"];
const INIT_ERRORS = ["cancelled", "timeout", "server_error", "invalid_input", "transport_error"];
const TURN_STATUSES = ["inProgress", "completed", "failed", "interrupted"];
const COMMAND_STATUSES = ["inProgress", "completed", "failed", "declined"];
const ITEM_KINDS = ["unsupported", "user_message", "agent_message", "collab", "subagent_activity", "command_execution", "file_change"];

function invalid(): never { throw new TypeError("유효하지 않은 turn 수집 결과입니다."); }
function object(value: unknown): object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value;
}
function read(value: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !("value" in d)) invalid();
  return d.value;
}
function shape(value: unknown, fields: Record<string, Decoder>): Snapshot {
  const input = object(value), result: Snapshot = {};
  for (const [key, decode] of Object.entries(fields)) result[key] = decode(read(input, key));
  return result;
}
function oneOf(values: readonly string[]): Decoder {
  return value => typeof value === "string" && values.includes(value) ? value : invalid();
}
const nullable = (decode: Decoder): Decoder => value => value === null ? null : decode(value);
const equal = (expected: string | number): Decoder => value => value === expected ? value : invalid();
const string = (max: number): Decoder => value => typeof value === "string" && value.length > 0 &&
  value.length <= max && value.trim().length > 0 ? value : invalid();
const integer = (min: number, max = Number.MAX_SAFE_INTEGER): Decoder => value =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid();
const id = nullable(string(256));
const time = nullable(integer(Number.MIN_SAFE_INTEGER));
const alias: Decoder = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : invalid();

function array(value: unknown, max: number, decode: (value: unknown, index: number) => unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
  const length = read(value, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > max) invalid();
  const result: unknown[] = [];
  // 입력 배열의 iterator와 toJSON은 사용하지 않는다.
  for (let i = 0; i < length; i++) result.push(decode(read(value, String(i)), i));
  return result;
}
function nested(value: unknown, budget: Budget, key: "receivers" | "changes", decode: Decoder): unknown {
  if (value === null) return null;
  const result = array(value, budget[key], decode);
  budget[key] -= result.length;
  return result;
}
function item(value: unknown, index: number, budget: Budget): Snapshot {
  const input = object(value), kind = read(input, "kind");
  if (typeof kind !== "string" || !ITEM_KINDS.includes(kind)) invalid();
  const fields: Record<string, Decoder> = { index: equal(index), kind: equal(kind) };
  if (kind === "unsupported") return shape(input, fields);
  Object.assign(fields, { turn_id: id, item_id: id, started_at_ms: time, completed_at_ms: time });
  if (kind === "collab") Object.assign(fields, {
    sender_thread_id: id, receiver_thread_ids: (v: unknown) => nested(v, budget, "receivers", id),
    tool: nullable(oneOf(["spawnAgent", "sendInput", "resumeAgent", "wait", "closeAgent", "sendMessage", "followupTask", "interruptAgent", "listAgents"])),
    status: nullable(oneOf(TURN_STATUSES)),
  });
  else if (kind === "subagent_activity") Object.assign(fields, {
    agent_thread_id: id, activity: nullable(oneOf(["started", "interacted", "interrupted", "completed"])),
    reported_model: id, reported_reasoning_effort: id,
  });
  else if (kind === "command_execution") Object.assign(fields, {
    status: nullable(oneOf(COMMAND_STATUSES)), exit_code: nullable(integer(-2147483648, 2147483647)),
    duration_ms: nullable(integer(0)),
  });
  else if (kind === "file_change") Object.assign(fields, {
    status: nullable(oneOf(COMMAND_STATUSES)),
    change_kinds: (v: unknown) => nested(v, budget, "changes", nullable(oneOf(["add", "update", "delete"]))),
  });
  return shape(input, fields);
}
function turn(value: unknown, index: number, budget: Budget): Snapshot {
  return shape(value, { index: equal(index), turn_id: id, status: nullable(oneOf(TURN_STATUSES)), items_view: equal("full"),
    items: items => {
      const result = array(items, budget.items, (v, i) => item(v, i, budget));
      budget.items -= result.length;
      return result;
    } });
}
function page(value: unknown): Snapshot {
  const input = object(value), kind = read(input, "kind");
  if (kind !== "page" && kind !== "unsupported") invalid();
  const fields: Record<string, Decoder> = { kind: equal(kind), source_id: nullable(alias), schema_reference: equal("0.166.0") };
  if (kind === "unsupported") return shape(input, { ...fields, reason: equal("invalid_page") });
  const budget: Budget = { items: 10000, receivers: 10000, changes: 10000 };
  return shape(input, { ...fields, verification_status: equal("unverified"), next_page: oneOf(["available", "none", "unknown"]),
    turns: turns => array(turns, 10000, (v, i) => turn(v, i, budget)) });
}
function thread(value: unknown): unknown {
  if (value === null) return null;
  const input = object(value), kind = read(input, "kind");
  if (kind !== "thread" && kind !== "unsupported") invalid();
  const fields: Record<string, Decoder> = { kind: equal(kind), source: source => shape(source, {
    format: equal("codex_app_server_thread_read"), schema_reference: equal("0.166.0"), source_id: nullable(alias),
  }) };
  if (kind === "unsupported") return shape(input, { ...fields, reason: equal("invalid_thread") });
  const result = shape(input, { ...fields, verification_status: equal("unverified"), thread_id: string(65536),
    parent_thread_id: nullable(string(65536)), session_id: nullable(string(65536)), forked_from_id: nullable(string(65536)) });
  const status = Object.getOwnPropertyDescriptor(input, "parent_thread_id_status");
  if (status && !("value" in status)) invalid();
  result.parent_thread_id_status = status ? oneOf(["present", "explicit_null", "unknown"])(status.value) : "unknown";
  return result;
}
function collection(value: unknown): unknown {
  if (value === null) return null;
  const result = shape(value, { verification_status: equal("unverified"), source_id: alias,
    status: oneOf(["last_page", "partial"]), reason: oneOf(STOPS), thread,
    pages: pages => array(pages, 20, page) });
  if ((result.status === "last_page") !== (result.reason === "last_page")) invalid();
  if (result.status === "last_page") {
    if (result.thread === null || (result.thread as Snapshot).kind !== "thread") invalid();
    const pages = result.pages as Snapshot[];
    if (pages.length === 0 || pages.some((p, i) => p.kind !== "page" || p.next_page !== (i === pages.length - 1 ? "none" : "available"))) invalid();
  }
  return result;
}

/** 허용한 관측만 JSON으로 복사한다. 파일과 서버에는 접근하지 않는다. */
export function exportChildTurnCollectionJson(input: ChildTurnCollectionResult): string {
  try {
    const result = shape(input, { initialization_error: nullable(oneOf(INIT_ERRORS)),
      cleanup_status: oneOf(["exit_observed", "unknown"]), collection });
    if ((result.initialization_error === null) === (result.collection === null)) invalid();
    const json = JSON.stringify({ format: "agent-slity.child-turn-collection", version: 1,
      schema_reference: "0.166.0", verification_status: "unverified", result });
    if (Buffer.byteLength(json, "utf8") > MAX_BYTES) invalid();
    return json;
  } catch { return invalid(); }
}
