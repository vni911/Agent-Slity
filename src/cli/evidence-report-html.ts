import type { EvidenceReport } from "../core/evidence-report.js";

const labels: Record<string, string> = {
  records: "입력 기록", events: "이벤트 관측", diagnostics: "진단", unsupported: "미지원",
  turns: "turn 관측", items: "item 관측", initialization_error: "초기화 오류", cleanup_status: "정리 상태",
  collection: "수집", status: "수집 상태", reason: "종료 사유", pages: "페이지", received: "수신",
  supported: "지원", observations: "지원 페이지 관측", count_scope: "집계 범위", thread_kind: "스레드 형식",
  event_types: "이벤트 유형", turn_statuses: "turn 상태", item_kinds: "item 유형",
  unique_executions: "고유 실행 수", unique_agents: "고유 에이전트 수", quality: "결과 품질",
  elapsed_time_ms: "전체 소요 시간", total_tokens: "전체 토큰", efficiency: "협업 효율", savings: "절감량",
  source_position_overlap: "같은 출처 위치의 중복 후보", source_position_conflict: "같은 출처 위치의 충돌 후보",
  repeated_turn_id: "반복 turn ID 후보", repeated_item_id: "반복 item ID 후보",
  reported_execution_error: "입력에 보고된 실행 오류", reported_command_failure: "입력에 보고된 명령 실패",
  validation_unobserved: "검증 결과 미관측", input_observation: "입력 관측", suspected: "의심 후보", unknown: "확인 필요",
  identity_and_scope_unverified: "식별 및 집계 범위가 검증되지 않았습니다.", quality_not_collected: "품질 평가를 수집하지 않았습니다.",
  end_to_end_timing_unavailable: "전체 실행 시간 근거가 없습니다.", scope_and_usage_semantics_unverified: "사용량의 범위와 의미가 검증되지 않았습니다.",
  quality_and_baseline_unverified: "품질과 비교 기준이 검증되지 않았습니다.", no_controlled_baseline: "통제된 비교 기준이 없습니다.",
  record_index: "기록 인덱스", input_tokens: "입력 토큰", cached_input_tokens: "캐시 입력 토큰", output_tokens: "출력 토큰",
  reasoning_output_tokens: "추론 출력 토큰",
};
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
const label = (key: string): string => escapeHtml(labels[key] ?? key);
function valueHtml(value: unknown): string {
  if (value === null) return '<span class="unknown">unknown · 확인 필요</span>';
  if (typeof value === "object") return `<dl>${Object.entries(value).map(([key, entry]) => `<div><dt>${label(key)}</dt><dd>${valueHtml(entry)}</dd></div>`).join("")}</dl>`;
  return escapeHtml(String(value));
}
function summaryHtml(report: EvidenceReport): string {
  if (report.input_kind === "normalization") return valueHtml(report.summary);
  const { initialization_error, cleanup_status, collection } = report.summary;
  return valueHtml({ initialization_error: initialization_error ?? "보고된 초기화 오류 없음", cleanup_status, collection });
}
function usageHtml(report: EvidenceReport): string {
  if (report.input_kind === "normalization") return report.reported_usage.length
    ? report.reported_usage.map(usage => valueHtml(usage)).join("<hr>")
    : "<p>보고된 사용량이 없습니다. 전체 사용량은 unknown입니다.</p>";
  if (report.collaboration_tools === null) return "<p>지원 페이지 관측이 없어 협업 도구 횟수는 unknown입니다.</p>";
  return Object.keys(report.collaboration_tools).length ? valueHtml(report.collaboration_tools) : "<p>지원 페이지에서 협업 도구 관측 0건</p>";
}

/** 내부 전용: CLI가 검증된 스냅샷으로 생성한 DTO만 받는다. 공개 입력 파서가 아니다. */
export function renderEvidenceReportHtml(report: EvidenceReport): string {
  const findings = report.findings.map(finding => `<details><summary><span class="badge ${finding.evidence_level}">${label(finding.evidence_level)}</span> ${label(finding.rule_id)} <span class="muted">근거 ${finding.references.length}건</span></summary><p>규칙 ${escapeHtml(finding.rule_id)} · v${finding.rule_version}</p>${finding.references.length ? `<ul>${finding.references.map(ref => `<li>${ref.kind === "record" ? `기록 ${ref.record_index}` : `페이지 ${ref.page_index} / turn ${ref.turn_index}${ref.kind === "item" ? ` / item ${ref.item_index}` : ""}`}</li>`).join("")}</ul>` : "<p>이 입력만으로 검증 성공·실패나 작업 품질을 판정할 수 없습니다.</p>"}</details>`).join("");
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Agent Slity · 근거 보고서</title><style>
:root{color-scheme:light; font-family:system-ui,sans-serif;color:#182b3b;background:#f3f6f8}*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:40px 24px 64px}h1{font-size:2rem;margin:8px 0 16px}h2{font-size:1.25rem}p,li{line-height:1.7}.eyebrow{font-weight:700;color:#365c72}.banner{border-left:4px solid #ad6b0c;background:#fff3dc;padding:16px 20px}section{margin-top:28px;padding:24px;background:white;border:1px solid #dce4e9;border-radius:12px}dl{margin:0}dl>div{display:grid;grid-template-columns:minmax(120px,1fr) minmax(0,2fr);gap:12px;padding:8px 0;border-bottom:1px solid #edf0f3}dt{color:#526674}dd{margin:0;overflow-wrap:anywhere}.unknown,.muted{color:#5a6874}.badge{display:inline-block;padding:3px 8px;border-radius:5px;font-size:.8rem;background:#e5f0f8;color:#234e70}.suspected{background:#fff0d4;color:#815008}.unknown.badge{background:#eef0f3;color:#4d5964}details{border-top:1px solid #dce4e9;padding:14px 0}summary{cursor:pointer;line-height:1.8}summary:focus-visible{outline:3px solid #2370ac;outline-offset:4px}code{overflow-wrap:anywhere}footer{margin-top:24px;color:#526674;font-size:.9rem}@media(max-width:600px){main{padding:24px 14px}section{padding:16px}h1{font-size:1.65rem}dl>div{grid-template-columns:1fr;gap:4px}.muted{display:block}}
</style></head><body><main><header><div class="eyebrow">Agent Slity / 근거 보고서</div><h1>관측한 사실과 확인할 것</h1><p>입력 형식: ${report.input_kind === "normalization" ? "정규화 기록" : "자식 turn 수집 기록"} · 보고서 v1</p></header>
<div class="banner"><strong>미검증 · unverified</strong><p>입력의 관측 횟수이며 중복을 포함합니다. 고유 실행 수·에이전트 수·품질·협업 효율을 증명하지 않습니다.</p></div>
<section aria-labelledby="observations"><h2 id="observations">입력 관측 요약</h2><p>지원되는 관측만 집계합니다. unknown은 0이 아닙니다.</p>${summaryHtml(report)}</section>
<section aria-labelledby="findings"><h2 id="findings">근거와 의심 후보</h2><p>항목을 펼치면 규칙과 입력 위치를 볼 수 있습니다. 위치 인덱스는 0부터 시작합니다. 의심 후보는 실제 중복·원인·실패한 검증을 확정하지 않습니다.</p>${findings}</section>
<section aria-labelledby="usage"><h2 id="usage">입력에 보고된 사용량과 협업 도구</h2><p>사용량은 입력별 보고값입니다. 중복 제거·전체 합산·비용 환산을 수행하지 않습니다.</p>${usageHtml(report)}</section>
<section aria-labelledby="unknown"><h2 id="unknown">확인되지 않은 지표</h2><dl>${Object.keys(report.unknown_metrics).map(key => `<div><dt>${label(key)}</dt><dd><strong>unknown</strong><br>${label(report.unknown_metric_reasons[key as keyof typeof report.unknown_metrics])}</dd></div>`).join("")}</dl></section>
<section><h2>해석 한계</h2><ul><li>입력의 출처와 진위를 인증하지 않았습니다.</li><li>중복 관측을 보존하며 지원되는 입력만 해석합니다.</li><li>명령의 종료 코드와 품질·테스트 성공은 별개입니다.</li><li>원문·개인 식별자를 보고서에 복사하지 않습니다. 입력 위치로 원본을 별도 확인하세요.</li></ul></section><footer>오프라인 문서 · 외부 스크립트와 네트워크 의존성 없음 · 자동 생성 권고나 모델 호출 없음</footer></main></body></html>`;
  if (Buffer.byteLength(html, "utf8") > 16 * 1024 * 1024) throw new TypeError("HTML 보고서를 생성할 수 없습니다.");
  return html;
}
