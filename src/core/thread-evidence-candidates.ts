import type { ThreadReadResult } from "../adapters/codex-app-server-thread-read.js";
import type { ItemsPageResult } from "../adapters/codex-app-server-items.js";

export interface ThreadEvidenceCandidate {
  source_id: string;
  thread_id: string;
  thread_indices: number[];
  item_references: { page_index: number; item_index: number; role: "sender" | "receiver" | "activity"; receiver_index: number | null }[];
}

/** 정규화된 관측의 명시적 값만 비교한다. 일치는 실제 관계나 실행의 증명이 아니다. */
export function findThreadEvidenceCandidates(threads: readonly ThreadReadResult[], pages: readonly ItemsPageResult[]): {
  verification_status: "unverified"; groups: ThreadEvidenceCandidate[];
} {
  const groups = new Map<string, ThreadEvidenceCandidate>();
  for (const [index, thread] of threads.entries()) {
    if (thread.kind !== "thread" || thread.source.source_id === null) continue;
    const key = JSON.stringify([thread.source.source_id, thread.thread_id]);
    let group = groups.get(key);
    if (!group) {
      group = { source_id: thread.source.source_id, thread_id: thread.thread_id, thread_indices: [], item_references: [] };
      groups.set(key, group);
    }
    group.thread_indices.push(index);
  }
  for (const [pageIndex, page] of pages.entries()) {
    if (page.kind !== "page" || page.source_id === null) continue;
    const add = (id: string | null, itemIndex: number, role: "sender" | "receiver" | "activity", receiverIndex: number | null): void => {
      if (id === null) return;
      groups.get(JSON.stringify([page.source_id, id]))?.item_references.push({ page_index: pageIndex, item_index: itemIndex, role, receiver_index: receiverIndex });
    };
    for (const [itemIndex, item] of page.items.entries()) {
      if (item.kind === "collab") {
        add(item.sender_thread_id, itemIndex, "sender", null);
        item.receiver_thread_ids?.forEach((id, index) => add(id, itemIndex, "receiver", index));
      } else if (item.kind === "subagent_activity") add(item.agent_thread_id, itemIndex, "activity", null);
    }
  }
  return { verification_status: "unverified", groups: [...groups.values()].filter((group) => group.item_references.length > 0) };
}
