import { beforeEach, describe, expect, it, vi } from "vitest";
import { constants } from "node:fs";
import { readChildTurnCollectionJson, ChildTurnSnapshotReadError } from "../../src/adapters/child-turn-snapshot-reader.js";
import { readUtf8SnapshotFile } from "../../src/adapters/snapshot-file-reader.js";

const fs = vi.hoisted(() => ({ stat: vi.fn(), open: vi.fn() }));
vi.mock("node:fs/promises", () => fs);
const input = { initialization_error: "timeout", cleanup_status: "unknown", collection: null };
const envelope = { format: "agent-slity.child-turn-collection", version: 1, schema_reference: "0.166.0", verification_status: "unverified", result: input, extra: "가나다PRIVATE_TEXT" };
const source = Buffer.from(JSON.stringify(envelope));
let handle: { stat: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
function supply(bytes: Buffer) {
  let offset = 0;
  fs.stat.mockResolvedValue({ isFile: () => true, size: bytes.length });
  handle.stat.mockResolvedValue({ isFile: () => true, size: bytes.length });
  handle.read.mockImplementation(async (buffer: Buffer, _offset: number, length: number) => {
    const count = Math.min(5, length, bytes.length - offset);
    bytes.copy(buffer, 0, offset, offset + count); offset += count;
    return { bytesRead: count };
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  handle = { stat: vi.fn(), read: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  fs.open.mockResolvedValue(handle); supply(source);
});

describe("저장된 turn JSON의 제한된 파일 읽기", () => {
  it("읽기 전용 청크와 UTF-8 경계를 처리하고 close 뒤 허용 관측만 반환한다", async () => {
    expect(await readChildTurnCollectionJson("PRIVATE_FILE.json")).toEqual(input);
    expect(fs.open.mock.calls[0][1]).toBe(constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("잘못된 경로는 파일 작업 전에 고정 invalid_input 오류로 거부한다", async () => {
    for (const path of ["", ".", "x\0y", "./"]) {
      await expect(readChildTurnCollectionJson(path)).rejects.toMatchObject({ name: "ChildTurnSnapshotReadError", code: "invalid_input", message: "turn 수집 JSON 파일을 읽을 수 없습니다." });
    }
    expect(fs.stat).not.toHaveBeenCalled(); expect(fs.open).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "win32")("장치와 혼합 UNC 경로는 파일 작업 전에 거부한다", async () => {
    for (const path of ["NUL", "CONIN$", "C:CONOUT$", "\\/host/share/x", "/\\host/share/x", "C:/x:stream"]) {
      await expect(readChildTurnCollectionJson(path)).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(fs.stat).not.toHaveBeenCalled();
  });

  it("일반 파일이 아니거나 사전 크기를 초과하면 열지 않는다", async () => {
    for (const details of [{ isFile: () => false, size: 0 }, { isFile: () => true, size: 16 * 1024 * 1024 + 1 }]) {
      fs.stat.mockResolvedValue(details);
      await expect(readChildTurnCollectionJson("PRIVATE_FILE.json")).rejects.toMatchObject({ code: "read_failed" });
    }
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("열린 파일의 종류·크기 변경을 확인하고 실패해도 닫는다", async () => {
    for (const details of [{ isFile: () => false, size: 0 }, { isFile: () => true, size: 16 * 1024 * 1024 + 1 }]) {
      handle.stat.mockResolvedValue(details);
      await expect(readChildTurnCollectionJson("PRIVATE_FILE.json")).rejects.toMatchObject({ code: "read_failed" });
    }
    expect(handle.read).not.toHaveBeenCalled(); expect(handle.close).toHaveBeenCalledTimes(2);
  });

  it("stat 뒤 성장해도 실제 읽기는 예산+1byte로 제한하며 닫는다", async () => {
    supply(Buffer.from("0123456789"));
    fs.stat.mockResolvedValue({ isFile: () => true, size: 0 }); handle.stat.mockResolvedValue({ isFile: () => true, size: 0 });
    await expect(readUtf8SnapshotFile("PRIVATE_FILE.json", 8)).rejects.toBeInstanceOf(TypeError);
    expect(handle.read.mock.results).toHaveLength(2);
    expect(handle.read.mock.calls.map(call => call[2])).toEqual([9, 4]);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("손상 UTF-8은 read_failed, BOM·손상 JSON·미지원 schema는 invalid_json이다", async () => {
    for (const [bytes, code] of [[Buffer.from([0xc3, 0x28]), "read_failed"], [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), source]), "invalid_json"],
      [Buffer.from("PRIVATE_BAD_JSON"), "invalid_json"], [Buffer.from(JSON.stringify({ ...envelope, version: 2 })), "invalid_json"]] as const) {
      supply(bytes);
      await expect(readChildTurnCollectionJson("PRIVATE_FILE.json")).rejects.toMatchObject({ code });
    }
    expect(handle.close).toHaveBeenCalledTimes(4);
  });

  it("읽기·close의 OS 오류 원문을 고정 오류로 바꾸고 성공 관측을 반환하지 않는다", async () => {
    for (const operation of ["read", "close"] as const) {
      supply(source); handle.close.mockResolvedValue(undefined);
      handle[operation].mockRejectedValue(new Error("PRIVATE_OS_ERROR"));
      try { await readChildTurnCollectionJson("PRIVATE_FILE.json"); expect.unreachable(); }
      catch (error) {
        expect(error).toBeInstanceOf(ChildTurnSnapshotReadError);
        expect(error).toMatchObject({ code: "read_failed", message: "turn 수집 JSON 파일을 읽을 수 없습니다." });
        expect((error as Error).message).not.toContain("PRIVATE_"); expect(error).not.toHaveProperty("cause");
      }
    }
  });
});
