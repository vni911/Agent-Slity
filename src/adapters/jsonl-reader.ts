import { createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { TextDecoder } from "node:util";

/** 한 줄의 원본 크기 제한. 줄바꿈 LF를 제외하고 CR은 포함한다. */
const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;

export interface JsonlReadOptions {
  maxLineBytes?: number;
  /** LF를 포함한 전체 파일 바이트 제한. 생략하면 제한하지 않는다. 초과 오류 전 일부 결과가 이미 반환될 수 있다. */
  maxFileBytes?: number;
}

export type JsonlReadResult =
  | { kind: "record"; line: number; value: unknown }
  | { kind: "diagnostic"; line: number; code: "invalid_json" | "invalid_utf8" | "line_too_long" };

/** 파일 경로와 원본 내용을 노출하지 않는 읽기 오류. */
export class JsonlReadError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`JSONL 파일을 읽을 수 없습니다 (${code}).`);
    this.name = "JsonlReadError";
    this.code = code;
  }
}

/** 지정한 파일만 읽는다. 값은 정규화하거나 기록하지 않는다. */
export async function* readJsonlFile(
  path: string,
  options: JsonlReadOptions = {},
): AsyncGenerator<JsonlReadResult> {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) {
    throw new RangeError("maxLineBytes는 양의 정수여야 합니다.");
  }
  const maxFileBytes = options.maxFileBytes;
  if (maxFileBytes !== undefined && (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 0)) {
    throw new RangeError("maxFileBytes는 음이 아닌 정수여야 합니다.");
  }

  let input: ReadStream | undefined;
  let line = 1;
  let pieces: Buffer[] = [];
  let length = 0;
  let tooLong = false;
  let totalBytes = 0;

  function append(part: Buffer): void {
    if (tooLong) return;
    if (length + part.length > maxLineBytes) {
      tooLong = true;
      pieces = [];
      length = 0;
      return;
    }
    if (part.length > 0) pieces.push(part);
    length += part.length;
  }

  function finishLine(): JsonlReadResult | undefined {
    if (tooLong) return { kind: "diagnostic", line, code: "line_too_long" };
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(pieces, length));
    } catch {
      return { kind: "diagnostic", line, code: "invalid_utf8" };
    }
    if (/^[ \t\r]*$/.test(text)) return undefined;
    try {
      const value: unknown = JSON.parse(text);
      return { kind: "record", line, value };
    } catch {
      return { kind: "diagnostic", line, code: "invalid_json" };
    }
  }

  try {
    input = createReadStream(path);
    for await (const chunk of input) {
      const bytes = chunk as Buffer;
      if (maxFileBytes !== undefined && bytes.length > maxFileBytes - totalBytes) throw new JsonlReadError("FILE_TOO_LARGE");
      totalBytes += bytes.length;
      let start = 0;
      while (start < bytes.length) {
        const newline = bytes.indexOf(0x0a, start);
        const end = newline < 0 ? bytes.length : newline;
        append(bytes.subarray(start, end));
        if (newline < 0) break;
        const result = finishLine();
        if (result) yield result;
        line += 1;
        pieces = [];
        length = 0;
        tooLong = false;
        start = newline + 1;
      }
    }
    if (length > 0 || tooLong) {
      const result = finishLine();
      if (result) yield result;
    }
  } catch (error: unknown) {
    if (error instanceof JsonlReadError) throw error;
    const rawCode = (error as NodeJS.ErrnoException)?.code;
    const code = typeof rawCode === "string" && /^E[A-Z0-9]+$/.test(rawCode)
      ? rawCode
      : "READ_FAILED";
    throw new JsonlReadError(code);
  } finally {
    input?.destroy();
  }
}
