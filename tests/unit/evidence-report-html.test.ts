import { describe, expect, it } from "vitest";
import { createNormalizationEvidenceReport, createChildTurnEvidenceReport } from "../../src/core/evidence-report.js";
import { renderEvidenceReportHtml, escapeHtml } from "../../src/cli/evidence-report-html.js";
import { normalizeCodexExecLine } from "../../src/adapters/codex-exec-normalizer.js";
import { normalizeCodexTurnsPageV0166 } from "../../src/adapters/codex-app-server-turns.js";
import { runCli } from "../../src/cli/run.js";

describe("오프라인 근거 보고서", () => {
  it("실제 0·unknown·입력 관측·후보를 구분하며 원문을 제외한다", () => {
    const event = normalizeCodexExecLine({ kind: "record", line: 1, value: { type: "turn.completed",
      usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 2 }, thread_id: "PRIVATE_THREAD" } }, "PRIVATE_ALIAS");
    const html = renderEvidenceReportHtml(createNormalizationEvidenceReport([event, event]));
    expect(html).toContain('lang="ko"'); expect(html).toContain("미검증 · unverified");
    expect(html).toContain("의심 후보"); expect(html).toContain("기록 0"); expect(html).toContain("기록 1");
    expect(html).toContain("전체 토큰"); expect(html).toContain("unknown"); expect(html).toContain("<dd>0</dd>");
    expect(html).not.toContain("PRIVATE_"); expect(html).not.toMatch(/<script|https?:\/\/|<link|<iframe|<img/);
    expect(html).toContain("default-src 'none'"); expect(html).toContain("<details>");
  });
  it("수집되지 않은 범위를 빈 성공으로 바꾸지 않는다", () => {
    const html = renderEvidenceReportHtml(createChildTurnEvidenceReport({ initialization_error: "transport_error", cleanup_status: "unknown", collection: null }));
    expect(html).toContain("transport_error"); expect(html).toContain("unknown · 확인 필요");
    expect(html).not.toContain("<dd>0</dd>");
  });
  it("초기화 오류 없음과 수집 미관측을 구분해 표시한다", () => {
    const html = renderEvidenceReportHtml(createChildTurnEvidenceReport({ initialization_error: null, cleanup_status: "unknown",
      collection: { verification_status: "unverified", source_id: "synthetic", status: "partial", reason: "server_error", thread: null, pages: [] } }));
    expect(html).toContain("보고된 초기화 오류 없음"); expect(html).toContain("unknown · 확인 필요");
    expect(html).not.toContain("schema_reference");
  });
  it("HTML 문맥의 특수 문자를 이스케이프한다", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">&\'')).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;");
  });
  it("협업 도구의 미관측과 지원 페이지의 관측 0건을 구분한다", () => {
    const input = { initialization_error: null, cleanup_status: "unknown" as const,
      collection: { verification_status: "unverified" as const, source_id: "synthetic", status: "partial" as const,
        reason: "server_error" as const, thread: null, pages: [] as ReturnType<typeof normalizeCodexTurnsPageV0166>[] } };
    expect(renderEvidenceReportHtml(createChildTurnEvidenceReport(input))).toContain("협업 도구 횟수는 unknown");
    input.collection.pages.push(normalizeCodexTurnsPageV0166({ data: [], nextCursor: null }));
    expect(renderEvidenceReportHtml(createChildTurnEvidenceReport(input))).toContain("협업 도구 관측 0건");
  });
  it("잘못된 보고서 인수는 읽기 전에 사용법 오류로 끝난다", async () => {
    for (const args of [["--report"], ["--report", "auto", "PRIVATE_PATH"], ["--report-html", "turn", "-h"],
      ["--report", "normalization", "PRIVATE_PATH", "extra"], ["--report-html", "turn", ""]]) {
      const result = await runCli(args);
      expect(result.exitCode).toBe(2); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("PRIVATE_PATH");
    }
  });
});
