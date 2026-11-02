import { writeFile } from "node:fs/promises";
import { readJsonlFile } from "../adapters/jsonl-reader.js";
import { normalizeCodexExecLine } from "../adapters/codex-exec-normalizer.js";
import { exportNormalizationJson } from "../core/json-export.js";
import { findSourceOverlaps } from "../core/source-overlap.js";
import { groupItemObservations } from "../core/item-observations.js";
import type { NormalizationResult } from "../core/events.js";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Windows의 대체 데이터 스트림과 장치 경로는 일반 새 파일로 취급하지 않는다. */
function unsafeWindowsOutput(path: string): boolean {
  if (process.platform !== "win32") return false;
  if (/^(?:\\\\|\/\/)[?.](?:\\|\/)/.test(path)) return true;
  const withoutDrive = /^[A-Za-z]:/.test(path) ? path.slice(2) : path;
  if (withoutDrive.includes(":")) return true;
  return withoutDrive.split(/[\\/]/).some((part) =>
    /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i.test(part.replace(/[ .]+$/, "")),
  );
}

/** 지정된 입력만 읽는다. 명시적인 출력 옵션에서만 새 파일을 만든다. */
export async function runCli(args: readonly string[]): Promise<CliResult> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return {
      exitCode: 0,
      stdout: [
        "사용법: node dist/cli/main.js <JSONL 파일> [출처_별칭]",
        "새 파일 저장: node dist/cli/main.js --output <JSONL 파일> <새 JSON 파일> [출처_별칭]",
        "입력 요약: node dist/cli/main.js --summary <JSONL 파일>",
        "항목 관측 후보: node dist/cli/main.js --items <JSONL 파일> <출처_별칭>",
        "중복 후보: node dist/cli/main.js --overlaps <출처_별칭> <JSONL 파일> <JSONL 파일> [...]",
        "도움말: node dist/cli/main.js --help 또는 -h",
        "출처 별칭: 일반 입력은 선택, 중복·항목 후보 조회는 필수. 영문자·숫자·밑줄·하이픈 1~64자.",
        "결과는 표준 출력으로 제공되며 민감한 식별자가 포함될 수 있습니다.",
        "출력 리디렉션 시 원본과 다른 파일을 지정하세요.",
        "--output은 기존 파일을 덮어쓰지 않으며, 저장 실패 시 부분 파일이 남을 수 있습니다.",
        "중복 후보는 정규화 결과 비교이며 원본의 동일성을 증명하지 않습니다.",
        "항목 관측 후보는 실제 항목이나 실행의 동일성을 증명하지 않습니다.",
        "입력 요약은 중복을 포함한 정규화 결과 수이며 실제 고유 이벤트 수가 아닙니다.",
        "",
      ].join("\n"),
      stderr: "",
    };
  }
  if (args[0] === "--items") {
    if (args.length !== 3 || !args[1] || args[1].startsWith("-") || !args[2] ||
        args.includes("--help") || args.includes("-h")) {
      return { exitCode: 2, stdout: "", stderr: "사용법: --items <JSONL 파일> <출처_별칭>\n" };
    }
    const path = args[1];
    const sourceId = args[2];
    try {
      normalizeCodexExecLine({ kind: "diagnostic", line: 1, code: "invalid_json" }, sourceId);
      const results: NormalizationResult[] = [];
      for await (const entry of readJsonlFile(path)) results.push(normalizeCodexExecLine(entry, sourceId));
      const evidence = groupItemObservations(results);
      const unassociated = evidence.unassociated.map((entry) => {
        const result = results[entry.index];
        if (!result || result.kind !== "event") throw new Error("잘못된 항목 인덱스입니다.");
        return { ...entry, line: result.event.source.line };
      });
      const diagnostics: { index: number; line: number; code: string }[] = [];
      const unsupported: { index: number; line: number; reason: string }[] = [];
      const otherEventIndices: number[] = [];
      for (const [index, result] of results.entries()) {
        if (result.kind === "diagnostic") diagnostics.push({ index, line: result.source.line, code: result.code });
        else if (result.kind === "unsupported") unsupported.push({ index, line: result.source.line, reason: result.reason });
        else if (result.event.event_type !== "item.started" && result.event.event_type !== "item.completed") otherEventIndices.push(index);
      }
      return { exitCode: 0, stdout: `${JSON.stringify({
        format: "agent-slity.item-observations", version: 1, verification_status: evidence.verification_status,
        groups: evidence.groups, unassociated, diagnostics, unsupported, other_event_indices: otherEventIndices,
      })}\n`, stderr: "" };
    } catch {
      return { exitCode: 1, stdout: "", stderr: "입력을 처리할 수 없습니다. 파일과 출처 별칭을 확인하세요.\n" };
    }
  }
  if (args[0] === "--output") {
    const input = args[1];
    const output = args[2];
    const alias = args[3];
    if ((args.length !== 3 && args.length !== 4) || !input || !output ||
        input.startsWith("-") || output.startsWith("-") || unsafeWindowsOutput(output) ||
        args.includes("--help") || args.includes("-h")) {
      return { exitCode: 2, stdout: "", stderr: "사용법: --output <JSONL 파일> <새 JSON 파일> [출처_별칭]\n" };
    }
    const result = await runCli(alias === undefined ? [input] : [input, alias]);
    if (result.exitCode !== 0) return result;
    try {
      await writeFile(output, result.stdout, { flag: "wx", mode: 0o600 });
      return { exitCode: 0, stdout: "저장했습니다.\n", stderr: "" };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        return { exitCode: 1, stdout: "", stderr: "출력 파일이 이미 존재합니다. 덮어쓰지 않았습니다.\n" };
      }
      return { exitCode: 1, stdout: "", stderr: "출력에 실패했습니다. 새 파일이 일부 저장되었을 수 있습니다.\n" };
    }
  }
  if (args[0] === "--summary") {
    if (args.length !== 2 || !args[1] || args[1].startsWith("-")) {
      return { exitCode: 2, stdout: "", stderr: "사용법: --summary <JSONL 파일>\n" };
    }
    try {
      const eventTypes: Record<string, number> = Object.create(null) as Record<string, number>;
      const unsupportedReasons: Record<string, number> = Object.create(null) as Record<string, number>;
      const diagnosticCodes: Record<string, number> = Object.create(null) as Record<string, number>;
      let totalResults = 0;
      for await (const entry of readJsonlFile(args[1])) {
        const result = normalizeCodexExecLine(entry);
        totalResults += 1;
        if (result.kind === "event") {
          const key = result.event.event_type;
          eventTypes[key] = (eventTypes[key] ?? 0) + 1;
        } else if (result.kind === "unsupported") {
          unsupportedReasons[result.reason] = (unsupportedReasons[result.reason] ?? 0) + 1;
        } else {
          diagnosticCodes[result.code] = (diagnosticCodes[result.code] ?? 0) + 1;
        }
      }
      const summary = {
        format: "agent-slity.input-summary", version: 1, verification_status: "unverified",
        count_semantics: "normalized_results_including_duplicates", total_results: totalResults,
        event_types: eventTypes, unsupported_reasons: unsupportedReasons, diagnostic_codes: diagnosticCodes,
      };
      return { exitCode: 0, stdout: `${JSON.stringify(summary)}\n`, stderr: "" };
    } catch {
      return { exitCode: 1, stdout: "", stderr: "입력을 처리할 수 없습니다. 파일을 확인하세요.\n" };
    }
  }
  if (args[0] === "--overlaps") {
    if (args.length < 4 || args.includes("--help") || args.includes("-h") ||
        !args[1] || args.slice(2).some((path) => !path || path.startsWith("-"))) {
      return { exitCode: 2, stdout: "", stderr: "사용법: --overlaps <출처_별칭> <JSONL 파일> <JSONL 파일> [...]\n" };
    }
    const sourceId = args[1];
    try {
      normalizeCodexExecLine({ kind: "diagnostic", line: 1, code: "invalid_json" }, sourceId);
      const results: NormalizationResult[] = [];
      const inputs: { input_index: number; start_index: number; result_count: number }[] = [];
      for (const [inputIndex, path] of args.slice(2).entries()) {
        const startIndex = results.length;
        for await (const entry of readJsonlFile(path)) results.push(normalizeCodexExecLine(entry, sourceId));
        inputs.push({ input_index: inputIndex, start_index: startIndex, result_count: results.length - startIndex });
      }
      const overlaps = findSourceOverlaps(results);
      return { exitCode: 0, stdout: `${JSON.stringify({ format: "agent-slity.source-overlaps", version: 1, inputs, overlaps })}\n`, stderr: "" };
    } catch {
      return { exitCode: 1, stdout: "", stderr: "입력을 처리할 수 없습니다. 파일과 출처 별칭을 확인하세요.\n" };
    }
  }
  if (args.length < 1 || args.length > 2 || args.includes("--help") || args.includes("-h") || !args[0] || args[0].startsWith("-")) {
    return { exitCode: 2, stdout: "", stderr: "사용법: node dist/cli/main.js <JSONL 파일> [출처_별칭]\n" };
  }
  const [path, sourceId] = args;
  try {
    // 빈 파일이어도 출처 별칭을 검증한다.
    normalizeCodexExecLine({ kind: "diagnostic", line: 1, code: "invalid_json" }, sourceId);
    const results: NormalizationResult[] = [];
    for await (const entry of readJsonlFile(path!)) {
      results.push(normalizeCodexExecLine(entry, sourceId));
    }
    return { exitCode: 0, stdout: `${exportNormalizationJson(results)}\n`, stderr: "" };
  } catch {
    return { exitCode: 1, stdout: "", stderr: "입력을 처리할 수 없습니다. 파일과 출처 별칭을 확인하세요.\n" };
  }
}
