import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("저장소 기본 문서", () => {
  it("기본 문서와 라이선스를 제공한다", () => {
    for (const path of ["README.md", "README.ko.md", "README.en.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md", "LICENSE"]) {
      expect(existsSync(path), path).toBe(true);
    }
  });

  it("한국어 README의 상대 문서 링크가 존재한다", () => {
    const readme = readFileSync("README.md", "utf8");
    const links = [...readme.matchAll(/\]\(([^)]+)\)/g)]
      .map((match) => match[1])
      .filter((link) => !/^https?:\/\//.test(link));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(existsSync(link), link).toBe(true);
  });

  it("인증 정보와 로컬 실행 기록을 Git 제외 규칙에 포함한다", () => {
    const paths = [".env.local", ".codex/auth.json", "sessions/run.json", "run.sqlite-journal"];
    const output = execFileSync("git", ["-c", "core.excludesFile=", "check-ignore", "--no-index", "--stdin"], {
      input: `${paths.join("\n")}\n`,
      encoding: "utf8",
    });
    expect(output.trim().split(/\r?\n/).sort()).toEqual(paths.sort());
  });
});
