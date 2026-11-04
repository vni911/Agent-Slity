import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectFromChildV0166 } from "../../src/index.js";

afterEach(() => vi.useRealTimers());

describe("자식 프로세스 수집 수명", () => {
  it("종료를 관측하지 못하면 성공으로 단정하지 않는다", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      exitCode: null, signalCode: null, kill: vi.fn(() => false) }) as unknown as ChildProcessWithoutNullStreams;
    const pending = collectFromChildV0166(child, "", "sample");
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(result).toEqual({ collection: null, initialization_error: "invalid_input", cleanup_status: "unknown" });
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit("close", null, null);
  });

  it("exit 뒤 close 전의 지연 자식 오류를 처리하고 close 후 리스너를 제거한다", async () => {
    const emitter = new EventEmitter();
    const child = Object.assign(emitter, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      exitCode: null, signalCode: null, kill: vi.fn(() => { emitter.emit("exit", 0, null); return true; }) }) as unknown as ChildProcessWithoutNullStreams;
    const result = await collectFromChildV0166(child, "", "sample");
    expect(result.cleanup_status).toBe("exit_observed");
    expect(() => child.emit("error", new Error("PRIVATE_LATE_ERROR"))).not.toThrow();
    child.emit("close", 0, null);
    expect(child.listenerCount("error")).toBe(0);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_LATE_ERROR");
  });
});
