import React, { useEffect, useMemo, useState } from "react";

const SYNTHETIC_TASK = "2 + 2의 결과를 숫자 하나로 답하세요.";
const ROLE_NAMES = { researcher: "조사 담당", implementer: "구현 담당", reviewer: "독립 리뷰 담당" };
const MODES = [
  { id: "solo", name: "Solo", count: "1명", description: "구현 담당", roles: ["implementer"] },
  { id: "small", name: "Small", count: "2명", description: "구현 + 독립 리뷰", roles: ["implementer", "reviewer"] },
  { id: "full", name: "Full", count: "3명", description: "조사 + 구현 + 독립 리뷰", roles: ["researcher", "implementer", "reviewer"] },
  { id: "manual", name: "Manual", count: "직접 구성", description: "역할과 순서를 선택", roles: [] },
];
const STATUS = { completed: "완료", failed: "실패", cancelled: "취소됨", timeout: "시간 초과", unknown: "확인 필요" };
const RULE_NAMES = {
  source_position_overlap: "같은 출처 위치의 중복 후보", source_position_conflict: "같은 출처 위치의 충돌 후보",
  repeated_turn_id: "반복 turn ID 후보", repeated_item_id: "반복 item ID 후보",
  reported_execution_error: "입력에 보고된 실행 오류", reported_command_failure: "입력에 보고된 명령 실패",
  validation_unobserved: "검증 결과 미관측",
};
const METRIC_NAMES = { unique_executions: "고유 실행 수", unique_agents: "고유 에이전트 수", quality: "결과 품질", elapsed_time_ms: "전체 소요 시간", total_tokens: "전체 토큰", efficiency: "협업 효율", savings: "절감량" };
const REASONS = { identity_and_scope_unverified: "식별과 집계 범위 미검증", quality_not_collected: "품질 평가 미수집", end_to_end_timing_unavailable: "전체 실행 시간 근거 없음", scope_and_usage_semantics_unverified: "사용량의 범위·의미 미검증", quality_and_baseline_unverified: "품질과 비교 기준 미검증", no_controlled_baseline: "통제된 비교 기준 없음" };
const rolesText = roles => roles.map(role => ROLE_NAMES[role] ?? role).join(" · ");
const known = value => value === null || value === undefined ? "unknown" : String(value);
const timeText = value => typeof value === "number" ? `${value.toLocaleString("ko-KR")} ms` : "unknown";
const cleanupText = (value, synthetic = false) => value === "exit_observed" ? "직접 자식 종료 관측" : synthetic ? "unknown · 인메모리 합성 실행" : "unknown · 종료 확인 필요";

function EmptyState({ title, children }) {
  return <div className="empty-state"><span className="empty-mark" aria-hidden="true">—</span><h3>{title}</h3><p>{children}</p></div>;
}
function SectionHeading({ number, title, children }) {
  return <div className="section-heading"><div><span className="step-number">{number}</span><h2>{title}</h2></div>{children}</div>;
}
function ConditionSelect({ id, label, value, onChange, disabled }) {
  return <label className="field">{label}<select id={id} data-testid={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="true">필요</option><option value="false">불필요</option><option value="unknown">확인 필요</option></select></label>;
}
function PlanView({ plan }) {
  if (!plan) return <EmptyState title="선택한 팀의 계획을 확인하세요">조건을 정한 뒤 ‘계획 확인’을 누르면 명시한 선택과 규칙 추천을 나란히 확인할 수 있습니다.</EmptyState>;
  const recommendation = plan.recommendation;
  const candidate = recommendation.candidate;
  const states = { suggested: "규칙 제안", unknown: "조건 확인 필요", budget_blocked: "인원 제한 초과" };
  return <div data-testid="team-plan" className="plan-content">
    <div className="plan-choice"><span className="overline">명시적 선택</span><div className="choice-title"><strong>{plan.selection.mode}</strong><span>{plan.selection.agent_count}명</span></div><p>{rolesText(plan.selection.roles)}</p></div>
    <div className="recommendation"><span className={`badge ${recommendation.status === "suggested" ? "neutral" : "warning"}`}>{states[recommendation.status]}</span><h3>{candidate ? `${candidate.mode} · ${candidate.agent_count}명` : "추천 후보 unknown"}</h3><p>{candidate ? rolesText(candidate.roles) : "작업 조건이 모두 알려지지 않아 후보를 정하지 않았습니다."}</p>{recommendation.status === "budget_blocked" ? <p className="warning-copy">필요 인원이 제한을 초과했습니다. 요청한 역할을 자동으로 제거하지 않습니다.</p> : null}</div>
    {plan.warnings.map((warning, index) => <p className="inline-warning" key={index}>선택한 팀에 요청 역할이 없습니다: {rolesText(warning.roles)}</p>)}
    <details className="quiet-details"><summary>추천 근거와 한계</summary><p>규칙 {recommendation.rule_id} · v{recommendation.rule_version}</p><ul>{recommendation.evidence.map(evidence => <li key={evidence.field}>{evidence.field}: {evidence.requested_value === null ? "unknown" : String(evidence.requested_value)}</li>)}</ul><p>사용자가 요청한 조건에 대한 미검증 제안입니다. 실제 품질·효율은 unknown이며, 추천이 명시적 선택을 변경하지 않습니다.</p></details>
  </div>;
}
function OutputText({ output }) {
  const [expanded, setExpanded] = useState(false);
  const long = output.length > 12000;
  return <><pre>{long && !expanded ? `${output.slice(0, 12000)}\n\n[표시 범위: 처음 12,000자]` : output || "출력 없음"}</pre>{long ? <button className="text-button" onClick={() => setExpanded(value => !value)}>{expanded ? "간단히 보기" : "전체 출력 보기"}</button> : null}</>;
}
function ExecutionView({ execution, progress, busy }) {
  if (!execution && !busy) return <EmptyState title="실행 결과가 여기에 표시됩니다">먼저 계획을 확인하고 실행하세요. 합성 데모는 고정 과제로 역할 전달과 종료 흐름을 확인합니다.</EmptyState>;
  if (!execution) return <div className="running-state" role="status"><span className="working-line" aria-hidden="true" /><h3>팀 작업을 진행하고 있습니다</h3><p>{progress.length ? `${rolesText([progress.at(-1).role])} 단계 결과를 받았습니다.` : "선택한 팀의 첫 단계를 준비하고 있습니다."}</p><p className="muted">작업을 중지하려면 취소를 누르세요.</p></div>;
  return <div data-testid="execution-result"><div className="result-topline"><span className={`badge ${execution.synthetic ? "neutral" : "warning"}`}>{execution.synthetic ? "합성 데모" : "Codex 실행"}</span><strong>{STATUS[execution.status] ?? execution.status}</strong></div><div className="metric-strip"><div><span>소요 시간</span><strong>{timeText(execution.elapsed_ms)}</strong></div><div><span>품질</span><strong>{execution.quality_basis === "synthetic_fixture" ? execution.quality === "passed" ? "합성 정답 검사 통과" : execution.quality === "failed" ? "합성 정답 검사 실패" : "unknown" : "unknown"}</strong></div><div><span>정리 상태</span><strong>{cleanupText(execution.cleanup_status, execution.synthetic)}</strong></div></div><p className="small-note">{execution.synthetic ? "고정 합성 과제의 검사 결과입니다. 실제 작업 품질이나 효율 우위를 증명하지 않습니다." : "출력과 상태는 실행 관측입니다. 작업 품질·협업 효율은 별도 검증 전까지 unknown입니다."}</p><div className="execution-steps">{execution.steps.map((step, index) => <details className="execution-step" key={`${index}-${step.role}`} open={step.role === "implementer"}><summary><span className="step-order">{index + 1}</span><strong>{ROLE_NAMES[step.role] ?? step.role}</strong><span className="step-result">{STATUS[step.status] ?? step.status} · {timeText(step.elapsed_ms)}</span></summary><OutputText output={step.output} /><dl className="compact-dl"><div><dt>정리</dt><dd>{cleanupText(step.cleanup_status, execution.synthetic)}</dd></div><div><dt>오류 코드</dt><dd>{step.error_code ?? "보고된 오류 없음"}</dd></div><div><dt>보고 사용량</dt><dd>{step.reported_usage ? Object.entries(step.reported_usage).map(([key, value]) => `${key}: ${known(value)}`).join(" / ") : "unknown"}</dd></div></dl></details>)}</div></div>;
}
function FindingView({ finding }) {
  const [count, setCount] = useState(50);
  const levels = { input_observation: "입력 관측", suspected: "의심 후보", unknown: "확인 필요" };
  return <details className="finding"><summary><span className={`badge ${finding.evidence_level === "suspected" ? "warning" : "neutral"}`}>{levels[finding.evidence_level] ?? finding.evidence_level}</span><strong>{RULE_NAMES[finding.rule_id] ?? finding.rule_id}</strong><span className="muted">근거 {finding.references.length.toLocaleString("ko-KR")}건</span></summary><p className="small-note">{finding.rule_id} · v{finding.rule_version} · 위치는 0부터 시작합니다.</p>{finding.references.length ? <><ul className="reference-list">{finding.references.slice(0, count).map((reference, index) => <li key={index}>{reference.kind === "record" ? `기록 ${reference.record_index}` : `페이지 ${reference.page_index} / turn ${reference.turn_index}${reference.kind === "item" ? ` / item ${reference.item_index}` : ""}`}</li>)}</ul>{finding.references.length > count ? <button className="text-button" onClick={() => setCount(value => value + 50)}>근거 50건 더 보기 ({count}/{finding.references.length})</button> : null}</> : <p>이 입력만으로 검증 성공·실패나 작업 품질을 판정할 수 없습니다.</p>}</details>;
}
function ReportView({ report, name, onSave, disabled }) {
  const [findingCount, setFindingCount] = useState(100);
  const [usageCount, setUsageCount] = useState(20);
  if (!report) return <EmptyState title="저장된 스냅샷을 열어보세요">정규화 또는 자식 turn 수집 JSON을 선택하면 관측 사실·의심 후보·확인되지 않은 지표를 구분해 보여줍니다.</EmptyState>;
  const normal = report.input_kind === "normalization";
  const collection = normal ? null : report.summary.collection;
  const countItems = normal ? [["입력 기록", report.summary.records], ["이벤트 관측", report.summary.events], ["진단", report.summary.diagnostics], ["미지원", report.summary.unsupported]] : [["turn 관측", collection?.observations?.turns ?? null], ["item 관측", collection?.observations?.items ?? null], ["지원 페이지", collection?.pages?.supported ?? null], ["미지원 페이지", collection?.pages?.unsupported ?? null]];
  return <div data-testid="evidence-report" className="report-content"><div className="section-heading"><div><h2>{name}</h2></div><button data-testid="save-report" className="button secondary" onClick={onSave} disabled={disabled}>보고서 JSON 저장</button></div><div className="notice-banner"><strong>미검증 · 중복을 포함한 관측</strong><p>지원되는 입력의 관측 횟수입니다. 고유 실행 수·실제 중복·품질·효율을 확정하지 않습니다.</p></div><div className="report-counts">{countItems.map(([label, value]) => <div key={label}><span>{label}</span><strong>{known(value)}</strong></div>)}</div>{!normal ? <dl className="compact-dl report-states"><div><dt>초기화</dt><dd>{report.summary.initialization_error ?? "보고된 초기화 오류 없음"}</dd></div><div><dt>수집 상태</dt><dd>{collection ? `${collection.status} / ${collection.reason}` : "unknown"}</dd></div><div><dt>정리 상태</dt><dd>{cleanupText(report.summary.cleanup_status)}</dd></div><div><dt>협업 도구 관측</dt><dd>{report.collaboration_tools === null ? "unknown · 지원 페이지 관측 없음" : Object.keys(report.collaboration_tools).length ? Object.entries(report.collaboration_tools).map(([tool, count]) => `${tool}: ${count}`).join(" / ") : "지원 페이지에서 0건"}</dd></div></dl> : null}<h3 className="subheading">근거와 의심 후보</h3><p className="small-note">후보는 실제 낭비나 원인을 확정하지 않습니다. 항목을 펼쳐 입력 위치를 확인하세요.</p><p className="small-note" data-testid="finding-count">규칙 결과 {Math.min(findingCount, report.findings.length).toLocaleString("ko-KR")}개 표시 / 전체 {report.findings.length.toLocaleString("ko-KR")}개</p>{report.findings.slice(0, findingCount).map((finding, index) => <FindingView key={`${index}-${finding.rule_id}`} finding={finding} />)}{report.findings.length > findingCount ? <button className="button secondary" onClick={() => setFindingCount(value => value + 100)}>규칙 결과 100개 더 보기</button> : null}{normal && report.reported_usage.length ? <><h3 className="subheading">입력별 보고 사용량</h3><p className="small-note">합산·중복 제거·비용 환산을 하지 않습니다.</p><div className="table-scroll"><table><thead><tr><th>기록</th><th>입력</th><th>캐시 입력</th><th>출력</th><th>추론 출력</th></tr></thead><tbody>{report.reported_usage.slice(0, usageCount).map(usage => <tr key={usage.record_index}><td>{usage.record_index}</td><td>{known(usage.input_tokens)}</td><td>{known(usage.cached_input_tokens)}</td><td>{known(usage.output_tokens)}</td><td>{known(usage.reasoning_output_tokens)}</td></tr>)}</tbody></table></div>{report.reported_usage.length > usageCount ? <button className="text-button" onClick={() => setUsageCount(value => value + 20)}>사용량 20개 더 보기 ({usageCount}/{report.reported_usage.length})</button> : null}</> : null}<h3 className="subheading">확인되지 않은 지표</h3><div className="unknown-grid">{Object.keys(report.unknown_metrics).map(key => <div key={key}><span>{METRIC_NAMES[key] ?? key}</span><strong>unknown</strong><p>{REASONS[report.unknown_metric_reasons[key]] ?? report.unknown_metric_reasons[key]}</p></div>)}</div><p className="small-note">원문·경로·ID·출처 별칭은 보고서에 복사하지 않습니다. 보고된 메타데이터도 공유 전에 검토하세요.</p></div>;
}

export default function App() {
  const bridge = window.agentSlity;
  const [tab, setTab] = useState("team");
  const [mode, setMode] = useState("small"), [manualRoles, setManualRoles] = useState(["implementer", "reviewer"]);
  const [maxAgents, setMaxAgents] = useState(3), [research, setResearch] = useState("false"), [review, setReview] = useState("true");
  const [provider, setProvider] = useState("synthetic"), [task, setTask] = useState(SYNTHETIC_TASK), [timeout, setTimeoutValue] = useState(30);
  const [executable, setExecutable] = useState(null), [workspace, setWorkspace] = useState(null);
  const [planState, setPlanState] = useState(null), [execution, setExecution] = useState(null), [comparison, setComparison] = useState(null);
  const [reportState, setReportState] = useState(null), [snapshotKind, setSnapshotKind] = useState("turn");
  const [busy, setBusy] = useState(null), [progress, setProgress] = useState([]), [notice, setNotice] = useState(null), [cancelPending, setCancelPending] = useState(false);
  const request = useMemo(() => ({ format: "agent-slity.team-request", version: 1, selection: mode === "manual" ? { mode, roles: manualRoles } : { mode }, constraints: { max_agents: Number(maxAgents) }, task: { independent_research: research === "unknown" ? null : research === "true", independent_review: review === "unknown" ? null : review === "true" } }), [mode, manualRoles, maxAgents, research, review]);
  const signature = JSON.stringify(request), plan = planState?.signature === signature ? planState.plan : null;
  const selectedRoles = mode === "manual" ? manualRoles : MODES.find(item => item.id === mode).roles;
  const invalidSelection = selectedRoles.length > Number(maxAgents) || !selectedRoles.includes("implementer") || selectedRoles.length === 0;
  const invalidTimeout = !Number.isInteger(Number(timeout)) || Number(timeout) < 1 || Number(timeout) > 300;
  const disabled = !bridge || busy !== null;

  useEffect(() => {
    if (!bridge?.onProgress) return;
    return bridge.onProgress(step => setProgress(previous => [...previous, step].slice(-12)));
  }, [bridge]);

  async function perform(operation, action, failure) {
    if (!bridge || busy !== null) return null;
    setBusy(operation); setNotice(null);
    try { return await action(); }
    catch { setNotice({ kind: "error", text: failure }); return null; }
    finally { setBusy(null); }
  }
  async function handlePlan(event) {
    event.preventDefault();
    const result = await perform("plan", () => bridge.plan(request), "계획을 만들 수 없습니다. 선택 역할·인원 제한·작업 조건을 확인하세요.");
    if (result) setPlanState({ signature, plan: result });
  }
  async function handleRun() {
    setExecution(null); setProgress([]); setCancelPending(false);
    const result = await perform("run", () => bridge.run({ request, provider, task: provider === "synthetic" ? SYNTHETIC_TASK : task, timeout_ms: Number(timeout) * 1000, confirm_model_call: provider === "codex" }), "실행을 시작하거나 결과를 가져오지 못했습니다. 설정을 확인하고 다시 시도하세요.");
    if (result) setExecution(result);
    setCancelPending(false);
  }
  async function handleCancel() {
    if (cancelPending) return;
    setCancelPending(true);
    try { const accepted = await bridge.cancel(); setNotice({ kind: "info", text: accepted ? "취소를 요청했습니다. 종료 관측을 기다리고 있습니다." : "진행 중인 실행이 이미 종료됐습니다." }); }
    catch { setNotice({ kind: "error", text: "취소 요청을 확인하지 못했습니다. 종료 상태를 확인하세요." }); }
    finally { setCancelPending(false); }
  }
  async function handleCompare() {
    setComparison(null); setProgress([]); setCancelPending(false);
    const result = await perform("compare", () => bridge.compare({ timeout_ms: Number(timeout) * 1000 }), "팀 비교를 완료하지 못했습니다. 제한 시간을 확인하고 다시 시도하세요.");
    if (result) setComparison(result);
    setCancelPending(false);
  }
  async function handleOpen() {
    const result = await perform("open", () => bridge.openSnapshot(snapshotKind), "기록을 열 수 없습니다. 선택한 형식·UTF-8·크기를 확인하세요.");
    if (result) setReportState(previous => ({ ...result, view_revision: (previous?.view_revision ?? 0) + 1 }));
  }
  async function handleSave(kind) {
    const result = await perform("save", () => bridge.save({ kind }), "저장하지 못했습니다. 원본과 다른 경로를 선택하고 다시 시도하세요.");
    if (result?.saved) setNotice({ kind: result.temp_cleanup_status && result.temp_cleanup_status !== "complete" ? "info" : "success", text: `${result.name ?? "결과 파일"}을 저장했습니다.${result.temp_cleanup_status && result.temp_cleanup_status !== "complete" ? " 임시 파일 정리 상태는 확인이 필요합니다." : ""}` });
  }
  async function choose(kind) {
    const result = await perform("choose", () => kind === "executable" ? bridge.chooseExecutable() : bridge.chooseWorkspace(), "선택을 완료하지 못했습니다. 다시 시도하세요.");
    if (result) {
      if (kind === "executable") setExecutable(result.name);
      else setWorkspace(result.name);
    }
  }
  function toggleRole(role) { setManualRoles(previous => previous.includes(role) ? previous.filter(value => value !== role) : [...previous, role]); }
  function moveRole(index, offset) { setManualRoles(previous => { const next = [...previous]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; }); }

  const pageTitle = { team: "필요한 역할만, 명확한 팀으로.", report: "관측한 사실과 확인할 것.", comparison: "같은 과제, 다른 팀 구성." }[tab];
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-symbol" aria-hidden="true"><i /><i /><i /></span><span>Agent Slity</span></div><p className="sidebar-caption">TEAM WORKSPACE</p><nav aria-label="주 메뉴">{[["team", "팀 작업", "01"], ["report", "기록 보고서", "02"], ["comparison", "팀 비교", "03"]].map(([id, text, number]) => <button key={id} data-testid={`tab-${id}`} className={`nav-item ${tab === id ? "active" : ""}`} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><span>{number}</span>{text}<span className="nav-arrow" aria-hidden="true">↗</span></button>)}</nav><div className="sidebar-bottom"><span className="local-dot" />로컬 작업 공간<p>자동 공개·자동 저장 없이<br />선택한 흐름을 직접 실행합니다.</p></div></aside><main><header className="topbar"><span>작업 공간 <span className="crumb-divider">/</span> {{ team: "팀 작업", report: "기록 보고서", comparison: "팀 비교" }[tab]}</span><span className="connection-status">{busy === "run" || busy === "compare" ? "실행 중" : bridge ? "데스크톱 연결됨" : "브라우저 미리보기"}</span></header><div className="page-content"><div className="page-heading"><div><span className="overline">AGENT SLITY</span><h1>{pageTitle}</h1><p>{{ team: "팀을 선택하고, 계획을 확인한 뒤 실행 결과를 살펴보세요.", report: "지원 스냅샷의 근거와 한계를 원본 수정 없이 확인하세요.", comparison: "합성 고정 과제로 실행 흐름을 비교하고, 관측 범위를 확인하세요." }[tab]}</p></div><span className="outline-label">{tab === "report" ? "입력 읽기 전용" : "명시적 실행"}</span></div>{!bridge ? <div className="notice-banner preview-notice" role="status"><strong>데스크톱 앱을 시작해야 합니다.</strong><p>현재는 화면 미리보기입니다. 파일 읽기·팀 실행·저장은 데스크톱 연결 후 사용할 수 있습니다.</p></div> : null}{notice ? <div className={`notice-banner ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</div> : null}
    <div hidden={tab !== "team"}><div className="workbench"><section className="panel setup-panel"><SectionHeading number="01" title="팀 구성" /><form onSubmit={handlePlan}><fieldset disabled={disabled}><legend className="field-label">팀 모드</legend><div className="mode-grid">{MODES.map(item => <label className={`mode-option ${mode === item.id ? "selected" : ""}`} key={item.id}><input type="radio" name="team-mode" data-testid={`mode-${item.id}`} value={item.id} checked={mode === item.id} onChange={() => setMode(item.id)} /><span><strong>{item.name}</strong><small>{item.count}</small></span><p>{item.description}</p></label>)}</div></fieldset>{mode === "manual" ? <fieldset className="manual-roles" disabled={disabled}><legend className="field-label">직접 선택한 역할</legend><div className="role-checkboxes">{Object.entries(ROLE_NAMES).map(([role, label]) => <label key={role}><input type="checkbox" checked={manualRoles.includes(role)} disabled={disabled || role === "implementer"} onChange={() => toggleRole(role)} />{label}</label>)}</div><ol>{manualRoles.map((role, index) => <li key={role}><span>{ROLE_NAMES[role]}</span><button type="button" aria-label={`${ROLE_NAMES[role]} 위로`} disabled={disabled || index === 0} onClick={() => moveRole(index, -1)}>↑</button><button type="button" aria-label={`${ROLE_NAMES[role]} 아래로`} disabled={disabled || index === manualRoles.length - 1} onClick={() => moveRole(index, 1)}>↓</button></li>)}</ol><p className="small-note">선택 순서는 계획에 보존됩니다. 실제 단계는 역할 의존성에 따라 진행됩니다.</p></fieldset> : null}<div className="form-row"><label className="field">최대 인원<select data-testid="max-agents" value={maxAgents} disabled={disabled} onChange={event => setMaxAgents(Number(event.target.value))}><option value={1}>1명</option><option value={2}>2명</option><option value={3}>3명</option></select></label><ConditionSelect id="research" label="독립 조사" value={research} disabled={disabled} onChange={setResearch} /><ConditionSelect id="review" label="독립 리뷰" value={review} disabled={disabled} onChange={setReview} /></div>{invalidSelection ? <p role="alert" className="inline-warning">선택 인원이 제한을 초과했습니다. 역할과 최대 인원을 확인하세요.</p> : null}<button data-testid="plan-button" type="submit" className="button primary wide" disabled={disabled || invalidSelection}>{busy === "plan" ? "계획 확인 중…" : "계획 확인"}<span aria-hidden="true">→</span></button></form><p className="small-note">작업 조건이 빠지면 추천은 unknown입니다. 규칙 추천이 선택을 자동으로 바꾸지 않습니다.</p></section><section className="panel plan-panel"><SectionHeading number="02" title="선택과 추천"><span className="badge neutral">실행 전 계획</span></SectionHeading><PlanView plan={plan} /></section></div><section className="panel execution-config"><SectionHeading number="03" title="명시적 실행" /><div className="execution-inputs"><div><div className="form-row"><label className="field">실행기<select data-testid="provider" value={provider} disabled={disabled} onChange={event => setProvider(event.target.value)}><option value="synthetic">합성 데모 · 모델 호출 없음</option><option value="codex">Codex · 모델 호출</option></select></label><label className="field timeout-field">제한 시간 (초)<input data-testid="timeout" type="number" min="1" max="300" step="1" value={timeout} disabled={disabled} onChange={event => setTimeoutValue(event.target.value)} /></label></div><label className="field task-field">{provider === "synthetic" ? "고정 합성 과제" : "실행할 과제"}<textarea data-testid="task" value={provider === "synthetic" ? SYNTHETIC_TASK : task} readOnly={provider === "synthetic"} disabled={disabled} maxLength={8000} rows={3} onChange={event => setTask(event.target.value)} /></label></div><div className="run-settings">{provider === "codex" ? <><button className="file-choice" data-testid="choose-executable" onClick={() => choose("executable")} disabled={disabled}><span>Codex 실행 파일</span><strong>{executable ?? "선택하기"}</strong></button><button className="file-choice" data-testid="choose-workspace" onClick={() => choose("workspace")} disabled={disabled}><span>읽을 작업 폴더</span><strong>{workspace ?? "선택하기"}</strong></button><p className="small-note">선택한 폴더와 과제를 Codex가 읽고 모델 요청이 발생합니다. 실행은 read-only 설정으로 요청합니다.</p></> : <div className="demo-note"><strong>연결부터 결과까지 먼저 확인하세요.</strong><p>고정 과제로 역할별 결과 전달과 정답 검사를 확인합니다. 실제 작업 효율 비교 결과는 아닙니다.</p></div>}<div className="run-actions"><button data-testid="run-button" className={`button primary ${provider === "codex" ? "model-action" : ""}`} onClick={handleRun} disabled={disabled || !plan || invalidTimeout || (provider === "codex" && (!executable || !workspace || !task.trim()))}>{busy === "run" ? "실행 중…" : provider === "synthetic" ? "합성 데모 실행" : "Codex 실행 · 모델 호출"}<span aria-hidden="true">→</span></button><button data-testid="cancel-button" className="button secondary" onClick={handleCancel} disabled={(busy !== "run" && busy !== "compare") || cancelPending}>{cancelPending ? "취소 요청 중…" : "취소"}</button></div>{!plan ? <p className="small-note">실행 전에 현재 설정의 계획을 확인하세요.</p> : null}{invalidTimeout ? <p className="inline-warning">제한 시간은1~300초의 정수로 입력하세요.</p> : null}</div></div></section><section className="panel result-panel"><SectionHeading number="04" title="실행 결과"><button data-testid="save-execution" className="button secondary" onClick={() => handleSave("execution")} disabled={disabled || !execution}>실행 결과 저장</button></SectionHeading><ExecutionView execution={execution} progress={progress} busy={busy === "run"} /><p className="privacy-note">실행 출력에는 입력·프로젝트 정보가 포함될 수 있습니다. 자동 저장하지 않으며, 저장·공유 전에 내용을 검토하세요.</p></section></div>
    <div hidden={tab !== "report"}><section className="panel"><SectionHeading number="01" title="스냅샷 열기" /><div className="file-toolbar"><label className="field">입력 형식<select data-testid="snapshot-kind" value={snapshotKind} disabled={disabled} onChange={event => setSnapshotKind(event.target.value)}><option value="turn">자식 turn 수집 JSON</option><option value="normalization">정규화 JSON</option></select></label><button data-testid="open-snapshot" className="button primary" onClick={handleOpen} disabled={disabled}>JSON 파일 열기<span aria-hidden="true">↑</span></button></div><p className="small-note">지원되는 저장 스냅샷 하나를 읽습니다. 원본은 수정하지 않으며 JSONL 자동 탐색은 하지 않습니다.</p></section><section className="panel"><ReportView key={reportState?.view_revision ?? "empty"} report={reportState?.report} name={reportState?.name} disabled={disabled} onSave={() => handleSave("report")} /></section></div>
    <div hidden={tab !== "comparison"}><section className="panel comparison-intro"><SectionHeading number="01" title="합성 팀 비교" /><div><div><h3>Solo · Small · Full, 동일한 고정 과제</h3><p>같은 합성 실행기로 ‘2 + 2’를 수행하고 시간과 정답 검사 결과를 나란히 봅니다. 실제 모델의 품질·비용·효율 우위는 판정하지 않습니다.</p></div><button data-testid="compare-button" className="button primary" onClick={handleCompare} disabled={disabled || invalidTimeout}>{busy === "compare" ? "비교 실행 중…" : "합성 팀 비교 실행"}<span aria-hidden="true">→</span></button></div><div className="comparison-controls"><label className="field timeout-field">팀별 제한 시간 (초)<input type="number" min="1" max="300" step="1" value={timeout} disabled={disabled} onChange={event => setTimeoutValue(event.target.value)} /></label><button className="button secondary" onClick={handleCancel} disabled={busy !== "compare" || cancelPending}>비교 취소</button></div></section><section className="panel"><SectionHeading number="02" title="비교 결과"><button data-testid="save-comparison" className="button secondary" disabled={disabled || !comparison} onClick={() => handleSave("comparison")}>비교 결과 저장</button></SectionHeading>{comparison ? <div data-testid="comparison-result"><div className="notice-banner"><strong>합성 검증 · 효율 unknown</strong><p>고정 과제와 합성 실행기의 실행 관측입니다. 일반적인 협업 효율이나 실제 작업 품질을 증명하지 않습니다.</p></div><div className="result-topline"><span className="badge neutral">합성 비교</span><strong>{STATUS[comparison.status] ?? "확인 필요"}</strong></div>{comparison.runs.length === 0 ? <p className="small-note">수신된 실행 결과가 없습니다. 비교 완료를 뜻하지 않습니다.</p> : null}<div className="table-scroll"><table><thead><tr><th>팀 선택</th><th>단계</th><th>상태</th><th>소요 시간</th><th>합성 정답 검사</th><th>효율</th></tr></thead><tbody>{comparison.runs.map((run, index) => <tr key={index}><td><strong>{run.selection.mode}</strong><small>{run.selection.agent_count}명</small></td><td>{run.steps.length}개</td><td>{STATUS[run.status] ?? run.status}</td><td>{timeText(run.elapsed_ms)}</td><td>{run.quality_basis === "synthetic_fixture" ? run.quality === "passed" ? "통과" : run.quality === "failed" ? "실패" : "unknown" : "unknown"}</td><td>unknown</td></tr>)}</tbody></table></div><p className="small-note">실패·취소·누락된 검증은 성공이나0으로 바꾸지 않습니다. 한 번의 합성 비교로 팀 순위를 매기지 않습니다.</p></div> : busy === "compare" ? <div className="running-state" role="status"><span className="working-line" aria-hidden="true" /><h3>합성 비교를 진행하고 있습니다</h3><p>{progress.length}개 단계 결과를 받았습니다.</p></div> : <EmptyState title="동일 조건의 실행 결과를 확인하세요">합성 팀 비교를 실행하면 구성별 상태·시간·정답 검사 결과가 표시됩니다.</EmptyState>}</section></div>
    <footer>Agent Slity <span>·</span> 관측과 판단을 구분하는 팀 작업 공간</footer></div></main></div>;
}
