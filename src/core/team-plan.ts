export type TeamMode = "solo" | "small" | "full" | "manual";
export type TeamRole = "researcher" | "implementer" | "reviewer";
export interface TeamRequirements { independent_research: boolean | null; independent_review: boolean | null }
export interface TeamRequest {
  format: "agent-slity.team-request";
  version: 1;
  selection: { mode: Exclude<TeamMode, "manual"> } | { mode: "manual"; roles: TeamRole[] };
  constraints: { max_agents: number };
  task: TeamRequirements;
}
export interface TeamCandidate { mode: TeamMode; roles: TeamRole[]; agent_count: number }
export interface TeamPlan {
  format: "agent-slity.team-plan";
  version: 1;
  verification_status: "unverified";
  execution_status: "not_started";
  selection: TeamCandidate & { source: "explicit_user_choice" };
  constraints: { max_agents: number };
  task: TeamRequirements;
  recommendation: {
    status: "suggested" | "unknown" | "budget_blocked";
    candidate: TeamCandidate | null;
    rule_id: "requested_role_requirements";
    rule_version: 1;
    evidence: { field: "task.independent_research" | "task.independent_review"; requested_value: boolean | null }[];
    reason: "requirements_incomplete" | "requested_roles_fit_limit" | "required_roles_exceed_limit";
  };
  warnings: { code: "selected_roles_missing_requirements"; roles: TeamRole[] }[];
  unknown_metrics: { quality: null; efficiency: null };
  limitations: ["caller_supplied_requirements", "heuristic_not_benchmarked", "selection_not_execution"];
}
export const MAX_TEAM_REQUEST_JSON_BYTES = 64 * 1024;
const presets: Record<Exclude<TeamMode, "manual">, readonly TeamRole[]> = {
  solo: ["implementer"], small: ["implementer", "reviewer"], full: ["researcher", "implementer", "reviewer"],
};
function invalid(): never { throw new TypeError("유효하지 않은 팀 구성 요청입니다."); }
function own(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) invalid();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) invalid();
  return descriptor.value;
}
function object(value: unknown): object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value;
}
function condition(value: unknown): boolean | null {
  if (value === null || typeof value === "boolean") return value;
  return invalid();
}
function copyRequest(value: unknown): TeamRequest {
  object(value);
  if (own(value, "format") !== "agent-slity.team-request" || own(value, "version") !== 1) invalid();
  const selection = object(own(value, "selection")), mode = own(selection, "mode");
  if (mode !== "solo" && mode !== "small" && mode !== "full" && mode !== "manual") invalid();
  let selected: TeamRequest["selection"];
  if (mode === "manual") {
    const values = own(selection, "roles");
    if (!Array.isArray(values)) invalid();
    const length = own(values, "length");
    if (typeof length !== "number" || length < 1 || length > 3) invalid();
    const roles: TeamRole[] = [];
    for (let index = 0; index < length; index++) {
      const role = own(values, String(index));
      if (role !== "researcher" && role !== "implementer" && role !== "reviewer" || roles.includes(role)) invalid();
      roles.push(role);
    }
    if (!roles.includes("implementer")) invalid();
    selected = { mode, roles };
  } else {
    if (Object.getOwnPropertyDescriptor(selection, "roles")) invalid();
    selected = { mode };
  }
  const constraints = object(own(value, "constraints")), max = own(constraints, "max_agents");
  if (typeof max !== "number" || !Number.isSafeInteger(max) || max < 1 || max > 3) invalid();
  const roles = selected.mode === "manual" ? selected.roles : presets[selected.mode];
  if (roles.length > max) invalid();
  const task = object(own(value, "task"));
  return { format: "agent-slity.team-request", version: 1, selection: selected, constraints: { max_agents: max },
    task: { independent_research: condition(own(task, "independent_research")), independent_review: condition(own(task, "independent_review")) } };
}

/** 호출자가 명시한 선택과 요청 조건에서 실행 전 계획을 만든다. */
export function createTeamPlan(input: TeamRequest): TeamPlan {
  try {
    const request = copyRequest(input), task = request.task;
    const roles = request.selection.mode === "manual" ? [...request.selection.roles] : [...presets[request.selection.mode]];
    let candidate: TeamCandidate | null = null;
    if (task.independent_research !== null && task.independent_review !== null) {
      const mode = task.independent_research ? task.independent_review ? "full" : "manual" : task.independent_review ? "small" : "solo";
      const needed: TeamRole[] = mode === "manual" ? ["researcher", "implementer"] : [...presets[mode]];
      candidate = { mode, roles: needed, agent_count: needed.length };
    }
    const exceeds = candidate !== null && candidate.agent_count > request.constraints.max_agents;
    const missing: TeamRole[] = [];
    if (task.independent_research === true && !roles.includes("researcher")) missing.push("researcher");
    if (task.independent_review === true && !roles.includes("reviewer")) missing.push("reviewer");
    return { format: "agent-slity.team-plan", version: 1, verification_status: "unverified", execution_status: "not_started",
      selection: { mode: request.selection.mode, roles, agent_count: roles.length, source: "explicit_user_choice" },
      constraints: request.constraints, task,
      recommendation: { status: candidate === null ? "unknown" : exceeds ? "budget_blocked" : "suggested", candidate,
        rule_id: "requested_role_requirements", rule_version: 1,
        evidence: [{ field: "task.independent_research", requested_value: task.independent_research },
          { field: "task.independent_review", requested_value: task.independent_review }],
        reason: candidate === null ? "requirements_incomplete" : exceeds ? "required_roles_exceed_limit" : "requested_roles_fit_limit" },
      warnings: missing.length ? [{ code: "selected_roles_missing_requirements", roles: missing }] : [],
      unknown_metrics: { quality: null, efficiency: null },
      limitations: ["caller_supplied_requirements", "heuristic_not_benchmarked", "selection_not_execution"] };
  } catch { return invalid(); }
}

export function parseTeamRequestJson(json: string): TeamRequest {
  try {
    if (typeof json !== "string" || Buffer.byteLength(json, "utf8") > MAX_TEAM_REQUEST_JSON_BYTES) invalid();
    return copyRequest(JSON.parse(json));
  } catch { return invalid(); }
}
