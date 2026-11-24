import type { NormalizationResult, ObservedUsage } from "./events.js";
import type { ChildTurnCollectionResult } from "./child-thread-collection.js";
import type { ChildTurnCollectionSummary } from "./child-turn-summary.js";
import { summarizeChildTurnCollection } from "./child-turn-summary.js";
import { serializeNormalizationSnapshot } from "./normalization-json-parse.js";
import { exportChildTurnCollectionJson } from "./child-turn-json-export.js";
import { parseChildTurnCollectionJson } from "./child-turn-json-parse.js";
import { findSourceOverlaps } from "./source-overlap.js";

export type EvidenceReference = { kind: "record"; record_index: number } |
  { kind: "turn"; page_index: number; turn_index: number } |
  { kind: "item"; page_index: number; turn_index: number; item_index: number };
export type EvidenceRuleId = "source_position_overlap" | "source_position_conflict" | "repeated_turn_id" |
  "repeated_item_id" | "reported_execution_error" | "reported_command_failure" | "validation_unobserved";
export interface EvidenceFinding {
  rule_id: EvidenceRuleId;
  rule_version: 1;
  evidence_level: "input_observation" | "suspected" | "unknown";
  references: EvidenceReference[];
}
interface EvidenceBase {
  format: "agent-slity.evidence-report";
  version: 1;
  verification_status: "unverified";
  count_semantics: "observations_including_duplicates";
  findings: EvidenceFinding[];
  unknown_metrics: { unique_executions: null; unique_agents: null; quality: null; elapsed_time_ms: null;
    total_tokens: null; efficiency: null; savings: null };
  unknown_metric_reasons: Record<"unique_executions" | "unique_agents" | "quality" | "elapsed_time_ms" | "total_tokens" | "efficiency" | "savings", string>;
  limitations: string[];
}
export type NormalizationEvidenceReport = EvidenceBase & {
  input_kind: "normalization";
  summary: { records: number; events: number; diagnostics: number; unsupported: number; event_types: Record<string, number> };
  reported_usage: ({ record_index: number } & ObservedUsage)[];
};
export type ChildTurnEvidenceReport = EvidenceBase & {
  input_kind: "child_turn_collection";
  summary: ChildTurnCollectionSummary;
  reported_usage: null;
  collaboration_tools: Record<string, number> | null;
};
export type EvidenceReport = NormalizationEvidenceReport | ChildTurnEvidenceReport;

const recordRef = (record_index: number): EvidenceReference => ({ kind: "record", record_index });
function finding(rule_id: EvidenceRuleId, evidence_level: EvidenceFinding["evidence_level"], references: EvidenceReference[]): EvidenceFinding {
  return { rule_id, rule_version: 1, evidence_level, references };
}
function base(): EvidenceBase {
  return { format: "agent-slity.evidence-report", version: 1, verification_status: "unverified",
    count_semantics: "observations_including_duplicates", findings: [],
    unknown_metrics: { unique_executions: null, unique_agents: null, quality: null, elapsed_time_ms: null, total_tokens: null, efficiency: null, savings: null },
    unknown_metric_reasons: { unique_executions: "identity_and_scope_unverified", unique_agents: "identity_and_scope_unverified",
      quality: "quality_not_collected", elapsed_time_ms: "end_to_end_timing_unavailable", total_tokens: "scope_and_usage_semantics_unverified",
      efficiency: "quality_and_baseline_unverified", savings: "no_controlled_baseline" },
    limitations: ["input_not_authenticated", "duplicates_preserved", "supported_observations_only", "quality_and_efficiency_unverified"] };
}
function finish<T extends EvidenceReport>(report: T): T {
  report.findings.push(finding("validation_unobserved", "unknown", []));
  if (Buffer.byteLength(JSON.stringify(report), "utf8") > 16 * 1024 * 1024) throw new TypeError();
  return report;
}
function invalid(): never { throw new TypeError("근거 보고서를 생성할 수 없습니다."); }

/** 집계는 입력 관측만 뜻하며 실제 고유 실행·품질·효율을 인증하지 않는다. */
export function createNormalizationEvidenceReport(input: readonly NormalizationResult[]): NormalizationEvidenceReport {
  try {
    const records = serializeNormalizationSnapshot(input).results;
    const summary = { records: records.length, events: 0, diagnostics: 0, unsupported: 0,
      event_types: Object.fromEntries(["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.completed", "error"].map(key => [key, 0])) };
    const report: NormalizationEvidenceReport = { ...base(), input_kind: "normalization", summary, reported_usage: [] };
    const errors: EvidenceReference[] = [];
    for (const [index, record] of records.entries()) {
      if (record.kind === "diagnostic") { summary.diagnostics++; continue; }
      if (record.kind === "unsupported") { summary.unsupported++; continue; }
      summary.events++; summary.event_types[record.event.event_type]++;
      if (["turn.failed", "error"].includes(record.event.event_type)) errors.push(recordRef(index));
      const usage = record.event.payload.usage;
      if (Object.values(usage).some(value => value !== null)) report.reported_usage.push({ record_index: index, ...usage });
    }
    for (const group of findSourceOverlaps(records)) {
      report.findings.push(finding(group.status === "conflict" ? "source_position_conflict" : "source_position_overlap", "suspected", group.indices.map(recordRef)));
    }
    if (errors.length) report.findings.push(finding("reported_execution_error", "input_observation", errors));
    return finish(report);
  } catch { return invalid(); }
}

export function createChildTurnEvidenceReport(input: ChildTurnCollectionResult): ChildTurnEvidenceReport {
  try {
    const snapshot = parseChildTurnCollectionJson(exportChildTurnCollectionJson(input));
    const summary = summarizeChildTurnCollection(snapshot);
    const report: ChildTurnEvidenceReport = { ...base(), input_kind: "child_turn_collection", summary,
      reported_usage: null, collaboration_tools: null };
    const turns = new Map<string, EvidenceReference[]>(), items = new Map<string, EvidenceReference[]>();
    const failures: EvidenceReference[] = [], turnErrors: EvidenceReference[] = [];
    const remember = (map: Map<string, EvidenceReference[]>, key: unknown[], ref: EvidenceReference): void => {
      const encoded = JSON.stringify(key), found = map.get(encoded);
      if (found) found.push(ref); else map.set(encoded, [ref]);
    };
    for (const [page_index, page] of (snapshot.collection?.pages ?? []).entries()) {
      if (page.kind !== "page") continue;
      report.collaboration_tools ??= {};
      for (const [turn_index, turn] of page.turns.entries()) {
        const ref: EvidenceReference = { kind: "turn", page_index, turn_index };
        if (turn.status === "failed") turnErrors.push(ref);
        if (page.source_id !== null && turn.turn_id !== null) remember(turns, [page.source_id, turn.turn_id], ref);
        for (const [item_index, item] of turn.items.entries()) {
          const itemRef: EvidenceReference = { kind: "item", page_index, turn_index, item_index };
          if (item.kind === "unsupported") continue;
          if (page.source_id !== null && item.turn_id !== null && item.item_id !== null) remember(items, [page.source_id, item.turn_id, item.item_id], itemRef);
          if (item.kind === "collab") {
            const tool = item.tool ?? "unknown";
            report.collaboration_tools[tool] = (report.collaboration_tools[tool] ?? 0) + 1;
          }
          if (item.kind === "command_execution" && (item.status === "failed" || item.exit_code !== null && item.exit_code !== 0)) failures.push(itemRef);
        }
      }
    }
    for (const [map, rule] of [[turns, "repeated_turn_id"], [items, "repeated_item_id"]] as const) {
      for (const refs of map.values()) if (refs.length > 1) report.findings.push(finding(rule, "suspected", refs));
    }
    if (turnErrors.length) report.findings.push(finding("reported_execution_error", "input_observation", turnErrors));
    if (failures.length) report.findings.push(finding("reported_command_failure", "input_observation", failures));
    return finish(report);
  } catch { return invalid(); }
}
