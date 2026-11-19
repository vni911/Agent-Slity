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

describe("여러 자식 turn JSON 요약", () => {
  function resetOnOpen(payload: (path: string) => Buffer): void {
    fs.open.mockImplementation(async (path: string) => { supply(payload(path)); return fs.file; });
  }
  function batchFailure(result: Awaited<ReturnType<typeof runCli>>): void {
    expect(result).toEqual({ exitCode: 1, stdout: "",
      stderr: "수집 JSON 묶음을 요약할 수 없습니다. 파일·UTF-8·형식·크기·전체 한도를 확인하세요.\n" });
    expect(fs.writeFile).not.toHaveBeenCalled();
  }
  function largeInputs(reported: number): { actual: () => number } {
    let actual = 0;
    const prefix = Buffer.from(json);
    fs.stat.mockResolvedValue(regular(reported)); fs.file.stat.mockResolvedValue(regular(reported));
    fs.open.mockImplementation(async () => {
      let offset = 0;
      fs.file.read.mockImplementation(async (buffer: Buffer, start: number, length: number) => {
        const size = Math.min(length, limit - offset);
        buffer.fill(32, start, start + size);
        if (offset < prefix.length) prefix.copy(buffer, start, offset, Math.min(prefix.length, offset + size));
        offset += size; actual += size;
        return { bytesRead: size, buffer };
      });
      return fs.file;
    });
    return { actual: () => actual };
  }

  it("순서·반복 경로와 개별 초기화 상태를 보존하고 파일을 순차 정리한다", async () => {
    const events: string[] = [];
    resetOnOpen(path => Buffer.from(path === "PRIVATE_B" ? json.replace('"cancelled"', '"server_error"') : json));
    const open = fs.open.getMockImplementation()!;
    fs.open.mockImplementation(async (path: string) => { events.push("open:" + path); return open(path); });
    fs.file.close.mockImplementation(async () => { events.push("close"); });
    const result = await runCli(["--child-turn-summaries", "PRIVATE_A", "PRIVATE_B", "PRIVATE_A"]);
    expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
    const batch = JSON.parse(result.stdout);
    expect(batch).toMatchObject({ format: "agent-slity.child-turn-summaries", version: 1,
      schema_reference: "0.166.0", verification_status: "unverified", count_semantics: "per_input_including_duplicates" });
    expect(batch.inputs.map((x: { input_index: number }) => x.input_index)).toEqual([0, 1, 2]);
    expect(batch.inputs.map((x: { summary: { initialization_error: string } }) => x.summary.initialization_error))
      .toEqual(["cancelled", "server_error", "cancelled"]);
    expect(events).toEqual(["open:PRIVATE_A", "close", "open:PRIVATE_B", "close", "open:PRIVATE_A", "close"]);
    expect(result.stdout).not.toContain("PRIVATE_"); expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("1개·8개 입력을 허용하고0개·9개는 읽기 전에 거부한다", async () => {
    resetOnOpen(() => Buffer.from(json));
    for (const count of [1, 8]) {
      const result = await runCli(["--child-turn-summaries", ...Array(count).fill("PRIVATE_INPUT")]);
      expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout).inputs).toHaveLength(count);
    }
    fs.stat.mockClear(); fs.open.mockClear();
    for (const paths of [[], Array(9).fill("PRIVATE_INPUT")]) {
      expect(await runCli(["--child-turn-summaries", ...paths])).toEqual({ exitCode: 2, stdout: "",
        stderr: "사용법: --child-turn-summaries <JSON 파일> [JSON 파일 ...] (최대8개)\n" });
    }
    expect(fs.stat).not.toHaveBeenCalled(); expect(fs.open).not.toHaveBeenCalled();
  });

  it("전체64MiB 경계는 허용하고 남은 예산보다 큰 다음 파일은 열지 않는다", async () => {
    const bytes = largeInputs(limit);
    const result = await runCli(["--child-turn-summaries", ...Array(4).fill("PRIVATE_FULL")]);
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout).inputs).toHaveLength(4);
    expect(bytes.actual()).toBe(64 * 1024 * 1024);
    fs.open.mockClear(); fs.file.close.mockClear();
    batchFailure(await runCli(["--child-turn-summaries", ...Array(5).fill("PRIVATE_FULL")]));
    expect(fs.open).toHaveBeenCalledTimes(4); expect(fs.file.close).toHaveBeenCalledTimes(4);
  });

  it("과소 stat 보고나 파일 성장에서도 전체64MiB+1byte만 읽고 모두 닫는다", async () => {
    const bytes = largeInputs(0);
    batchFailure(await runCli(["--child-turn-summaries", ...Array(6).fill("PRIVATE_GROWING")]));
    expect(bytes.actual()).toBe(64 * 1024 * 1024 + 1);
    expect(fs.open).toHaveBeenCalledTimes(5); expect(fs.file.close).toHaveBeenCalledTimes(5);
    expect(fs.file.read.mock.calls.at(-1)?.[2]).toBe(1);
  });

  it("stat의 예상 크기를 합산하지 않고 실제 읽은 바이트로 전체 예산을 계산한다", async () => {
    fs.stat.mockResolvedValue(regular(limit)); fs.file.stat.mockResolvedValue(regular(limit));
    resetOnOpen(() => Buffer.from(json));
    const result = await runCli(["--child-turn-summaries", ...Array(8).fill("PRIVATE_SHRUNK")]);
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout).inputs).toHaveLength(8);
    expect(fs.file.close).toHaveBeenCalledTimes(8);
  });

  it.each(["parse", "read", "close"])("뒤쪽 %s 실패 시 앞 결과도 출력하지 않고 다음 파일은 열지 않는다", async mode => {
    resetOnOpen(path => Buffer.from(path === "PRIVATE_BAD" && mode === "parse" ? "PRIVATE_INVALID" : json));
    if (mode === "read") {
      const open = fs.open.getMockImplementation()!;
      fs.open.mockImplementation(async (path: string) => {
        const file = await open(path);
        if (path === "PRIVATE_BAD") fs.file.read.mockRejectedValue(new Error("PRIVATE_READ_FAILURE"));
        return file;
      });
    }
    if (mode === "close") fs.file.close.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("PRIVATE_CLOSE_FAILURE"));
    batchFailure(await runCli(["--child-turn-summaries", "PRIVATE_GOOD", "PRIVATE_BAD", "PRIVATE_NEVER"]));
    expect(fs.open.mock.calls.map(args => args[0])).toEqual(["PRIVATE_GOOD", "PRIVATE_BAD"]);
    expect(fs.file.close).toHaveBeenCalledTimes(2);
  });

  it("뒤쪽 빈 경로·옵션·출력 지정도 첫 파일을 읽기 전에 거부한다", async () => {
    for (const tail of ["", "-h", "--help", "--output"]) {
      expect((await runCli(["--child-turn-summaries", "PRIVATE_VALID", tail])).exitCode).toBe(2);
    }
    expect(fs.stat).not.toHaveBeenCalled(); expect(fs.open).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "win32")("뒤쪽 Windows 장치 경로도 전체 파일 접근 전에 거부한다", async () => {
    for (const path of ["NUL", "CONIN$", "C:CONOUT$", "C:conin$.", "PRIVATE_INPUT:PRIVATE_ADS", "\\\\.\\pipe\\PRIVATE_PIPE"]) {
      expect((await runCli(["--child-turn-summaries", "PRIVATE_VALID", path])).exitCode).toBe(2);
    }
    expect(fs.stat).not.toHaveBeenCalled(); expect(fs.open).not.toHaveBeenCalled();
  });
});
