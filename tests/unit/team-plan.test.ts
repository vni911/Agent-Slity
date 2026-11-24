import { describe, expect, it } from "vitest";
import { createTeamPlan, parseTeamRequestJson, MAX_TEAM_REQUEST_JSON_BYTES } from "../../src/index.js";
import type { TeamRequest, TeamMode, TeamRole } from "../../src/index.js";

function request(research: boolean | null = false, review: boolean | null = false, max = 3): TeamRequest {
  return { format: "agent-slity.team-request", version: 1, selection: { mode: "solo" },
    constraints: { max_agents: max }, task: { independent_research: research, independent_review: review } };
}
describe("팀 선택과 규칙 기반 계획", () => {
  it.each<[TeamMode, TeamRole[]]>([["solo", ["implementer"]], ["small", ["implementer", "reviewer"]],
    ["full", ["researcher", "implementer", "reviewer"]], ["manual", ["reviewer", "implementer", "researcher"]]])(
    "%s의 명시 선택과 manual 순서를 보존하고 실제 실행은 주장하지 않는다", (mode, roles) => {
      const input = request(); input.selection = mode === "manual" ? { mode, roles } : { mode };
      const before = structuredClone(input), plan = createTeamPlan(input);
      expect(plan.selection).toEqual({ mode, roles, agent_count: roles.length, source: "explicit_user_choice" });
      expect(plan.execution_status).toBe("not_started"); expect(plan.verification_status).toBe("unverified");
      expect(plan.unknown_metrics).toEqual({ quality: null, efficiency: null }); expect(input).toEqual(before);
      plan.selection.roles.reverse(); expect(input).toEqual(before); expect(createTeamPlan(input).selection.roles).toEqual(roles);
    });
  it.each<[boolean, boolean, TeamMode, TeamRole[]]>([
    [false, false, "solo", ["implementer"]], [false, true, "small", ["implementer", "reviewer"]],
    [true, false, "manual", ["researcher", "implementer"]], [true, true, "full", ["researcher", "implementer", "reviewer"]],
  ])("연구 %s·리뷰 %s의 추천을 인원 제한1~3에서 확인한다", (research, review, mode, roles) => {
    for (const max of [1, 2, 3]) {
      const plan = createTeamPlan(request(research, review, max));
      expect(plan.selection.mode).toBe("solo"); expect(plan.selection.roles).toEqual(["implementer"]);
      expect(plan.recommendation).toEqual({ status: roles.length > max ? "budget_blocked" : "suggested",
        candidate: { mode, roles, agent_count: roles.length }, rule_id: "requested_role_requirements", rule_version: 1,
        evidence: [{ field: "task.independent_research", requested_value: research }, { field: "task.independent_review", requested_value: review }],
        reason: roles.length > max ? "required_roles_exceed_limit" : "requested_roles_fit_limit" });
      expect(plan.warnings).toEqual(research || review ? [{ code: "selected_roles_missing_requirements",
        roles: [...(research ? ["researcher"] : []), ...(review ? ["reviewer"] : [])] }] : []);
    }
  });
  it.each<[boolean | null, boolean | null]>([[null, null], [null, false], [null, true], [false, null], [true, null]])(
    "조건 %s/%s에서도 unknown을 우선한다", (research, review) => {
      const plan = createTeamPlan(request(research, review, 1));
      expect(plan.recommendation.status).toBe("unknown"); expect(plan.recommendation.candidate).toBeNull();
      expect(plan.recommendation.reason).toBe("requirements_incomplete"); expect(plan.selection.mode).toBe("solo");
    });
  it("명시 선택 인원 초과는 unknown 추천보다 먼저 거부한다", () => {
    const input = request(null, null, 1); input.selection = { mode: "small" };
    expect(() => createTeamPlan(input)).toThrowError(/^유효하지 않은 팀 구성 요청입니다\.$/);
  });
  it("manual의 없는 구현 담당·중복·구멍·초과·유효하지 않은 역할과 preset roles를 거부한다", () => {
    for (const selection of [{ mode: "manual", roles: [] }, { mode: "manual", roles: ["reviewer"] },
      { mode: "manual", roles: ["implementer", "implementer"] }, { mode: "manual", roles: ["implementer", , "reviewer"] },
      { mode: "manual", roles: ["implementer", "researcher", "reviewer", "other"] },
      { mode: "manual", roles: ["implementer", "PRIVATE_ROLE"] }, { mode: "manual" },
      { mode: "solo", roles: ["implementer"] }, { mode: "AUTO" }]) {
      expect(() => createTeamPlan({ ...request(), selection } as TeamRequest)).toThrowError(/^유효하지 않은 팀 구성 요청입니다\.$/);
    }
  });
  it("조건·제한의 누락/암묵적 변환을 거부한다", () => {
    for (const max of [0, 4, 1.5, NaN, Infinity, null, "3"]) {
      expect(() => createTeamPlan({ ...request(), constraints: { max_agents: max } } as TeamRequest)).toThrow(TypeError);
    }
    for (const task of [{}, { independent_research: false }, { independent_research: 0, independent_review: "false" }]) {
      expect(() => createTeamPlan({ ...request(), task } as unknown as TeamRequest)).toThrow(TypeError);
    }
    const inherited = Object.create(request()) as TeamRequest;
    expect(() => createTeamPlan(inherited)).toThrow(TypeError);
  });
  it("추가 원문을 복사하지 않고 getter·toJSON·배열 iterator를 실행하지 않는다", () => {
    const input = request(true, true); input.selection = { mode: "manual", roles: ["implementer", "reviewer"] };
    let calls = 0;
    const hook = (): never => { calls++; throw new Error("PRIVATE_SECRET"); };
    Object.defineProperty(input, "toJSON", { value: hook }); Object.defineProperty(input, "private", { get: hook });
    Object.defineProperty(input.selection.roles, Symbol.iterator, { value: hook });
    const plan = createTeamPlan(input); expect(calls).toBe(0); expect(JSON.stringify(plan)).not.toContain("PRIVATE_");
    Object.defineProperty(input.task, "independent_review", { get: hook });
    expect(() => createTeamPlan(input)).toThrowError(/^유효하지 않은 팀 구성 요청입니다\.$/); expect(calls).toBe(0);
  });
  it("64KiB 원문 경계를 UTF-8 바이트로 검사한다", () => {
    const json = JSON.stringify({ ...request(), extra: "한글" });
    const exact = json + " ".repeat(MAX_TEAM_REQUEST_JSON_BYTES - Buffer.byteLength(json));
    expect(parseTeamRequestJson(exact)).toEqual(request());
    expect(() => parseTeamRequestJson(exact + " ")).toThrowError(/^유효하지 않은 팀 구성 요청입니다\.$/);
    for (const invalid of ["", "\uFEFF" + json, "{", "null", "[]", JSON.stringify({ ...request(), version: 2 })]) {
      expect(() => parseTeamRequestJson(invalid)).toThrowError(/^유효하지 않은 팀 구성 요청입니다\.$/);
    }
  });
});
