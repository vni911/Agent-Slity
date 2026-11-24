import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/run.js";
import { createTeamPlan } from "../../src/core/team-plan.js";
import type { TeamRequest } from "../../src/core/team-plan.js";
import { renderTeamPlanText } from "../../src/cli/team-plan.js";

const request: TeamRequest = { format: "agent-slity.team-request", version: 1, selection: { mode: "solo" },
  constraints: { max_agents: 1 }, task: { independent_research: true, independent_review: true } };
describe("팀 구성 계획 CLI", () => {
  it("차단된 추천의 필요 인원·선택 보존·근거·미실행을 표시한다", () => {
    const text = renderTeamPlanText(createTeamPlan(request));
    for (const expected of ["명시적 선택: solo · 1명", "추천 후보: full · 3명", "인원 제한: 1명", "인원 제한 초과로 추천 차단",
      "requested_role_requirements v1", "task.independent_research: true", "시작하지 않음", "품질: unknown", "협업 효율: unknown",
      "요청 역할이 없습니다", "독립 리뷰 담당"]) expect(text).toContain(expected);
  });
  it("알려지지 않은 조건을 false·solo 추천으로 바꾸지 않는다", () => {
    const text = renderTeamPlanText(createTeamPlan({ ...request, task: { independent_research: true, independent_review: null } }));
    expect(text).toContain("추천 후보: unknown"); expect(text).toContain("task.independent_review: unknown");
    expect(text).not.toContain("추천 후보: solo"); expect(text).toContain("조사 담당");
  });
  it("도움말과 두 출력 경로를 제공한다", async () => {
    const help = await runCli(["--help"]);
    expect(help.exitCode).toBe(0); expect(help.stdout).toContain("--team-plan <");
    expect(help.stdout).toContain("--team-plan-text <"); expect(help.stdout).toContain("64KiB");
    const result = await runCli(["--team-plan-text", "tests/fixtures/team-request-demo.json"]);
    expect(result.exitCode).toBe(0); expect(result.stdout).toContain("명시적 선택: small · 2명");
    expect(result.stdout).toContain("추천 후보: full · 3명"); expect(result.stderr).toBe("");
  });
  it("잘못된 인수와 장치 경로를 파일 처리 전에 거부한다", async () => {
    const args = [["--team-plan"], ["--team-plan-text", ""], ["--team-plan", "-h"], ["--team-plan", "PRIVATE_PATH", "extra"]];
    if (process.platform === "win32") for (const path of ["CON", "CONIN$", "C:private.json", "\\\\server\\share\\file.json", "file.json:secret"]) args.push(["--team-plan", path]);
    for (const input of args) {
      const result = await runCli(input); expect(result.exitCode).toBe(2); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("PRIVATE_PATH");
    }
  });
});
