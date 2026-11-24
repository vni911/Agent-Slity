import { executeTeam, SYNTHETIC_TASK } from "./team-execution.js";
import type { ExecutionOptions, TeamExecution } from "./team-execution.js";

export interface TeamComparison {
  format: "agent-slity.team-comparison";
  version: 1;
  synthetic: true;
  task_id: "arithmetic-2-plus-2";
  status: "completed" | "cancelled" | "failed";
  environment: { platform: string; node: string };
  repeats: 1;
  runs: TeamExecution[];
  efficiency: null;
  limitations: string[];
}
/** 같은 합성 과제·실행기·제한으로 선택한 세 구성을 순차 비교한다. */
export async function compareSyntheticTeams(options: Pick<ExecutionOptions, "timeout_ms" | "signal" | "onProgress">): Promise<TeamComparison> {
  const invalid = (): never => { throw new TypeError("비교 실행 설정이 유효하지 않습니다."); };
  if (typeof options !== "object" || options === null || Array.isArray(options)) invalid();
  const own = (key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) invalid();
    return descriptor.value;
  };
  const timeout = own("timeout_ms"), signal = own("signal"), progress = own("onProgress");
  if (typeof timeout !== "number" || !Number.isSafeInteger(timeout) || timeout < 100 || timeout > 300000 ||
      signal !== undefined && !(signal instanceof AbortSignal) || progress !== undefined && typeof progress !== "function") invalid();
  const config = { timeout_ms: timeout as number, signal: signal as AbortSignal | undefined, onProgress: progress as ExecutionOptions["onProgress"] };
  const runs: TeamExecution[] = [];
  for (const mode of ["solo", "small", "full"] as const) {
    if (config.signal?.aborted) break;
    const run = await executeTeam({ format: "agent-slity.team-request", version: 1, selection: { mode },
      constraints: { max_agents: 3 }, task: { independent_research: true, independent_review: true } },
    { ...config, provider: "synthetic", task: SYNTHETIC_TASK });
    runs.push(run);
    if (run.status !== "completed") break;
  }
  return { format: "agent-slity.team-comparison", version: 1, synthetic: true, task_id: "arithmetic-2-plus-2",
    status: config.signal?.aborted || runs.some(run => run.status === "cancelled") ? "cancelled" : runs.length === 3 && runs.every(run => run.status === "completed") ? "completed" : "failed",
    environment: { platform: process.platform, node: process.version }, repeats: 1, runs, efficiency: null,
    limitations: ["synthetic_fixture_only", "single_run_per_configuration", "wall_clock_not_benchmark", "no_real_quality_or_efficiency_claim"] };
}
