import { createTeamPlan } from "./team-plan.js";
import type { TeamPlan, TeamRequest, TeamRole } from "./team-plan.js";
import type { ObservedUsage } from "./events.js";
import { executeCodexStep, MAX_EXECUTION_OUTPUT_BYTES, validateCodexTarget } from "../adapters/codex-team-executor.js";

export const SYNTHETIC_TASK = "2 + 2의 결과를 숫자 하나로 답하세요.";
export interface ExecutionStep {
  role: TeamRole; status: "completed" | "failed" | "cancelled" | "timeout"; output: string;
  elapsed_ms: number | null; reported_usage: ObservedUsage | null; error_code: string | null;
  cleanup_status: "exit_observed" | "unknown";
}
export interface ExecutionOptions {
  provider: "synthetic" | "codex"; task: string; timeout_ms: number; executable?: string; cwd?: string;
  signal?: AbortSignal; onProgress?: (step: ExecutionStep) => void;
}
export interface TeamExecution {
  format: "agent-slity.team-execution"; version: 1; provider: "synthetic" | "codex"; synthetic: boolean;
  status: ExecutionStep["status"]; steps: ExecutionStep[]; elapsed_ms: number;
  quality: "unknown" | "passed" | "failed"; quality_basis: "synthetic_fixture" | "unknown"; efficiency: null;
  cleanup_status: "exit_observed" | "unknown"; selection: TeamPlan["selection"];
}
export interface StepContext { role: TeamRole; task: string; previous_steps: readonly ExecutionStep[]; timeout_ms: number; signal: AbortSignal }
export type AgentExecutor = (context: StepContext) => Promise<ExecutionStep>;
function invalid(): never { throw new TypeError("유효하지 않은 팀 실행 요청입니다."); }
function copyOptions(value: ExecutionOptions): ExecutionOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const own = (key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) invalid();
    return descriptor.value;
  };
  const provider = own("provider"), task = own("task"), timeout = own("timeout_ms"), signal = own("signal"), progress = own("onProgress");
  if (provider !== "synthetic" && provider !== "codex" || typeof task !== "string" || !task.trim() || task.length > 8000 ||
    typeof timeout !== "number" || !Number.isSafeInteger(timeout) || timeout < 100 || timeout > 300000 ||
    signal !== undefined && !(signal instanceof AbortSignal) || progress !== undefined && typeof progress !== "function") invalid();
  if (provider === "synthetic" && task !== SYNTHETIC_TASK) invalid();
  const executable = own("executable"), cwd = own("cwd");
  if (provider === "codex" && (typeof executable !== "string" || typeof cwd !== "string")) invalid();
  return { provider, task, timeout_ms: timeout, ...(provider === "codex" ? { executable: executable as string, cwd: cwd as string } : {}),
    ...(signal === undefined ? {} : { signal: signal as AbortSignal }), ...(progress === undefined ? {} : { onProgress: progress as ExecutionOptions["onProgress"] }) };
}
function safeStep(value: ExecutionStep, role: TeamRole): ExecutionStep {
  if (typeof value !== "object" || value === null || value.role !== role || !["completed", "failed", "cancelled", "timeout"].includes(value.status) ||
    typeof value.output !== "string" || Buffer.byteLength(value.output, "utf8") > MAX_EXECUTION_OUTPUT_BYTES ||
    value.elapsed_ms !== null && (!Number.isFinite(value.elapsed_ms) || value.elapsed_ms < 0) ||
    !["exit_observed", "unknown"].includes(value.cleanup_status)) throw new TypeError();
  const usage = value.reported_usage;
  const number = (key: keyof ObservedUsage): number | null => usage && typeof usage[key] === "number" && Number.isSafeInteger(usage[key]) && usage[key]! >= 0 ? usage[key] : null;
  return { role, status: value.status, output: value.status === "completed" ? value.output : "", elapsed_ms: value.elapsed_ms,
    reported_usage: usage === null ? null : { input_tokens: number("input_tokens"), cached_input_tokens: number("cached_input_tokens"), output_tokens: number("output_tokens"), reasoning_output_tokens: number("reasoning_output_tokens") },
    error_code: value.status === "completed" ? null : typeof value.error_code === "string" && ["invalid_output", "unsupported_output", "reported_execution_error", "output_limit", "invalid_utf8", "process_failed", "transport_error", "spawn_failed", "cancelled", "timeout"].includes(value.error_code) ? value.error_code : "execution_failed", cleanup_status: value.cleanup_status };
}
const syntheticExecutor: AgentExecutor = async context => {
  const start = performance.now();
  await new Promise(resolve => setTimeout(resolve, 25));
  const cancelled = context.signal.aborted;
  return { role: context.role, status: cancelled ? "cancelled" : "completed", output: cancelled ? "" :
    context.role === "implementer" ? "4" : context.role === "researcher" ? "합성 과제: 2 + 2 = 4" : "합성 fixture의 기대 출력 4를 확인합니다.",
    elapsed_ms: Math.max(0, Math.round(performance.now() - start)), reported_usage: null,
    error_code: cancelled ? "cancelled" : null, cleanup_status: "unknown" };
};

/** 내부 테스트 경계. 실제 공개 경로는 executeTeam만 사용한다. */
export async function executeTeamWithExecutor(input: TeamRequest, rawOptions: ExecutionOptions, executor: AgentExecutor, startedAt?: number): Promise<TeamExecution> {
  let plan: TeamPlan, options: ExecutionOptions;
  try { plan = createTeamPlan(input); options = copyOptions(rawOptions); } catch { return invalid(); }
  const started = startedAt ?? performance.now(), deadline = started + options.timeout_ms;
  const steps: ExecutionStep[] = [];
  let status: ExecutionStep["status"] = "completed";
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - performance.now()));
  try {
    for (const role of ["researcher", "implementer", "reviewer"] as const) {
      if (!plan.selection.roles.includes(role)) continue;
      if (signal.aborted || performance.now() >= deadline) { status = options.signal?.aborted ? "cancelled" : "timeout"; break; }
      let step: ExecutionStep;
      try {
        step = safeStep(await executor({ role, task: options.task, previous_steps: structuredClone(steps),
          timeout_ms: Math.max(1, Math.ceil(deadline - performance.now())), signal }), role);
      } catch {
        step = { role, status: "failed", output: "", elapsed_ms: null, reported_usage: null, error_code: "execution_failed", cleanup_status: "unknown" };
      }
      if (signal.aborted || performance.now() >= deadline) {
        const reason = options.signal?.aborted ? "cancelled" : "timeout";
        step = { ...step, status: reason, error_code: reason, output: "", reported_usage: null };
      }
      steps.push(step);
      try { options.onProgress?.(structuredClone(step)); } catch { /* 보기용 callback 실패는 실행 결과를 바꾸지 않는다. */ }
      if (step.status !== "completed") { status = step.status; break; }
    }
  } finally { clearTimeout(timer); }
  const fixture = options.provider === "synthetic";
  const quality = fixture && status === "completed" ? steps.find(step => step.role === "implementer")?.output === "4" ? "passed" : "failed" : "unknown";
  return { format: "agent-slity.team-execution", version: 1, provider: options.provider, synthetic: fixture,
    status, steps, elapsed_ms: Math.max(0, Math.round(performance.now() - started)), quality,
    quality_basis: fixture && status === "completed" ? "synthetic_fixture" : "unknown", efficiency: null,
    cleanup_status: steps.length > 0 && steps.every(step => step.cleanup_status === "exit_observed") ? "exit_observed" : "unknown", selection: plan.selection };
}

export async function executeTeam(input: TeamRequest, rawOptions: ExecutionOptions): Promise<TeamExecution> {
  const started = performance.now();
  let options: ExecutionOptions, request: TeamRequest;
  try {
    const plan = createTeamPlan(input); options = copyOptions(rawOptions);
    request = { format: "agent-slity.team-request", version: 1,
      selection: plan.selection.mode === "manual" ? { mode: "manual", roles: plan.selection.roles } : { mode: plan.selection.mode },
      constraints: plan.constraints, task: plan.task };
  } catch { return invalid(); }
  if (options.provider === "codex") {
    try { await validateCodexTarget(options.executable!, options.cwd!, { timeout_ms: Math.min(options.timeout_ms, 5000), signal: options.signal }); }
    catch { if (!options.signal?.aborted) return invalid(); }
  }
  return executeTeamWithExecutor(request, options, options.provider === "synthetic" ? syntheticExecutor : context => executeCodexStep(context, options.executable!, options.cwd!), started);
}
