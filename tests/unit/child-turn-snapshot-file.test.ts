import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { isSafeSnapshotPath, saveChildTurnCollectionJson } from "../../src/adapters/child-turn-snapshot-file.js";
import type { ChildTurnCollectionResult } from "../../src/index.js";

const fs = vi.hoisted(() => ({ open: vi.fn(), lstat: vi.fn(), link: vi.fn(), unlink: vi.fn() }));
vi.mock("node:fs/promises", () => fs);
const input: ChildTurnCollectionResult = { initialization_error: "timeout", cleanup_status: "unknown", collection: null };
const ioError = (code: string) => Object.assign(new Error("PRIVATE_OS_PATH"), { code });
let handle: { write: ReturnType<typeof vi.fn>; sync: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.resetAllMocks();
  fs.lstat.mockRejectedValue(ioError("ENOENT"));
  fs.link.mockResolvedValue(undefined); fs.unlink.mockResolvedValue(undefined);
  handle = { write: vi.fn(async (_bytes: Buffer, _offset: number, length: number) => ({ bytesWritten: length })),
    sync: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
  fs.open.mockResolvedValue(handle);
});

describe("turn JSON 스냅샷 파일 writer", () => {
  it("실패 상태도 wx/0600으로 완전히 쓰고 sync/close 뒤 게시하며 자기 임시 이름만 지운다", async () => {
    handle.write.mockImplementation(async (_bytes: Buffer, _offset: number, length: number) => ({ bytesWritten: Math.min(length, 17) }));
    const result = await saveChildTurnCollectionJson(input, "snapshot.json");
    expect(result).toEqual({ publication_status: "published", temp_cleanup_status: "complete", error: null, cleanup_errors: [] });
    const temporary = fs.open.mock.calls[0][0];
    expect(fs.open).toHaveBeenCalledWith(temporary, "wx", 0o600);
    expect(fs.link).toHaveBeenCalledWith(temporary, resolve("snapshot.json"));
    expect(fs.unlink).toHaveBeenCalledExactlyOnceWith(temporary);
    expect(handle.write.mock.calls[0][0].toString()).not.toMatch(/[\n\r]$/);
    const calls = [handle.write, handle.sync, handle.close, fs.link, fs.unlink].map(fn => fn.mock.invocationCallOrder);
    expect(Math.max(...calls[0])).toBeLessThan(calls[1][0]);
    expect(calls.slice(1).map(call => call[0])).toEqual(calls.slice(1).map(call => call[0]).sort((a, b) => a - b));
  });

  it("잘못된 자료와 경로는 파일 작업 없이 고정 오류로 거부한다", async () => {
    for (const [value, path] of [[{}, "snapshot.json"], [input, ""], [input, "x\0y"], [input, "./"]] as const) {
      expect(await saveChildTurnCollectionJson(value as ChildTurnCollectionResult, path)).toEqual({
        publication_status: "not_published", temp_cleanup_status: "complete", error: "invalid_input", cleanup_errors: [],
      });
    }
    expect(fs.lstat).not.toHaveBeenCalled(); expect(fs.open).not.toHaveBeenCalled();
  });

  it("Windows 장치·UNC·ADS·드라이브 상대·확장 경로를 정책 단계에서 거부한다", () => {
    for (const path of ["NUL", "NUL.txt", "NUL .txt", "CONOUT$", "x/NUL .", "x:stream", "C:relative", "C:CONIN$", "\\\\host\\share\\x", "\\/host/share/x", "/\\host/share/x", "\\\\?\\C:\\x", "C:/x:stream", "C:/COM¹.log"]) {
      expect(isSafeSnapshotPath(path, "win32"), path).toBe(false);
    }
    expect(isSafeSnapshotPath("C:/normal/snapshot.json", "win32")).toBe(true);
  });

  it.skipIf(process.platform !== "win32")("혼합 구분자 UNC를 어떤 파일 작업도 하기 전에 거부한다", async () => {
    for (const path of ["\\/host/share/x", "/\\host/share/x"]) {
      expect((await saveChildTurnCollectionJson(input, path)).error).toBe("invalid_input");
    }
    expect(fs.lstat).not.toHaveBeenCalled(); expect(fs.open).not.toHaveBeenCalled();
  });

  it("기존 대상과 디렉터리에는 임시 파일도 생성하지 않는다", async () => {
    for (const directory of [false, true]) {
      fs.lstat.mockResolvedValue({ isDirectory: () => directory });
      const result = await saveChildTurnCollectionJson(input, "snapshot.json");
      expect(result.error).toBe(directory ? "invalid_input" : "already_exists");
      expect(result.publication_status).toBe("not_published");
    }
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("임시 생성 충돌이나 권한 실패 때 소유하지 않은 임시 파일을 지우지 않는다", async () => {
    for (const code of ["EEXIST", "EACCES"]) {
      fs.open.mockRejectedValue(ioError(code));
      const result = await saveChildTurnCollectionJson(input, "snapshot.json");
      expect(result.error).toBe("io_error"); expect(result.publication_status).toBe("not_published");
    }
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  for (const failure of ["write", "zero_write", "sync", "close"] as const) {
    it(`${failure} 실패에서 게시하지 않고 원래 오류와 임시 정리 상태를 보존한다`, async () => {
      if (failure === "write") handle.write.mockRejectedValue(ioError("ENOSPC"));
      if (failure === "zero_write") handle.write.mockResolvedValue({ bytesWritten: 0 });
      if (failure === "sync") handle.sync.mockRejectedValue(ioError("EIO"));
      if (failure === "close") handle.close.mockRejectedValueOnce(ioError("EIO"));
      const result = await saveChildTurnCollectionJson(input, "snapshot.json");
      expect(result).toEqual({ publication_status: "not_published", temp_cleanup_status: "complete", error: "io_error", cleanup_errors: [] });
      expect(fs.link).not.toHaveBeenCalled(); expect(fs.unlink).toHaveBeenCalledTimes(1);
      expect(handle.close).toHaveBeenCalledTimes(failure === "close" ? 2 : 1);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    });
  }

  it("close와 unlink 정리가 모두 실패해도 원래 오류를 가리지 않는다", async () => {
    handle.write.mockRejectedValue(ioError("ENOSPC")); handle.close.mockRejectedValue(ioError("EIO")); fs.unlink.mockRejectedValue(ioError("EPERM"));
    expect(await saveChildTurnCollectionJson(input, "snapshot.json")).toEqual({ publication_status: "not_published", temp_cleanup_status: "unknown", error: "io_error", cleanup_errors: ["close_failed", "unlink_failed"] });
  });

  for (const [code, status, error] of [["EEXIST", "not_published", "already_exists"], ["ENOTSUP", "not_published", "unsupported_storage"], ["EIO", "unknown", "io_error"]]) {
    it(`게시 ${code}를 ${status}로 구분하고 fallback하지 않는다`, async () => {
      fs.link.mockRejectedValue(ioError(code));
      expect(await saveChildTurnCollectionJson(input, "snapshot.json")).toEqual({ publication_status: status, temp_cleanup_status: "complete", error, cleanup_errors: [] });
      expect(fs.link).toHaveBeenCalledTimes(1); expect(fs.unlink).toHaveBeenCalledTimes(1);
    });
  }

  it("게시 후 정리 실패는 published/pending이며 최종 경로는 삭제하지 않는다", async () => {
    fs.unlink.mockRejectedValue(ioError("EPERM"));
    fs.lstat.mockRejectedValueOnce(ioError("ENOENT")).mockResolvedValue({ isDirectory: () => false });
    const result = await saveChildTurnCollectionJson(input, "snapshot.json");
    expect(result).toEqual({ publication_status: "published", temp_cleanup_status: "pending", error: null, cleanup_errors: ["unlink_failed"] });
    expect(fs.unlink).not.toHaveBeenCalledWith(resolve("snapshot.json"));
  });

  it("임시 삭제 실패 뒤 잔류 여부도 확인할 수 없으면 unknown을 남긴다", async () => {
    fs.unlink.mockRejectedValue(ioError("EPERM"));
    fs.lstat.mockRejectedValueOnce(ioError("ENOENT")).mockRejectedValue(ioError("EACCES"));
    expect(await saveChildTurnCollectionJson(input, "snapshot.json")).toEqual({ publication_status: "published", temp_cleanup_status: "unknown", error: null, cleanup_errors: ["unlink_failed"] });
  });

  it("이미 없어진 자기 임시 이름은 정리 완료이며 경로 오류 원문을 반환하지 않는다", async () => {
    fs.unlink.mockRejectedValue(ioError("ENOENT"));
    expect((await saveChildTurnCollectionJson(input, "snapshot.json")).temp_cleanup_status).toBe("complete");
    fs.lstat.mockRejectedValue(ioError("EACCES"));
    const result = await saveChildTurnCollectionJson(input, "snapshot.json");
    expect(result.error).toBe("io_error"); expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });
});
