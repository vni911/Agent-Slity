import { ReadStream } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JsonlReadError, readJsonlFile } from "../../src/index.js";
import type { JsonlReadOptions, JsonlReadResult } from "../../src/index.js";

async function collect(path: string, options?: JsonlReadOptions): Promise<JsonlReadResult[]> {
  const results: JsonlReadResult[] = [];
  for await (const result of readJsonlFile(path, options)) results.push(result);
  return results;
}

async function withFile(content: string | Buffer, run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "agent-slity-jsonl-"));
  const path = join(dir, "synthetic.jsonl");
  await writeFile(path, content);
  try {
    await run(path);
  } finally {
    await unlink(path);
    await rmdir(dir);
  }
}

describe("JSONL 읽기 전용 가져오기", () => {
  it("CRLF, 빈 줄, 중복과 마지막 개행 없는 값을 순서와 줄 번호대로 반환하고 원본을 보존한다", async () => {
    const source = '{"type":"thread.started","thread_id":"합성"}\r\n\r\n{"type":"turn.started"}\r\n{"type":"turn.started"}\r\nnull';
    await withFile(source, async (path) => {
      const before = await readFile(path);
      expect(await collect(path)).toEqual([
        { kind: "record", line: 1, value: { type: "thread.started", thread_id: "합성" } },
        { kind: "record", line: 3, value: { type: "turn.started" } },
        { kind: "record", line: 4, value: { type: "turn.started" } },
        { kind: "record", line: 5, value: null },
      ]);
      expect(await readFile(path)).toEqual(before);
    });
  });

  it("잘못된 JSON의 원문을 진단에 넣지 않고 다음 줄을 계속 읽는다", async () => {
    await withFile('{"private":"숨길내용"\n{"type":"turn.completed"}\n', async (path) => {
      const results = await collect(path);
      expect(results).toEqual([
        { kind: "diagnostic", line: 1, code: "invalid_json" },
        { kind: "record", line: 2, value: { type: "turn.completed" } },
      ]);
      expect(JSON.stringify(results[0])).not.toContain("숨길내용");
    });
  });

  it("손상된 UTF-8을 대체 문자로 해석하지 않고 해당 줄만 진단한다", async () => {
    const source = Buffer.concat([Buffer.from([0xff, 0x0a]), Buffer.from('{"ok":true}\n')]);
    await withFile(source, async (path) => {
      expect(await collect(path)).toEqual([
        { kind: "diagnostic", line: 1, code: "invalid_utf8" },
        { kind: "record", line: 2, value: { ok: true } },
      ]);
    });
  });

  it("줄 앞 BOM은 유효한 JSON으로 바꾸지 않고 진단한다", async () => {
    await withFile('\uFEFF{"type":"thread.started"}\n\uFEFF\n{"ok":true}\n', async (path) => {
      expect(await collect(path)).toEqual([
        { kind: "diagnostic", line: 1, code: "invalid_json" },
        { kind: "diagnostic", line: 2, code: "invalid_json" },
        { kind: "record", line: 3, value: { ok: true } },
      ]);
    });
  });

  it("제한을 넘은 줄을 건너뛰고 다음 줄과 마지막 미완결 개행 줄을 처리한다", async () => {
    await withFile(`${"x".repeat(70_000)}\n1\n1234567`, async (path) => {
      expect(await collect(path, { maxLineBytes: 6 })).toEqual([
        { kind: "diagnostic", line: 1, code: "line_too_long" },
        { kind: "record", line: 2, value: 1 },
        { kind: "diagnostic", line: 3, code: "line_too_long" },
      ]);
    });
  });

  it("청크 경계를 넘는 멀티바이트 UTF-8 값을 보존한다", async () => {
    const value = `a${"한".repeat(30_000)}`;
    await withFile(JSON.stringify({ value }), async (path) => {
      expect(await collect(path, { maxLineBytes: 100_000 })).toEqual([
        { kind: "record", line: 1, value: { value } },
      ]);
    });
  });

  it("빈 파일은 결과가 없고 잘못된 크기 제한은 거부한다", async () => {
    await withFile("", async (path) => {
      expect(await collect(path)).toEqual([]);
      await expect(collect(path, { maxLineBytes: 0 })).rejects.toBeInstanceOf(RangeError);
      await expect(collect(path, { maxLineBytes: Infinity })).rejects.toBeInstanceOf(RangeError);
    });
  });

  it("파일 읽기 오류에서 경로를 공개하지 않는다", async () => {
    const path = join(tmpdir(), `agent-slity-없는파일-${Date.now()}.jsonl`);
    try {
      await collect(path);
      throw new Error("예상한 읽기 오류가 발생하지 않았습니다.");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonlReadError);
      expect((error as JsonlReadError).code).toBe("ENOENT");
      expect((error as Error).message).not.toContain(path);
    }
  });

  it("스트림 생성이 즉시 실패하는 경로도 오류에 노출하지 않는다", async () => {
    const path = "PRIVATE_SYNTHETIC_PATH\0do-not-echo.jsonl";
    try {
      await collect(path);
      throw new Error("예상한 읽기 오류가 발생하지 않았습니다.");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonlReadError);
      expect((error as JsonlReadError).code).toBe("READ_FAILED");
      expect((error as Error).message).not.toContain("PRIVATE_SYNTHETIC_PATH");
    }
  });

  it("중도에 반복을 종료해도 파일 핸들을 해제한다", async () => {
    await withFile('1\n2\n', async (path) => {
      const destroy = vi.spyOn(ReadStream.prototype, "destroy");
      try {
        for await (const result of readJsonlFile(path)) {
          expect(result).toEqual({ kind: "record", line: 1, value: 1 });
          break;
        }
        const stream = destroy.mock.instances.find(
          (instance): instance is ReadStream => instance instanceof ReadStream && instance.path === path,
        );
        expect(stream?.destroyed).toBe(true);
      } finally {
        destroy.mockRestore();
      }
    });
  });
});
