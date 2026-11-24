import { resolve } from "node:path";
import type { NormalizationResult } from "../core/events.js";
import { parseNormalizationJson, serializeNormalizationSnapshot, MAX_NORMALIZATION_JSON_BYTES } from "../core/normalization-json-parse.js";
import { readUtf8SnapshotFile } from "./snapshot-file-reader.js";
import { invalidSnapshotWriteResult, publishSnapshotJson } from "./snapshot-file-writer.js";
import type { SnapshotWriteResult } from "./snapshot-file-writer.js";
import { isSafeSnapshotPath } from "./snapshot-path.js";

export type NormalizationSnapshotWriteResult = SnapshotWriteResult;
export class NormalizationSnapshotReadError extends Error {
  constructor(readonly code: "invalid_input" | "read_failed" | "invalid_json") {
    super("정규화 JSON 파일을 읽을 수 없습니다."); this.name = "NormalizationSnapshotReadError";
  }
}

/** 기존 exporter/CLI를 바꾸지 않는 제한된 명시적 저장 경로다. */
export async function saveNormalizationJson(results: readonly NormalizationResult[], path: string): Promise<NormalizationSnapshotWriteResult> {
  let json: string;
  try {
    if (!isSafeSnapshotPath(path)) return invalidSnapshotWriteResult();
    ({ json } = serializeNormalizationSnapshot(results));
  } catch { return invalidSnapshotWriteResult(); }
  return publishSnapshotJson(json, path);
}

export async function readNormalizationJson(path: string): Promise<NormalizationResult[]> {
  let target: string;
  try { if (!isSafeSnapshotPath(path)) throw new TypeError(); target = resolve(path); }
  catch { throw new NormalizationSnapshotReadError("invalid_input"); }
  let json: string;
  try { ({ json } = await readUtf8SnapshotFile(target, MAX_NORMALIZATION_JSON_BYTES)); }
  catch { throw new NormalizationSnapshotReadError("read_failed"); }
  try { return parseNormalizationJson(json); }
  catch { throw new NormalizationSnapshotReadError("invalid_json"); }
}
