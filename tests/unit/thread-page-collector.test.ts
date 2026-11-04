import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { CodexReadTransport, ReadTransportError, collectCodexThreadPagesV0166 } from "../../src/index.js";
import type { ThreadReadClient } from "../../src/index.js";

function syntheticServer(pages: unknown[]) {
  const input = new PassThrough();
  const requests: { id?: number; method: string; params?: Record<string, unknown> }[] = [];
  let index = 0;
  const output = new Writable({ write(chunk: Buffer, _encoding, callback) {
    const message = JSON.parse(chunk.toString("utf8")) as { id?: number; method: string; params?: Record<string, unknown> };
    requests.push(message);
    if (message.method === "initialize") input.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
    if (message.method === "thread/read") input.write(`${JSON.stringify({ id: message.id, result: { thread: { id: "child", parentThreadId: "parent", cwd: "PRIVATE_PATH" } } })}\n`);
    if (message.method === "thread/items/list") input.write(`${JSON.stringify({ id: message.id, result: pages[index++] })}\n`);
    callback();
  } });
  return { transport: new CodexReadTransport(input, output), requests };
}

function page(nextCursor: unknown) {
  return { data: [{ turnId: "turn", item: { id: "item", type: "collabAgentToolCall", senderThreadId: "parent",
    receiverThreadIds: ["child"], tool: "spawnAgent", status: "completed", prompt: "PRIVATE_PROMPT" } },
  { item: { type: "future", text: "PRIVATE_MESSAGE" } }], nextCursor };
}

describe("단일 스레드 페이지 수집", () => {
  it("합성 스트림에서 여러 페이지와 중복을 정규화하고 커서·원문은 남기지 않는다", async () => {
    const server = syntheticServer([page("PRIVATE_CURSOR"), page(null)]);
    try {
      await server.transport.initialize();
      const result = await collectCodexThreadPagesV0166(server.transport, "child", "sample");
      expect(result).toMatchObject({ status: "last_page", reason: "last_page", verification_status: "unverified",
        thread: { kind: "thread", thread_id: "child", parent_thread_id: "parent" } });
      expect(result.pages).toHaveLength(2);
      expect(result.pages[0]).toMatchObject({ kind: "page", next_page: "available", items: [{ kind: "collab", item_id: "item" }, { kind: "unsupported" }] });
      expect(result.pages[1]).toMatchObject({ kind: "page", next_page: "none" });
      expect(server.requests.map((entry) => entry.method)).toEqual(["initialize", "initialized", "thread/read", "thread/items/list", "thread/items/list"]);
      expect(server.requests[4]?.params?.cursor).toBe("PRIVATE_CURSOR");
      expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    } finally { server.transport.close(); }
  });

  it("반복 커서와 페이지 한도를 미완료로 남긴다", async () => {
    const repeated = syntheticServer([page("PRIVATE_CURSOR"), page("PRIVATE_CURSOR")]);
    try {
      await repeated.transport.initialize();
      const result = await collectCodexThreadPagesV0166(repeated.transport, "child", "sample");
      expect(result).toMatchObject({ status: "partial", reason: "cursor_repeated" });
      expect(result.pages).toHaveLength(2);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_CURSOR");
    } finally { repeated.transport.close(); }
    const limited = syntheticServer([page("PRIVATE_CURSOR")]);
    try {
      await limited.transport.initialize();
      expect(await collectCodexThreadPagesV0166(limited.transport, "child", "sample", { maxPages: 1 }))
        .toMatchObject({ status: "partial", reason: "page_limit" });
    } finally { limited.transport.close(); }
  });

  it("누락·잘못된 커서와 미지원 페이지를 구분한다", async () => {
    for (const [input, reason] of [[{ data: [] }, "cursor_unknown"], [page(""), "cursor_invalid"], [page(42), "cursor_invalid"], [{ data: "bad" }, "invalid_page"]] as const) {
      const server = syntheticServer([input]);
      try {
        await server.transport.initialize();
        const result = await collectCodexThreadPagesV0166(server.transport, "child", "sample");
        expect(result).toMatchObject({ status: "partial", reason });
        expect(result.pages).toHaveLength(1);
      } finally { server.transport.close(); }
    }
  });

  it("스레드 ID 불일치와 오류는 후속 페이지를 요청하지 않고 원문을 숨긴다", async () => {
    let calls = 0;
    const mismatch: ThreadReadClient = { async readThread() { return { thread: { id: "other" } }; },
      async listItems() { calls++; return {}; } };
    expect(await collectCodexThreadPagesV0166(mismatch, "child", "sample")).toMatchObject({ status: "partial", reason: "thread_mismatch" });
    expect(calls).toBe(0);
    const failure: ThreadReadClient = { async readThread() { throw new Error("PRIVATE_ERROR"); }, async listItems() { return {}; } };
    const result = await collectCodexThreadPagesV0166(failure, "child", "sample");
    expect(result).toMatchObject({ status: "partial", reason: "transport_error" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_ERROR");
  });

  it("페이지 실패·취소 시 이미 수집한 결과를 보존한다", async () => {
    for (const reason of ["timeout", "server_error", "cancelled"] as const) {
      let calls = 0;
      const client: ThreadReadClient = { async readThread() { return { thread: { id: "child" } }; },
        async listItems() { if (calls++ === 0) return page("PRIVATE_CURSOR"); throw new ReadTransportError(reason); } };
      const result = await collectCodexThreadPagesV0166(client, "child", "sample");
      expect(result).toMatchObject({ status: "partial", reason });
      expect(result.pages).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    }
  });

  it("입력 옵션은 호출 전에 검증한다", async () => {
    let calls = 0;
    const client: ThreadReadClient = { async readThread() { calls++; return {}; }, async listItems() { return {}; } };
    await expect(collectCodexThreadPagesV0166(client, "child", "PRIVATE/ALIAS")).rejects.toThrow(TypeError);
    await expect(collectCodexThreadPagesV0166(client, "child", "sample", { maxPages: 21 })).rejects.toThrow(RangeError);
    const controller = new AbortController(); controller.abort();
    expect(await collectCodexThreadPagesV0166(client, "child", "sample", { signal: controller.signal })).toMatchObject({ status: "partial", reason: "cancelled" });
    expect(calls).toBe(0);
  });

  it("커서 속성을 한 번만 읽어 페이지 상태와 종료 사유를 일치시킨다", async () => {
    let reads = 0;
    const changing = new Proxy({ data: [] }, { getOwnPropertyDescriptor(target, property) {
      if (property === "nextCursor") return { configurable: true, enumerable: true, value: reads++ === 0 ? null : "PRIVATE_CURSOR" };
      return Reflect.getOwnPropertyDescriptor(target, property);
    } });
    const client: ThreadReadClient = { async readThread() { return { thread: { id: "child" } }; }, async listItems() { return changing; } };
    const result = await collectCodexThreadPagesV0166(client, "child", "sample");
    expect(result).toMatchObject({ status: "last_page", reason: "last_page", pages: [{ next_page: "none" }] });
    expect(reads).toBe(1);
  });

  it("클라이언트가 취소에 응답하지 않아도 이미 수집한 페이지와 취소 사유를 반환한다", async () => {
    const controller = new AbortController();
    let secondRequested!: () => void;
    const started = new Promise<void>((resolve) => { secondRequested = resolve; });
    let calls = 0;
    const client: ThreadReadClient = { async readThread() { return { thread: { id: "child" } }; },
      listItems() { if (calls++ === 0) return Promise.resolve(page("PRIVATE_CURSOR")); secondRequested(); return new Promise(() => {}); } };
    const pending = collectCodexThreadPagesV0166(client, "child", "sample", { signal: controller.signal });
    await started;
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ status: "partial", reason: "cancelled" });
    expect(result.pages).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });
});
