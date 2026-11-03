import { describe, expect, it } from "vitest";
import { normalizeCodexThreadReadV0166 } from "../../src/index.js";
import type { ThreadReadResult } from "../../src/index.js";

describe("thread/read 식별자 정규화", () => {
  it("서로 다른 명시적 관계를 구분하고 불필요한 원문을 제외한다", () => {
    const input = { thread: { id: "child", parentThreadId: "parent", sessionId: "session", forkedFromId: "fork",
      cwd: "PRIVATE_PATH", turns: [{ text: "PRIVATE_MESSAGE" }] } };
    expect(normalizeCodexThreadReadV0166(input, "sample_1")).toEqual({
      kind: "thread", source: { format: "codex_app_server_thread_read", schema_reference: "0.166.0", source_id: "sample_1" },
      verification_status: "unverified", thread_id: "child", parent_thread_id: "parent", parent_thread_id_status: "present", session_id: "session", forked_from_id: "fork",
    });
    expect(input.thread.turns[0].text).toBe("PRIVATE_MESSAGE");
  });

  it("누락되거나 유효하지 않은 선택 ID를 추정하지 않는다", () => {
    for (const thread of [{ id: "child", forkedFromId: "fork" }, { id: "child", parentThreadId: " ", sessionId: 12 }]) {
      const result = normalizeCodexThreadReadV0166({ thread });
      if (result.kind !== "thread") throw new Error("스레드가 아닙니다.");
      expect(result.parent_thread_id).toBeNull();
      expect(result.parent_thread_id_status).toBe("unknown");
      expect(result.session_id).toBeNull();
      expect(result.forked_from_id).toBe("forkedFromId" in thread ? "fork" : null);
      expect(result.source.source_id).toBeNull();
    }
  });

  it("필수 ID가 없거나 잘못된 입력은 원문 없는 미지원 결과로 반환한다", () => {
    for (const input of [null, [], {}, { thread: [] }, { thread: { id: " " } }, { thread: { id: 10, text: "PRIVATE" } }]) {
      expect(normalizeCodexThreadReadV0166(input)).toEqual({
        kind: "unsupported", source: { format: "codex_app_server_thread_read", schema_reference: "0.166.0", source_id: null }, reason: "invalid_thread",
      });
    }
  });

  it("getter와 해제된 프록시의 오류를 노출하거나 getter를 실행하지 않는다", () => {
    let called = false;
    const thread = { id: "child" };
    Object.defineProperty(thread, "parentThreadId", { get() { called = true; throw new Error("PRIVATE"); } });
    const result = normalizeCodexThreadReadV0166({ thread });
    expect(result.kind === "thread" && result.parent_thread_id).toBeNull();
    expect(result.kind === "thread" && result.parent_thread_id_status).toBe("unknown");
    expect(called).toBe(false);
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(normalizeCodexThreadReadV0166(proxy).kind).toBe("unsupported");
  });

  it("명시적 null을 누락과 구분하되 루트 스레드로 단정하지 않는다", () => {
    const explicit = normalizeCodexThreadReadV0166({ thread: { id: "thread", parentThreadId: null } });
    expect(explicit).toMatchObject({ kind: "thread", parent_thread_id: null, parent_thread_id_status: "explicit_null", verification_status: "unverified" });
    for (const value of [undefined, "", " ", 0, false, {}]) {
      const result = normalizeCodexThreadReadV0166({ thread: { id: "thread", parentThreadId: value } });
      expect(result).toMatchObject({ kind: "thread", parent_thread_id: null, parent_thread_id_status: "unknown" });
    }
    expect(normalizeCodexThreadReadV0166({ thread: { id: "thread" } })).toMatchObject({ parent_thread_id_status: "unknown" });
  });

  it("상태 필드가 없는 이전 TypeScript 결과도 허용한다", () => {
    const legacy: ThreadReadResult = { kind: "thread", source: { format: "codex_app_server_thread_read", schema_reference: "0.166.0", source_id: null },
      verification_status: "unverified", thread_id: "legacy", parent_thread_id: null, session_id: null, forked_from_id: null };
    expect(legacy.parent_thread_id_status).toBeUndefined();
  });

  it("잘못된 출처 별칭은 원문 없이 거부한다", () => {
    for (const alias of ["", "a/b", "한글", "x".repeat(65)]) {
      expect(() => normalizeCodexThreadReadV0166({}, alias)).toThrowError(/^출처 별칭은 영문자, 숫자, 밑줄, 하이픈 1~64자여야 합니다\.$/);
    }
    expect(normalizeCodexThreadReadV0166({}, "x".repeat(64)).source.source_id).toHaveLength(64);
  });
});
