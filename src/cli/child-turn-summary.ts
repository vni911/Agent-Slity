import { readUtf8SnapshotFile } from "../adapters/snapshot-file-reader.js";
import { parseChildTurnCollectionJson } from "../core/child-turn-json-parse.js";
import { MAX_CHILD_TURN_JSON_BYTES } from "../core/child-turn-json-schema.js";
import { summarizeChildTurnCollection } from "../core/child-turn-summary.js";
import type { ChildTurnCollectionSummary } from "../core/child-turn-summary.js";

export const MAX_CHILD_TURN_SUMMARY_INPUTS = 8;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

interface ChildTurnSummaries {
  format: "agent-slity.child-turn-summaries";
  version: 1;
  schema_reference: "0.166.0";
  verification_status: "unverified";
  count_semantics: "per_input_including_duplicates";
  inputs: { input_index: number; summary: ChildTurnCollectionSummary }[];
}

/** CLI 내부 전용이다. 원본 바이트를 제한하고 열린 파일의 close를 기다린다. */
async function readChildTurnInput(path: string, maxBytes: number): Promise<{ summary: ChildTurnCollectionSummary; bytes: number }> {
  const { json, bytes } = await readUtf8SnapshotFile(path, maxBytes);
  return { summary: summarizeChildTurnCollection(parseChildTurnCollectionJson(json)), bytes };
}

export async function readChildTurnSummary(path: string): Promise<ChildTurnCollectionSummary> {
  return (await readChildTurnInput(path, MAX_CHILD_TURN_JSON_BYTES)).summary;
}

/** 순차 읽기의 작은 요약만 보관하고 실패 시 부분 결과를 반환하지 않는다. */
export async function readChildTurnSummaries(paths: readonly string[]): Promise<ChildTurnSummaries> {
  if (paths.length < 1 || paths.length > MAX_CHILD_TURN_SUMMARY_INPUTS) throw new TypeError();
  const inputs: ChildTurnSummaries["inputs"] = [];
  let remaining = MAX_TOTAL_BYTES;
  for (let index = 0; index < paths.length; index++) {
    const result = await readChildTurnInput(paths[index], Math.min(MAX_CHILD_TURN_JSON_BYTES, remaining));
    remaining -= result.bytes;
    inputs.push({ input_index: index, summary: result.summary });
  }
  return { format: "agent-slity.child-turn-summaries", version: 1, schema_reference: "0.166.0",
    verification_status: "unverified", count_semantics: "per_input_including_duplicates", inputs };
}
