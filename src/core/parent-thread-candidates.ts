import type { ThreadReadResult } from "../adapters/codex-app-server-thread-read.js";

export interface ParentThreadCandidateGroup {
  source_id: string;
  parent_thread_id: string;
  child_indices: number[];
  parent_candidate_indices: number[];
}
export interface ParentThreadCandidates {
  verification_status: "unverified";
  groups: ParentThreadCandidateGroup[];
  unassociated: { index: number; reason: "missing_source" | "missing_parent" | "missing_both" }[];
  unsupported_indices: number[];
}

/** 명시적 값의 일치만 표시한다. 후보가 실제 부모임을 검증하지 않는다. */
export function findParentThreadCandidates(results: readonly ThreadReadResult[]): ParentThreadCandidates {
  const indices = new Map<string, number[]>();
  const groups = new Map<string, ParentThreadCandidateGroup>();
  const unassociated: ParentThreadCandidates["unassociated"] = [];
  const unsupported_indices: number[] = [];
  for (const [index, result] of results.entries()) {
    if (result.kind === "unsupported") { unsupported_indices.push(index); continue; }
    const source = result.source.source_id;
    if (source !== null) {
      const key = JSON.stringify([source, result.thread_id]);
      const found = indices.get(key) ?? [];
      found.push(index);
      indices.set(key, found);
    }
    const parent = result.parent_thread_id;
    if (source === null || parent === null) {
      const reason = source === null && parent === null ? "missing_both" : source === null ? "missing_source" : "missing_parent";
      unassociated.push({ index, reason });
      continue;
    }
    const key = JSON.stringify([source, parent]);
    let group = groups.get(key);
    if (!group) {
      group = { source_id: source, parent_thread_id: parent, child_indices: [], parent_candidate_indices: [] };
      groups.set(key, group);
    }
    group.child_indices.push(index);
  }
  for (const [key, group] of groups) group.parent_candidate_indices = indices.get(key) ?? [];
  return { verification_status: "unverified", groups: [...groups.values()], unassociated, unsupported_indices };
}
