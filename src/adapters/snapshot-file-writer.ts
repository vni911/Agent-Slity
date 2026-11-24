import { randomUUID } from "node:crypto";
import { link, lstat, open, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isSafeSnapshotPath } from "./snapshot-path.js";

export interface SnapshotWriteResult {
  publication_status: "published" | "not_published" | "unknown";
  /** complete는 자기 임시 파일과 handle의 정리를 마쳤거나 정리 대상이 없음을 뜻한다. */
  temp_cleanup_status: "complete" | "pending" | "unknown";
  error: "invalid_input" | "already_exists" | "unsupported_storage" | "io_error" | null;
  cleanup_errors: ("close_failed" | "unlink_failed")[];
}

function code(error: unknown): unknown {
  try { return typeof error === "object" && error !== null ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined; }
  catch { return undefined; }
}

/** 신뢰하는 기존 로컬 부모에 새 스냅샷 하나를 명시적으로 저장한다. 자동 재시도·덮어쓰기는 없다. */
export async function publishSnapshotJson(json: string, path: string): Promise<SnapshotWriteResult> {
  const result: SnapshotWriteResult = { publication_status: "not_published", temp_cleanup_status: "complete", error: null, cleanup_errors: [] };
  let bytes: Buffer, target: string;
  try {
    if (!isSafeSnapshotPath(path) || typeof json !== "string" || Buffer.byteLength(json, "utf8") > 16 * 1024 * 1024) throw new TypeError();
    bytes = Buffer.from(json, "utf8");
    target = resolve(path);
  } catch { result.error = "invalid_input"; return result; }

  let temporary: string | undefined, file: FileHandle | undefined;
  let owned = false, stage: "prepare" | "write" | "publish" = "prepare";
  try {
    try {
      const existing = await lstat(target);
      result.error = existing.isDirectory() ? "invalid_input" : "already_exists";
      return result;
    } catch (error) { if (code(error) !== "ENOENT") throw error; }
    temporary = join(dirname(target), `.agent-slity-${randomUUID()}.tmp`);
    file = await open(temporary, "wx", 0o600);
    owned = true;
    stage = "write";
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, null);
      if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytes.length - offset) throw new Error();
      offset += bytesWritten;
    }
    await file.sync();
    await file.close();
    file = undefined;
    stage = "publish";
    await link(temporary, target);
    result.publication_status = "published";
  } catch (error) {
    const errorCode = code(error);
    if (stage === "publish" && errorCode === "EEXIST") result.error = "already_exists";
    else if (stage === "publish" && typeof errorCode === "string" && ["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"].includes(errorCode)) result.error = "unsupported_storage";
    else {
      result.error = "io_error";
      // 게시 요청의 오류만으로 부작용이 전혀 없었다고 단정하지 않는다.
      if (stage === "publish") result.publication_status = "unknown";
    }
  } finally {
    if (file) {
      try { await file.close(); }
      catch { result.cleanup_errors.push("close_failed"); result.temp_cleanup_status = "unknown"; }
    }
    if (owned && temporary) {
      try { await unlink(temporary); }
      catch (error) {
        if (code(error) !== "ENOENT") {
          result.cleanup_errors.push("unlink_failed");
          if (result.temp_cleanup_status !== "unknown") {
            try { await lstat(temporary); result.temp_cleanup_status = "pending"; }
            catch (inspection) { result.temp_cleanup_status = code(inspection) === "ENOENT" ? "complete" : "unknown"; }
          }
        }
      }
    }
  }
  return result;
}

export function invalidSnapshotWriteResult(): SnapshotWriteResult {
  return { publication_status: "not_published", temp_cleanup_status: "complete", error: "invalid_input", cleanup_errors: [] };
}
