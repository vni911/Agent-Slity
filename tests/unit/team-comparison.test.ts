import { describe, expect, it } from "vitest";
import { compareSyntheticTeams } from "../../src/core/team-comparison.js";

describe("고정 합성 과제의 팀 비교", () => {
  it("동일 과제의 세 선택을 실행하고 실제 효율로 환산하지 않는다", async () => {
    const result = await compareSyntheticTeams({ timeout_ms: 5000 });
    expect(result.status).toBe("completed"); expect(result.synthetic).toBe(true);
    expect(result.runs.map(run => run.selection.mode)).toEqual(["solo", "small", "full"]);
    expect(result.runs.map(run => run.steps.length)).toEqual([1, 2, 3]);
    expect(result.runs.every(run => run.quality === "passed" && run.quality_basis === "synthetic_fixture")).toBe(true);
    expect(result.efficiency).toBeNull(); expect(result.repeats).toBe(1);
  });
  it("취소된 비교에서 실행되지 않은 구성의 값을 만들지 않는다", async () => {
    const controller = new AbortController(); controller.abort();
    const result = await compareSyntheticTeams({ timeout_ms: 5000, signal: controller.signal });
    expect(result.status).toBe("cancelled"); expect(result.runs).toEqual([]);
  });
  it("진행 callback이 원래 옵션을 바꿔도 처음 고정한 비교 제한을 유지한다", async () => {
    const options = { timeout_ms: 5000, onProgress: () => { options.timeout_ms = 1; } };
    const result = await compareSyntheticTeams(options);
    expect(result.status).toBe("completed"); expect(result.runs).toHaveLength(3);
  });
});
