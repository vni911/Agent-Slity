import { resolve } from "node:path";
import { readUtf8SnapshotFile } from "../adapters/snapshot-file-reader.js";
import { isSafeSnapshotPath } from "../adapters/snapshot-path.js";
import { parseTeamRequestJson } from "../core/team-plan.js";
import { executeTeam, SYNTHETIC_TASK } from "../core/team-execution.js";
import { compareSyntheticTeams } from "../core/team-comparison.js";
import type { CliResult } from "./run.js";

export async function runTeamExecutionCli(args: readonly string[]): Promise<CliResult> {
  if (args[0] === "--compare-demo") {
    if (args.length !== 1) return { exitCode: 2, stdout: "", stderr: "사용법: --compare-demo\n" };
    return { exitCode: 0, stdout: JSON.stringify(await compareSyntheticTeams({ timeout_ms: 5000 })) + "\n", stderr: "" };
  }
  if (args.length !== 2 || !isSafeSnapshotPath(args[1]) || args[1].startsWith("-")) {
    return { exitCode: 2, stdout: "", stderr: "사용법: --run-demo <팀 요청 JSON> 또는 --run-codex-team <명시적 실행 JSON>\n" };
  }
  try {
    const { json } = await readUtf8SnapshotFile(resolve(args[1]), 64 * 1024);
    let result;
    if (args[0] === "--run-demo") result = await executeTeam(parseTeamRequestJson(json), { provider: "synthetic", task: SYNTHETIC_TASK, timeout_ms: 5000 });
    else {
      const value = JSON.parse(json) as Record<string, unknown>;
      if (typeof value !== "object" || value === null || value.confirm_model_call !== true || typeof value.task !== "string" ||
          typeof value.executable !== "string" || typeof value.cwd !== "string" || typeof value.timeout_ms !== "number") throw new TypeError();
      result = await executeTeam(parseTeamRequestJson(JSON.stringify(value.team_request)), {
        provider: "codex", task: value.task, executable: value.executable, cwd: value.cwd, timeout_ms: value.timeout_ms });
    }
    return { exitCode: result.status === "completed" ? 0 : 1, stdout: JSON.stringify(result) + "\n", stderr: "" };
  } catch { return { exitCode: 1, stdout: "", stderr: "팀 실행 설정·파일·형식·크기를 확인하세요. 실제 모델 호출은 명시적 설정이 필요합니다.\n" }; }
}
