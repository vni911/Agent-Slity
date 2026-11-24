import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { executeCodexChild, validateCodexTarget } from "../../dist/adapters/codex-team-executor.js";

function child(mode) {
  return spawn(process.execPath, [resolve("tests/fixtures/team-executor-child.mjs"), mode], {
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", HOME: "", CODEX_HOME: "" },
  });
}
function context(signal = new AbortController().signal, timeout_ms = 3000) {
  return { role: "implementer", task: "고정 합성 과제", previous_steps: [], timeout_ms, signal };
}
test("실행 경로 검증은 실제 일반 파일/디렉터리를 확인하고 배치·상대 경로를 거부한다", async () => {
  await validateCodexTarget(process.execPath, process.cwd());
  await assert.rejects(validateCodexTarget("PRIVATE_RELATIVE.cmd", process.cwd()), /^TypeError: 유효하지 않은 Codex 실행 경로입니다\.$/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(validateCodexTarget(process.execPath, process.cwd(), { signal: controller.signal }), /^TypeError: 유효하지 않은 Codex 실행 경로입니다\.$/);
});
test("고정 Node 자식의 분할 UTF-8/JSONL과 마지막 메시지·usage0을 관측한다", async () => {
  const result = await executeCodexChild(child("success"), context(), "HANDOFF_SENTINEL");
  assert.equal(result.status, "completed"); assert.equal(result.output, "전달 확인"); assert.equal(result.cleanup_status, "exit_observed");
  assert.deepEqual(result.reported_usage, { input_tokens: 0, cached_input_tokens: 0, output_tokens: 3, reasoning_output_tokens: null });
  assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
});
test("출력 제한·UTF-8/프로토콜/프로세스 오류는 부분 결과나 stderr를 내보내지 않는다", async () => {
  for (const [mode, code] of [["overflow", "output_limit"], ["utf8", "invalid_utf8"], ["invalid", "invalid_output"], ["unknown", "unsupported_output"], ["failed", "process_failed"]]) {
    const result = await executeCodexChild(child(mode), context(), "fixture");
    assert.equal(result.status, "failed"); assert.equal(result.output, ""); assert.equal(result.error_code, code);
    assert.equal(result.cleanup_status, "exit_observed"); assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
  }
});
test("취소와 시간 초과에서 직접 자식을 종료하고 원문 없이 상태를 구분한다", async () => {
  for (const mode of ["cancel", "timeout"]) {
    const controller = new AbortController(), processChild = child("hang");
    const timer = mode === "cancel" ? setTimeout(() => controller.abort(), 250) : undefined;
    try {
      const result = await executeCodexChild(processChild, context(controller.signal, mode === "timeout" ? 250 : 3000), "fixture");
      assert.equal(result.status, mode === "cancel" ? "cancelled" : "timeout"); assert.equal(result.output, "");
      assert.equal(result.cleanup_status, "exit_observed");
      assert.ok(processChild.exitCode !== null || processChild.signalCode !== null);
    } finally { clearTimeout(timer); if (processChild.exitCode === null && processChild.signalCode === null) processChild.kill("SIGKILL"); }
  }
});
