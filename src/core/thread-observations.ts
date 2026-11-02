import type { NormalizationResult } from "./events.js";
import { exportNormalizationJson } from "./json-export.js";

export interface ThreadObservation {
  index: number;
  line: number;
  event_type: string;
  item_id: string | null;
  item_type: "command_execution" | "agent_message" | null;
}

/** 동일 값의 후보이며 실제 스레드나 실행의 동일성을 보증하지 않는다. */
export interface ThreadObservationGroup {
  source_id: string;
  thread_id: string;
  observations: ThreadObservation[];
}

export interface ThreadObservationResult {
  verification_status: "unverified";
  groups: ThreadObservationGroup[];
  unassociated: (ThreadObservation & {
    source_id: string | null;
    thread_id: string | null;
    reason: "missing_source" | "missing_thread_id" | "missing_both";
  })[];
  diagnostics: { index: number; line: number; source_id: string | null; code: "invalid_json" | "invalid_utf8" | "line_too_long" }[];
  unsupported: { index: number; line: number; source_id: string | null; reason: "invalid_record" | "unsupported_event_type" }[];
}

/** 명시적 ID만 묶으며 이벤트를 삭제하거나 부모·자식 관계를 추론하지 않는다. */
export function groupThreadObservations(results: readonly NormalizationResult[]): ThreadObservationResult {
  const normalized = JSON.parse(exportNormalizationJson(results)) as { results: NormalizationResult[] };
  const groups = new Map<string, ThreadObservationGroup>();
  const unassociated: ThreadObservationResult["unassociated"] = [];
  const diagnostics: ThreadObservationResult["diagnostics"] = [];
  const unsupported: ThreadObservationResult["unsupported"] = [];
  for (const [index, result] of normalized.results.entries()) {
    if (result.kind === "diagnostic") {
      diagnostics.push({ index, line: result.source.line, source_id: result.source.source_id, code: result.code });
      continue;
    }
    if (result.kind === "unsupported") {
      unsupported.push({ index, line: result.source.line, source_id: result.source.source_id, reason: result.reason });
      continue;
    }
    const event = result.event;
    const sourceId = event.source.source_id;
    const threadId = event.thread_id && event.thread_id.trim().length > 0 ? event.thread_id : null;
    const observation: ThreadObservation = {
      index, line: event.source.line, event_type: event.event_type,
      item_id: event.payload.item_id ?? null, item_type: event.payload.item_type ?? null,
    };
    if (sourceId === null || threadId === null) {
      const reason = sourceId === null && threadId === null ? "missing_both" : sourceId === null ? "missing_source" : "missing_thread_id";
      unassociated.push({ ...observation, source_id: sourceId, thread_id: threadId, reason });
      continue;
    }
    const key = JSON.stringify([sourceId, threadId]);
    let group = groups.get(key);
    if (!group) {
      group = { source_id: sourceId, thread_id: threadId, observations: [] };
      groups.set(key, group);
    }
    group.observations.push(observation);
  }
  return { verification_status: "unverified", groups: Array.from(groups.values()), unassociated, diagnostics, unsupported };
}
