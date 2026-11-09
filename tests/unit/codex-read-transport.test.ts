import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexReadTransport, ReadTransportError } from "../../src/adapters/codex-read-transport.js";

function harness() {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages: Record<string, unknown>[] = [];
  output.on("data", (data: Buffer) => messages.push(JSON.parse(data.toString("utf8")) as Record<string, unknown>));
  const transport = new CodexReadTransport(input, output);
  async function ready() {
    const initializing = transport.initialize();
    expect(messages[0]).toMatchObject({ id: 1, method: "initialize", params: { clientInfo: { name: "agent_slity" } } });
    input.write('{"id":1,"result":{}}\n');
    await initializing;
    expect(messages[1]).toEqual({ method: "initialized" });
  }
  return { input, output, messages, transport, ready };
}

afterEach(() => vi.useRealTimers());

describe("읽기 전용 프로토콜 전송", () => {
  it("turn 목록은 full과 오름차순을 명시하고 잘못된 커서를 전송 전에 거부한다", async () => {
    const h = harness(); await h.ready();
    expect(() => h.transport.listTurns("x", "")).toThrowError(ReadTransportError);
    const pending = h.transport.listTurns("x", "opaque");
    expect(h.messages[2]).toEqual({ id: 2, method: "thread/turns/list", params: {
      threadId: "x", limit: 100, itemsView: "full", sortDirection: "asc", cursor: "opaque" } });
    h.input.write('{"id":2,"result":{"data":[],"nextCursor":null}}\n');
    await expect(pending).resolves.toEqual({ data: [], nextCursor: null });
    h.transport.close();
  });
  it("초기화 이후 읽기 요청을 보내고 분할된 역순 응답을 ID로 연결한다", async () => {
    const h = harness();
    await h.ready();
    const first = h.transport.readThread("synthetic-thread");
    const second = h.transport.listItems("synthetic-thread", "synthetic-cursor");
    expect(h.messages.slice(2)).toEqual([
      { id: 2, method: "thread/read", params: { threadId: "synthetic-thread", includeTurns: false } },
      { id: 3, method: "thread/items/list", params: { threadId: "synthetic-thread", limit: 100, cursor: "synthetic-cursor" } },
    ]);
    h.input.write('{"method":"ignored/notification","params":{"text":"PRIVATE"}}\n{"id":3,"res');
    h.input.write('ult":{"data":[]}}\n{"id":2,"result":{"thread":{"id":"synthetic-thread"}}}\n');
    expect(await first).toEqual({ thread: { id: "synthetic-thread" } });
    expect(await second).toEqual({ data: [] });
    h.transport.close();
  });

  it("초기화 전 요청과 반복 초기화를 거부한다", async () => {
    const h = harness();
    expect(() => h.transport.readThread("x")).toThrowError(ReadTransportError);
    await h.ready();
    await expect(h.transport.initialize()).rejects.toMatchObject({ code: "state" });
    expect(() => h.transport.readThread("")).toThrowError(ReadTransportError);
    expect(h.messages.map((m) => m.method)).toEqual(["initialize", "initialized"]);
    h.transport.close();
  });

  it("서버 오류를 원문 없이 반환하고 다른 요청은 계속 처리한다", async () => {
    const h = harness(); await h.ready();
    const failed = h.transport.readThread("x");
    const ok = h.transport.readThread("y");
    h.input.write('{"id":2,"error":{"message":"PRIVATE_SERVER"}}\n{"id":3,"result":{}}\n');
    await expect(failed).rejects.toMatchObject({ code: "server_error", message: "읽기 전송 오류: server_error" });
    await expect(ok).resolves.toEqual({});
    h.transport.close();
  });

  it("역방향 요청, 알 수 없는 ID와 손상된 입력을 안전하게 종료한다", async () => {
    for (const frame of ['{"id":99,"method":"turn/start","params":{"secret":"PRIVATE"}}\n',
      '{"id":999,"result":{}}\n', '{"id":2,"result":{},"error":{}}\n', '{PRIVATE\n']) {
      const h = harness(); await h.ready();
      const response = h.transport.readThread("x");
      h.input.write(frame);
      await expect(response).rejects.toMatchObject({ code: "protocol", message: "읽기 전송 오류: protocol" });
      expect(h.messages.map((m) => m.method)).toEqual(["initialize", "initialized", "thread/read"]);
    }
  });

  it("잘못된 UTF-8과 너무 긴 줄을 거부한다", async () => {
    for (const [bytes, code] of [[Buffer.from([0xff, 0x0a]), "protocol"], [Buffer.alloc(1024 * 1024 + 1, 65), "limit"]] as const) {
      const h = harness(); await h.ready();
      const response = h.transport.readThread("x");
      h.input.write(bytes);
      await expect(response).rejects.toMatchObject({ code });
    }
  });

  it("시간 초과·취소·연결 종료 시 대기 요청을 정리한다", async () => {
    vi.useFakeTimers();
    const timeout = harness(); await timeout.ready();
    const first = timeout.transport.readThread("x");
    const firstAssertion = expect(first).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10000);
    await firstAssertion;
    const cancelled = harness(); await cancelled.ready();
    const controller = new AbortController();
    const second = cancelled.transport.readThread("x", controller.signal);
    controller.abort();
    await expect(second).rejects.toMatchObject({ code: "cancelled" });
    const ended = harness(); await ended.ready();
    const third = ended.transport.readThread("x");
    ended.input.end();
    await expect(third).rejects.toMatchObject({ code: "closed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("동시 요청 한도와 초기화 실패를 처리한다", async () => {
    const h = harness(); await h.ready();
    const requests = Array.from({ length: 8 }, () => h.transport.readThread("x"));
    const checks = requests.map((request) => expect(request).rejects.toMatchObject({ code: "closed" }));
    await expect(h.transport.readThread("x")).rejects.toMatchObject({ code: "limit" });
    h.transport.close();
    await Promise.all(checks);
    const init = harness();
    const promise = init.transport.initialize();
    init.input.write('{"id":1,"error":{"message":"PRIVATE"}}\n');
    await expect(promise).rejects.toMatchObject({ code: "server_error" });
    expect(init.input.destroyed).toBe(true);
    expect(init.output.destroyed).toBe(true);
  });

  it("초기화 알림 쓰기 실패를 성공으로 보고하지 않는다", async () => {
    const input = new PassThrough();
    const output = new Writable({ write(chunk: Buffer, _encoding, callback) {
      const message = JSON.parse(chunk.toString("utf8")) as { id?: number; method: string };
      if (message.method === "initialize") { input.write('{"id":1,"result":{}}\n'); callback(); }
      else setTimeout(() => callback(new Error("PRIVATE_WRITE_ERROR")), 5);
    } });
    const transport = new CodexReadTransport(input, output);
    await expect(transport.initialize()).rejects.toMatchObject({ code: "transport", message: "읽기 전송 오류: transport" });
    expect(input.destroyed).toBe(true);
  });

  it("쓰기 완료 전 도착한 응답을 성공 처리하지 않는다", async () => {
    const input = new PassThrough();
    const output = new Writable({ write(chunk: Buffer, _encoding, callback) {
      const message = JSON.parse(chunk.toString("utf8")) as { id?: number; method: string };
      if (message.method === "initialize") { input.write('{"id":1,"result":{}}\n'); callback(); }
      else if (message.method === "initialized") callback();
      else { input.write(`{"id":${message.id},"result":{}}\n`); callback(new Error("PRIVATE_WRITE_ERROR")); }
    } });
    const transport = new CodexReadTransport(input, output);
    await transport.initialize();
    await expect(transport.readThread("x")).rejects.toMatchObject({ code: "transport" });
  });

  it("초기화 알림이 완료되지 않으면 시간 초과로 종료한다", async () => {
    vi.useFakeTimers();
    const input = new PassThrough();
    const output = new Writable({ write(chunk: Buffer, _encoding, callback) {
      const message = JSON.parse(chunk.toString("utf8")) as { method: string };
      if (message.method === "initialize") { input.write('{"id":1,"result":{}}\n'); callback(); }
    } });
    const transport = new CodexReadTransport(input, output);
    const assertion = expect(transport.initialize()).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10001);
    await assertion;
    expect(input.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("출력 버퍼가 막히면 추가 요청을 중단한다", async () => {
    const input = new PassThrough();
    const output = new Writable({ highWaterMark: 1, write(chunk: Buffer, _encoding, callback) {
      const message = JSON.parse(chunk.toString("utf8")) as { method: string };
      if (message.method === "initialize") { input.write('{"id":1,"result":{}}\n'); callback(); }
      else if (message.method === "initialized") callback();
    } });
    const transport = new CodexReadTransport(input, output);
    await transport.initialize();
    const first = transport.readThread("x");
    const assertion = expect(first).rejects.toMatchObject({ code: "limit" });
    await expect(transport.readThread("y")).rejects.toMatchObject({ code: "limit" });
    await assertion;
  });

  it("큰 highWaterMark에서도 자체 출력 버퍼 상한을 적용한다", async () => {
    const input = new PassThrough();
    const output = new Writable({ highWaterMark: 4 * 1024 * 1024, write(chunk: Buffer, _encoding, callback) {
      if (chunk.length > 1024) return;
      const message = JSON.parse(chunk.toString("utf8")) as { method: string };
      if (message.method === "initialize") { input.write('{"id":1,"result":{}}\n'); callback(); }
      else callback();
    } });
    const transport = new CodexReadTransport(input, output);
    await transport.initialize();
    output.write(Buffer.alloc(1024 * 1024));
    expect(output.writableNeedDrain).toBe(false);
    await expect(transport.readThread("x")).rejects.toMatchObject({ code: "limit" });
  });

  it("종료 후 기본 스트림에 전송 리스너를 남기지 않는다", async () => {
    const h = harness(); await h.ready();
    h.transport.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.input.listenerCount("data")).toBe(0);
    expect(h.input.listenerCount("error")).toBe(0);
    expect(h.output.listenerCount("error")).toBe(0);
  });
});
