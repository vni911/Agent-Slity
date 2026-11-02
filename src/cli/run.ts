import { readJsonlFile } from "../adapters/jsonl-reader.js";
import { normalizeCodexExecLine } from "../adapters/codex-exec-normalizer.js";
import { exportNormalizationJson } from "../core/json-export.js";
import type { NormalizationResult } from "../core/events.js";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** 지정된 입력만 읽고 결과를 반환한다. 파일을 쓰거나 모델을 호출하지 않는다. */
export async function runCli(args: readonly string[]): Promise<CliResult> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return {
      exitCode: 0,
      stdout: [
        "사용법: node dist/cli/main.js <JSONL 파일> [출처_별칭]",
        "도움말: node dist/cli/main.js --help 또는 -h",
        "출처 별칭: 선택 사항, 영문자·숫자·밑줄·하이픈 1~64자.",
        "결과는 표준 출력으로 제공되며 민감한 식별자가 포함될 수 있습니다.",
        "출력 리디렉션 시 원본과 다른 파일을 지정하세요.",
        "",
      ].join("\n"),
      stderr: "",
    };
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
