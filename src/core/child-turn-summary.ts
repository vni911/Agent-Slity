import type { TurnItemObservation } from "../adapters/codex-app-server-turns.js";
import type { ChildTurnCollectionResult } from "./child-thread-collection.js";
import { copyChildTurnCollectionResult } from "./child-turn-json-schema.js";
import type { TurnPageCollection } from "./turn-page-collector.js";

export interface ChildTurnObservationCounts {
  turns: number;
  items: number;
  turn_statuses: Record<"inProgress" | "completed" | "failed" | "interrupted" | "unknown", number>;
  item_kinds: Record<TurnItemObservation["kind"], number>;
}

export interface ChildTurnCollectionSummary {
  format: "agent-slity.child-turn-summary";
  version: 1;
  schema_reference: "0.166.0";
  verification_status: "unverified";
  initialization_error: ChildTurnCollectionResult["initialization_error"];
  cleanup_status: ChildTurnCollectionResult["cleanup_status"];
  collection: {
    status: TurnPageCollection["status"];
    reason: TurnPageCollection["reason"];
    thread_kind: "thread" | "unsupported" | "unknown";
    pages: { received: number; supported: number; unsupported: number };
    count_scope: "supported_pages";
    observations: ChildTurnObservationCounts | null;
  } | null;
}

function emptyCounts(): ChildTurnObservationCounts {
  return { turns: 0, items: 0,
    turn_statuses: { inProgress: 0, completed: 0, failed: 0, interrupted: 0, unknown: 0 },
    item_kinds: { user_message: 0, agent_message: 0, collab: 0, subagent_activity: 0,
      command_execution: 0, file_change: 0, unsupported: 0 } };
}

/** 지원 페이지의 관측 횟수를 중복 제거 없이 센다. ID와 원문은 요약에 복사하지 않는다. */
export function summarizeChildTurnCollection(input: ChildTurnCollectionResult): ChildTurnCollectionSummary {
  try {
    const result = copyChildTurnCollectionResult(input);
    const summary: ChildTurnCollectionSummary = { format: "agent-slity.child-turn-summary", version: 1,
      schema_reference: "0.166.0", verification_status: "unverified",
      initialization_error: result.initialization_error, cleanup_status: result.cleanup_status, collection: null };
    if (result.collection === null) return summary;
    const collection = result.collection;
    const pages = { received: collection.pages.length, supported: 0, unsupported: 0 };
    let observations: ChildTurnObservationCounts | null = null;
    for (const page of collection.pages) {
      if (page.kind === "unsupported") { pages.unsupported++; continue; }
      pages.supported++;
      observations ??= emptyCounts();
      observations.turns += page.turns.length;
      for (const turn of page.turns) {
        switch (turn.status) {
          case "inProgress": case "completed": case "failed": case "interrupted":
            observations.turn_statuses[turn.status]++;
            break;
          default: observations.turn_statuses.unknown++;
        }
        observations.items += turn.items.length;
        for (const item of turn.items) observations.item_kinds[item.kind]++;
      }
    }
    summary.collection = { status: collection.status, reason: collection.reason,
      thread_kind: collection.thread?.kind ?? "unknown", pages, count_scope: "supported_pages", observations };
    return summary;
  } catch { throw new TypeError("유효하지 않은 turn 수집 요약 입력입니다."); }
}
