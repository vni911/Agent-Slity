import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectFromChildV0166, collectTurnsFromChildV0166 } from "../../src/index.js";
import type { ChildCollectionOptions } from "../../src/index.js";

afterEach(() => vi.useRealTimers());
function fakeChild(action: (signal: unknown) => boolean = () => true) {
  return Object.assign(new EventEmitter(), { pid: 123 as number | undefined, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null as number | null, signalCode: null as NodeJS.Signals | null, kill: vi.fn(action) });
}
function asChild(child: ReturnType<typeof fakeChild>) { return child as unknown as ChildProcessWithoutNullStreams; }
const close = (child: ReturnType<typeof fakeChild>) => child.emit("close", null, null);

describe("직접 자식 종료 정책", () => {
  for (const collect of [collectFromChildV0166, collectTurnsFromChildV0166]) {
    it(`${collect.name}는 짧은 기한에서 신호 전송 성공을 종료로 판단하지 않는다`, async () => {
      vi.useFakeTimers();
      const child = fakeChild();
      const pending = collect(asChild(child), "", "sample", { cleanupTimeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      expect((await pending).cleanup_status).toBe("unknown");
      expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
      expect(vi.getTimerCount()).toBe(0);
      expect(child.listenerCount("exit")).toBe(0);
      expect(() => child.emit("error", new Error("PRIVATE_LATE_ERROR"))).not.toThrow();
      close(child);
      expect(child.listenerCount("error")).toBe(0);
    });
  }

  it("명시적으로 허용할 때만 SIGKILL 후 실제 exit를 기다린다", async () => {
    vi.useFakeTimers();
    const child = fakeChild(signal => { if (signal === "SIGKILL") setTimeout(() => child.emit("exit", null, "SIGKILL"), 30); return true; });
    const pending = collectTurnsFromChildV0166(asChild(child), "", "sample", { cleanupTimeoutMs: 100, forceKillOnTimeout: true });
    await vi.advanceTimersByTimeAsync(99);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
    await vi.advanceTimersByTimeAsync(31);
    expect((await pending).cleanup_status).toBe("exit_observed");
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(vi.getTimerCount()).toBe(0);
    close(child);
  });

  it("강제 종료 신호 뒤에도 exit가 없으면 추가 1초 뒤 unknown이다", async () => {
    vi.useFakeTimers();
    const child = fakeChild(); let returned = false;
    const pending = collectFromChildV0166(asChild(child), "", "sample", { cleanupTimeoutMs: 100, forceKillOnTimeout: true });
    void pending.then(() => { returned = true; });
    await vi.advanceTimersByTimeAsync(1099);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).cleanup_status).toBe("unknown");
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(vi.getTimerCount()).toBe(0);
    close(child);
  });

  for (const behavior of ["false", "throw"] as const) {
    it(`kill ${behavior}도 종료 관측 없이는 unknown이며 원문을 노출하지 않는다`, async () => {
      vi.useFakeTimers();
      const child = fakeChild(() => { if (behavior === "throw") throw new Error("PRIVATE_SIGNAL"); return false; });
      const pending = collectFromChildV0166(asChild(child), "", "sample", { cleanupTimeoutMs: 1, forceKillOnTimeout: true });
      await vi.advanceTimersByTimeAsync(1001);
      const result = await pending;
      expect(result.cleanup_status).toBe("unknown");
      expect(JSON.stringify(result)).not.toContain("PRIVATE_");
      expect(child.kill).toHaveBeenCalledTimes(2);
      close(child);
    });
  }

  const invalid = [0, -1, 30001, NaN, Infinity, 1.5, "100", null];
  for (const timeout of invalid) {
    it(`잘못된 기한 ${String(timeout)}과 force true 혼합은 전체 기본 정책을 사용한다`, async () => {
      vi.useFakeTimers();
      const child = fakeChild();
      const pending = collectTurnsFromChildV0166(asChild(child), "thread", "sample",
        { cleanupTimeoutMs: timeout, forceKillOnTimeout: true } as ChildCollectionOptions);
      await vi.advanceTimersByTimeAsync(10000);
      expect(await pending).toEqual({ collection: null, initialization_error: "invalid_input", cleanup_status: "unknown" });
      expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
      expect(vi.getTimerCount()).toBe(0);
      close(child);
    });
  }

  it("잘못된 force 설정도 짧은 기한을 채택하지 않고 기본 10초로 정리한다", async () => {
    vi.useFakeTimers();
    const child = fakeChild(); let returned = false;
    const pending = collectFromChildV0166(asChild(child), "thread", "sample",
      { cleanupTimeoutMs: 1, forceKillOnTimeout: "yes" } as unknown as ChildCollectionOptions);
    void pending.then(() => { returned = true; });
    await vi.advanceTimersByTimeAsync(9999);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).initialization_error).toBe("invalid_input");
    expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
    close(child);
  });

  it("spawn 실패와 close만 관측한 자식에는 신호나 추가 대기가 없다", async () => {
    vi.useFakeTimers();
    const failed = Object.assign(fakeChild(), { pid: undefined });
    const result = await collectTurnsFromChildV0166(failed as unknown as ChildProcessWithoutNullStreams, "thread", "sample", { forceKillOnTimeout: true });
    expect(result).toMatchObject({ initialization_error: "transport_error", cleanup_status: "unknown" });
    expect(failed.kill).not.toHaveBeenCalled();
    expect(() => failed.emit("error", new Error("PRIVATE_SPAWN"))).not.toThrow();
    close(failed);
    const child = fakeChild(() => { close(child); return true; });
    expect((await collectFromChildV0166(asChild(child), "", "sample", { forceKillOnTimeout: true })).cleanup_status).toBe("unknown");
    expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  for (const collect of [collectFromChildV0166, collectTurnsFromChildV0166]) {
    it(`${collect.name}는 이미 닫힌 spawn 실패의 오류 코드를 실제 exit로 해석하지 않는다`, async () => {
      const child = Object.assign(fakeChild(), { pid: undefined, exitCode: -4058 });
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      await new Promise<void>(resolve => setImmediate(resolve));
      vi.useFakeTimers();
      const result = await collect(asChild(child), "thread", "sample", { forceKillOnTimeout: true });
      expect(result).toEqual({ collection: null, initialization_error: "transport_error", cleanup_status: "unknown" });
      expect(child.kill).not.toHaveBeenCalled();
      expect(child.listenerCount("error")).toBe(0);
      expect(child.listenerCount("close")).toBe(0);
      expect(child.listenerCount("exit")).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it("이미 종료된 자식과 기한 경계에서 관측한 exit에는 SIGKILL을 보내지 않는다", async () => {
    vi.useFakeTimers();
    const exited = Object.assign(fakeChild(), { exitCode: 0 });
    expect((await collectFromChildV0166(exited as unknown as ChildProcessWithoutNullStreams, "", "sample", { forceKillOnTimeout: true })).cleanup_status).toBe("exit_observed");
    expect(exited.kill).not.toHaveBeenCalled(); close(exited);
    const child = fakeChild(() => { setTimeout(() => child.emit("exit", 0, null), 100); return true; });
    const pending = collectFromChildV0166(asChild(child), "", "sample", { cleanupTimeoutMs: 100, forceKillOnTimeout: true });
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).cleanup_status).toBe("exit_observed");
    expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
    expect(vi.getTimerCount()).toBe(0); close(child);
  });

  it("수집 중 exit 없이 close된 자식은 추가 신호 없이 unknown으로 정리한다", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const pending = collectTurnsFromChildV0166(asChild(child), "thread", "sample", { forceKillOnTimeout: true });
    child.stdout.end(); close(child);
    const result = await pending;
    expect(result.cleanup_status).toBe("unknown");
    expect(child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("수집 취소 뒤에도 정리 대기를 건너뛰지 않는다", async () => {
    vi.useFakeTimers();
    const child = fakeChild(() => { setTimeout(() => child.emit("exit", 0, null), 5000); return true; });
    const controller = new AbortController(); controller.abort();
    const pending = collectTurnsFromChildV0166(asChild(child), "thread", "sample", { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ collection: null, initialization_error: "cancelled", cleanup_status: "exit_observed" });
    expect(vi.getTimerCount()).toBe(0); close(child);
  });
});
