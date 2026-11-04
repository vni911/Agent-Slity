import type { Readable, Writable } from "node:stream";

export type ReadTransportErrorCode = "state" | "closed" | "transport" | "protocol" | "limit" | "timeout" | "cancelled" | "server_error";
export class ReadTransportError extends Error {
  constructor(readonly code: ReadTransportErrorCode) {
    super(`읽기 전송 오류: ${code}`);
    this.name = "ReadTransportError";
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: ReadTransportError) => void;
  timer: ReturnType<typeof setTimeout>; signal?: AbortSignal; abort?: () => void;
  written: boolean; responded: boolean; result?: unknown; serverError: boolean };

/** 호출자가 제공한 스트림을 사용하고 종료 시 파괴한다. close 이벤트를 내보내는 스트림이 필요하다. */
export class CodexReadTransport {
  private state: "new" | "initializing" | "ready" | "closed" = "new";
  private closedCode: ReadTransportErrorCode = "closed";
  private initializationFailure?: (code: ReadTransportErrorCode) => void;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly maxLineBytes = 1024 * 1024;
  private partial: Buffer = Buffer.alloc(this.maxLineBytes);
  private partialLength = 0;
  private readonly maxPending = 8;
  private readonly timeoutMs = 10000;

  constructor(private readonly input: Readable, private readonly output: Writable) {
    input.on("data", this.onData);
    input.on("end", this.onEnd);
    input.on("error", this.onError);
    input.on("close", this.onEnd);
    output.on("error", this.onError);
    output.on("close", this.onEnd);
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.state !== "new") throw new ReadTransportError("state");
    this.state = "initializing";
    try {
      await this.#send("initialize", { clientInfo: { name: "agent_slity", title: "Agent Slity", version: "0.0.0" } }, signal);
    } catch (error) { this.fail("closed"); throw error; }
    if (this.state !== "initializing") throw new ReadTransportError("closed");
    await this.#writeInitialized(signal);
    if (this.state !== "initializing") throw new ReadTransportError("transport");
    this.state = "ready";
  }

  readThread(threadId: string, signal?: AbortSignal): Promise<unknown> {
    this.requireReady(threadId);
    return this.#send("thread/read", { threadId, includeTurns: false }, signal);
  }

  listItems(threadId: string, cursor?: string, signal?: AbortSignal): Promise<unknown> {
    this.requireReady(threadId);
    if (cursor !== undefined && (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 65536)) throw new ReadTransportError("limit");
    return this.#send("thread/items/list", cursor === undefined ? { threadId, limit: 100 } : { threadId, limit: 100, cursor }, signal);
  }

  close(): void { this.fail("closed"); }

  private requireReady(threadId: string): void {
    if (this.state !== "ready") throw new ReadTransportError("state");
    if (typeof threadId !== "string" || threadId.trim().length === 0 || threadId.length > 65536) throw new ReadTransportError("limit");
  }

  #send(method: "initialize" | "thread/read" | "thread/items/list", params: object, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) { this.fail("cancelled"); return Promise.reject(new ReadTransportError("cancelled")); }
    if (this.pending.size >= this.maxPending || this.nextId > Number.MAX_SAFE_INTEGER) return Promise.reject(new ReadTransportError("limit"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail("timeout"), this.timeoutMs);
      const entry: Pending = { resolve, reject, timer, written: false, responded: false, serverError: false };
      if (signal) {
        const abort = () => this.fail("cancelled");
        entry.signal = signal;
        entry.abort = abort;
        signal.addEventListener("abort", abort, { once: true });
      }
      this.pending.set(id, entry);
      void this.#write({ id, method, params }).then(() => {
        entry.written = true;
        this.settle(id, entry);
      }).catch((error: ReadTransportError) => this.fail(error.code));
    });
  }

  #writeInitialized(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (code?: ReadTransportErrorCode): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.initializationFailure = undefined;
        if (code) { this.fail(code); reject(new ReadTransportError(code)); } else resolve();
      };
      const onAbort = () => finish("cancelled");
      const timer = setTimeout(() => finish("timeout"), this.timeoutMs);
      this.initializationFailure = finish;
      signal?.addEventListener("abort", onAbort, { once: true });
      if (this.state === "closed") { finish(this.closedCode); return; }
      if (signal?.aborted) { finish("cancelled"); return; }
      void this.#write({ method: "initialized" }).then(() => finish()).catch((error: ReadTransportError) => finish(error.code));
    });
  }

  #write(message: object): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const line = `${JSON.stringify(message)}\n`;
        if (Buffer.byteLength(line) + this.output.writableLength > this.maxLineBytes || this.output.writableNeedDrain) {
          this.fail("limit"); reject(new ReadTransportError("limit")); return;
        }
        this.output.write(line, (error) => { if (error) { this.fail("transport"); reject(new ReadTransportError("transport")); } else resolve(); });
      } catch { this.fail("transport"); reject(new ReadTransportError("transport")); }
    });
  }

  private readonly onData = (chunk: unknown): void => {
    if (this.state === "closed") return;
    if (!Buffer.isBuffer(chunk)) { this.fail("protocol"); return; }
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const piece = chunk.subarray(offset, end);
      if (this.partialLength + piece.length > this.maxLineBytes) { this.fail("limit"); return; }
      piece.copy(this.partial, this.partialLength);
      this.partialLength += piece.length;
      if (newline < 0) return;
      const line = this.partial.subarray(0, this.partialLength);
      this.partialLength = 0;
      this.handleLine(line);
      if (this.partial.length === 0) return;
      offset = newline + 1;
    }
  };

  private handleLine(line: Buffer): void {
    let message: unknown;
    try { message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)); }
    catch { this.fail("protocol"); return; }
    if (typeof message !== "object" || message === null || Array.isArray(message)) { this.fail("protocol"); return; }
    const record = message as Record<string, unknown>;
    if (typeof record.method === "string") {
      if (Object.hasOwn(record, "id")) this.fail("protocol");
      return;
    }
    if (typeof record.id !== "number" || !Number.isSafeInteger(record.id)) { this.fail("protocol"); return; }
    const entry = this.pending.get(record.id);
    if (!entry || entry.responded) { this.fail("protocol"); return; }
    const hasResult = Object.hasOwn(record, "result");
    const hasError = Object.hasOwn(record, "error");
    if (hasResult === hasError) { this.fail("protocol"); return; }
    entry.responded = true;
    entry.serverError = hasError;
    entry.result = record.result;
    this.settle(record.id, entry);
  }

  private settle(id: number, entry: Pending): void {
    if (!entry.responded || !entry.written || this.pending.get(id) !== entry) return;
    this.pending.delete(id);
    this.release(entry);
    if (entry.serverError) entry.reject(new ReadTransportError("server_error"));
    else entry.resolve(entry.result);
  }

  private release(entry: Pending): void {
    clearTimeout(entry.timer);
    if (entry.signal && entry.abort) entry.signal.removeEventListener("abort", entry.abort);
  }

  private readonly onEnd = (): void => { this.fail("closed"); };
  private readonly onError = (): void => { this.fail("transport"); };
  private fail(code: ReadTransportErrorCode): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.closedCode = code;
    this.initializationFailure?.(code);
    this.partial = Buffer.alloc(0);
    this.partialLength = 0;
    for (const entry of this.pending.values()) { this.release(entry); entry.reject(new ReadTransportError(code)); }
    this.pending.clear();
    this.input.removeListener("data", this.onData);
    this.input.removeListener("end", this.onEnd);
    this.input.removeListener("close", this.onEnd);
    this.output.removeListener("close", this.onEnd);
    const input = this.input;
    const output = this.output;
    if (input.closed) input.removeListener("error", this.onError);
    else input.once("close", () => input.removeListener("error", this.onError));
    if (output.closed) output.removeListener("error", this.onError);
    else output.once("close", () => output.removeListener("error", this.onError));
    this.input.destroy();
    this.output.destroy();
  }
}
