import { resolve } from "node:path";
import { readUtf8SnapshotFile } from "../adapters/snapshot-file-reader.js";
import { isSafeSnapshotPath } from "../adapters/snapshot-path.js";
import { createTeamPlan, MAX_TEAM_REQUEST_JSON_BYTES, parseTeamRequestJson } from "../core/team-plan.js";
import type { TeamPlan, TeamRole } from "../core/team-plan.js";
import type { CliResult } from "./run.js";

const roleNames: Record<TeamRole, string> = { researcher: "조사 담당", implementer: "구현 담당", reviewer: "독립 리뷰 담당" };
const rolesText = (roles: TeamRole[]): string => roles.map(role => roleNames[role]).join(" / ");
/** 내부 전용이며 생성기가 검증한 계획만 표시한다. */
export function renderTeamPlanText(plan: TeamPlan): string {
  const recommendation = plan.recommendation;
  const status = { suggested: "규칙 제안", unknown: "unknown · 작업 조건 확인 필요", budget_blocked: "인원 제한 초과로 추천 차단" }[recommendation.status];
  const reason = { requirements_incomplete: "작업 조건이 모두 알려지지 않았습니다.",
    requested_roles_fit_limit: "요청한 역할 구성이 인원 제한 안에 있습니다.",
    required_roles_exceed_limit: "요청한 역할 구성에 필요한 인원이 제한을 초과합니다. 역할을 자동 제거하지 않습니다." }[recommendation.reason];
  return ["Agent Slity · 팀 구성 계획", "실행 상태: 시작하지 않음 (not_started)", "검증 상태: unverified",
    `명시적 선택: ${plan.selection.mode} · ${plan.selection.agent_count}명`, `선택 역할: ${rolesText(plan.selection.roles)}`,
    `인원 제한: ${plan.constraints.max_agents}명`, `추천 상태: ${status}`, `사유: ${reason}`,
    ...(recommendation.candidate ? [`추천 후보: ${recommendation.candidate.mode} · ${recommendation.candidate.agent_count}명`,
      `추천 역할: ${rolesText(recommendation.candidate.roles)}`] : ["추천 후보: unknown"]),
    `근거 규칙: ${recommendation.rule_id} v${recommendation.rule_version}`,
    ...recommendation.evidence.map(evidence => `요청 조건 ${evidence.field}: ${evidence.requested_value === null ? "unknown" : evidence.requested_value}`),
    ...plan.warnings.map(warning => `주의: 선택한 팀에 요청 역할이 없습니다 — ${rolesText(warning.roles)}`),
    "품질: unknown / 협업 효율: unknown", "명시적 선택은 추천으로 변경되지 않습니다.",
    "사용자가 요청한 조건에 대한 미검증 규칙 제안입니다. 실제 활동·품질·효율을 인증하지 않습니다.",
  ].join("\n");
}

export async function runTeamPlanCli(args: readonly string[]): Promise<CliResult> {
  if (args.length !== 2 || !isSafeSnapshotPath(args[1]) || args[1].startsWith("-")) {
    return { exitCode: 2, stdout: "", stderr: "사용법: --team-plan 또는 --team-plan-text <팀 요청 JSON 파일>\n" };
  }
  try {
    const input = await readUtf8SnapshotFile(resolve(args[1]), MAX_TEAM_REQUEST_JSON_BYTES);
    const plan = createTeamPlan(parseTeamRequestJson(input.json));
    return { exitCode: 0, stdout: (args[0] === "--team-plan-text" ? renderTeamPlanText(plan) : JSON.stringify(plan)) + "\n", stderr: "" };
  } catch {
    return { exitCode: 1, stdout: "", stderr: "팀 구성 계획을 만들 수 없습니다. 파일·UTF-8·형식·크기를 확인하세요.\n" };
  }
}
