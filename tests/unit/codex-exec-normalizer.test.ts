import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeCodexExecLine, readJsonlFile } from "../../src/index.js";
import type { JsonlReadResult } from "../../src/index.js";

function record(value: unknown, line = 1): JsonlReadResult {
  return { kind: "record", line, value };
}

describe("Codex exec JSONL 이벤트 정규화", () => {
  it("직접 제공된 스레드 ID와 출처를 보존하고 다른 식별자는 추정하지 않는다", () => {
    const result = normalizeCodexExecLine(record({ type: "thread.started", thread_id: "synthetic-thread" }, 3));
    expect(result).toEqual({
      kind: "event",
      event: {
        run_id: null,
        task_id: null,
        thread_id: "synthetic-thread",
        parent_thread_id: null,
        agent_id: null,
        event_id: null,
        event_type: "thread.started",
        timestamp: null,
        source: { format: "codex_exec_jsonl", line: 3, source_id: null, format_version: null, collected_at: null },
        verification_status: "unverified",
        payload: { usage: { input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_output_tokens: null } },
      },
    });
  });

  it("0은 보존하고 누락·음수·문자열·소수·안전 범위 밖의 사용량은 미확인으로 둔다", () => {
    const result = normalizeCodexExecLine(record({
      type: "turn.completed",
      usage: { input_tokens: 0, cached_input_tokens: -1, output_tokens: "42", reasoning_output_tokens: 1.5 },
    }));
    expect(result.kind).toBe("event");
    if (result.kind !== "event") throw new Error("이벤트가 아닙니다.");
    expect(result.event.payload.usage).toEqual({
      input_tokens: 0, cached_input_tokens: null, output_tokens: null, reasoning_output_tokens: null,
    });

    const unsafe = normalizeCodexExecLine(record({ type: "turn.completed", usage: { input_tokens: Number.MAX_SAFE_INTEGER + 1 } }));
    expect(unsafe.kind === "event" && unsafe.event.payload.usage.input_tokens).toBeNull();
  });

  it("완료 이벤트에서 직접 제공된 사용량을 집계 없이 그대로 보존한다", () => {
    const result = normalizeCodexExecLine(record({
      type: "turn.completed",
      usage: { input_tokens: 120, cached_input_tokens: 80, output_tokens: 42, reasoning_output_tokens: 12 },
    }, 7));
    expect(result.kind).toBe("event");
    if (result.kind !== "event") throw new Error("이벤트가 아닙니다.");
    expect(result.event.payload.usage).toEqual({
      input_tokens: 120, cached_input_tokens: 80, output_tokens: 42, reasoning_output_tokens: 12,
    });
    expect(result.event.source.line).toBe(7);
    expect(result.event.verification_status).toBe("unverified");
  });

  it("완료 이벤트가 아닌 입력의 사용량을 추정하지 않는다", () => {
    const result = normalizeCodexExecLine(record({ type: "turn.failed", usage: { input_tokens: 55 } }));
    expect(result.kind).toBe("event");
    if (result.kind !== "event") throw new Error("이벤트가 아닙니다.");
    expect(result.event.event_type).toBe("turn.failed");
    expect(result.event.payload.usage.input_tokens).toBeNull();
    expect(result.event.verification_status).toBe("unverified");
  });

  it("부모 스레드나 이벤트 ID를 이름·item ID에서 추측하지 않는다", () => {
    const result = normalizeCodexExecLine(record({
      type: "item.completed", thread_id: " ", name: "parent", item: { id: "item-1" },
    }));
    expect(result.kind).toBe("event");
    if (result.kind !== "event") throw new Error("이벤트가 아닙니다.");
    expect(result.event.thread_id).toBeNull();
    expect(result.event.parent_thread_id).toBeNull();
    expect(result.event.event_id).toBeNull();
  });

  it("메시지·명령·임의 payload를 결과에 복사하지 않는다", () => {
    const result = normalizeCodexExecLine(record({
      type: "item.completed", item: { id: "item-1", text: "PRIVATE_SYNTHETIC_MESSAGE", command: "PRIVATE_SYNTHETIC_COMMAND" },
      extra: "PRIVATE_SYNTHETIC_EXTRA",
    }));
    expect(result.kind).toBe("event");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("PRIVATE_SYNTHETIC_MESSAGE");
    expect(serialized).not.toContain("PRIVATE_SYNTHETIC_COMMAND");
    expect(serialized).not.toContain("PRIVATE_SYNTHETIC_EXTRA");
    expect(serialized).not.toContain("item-1");
  });

  it("객체가 아닌 값과 알 수 없는 이벤트를 줄 번호가 있는 미지원 결과로 남긴다", () => {
    expect(normalizeCodexExecLine(record(null, 1))).toEqual({
      kind: "unsupported", source: { format: "codex_exec_jsonl", line: 1, source_id: null, format_version: null, collected_at: null }, reason: "invalid_record",
    });
    expect(normalizeCodexExecLine(record(["item"], 2))).toEqual({
      kind: "unsupported", source: { format: "codex_exec_jsonl", line: 2, source_id: null, format_version: null, collected_at: null }, reason: "invalid_record",
    });
    expect(normalizeCodexExecLine(record({ type: "future.event", text: "PRIVATE_SYNTHETIC" }, 4))).toEqual({
      kind: "unsupported", source: { format: "codex_exec_jsonl", line: 4, source_id: null, format_version: null, collected_at: null }, reason: "unsupported_event_type",
    });
  });

  it("직접 전달된 getter를 실행하지 않고 해당 필드를 미확인으로 둔다", () => {
    const value = { type: "turn.completed", usage: {} };
    Object.defineProperty(value.usage, "input_tokens", {
      get() { throw new Error("PRIVATE_SYNTHETIC_GETTER"); },
      enumerable: true,
    });
    const result = normalizeCodexExecLine(record(value));
    expect(result.kind).toBe("event");
    if (result.kind !== "event") throw new Error("이벤트가 아닙니다.");
    expect(result.event.payload.usage.input_tokens).toBeNull();
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SYNTHETIC_GETTER");
  });

  it("해제된 프록시를 원문 오류 없이 미지원 값으로 처리한다", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(normalizeCodexExecLine(record(proxy))).toEqual({
      kind: "unsupported", source: { format: "codex_exec_jsonl", line: 1, source_id: null, format_version: null, collected_at: null }, reason: "invalid_record",
    });
  });

  it("리더 진단을 출처와 코드만 보존해 전달한다", () => {
    expect(normalizeCodexExecLine({ kind: "diagnostic", line: 8, code: "invalid_utf8" })).toEqual({
      kind: "diagnostic", source: { format: "codex_exec_jsonl", line: 8, source_id: null, format_version: null, collected_at: null }, code: "invalid_utf8",
    });
  });

  it("JSONL 리더와 연결할 때 중복·오류·미지의 레코드를 순서대로 남긴다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-slity-normalizer-"));
    const path = join(dir, "synthetic.jsonl");
    await writeFile(path, '{"type":"turn.started"}\n{"type":"turn.started"}\n{\n{"type":"new.event"}\n');
    try {
      const results = [];
      for await (const entry of readJsonlFile(path)) results.push(normalizeCodexExecLine(entry));
      expect(results.map((result) => result.kind)).toEqual(["event", "event", "diagnostic", "unsupported"]);
      expect(results.map((result) => result.kind === "event" ? result.event.source.line : result.source.line)).toEqual([1, 2, 3, 4]);
    } finally {
      await unlink(path);
      await rmdir(dir);
    }
  });
});
