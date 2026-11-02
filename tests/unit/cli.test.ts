import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/run.js";
import type { NormalizationResult } from "../../src/index.js";

describe("읽기 전용 CLI", () => {
  it("합성 예제를 읽어 정규화 JSON을 출력한다", async () => {
    const result = await runCli(["tests/fixtures/demo.jsonl", "demo"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const json = JSON.parse(result.stdout) as { version: number; results: NormalizationResult[] };
    expect(json.version).toBe(1);
    expect(json.results.map((entry) => entry.kind)).toEqual(["event", "event", "event", "unsupported"]);
    const first = json.results[0];
    expect(first?.kind === "event" && first.event.source.source_id).toBe("demo");
  });

  it("잘못된 인수와 없는 파일은 경로 없이 실패하고 JSON을 출력하지 않는다", async () => {
    const noArgs = await runCli([]);
    expect(noArgs.exitCode).toBe(2);
    expect(noArgs.stdout).toBe("");
    const missing = await runCli(["PRIVATE_NONEXISTENT_PATH.jsonl"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).not.toContain("PRIVATE_NONEXISTENT_PATH");
    expect((await runCli(["a", "b", "c"])).exitCode).toBe(2);
  });

  it("잘못된 별칭을 빈 파일에서도 거부하고 원본을 변경하지 않는다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-slity-cli-"));
    const path = join(dir, "input.jsonl");
    await writeFile(path, "");
    try {
      const result = await runCli([path, "private/path"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("private/path");
      expect(await readFile(path, "utf8")).toBe("");
    } finally {
      await unlink(path);
      await rmdir(dir);
    }
  });

  it("손상된 줄을 진단으로 보존하고 나머지 줄을 처리한다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-slity-cli-"));
    const path = join(dir, "input.jsonl");
    const input = '{"type":"turn.started"}\n{\n';
    await writeFile(path, input);
    try {
      const result = await runCli([path]);
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout) as { results: NormalizationResult[] };
      expect(json.results.map((entry) => entry.kind)).toEqual(["event", "diagnostic"]);
      expect(await readFile(path, "utf8")).toBe(input);
    } finally {
      await unlink(path);
      await rmdir(dir);
    }
  });
});
