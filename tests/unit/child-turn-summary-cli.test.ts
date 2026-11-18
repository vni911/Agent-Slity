import { constants } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  stat: vi.fn(), open: vi.fn(), writeFile: vi.fn(),
  file: { stat: vi.fn(), read: vi.fn(), close: vi.fn() },
}));
vi.mock("node:fs/promises", () => ({ stat: fs.stat, open: fs.open, writeFile: fs.writeFile }));
import { readChildTurnSummary } from "../../src/cli/child-turn-summary.js";
import { runCli } from "../../src/cli/run.js";

const limit = 16 * 1024 * 1024;
const json = JSON.stringify({ format: "agent-slity.child-turn-collection", version: 1, schema_reference: "0.166.0",
  verification_status: "unverified", extra: "가",
  result: { initialization_error: "cancelled", cleanup_status: "unknown", collection: null } });
const regular = (size = 0) => ({ isFile: () => true, size });
function supply(bytes: Buffer, maxChunk = Infinity): void {
  let offset = 0;
  fs.file.read.mockImplementation(async (buffer: Buffer, start: number, length: number) => {
    const size = Math.min(length, maxChunk, bytes.length - offset);
    bytes.copy(buffer, start, offset, offset + size); offset += size;
    return { bytesRead: size, buffer };
  });
}
function failed(result: Awaited<ReturnType<typeof runCli>>): void {
  expect(result).toEqual({ exitCode: 1, stdout: "",
    stderr: "수집 JSON을 요약할 수 없습니다. 파일·UTF-8·형식·크기를 확인하세요.\n" });
  expect(fs.writeFile).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  fs.stat.mockResolvedValue(regular());
  fs.open.mockResolvedValue(fs.file);
  fs.file.stat.mockResolvedValue(regular());
  fs.file.close.mockResolvedValue(undefined);
  supply(Buffer.from(json));
});

describe("자식 turn JSON CLI의 제한된 파일 읽기", () => {
  it("읽기 전용으로 열고 청크 사이 UTF-8 문자를 복원한 후 descriptor를 닫는다", async () => {
    supply(Buffer.from(json), 1);
    const result = await readChildTurnSummary("PRIVATE_PATH");
    expect(result).toMatchObject({ initialization_error: "cancelled", cleanup_status: "unknown", collection: null });
    expect(fs.open).toHaveBeenCalledWith("PRIVATE_PATH", constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    expect(fs.file.close).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it.each(["non_file", "too_large"])("열기 전 %s 입력은 descriptor를 만들지 않는다", async mode => {
    fs.stat.mockResolvedValue(mode === "non_file" ? { isFile: () => false, size: 0 } : regular(limit + 1));
    failed(await runCli(["--child-turn-summary", "PRIVATE_PATH"]));
    expect(fs.open).not.toHaveBeenCalled(); expect(fs.file.close).not.toHaveBeenCalled();
  });

  it.each(["non_file", "too_large"])("열린 대상의 %s 변경도 읽기 전에 거부하고 닫는다", async mode => {
    fs.file.stat.mockResolvedValue(mode === "non_file" ? { isFile: () => false, size: 0 } : regular(limit + 1));
    failed(await runCli(["--child-turn-summary", "PRIVATE_PATH"]));
    expect(fs.file.read).not.toHaveBeenCalled(); expect(fs.file.close).toHaveBeenCalledTimes(1);
  });

  it("stat 이후 성장한 파일도 최대16MiB+1바이트만 읽고 부분 출력 없이 닫는다", async () => {
    let total = 0;
    fs.file.read.mockImplementation(async (buffer: Buffer, start: number, length: number) => {
      buffer.fill(32, start, start + length); total += length;
      return { bytesRead: length, buffer };
    });
    failed(await runCli(["--child-turn-summary", "PRIVATE_GROWING_PATH"]));
    expect(total).toBe(limit + 1);
    expect(fs.file.read.mock.calls.at(-1)?.[2]).toBe(1);
    expect(fs.file.close).toHaveBeenCalledTimes(1);
  });

  it("읽기 도중 실패하면 앞 청크를 출력하지 않고 열린 descriptor를 닫는다", async () => {
    fs.file.read.mockResolvedValueOnce({ bytesRead: 1 });
    fs.file.read.mockRejectedValueOnce(new Error("PRIVATE_READ_FAILURE"));
    failed(await runCli(["--child-turn-summary", "PRIVATE_PATH"]));
    expect(fs.file.close).toHaveBeenCalledTimes(1);
  });

  it("열린 파일의 stat 실패도 descriptor를 닫고 원문 없는 오류로 반환한다", async () => {
    fs.file.stat.mockRejectedValue(new Error("PRIVATE_STAT_FAILURE"));
    failed(await runCli(["--child-turn-summary", "PRIVATE_PATH"]));
    expect(fs.file.close).toHaveBeenCalledTimes(1);
  });

  it.each([Buffer.from([0xff]), Buffer.from("\uFEFF" + json), Buffer.from("PRIVATE_INVALID_JSON")])(
    "디코딩·BOM·파싱 실패에도 descriptor를 닫는다", async bytes => {
      supply(bytes);
      failed(await runCli(["--child-turn-summary", "PRIVATE_PATH"]));
      expect(fs.file.close).toHaveBeenCalledTimes(1);
    });

  it("close가 끝나기 전에 CLI 성공을 반환하지 않는다", async () => {
    let finishClose: (() => void) | undefined;
    fs.file.close.mockImplementation(() => new Promise<void>(resolve => { finishClose = resolve; }));
    let returned = false;
    const pending = runCli(["--child-turn-summary", "PRIVATE_PATH"]).then(result => { returned = true; return result; });
    await vi.waitFor(() => expect(fs.file.close).toHaveBeenCalledTimes(1));
    expect(returned).toBe(false);
    if (!finishClose) throw new Error("정리 콜백 없음");
    finishClose();
    expect((await pending).exitCode).toBe(0);
  });

  it("close 실패는 성공 JSON 대신 고정 오류만 반환한다", async () => {
    fs.file.close.mockRejectedValue(new Error("PRIVATE_CLOSE_FAILURE"));
    failed(await runCli(["--child-turn-summary", "PRIVATE_PATH"]));
  });

  it("open 실패 때 닫을 descriptor가 없으며 인수 오류는 파일에 접근하지 않는다", async () => {
    fs.open.mockRejectedValue(new Error("PRIVATE_OPEN_FAILURE"));
    failed(await runCli(["--child-turn-summary", "PRIVATE_PATH"]));
    expect(fs.file.close).not.toHaveBeenCalled();
    fs.stat.mockClear();
    for (const args of [["--child-turn-summary"], ["--child-turn-summary", ""],
      ["--child-turn-summary", "-h"], ["--child-turn-summary", "PRIVATE_PATH", "PRIVATE_ALIAS"],
      ["--child-turn-summary", "PRIVATE_PATH", "--output", "PRIVATE_OUTPUT"]]) {
      expect(await runCli(args)).toEqual({ exitCode: 2, stdout: "", stderr: "사용법: --child-turn-summary <JSON 파일>\n" });
    }
    expect(fs.stat).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "win32")("Windows 콘솔 장치명은 stat/open 전에 거부한다", async () => {
    for (const path of ["CONIN$", "CONOUT$", "conin$.", "conout$ ", "C:\\PRIVATE\\CONIN$", "./CONOUT$",
      "C:CONIN$", "C:CONOUT$", "C:conin$.", "C:conout$ "]) {
      expect(await runCli(["--child-turn-summary", path])).toEqual({ exitCode: 2, stdout: "",
        stderr: "사용법: --child-turn-summary <JSON 파일>\n" });
    }
    expect(fs.stat).not.toHaveBeenCalled(); expect(fs.open).not.toHaveBeenCalled();
  });
});
