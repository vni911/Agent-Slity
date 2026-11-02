import type { NormalizationResult } from "./events.js";
import { exportNormalizationJson } from "./json-export.js";

export interface ItemObservation {
  index: number;
  line: number;
  event_type: "item.started" | "item.completed";
  item_type: "command_execution" | "agent_message" | null;
  thread_id: string | null;
}

/** 동일한 값의 후보이며 실제 항목이나 실행의 동일성을 보증하지 않는다. */
export interface ItemObservationGroup {
  source_id: string;
  item_id: string;
  observations: ItemObservation[];
}

export interface ItemObservationResult {
  verification_status: "unverified";
  groups: ItemObservationGroup[];
  unassociated: { index: number; reason: "missing_source" | "missing_item_id" | "missing_both" }[];
}

/** 명시적인 출처 별칭과 항목 ID로 후보를 묶는다. 입력을 수정하거나 순서를 추론하지 않는다. */
export function groupItemObservations(results: readonly NormalizationResult[]): ItemObservationResult {
  const normalized = JSON.parse(exportNormalizationJson(results)) as { results: NormalizationResult[] };
  const groups = new Map<string, ItemObservationGroup>();
  const unassociated: ItemObservationResult["unassociated"] = [];
  for (const [index, result] of normalized.results.entries()) {
    if (result.kind !== "event") continue;
    const event = result.event;
    if (event.event_type !== "item.started" && event.event_type !== "item.completed") continue;
    const sourceId = event.source.source_id;
    const itemId = event.payload.item_id ?? null;
    if (sourceId === null || itemId === null) {
      const reason = sourceId === null && itemId === null ? "missing_both" : sourceId === null ? "missing_source" : "missing_item_id";
      unassociated.push({ index, reason });
      continue;
    }
    const key = JSON.stringify([sourceId, itemId]);
    let group = groups.get(key);
    if (!group) {
      group = { source_id: sourceId, item_id: itemId, observations: [] };
      groups.set(key, group);
    }
    group.observations.push({
      index, line: event.source.line, event_type: event.event_type, item_type: event.payload.item_type ?? null, thread_id: event.thread_id,
    });
  }
  return { verification_status: "unverified", groups: Array.from(groups.values()), unassociated };
}
