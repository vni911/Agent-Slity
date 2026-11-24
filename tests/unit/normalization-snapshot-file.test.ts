import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCodexExecLine, exportNormalizationJson } from "../../src/index.js";
import { saveNormalizationJson, readNormalizationJson, NormalizationSnapshotReadError } from "../../src/adapters/normalization-snapshot-file.js";
const fs = vi.hoisted(() => ({ lstat: vi.fn(), stat: vi.fn(), open: vi.fn(), link: vi.fn(), unlink: vi.fn() }));
vi.mock("node:fs/promises", () => fs);
const records = () => [normalizeCodexExecLine({ kind: "record", line: 1, value: { type: "turn.completed", usage: { input_tokens: 0 } } }, "sample")];
let handle: { write: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn>; sync: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; stat: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.resetAllMocks();
  const bytes = Buffer.from(exportNormalizationJson(records())); let offset = 0;
  fs.lstat.mockRejectedValue(Object.assign(new Error("PRIVATE_PATH"), { code: "ENOENT" }));
  fs.stat.mockResolvedValue({ isFile: () => true, size: bytes.length });
  fs.link.mockResolvedValue(undefined); fs.unlink.mockResolvedValue(undefined);
  handle = { write: vi.fn(async (_b: Buffer, _o: number, length: number) => ({ bytesWritten: length })),
    sync: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), stat: vi.fn().mockResolvedValue({ isFile: () => true, size: bytes.length }),
    read: vi.fn(async (buffer: Buffer, _o: number, length: number) => {
      const count = Math.min(bytes.length - offset, length); bytes.copy(buffer, 0, offset, offset + count); offset += count; return { bytesRead: count };
    }) };
  fs.open.mockResolvedValue(handle);
});

describe("정규화 JSON의 파일 저장·읽기 연결", () => {
  it("허용한 정규화 JSON만 기존 게시 엔진으로 넘기고 같은 관측을 읽는다", async () => {
    expect((await saveNormalizationJson(records(), "snapshot.json")).publication_status).toBe("published");
    expect(handle.write.mock.calls[0][0].toString()).toBe(exportNormalizationJson(records()));
    expect(fs.link).toHaveBeenCalledTimes(1); expect(fs.unlink).toHaveBeenCalledTimes(1);
    expect(await readNormalizationJson("snapshot.json")).toEqual(records());
  });
  it("구조·레코드·경로 오류는 파일 작업 전에 거부한다", async () => {
    expect((await saveNormalizationJson([{}] as ReturnType<typeof records>, "snapshot.json")).error).toBe("invalid_input");
    expect((await saveNormalizationJson(Array(10001).fill(records()[0]), "snapshot.json")).error).toBe("invalid_input");
    expect((await saveNormalizationJson(records(), "")).error).toBe("invalid_input");
    await expect(readNormalizationJson("x\0y")).rejects.toMatchObject({ code: "invalid_input" });
    expect(fs.open).not.toHaveBeenCalled(); expect(fs.lstat).not.toHaveBeenCalled(); expect(fs.stat).not.toHaveBeenCalled();
  });
  it("게시 불명확과 게시 후 정리 실패를 그대로 보존한다", async () => {
    fs.link.mockRejectedValueOnce(Object.assign(new Error("PRIVATE_IO"), { code: "EIO" }));
    expect((await saveNormalizationJson(records(), "snapshot.json")).publication_status).toBe("unknown");
    fs.unlink.mockRejectedValueOnce(Object.assign(new Error("PRIVATE_IO"), { code: "EPERM" }));
    fs.lstat.mockRejectedValueOnce(Object.assign(new Error(), { code: "ENOENT" })).mockResolvedValue({ isDirectory: () => false });
    expect(await saveNormalizationJson(records(), "snapshot.json")).toEqual({ publication_status: "published", temp_cleanup_status: "pending", error: null, cleanup_errors: ["unlink_failed"] });
  });
  it("읽기/close 실패는 고정 오류이며 OS 경로를 포함하지 않는다", async () => {
    handle.close.mockRejectedValue(new Error("PRIVATE_OS_PATH"));
    await expect(readNormalizationJson("PRIVATE_FILE.json")).rejects.toMatchObject({ name: "NormalizationSnapshotReadError", code: "read_failed", message: "정규화 JSON 파일을 읽을 수 없습니다." });
    expect(new NormalizationSnapshotReadError("invalid_json")).not.toHaveProperty("cause");
  });
});
