import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeTeam, executeTeamWithExecutor, SYNTHETIC_TASK } from "../../src/core/team-execution.js";
import type { ExecutionOptions, ExecutionStep } from "../../src/core/team-execution.js";
import type { TeamRequest } from "../../src/core/team-plan.js";
import { buildCodexArguments, executeCodexChild, validateCodexTarget } from "../../src/adapters/codex-team-executor.js";

afterEach(() => vi.useRealTimers());

const request = (mode: "solo" | "small" | "full" = "full"): TeamRequest => ({ format: "agent-slity.team-request", version: 1,
  selection: { mode }, constraints: { max_agents: 3 }, task: { independent_research: true, independent_review: true } });
const options = (): ExecutionOptions => ({ provider: "synthetic", task: SYNTHETIC_TASK, timeout_ms: 1000 });
const step = (role: ExecutionStep["role"], output = "4"): ExecutionStep => ({ role, status: "completed", output,
  elapsed_ms: 0, reported_usage: null, error_code: null, cleanup_status: "unknown" });
describe("선택 팀 실행", () => {
  it.each(["solo", "small", "full"] as const)("%s 선택 역할만 실행하며 합성 품질과 실제 효율을 구분한다", async mode => {
    const result = await executeTeam(request(mode), options());
    expect(result.status).toBe("completed"); expect(result.synthetic).toBe(true); expect(result.quality).toBe("passed");
    expect(result.quality_basis).toBe("synthetic_fixture"); expect(result.efficiency).toBeNull();
    expect(result.steps.map(entry => entry.role)).toEqual(mode === "solo" ? ["implementer"] : mode === "small" ? ["implementer", "reviewer"] : ["researcher", "implementer", "reviewer"]);
    expect(result.cleanup_status).toBe("unknown"); expect(result.steps.every(entry => entry.reported_usage === null)).toBe(true);
  });
  it("manual 선택 순서는 보존하고 실행 의존 순서는 조사→구현→리뷰로 고정한다", async () => {
    const input = request(); input.selection = { mode: "manual", roles: ["reviewer", "implementer", "researcher"] };
    const result = await executeTeam(input, options());
    expect(result.selection.roles).toEqual(["reviewer", "implementer", "researcher"]);
    expect(result.steps.map(entry => entry.role)).toEqual(["researcher", "implementer", "reviewer"]);
  });
  it("이전 결과를 전달하되 executor와 callback이 저장된 결과를 변경하지 못한다", async () => {
    const calls: string[][] = [];
    const result = await executeTeamWithExecutor(request(), { ...options(), onProgress: observed => { observed.output = "CHANGED"; } }, async context => {
      calls.push(context.previous_steps.map(entry => entry.output));
      if (context.previous_steps[0]) context.previous_steps[0].output = "CHANGED";
      return step(context.role, context.role);
    });
    expect(calls).toEqual([[], ["researcher"], ["researcher", "implementer"]]);
    expect(result.steps.map(entry => entry.output)).toEqual(["researcher", "implementer", "reviewer"]);
    expect(result.quality).toBe("failed");
  });
  it("추천 full이어도 solo를 자동 확대하지 않고 실제 provider 품질은 unknown이다", async () => {
    const result = await executeTeamWithExecutor(request("solo"), { provider: "codex", task: "합성 과제", timeout_ms: 1000, executable: "unused", cwd: "unused" }, async context => step(context.role));
    expect(result.steps).toHaveLength(1); expect(result.quality).toBe("unknown"); expect(result.quality_basis).toBe("unknown");
  });
  it("실패 뒤 역할을 실행하지 않고 raw 오류와 부분 출력을 제외한다", async () => {
    let calls = 0;
    const result = await executeTeamWithExecutor(request(), options(), async context => { calls++; return { ...step(context.role), status: "failed", output: "PRIVATE_PARTIAL", error_code: "PRIVATE_ERROR" }; });
    expect(calls).toBe(1); expect(result.status).toBe("failed"); expect(result.quality).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });
  it("미리 취소된 실행과 진행 callback 취소는 이후 단계를 시작하지 않는다", async () => {
    const before = new AbortController(); before.abort();
    const stopped = await executeTeam(request(), { ...options(), signal: before.signal });
    expect(stopped.status).toBe("cancelled"); expect(stopped.steps).toEqual([]);
    const controller = new AbortController();
    const result = await executeTeam(request(), { ...options(), signal: controller.signal, onProgress: () => controller.abort() });
    expect(result.status).toBe("cancelled"); expect(result.steps).toHaveLength(1); expect(result.quality).toBe("unknown");
  });
  it("실행기 완료가 늦으면 성공 값이 있어도 기한 초과다", async () => {
    const result = await executeTeamWithExecutor(request("solo"), { ...options(), timeout_ms: 100 }, async context => {
      await new Promise(resolve => setTimeout(resolve, 130)); return step(context.role);
    });
    expect(result.status).toBe("timeout"); expect(result.steps[0].output).toBe(""); expect(result.quality).toBe("unknown");
  });
  it("크기 초과 결과·예외와 잘못된 옵션은 원문 없는 실패다", async () => {
    const overflow = await executeTeamWithExecutor(request(), options(), async context => step(context.role, "x".repeat(1024 * 1024 + 1)));
    expect(overflow.status).toBe("failed"); expect(overflow.steps).toHaveLength(1);
    const thrown = await executeTeamWithExecutor(request(), options(), async () => { throw new Error("PRIVATE_THROW"); });
    expect(JSON.stringify(thrown)).not.toContain("PRIVATE_");
    for (const value of [{ ...options(), timeout_ms: 99 }, { ...options(), timeout_ms: 300001 }, { ...options(), task: "other" },
      { ...options(), task: "x".repeat(8001) }, { ...options(), provider: "auto" }, { ...options(), signal: {} }]) {
      await expect(executeTeam(request(), value as ExecutionOptions)).rejects.toThrow(/^유효하지 않은 팀 실행 요청입니다\.$/);
    }
  });
  it("고정 Codex 인수는 셸 우회·쓰기 권한을 추가하지 않으며 상대/배치 경로를 거부한다", async () => {
    expect(buildCodexArguments()).toEqual(["--ask-for-approval", "never", "--sandbox", "read-only", "exec", "--json", "--ephemeral", "--color", "never", "--skip-git-repo-check", "-"]);
    await expect(validateCodexTarget("PRIVATE_RELATIVE.cmd", "PRIVATE_FOLDER")).rejects.toThrow(/^유효하지 않은 Codex 실행 경로입니다\.$/);
    await expect(executeTeam(request(), { provider: "codex", task: "과제", timeout_ms: 1000, executable: "PRIVATE_RELATIVE", cwd: "PRIVATE_FOLDER" })).rejects.toThrow(/^유효하지 않은 팀 실행 요청입니다\.$/);
  });
  it("종료 관측이 끝내 없으면 unknown으로 반환하고 child handle을 unref한다", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { pid: 123, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill: vi.fn(() => true), unref: vi.fn() });
    const result = executeCodexChild(child as unknown as ChildProcessWithoutNullStreams,
      { role: "implementer", task: "합성", previous_steps: [], timeout_ms: 100, signal: new AbortController().signal }, "합성");
    await vi.advanceTimersByTimeAsync(1250);
    expect(await result).toMatchObject({ status: "timeout", cleanup_status: "unknown", output: "" });
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]); expect(child.unref).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0); expect(() => child.emit("error", new Error("PRIVATE_LATE"))).not.toThrow();
    child.emit("close", null); expect(child.listenerCount("error")).toBe(0);
  });
  it("출력 EOF만으로 성공하지 않고 close를 관측하며 동기 kill close도 timer를 남기지 않는다", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { pid: 123, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill: vi.fn(() => { child.emit("close", null); return true; }), unref: vi.fn() });
    let returned = false;
    const result = executeCodexChild(child as unknown as ChildProcessWithoutNullStreams,
      { role: "implementer", task: "합성", previous_steps: [], timeout_ms: 100, signal: new AbortController().signal }, "합성");
    void result.then(() => { returned = true; });
    child.stdout.end('{"type":"item.completed","item":{"type":"agent_message","text":"4"}}\n{"type":"turn.completed"}\n');
    await vi.advanceTimersByTimeAsync(99); expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ status: "timeout", cleanup_status: "exit_observed" });
    expect(child.kill.mock.calls).toEqual([["SIGTERM"]]); expect(vi.getTimerCount()).toBe(0);
  });
});
