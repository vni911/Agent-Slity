import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { CodexReadTransport, ReadTransportError } from "../adapters/codex-read-transport.js";
import { collectCodexThreadPagesV0166 } from "./thread-page-collector.js";
import type { ThreadPageCollection } from "./thread-page-collector.js";
import { collectCodexTurnPagesV0166 } from "./turn-page-collector.js";
import type { TurnPageCollection } from "./turn-page-collector.js";

export interface ChildThreadCollectionResult {
  collection: ThreadPageCollection | null;
  initialization_error: "cancelled" | "timeout" | "server_error" | "invalid_input" | "transport_error" | null;
  cleanup_status: "exit_observed" | "unknown";
}
export interface ChildTurnCollectionResult {
  collection: TurnPageCollection | null;
  initialization_error: ChildThreadCollectionResult["initialization_error"];
  cleanup_status: ChildThreadCollectionResult["cleanup_status"];
}

type CollectionOptions = { maxPages?: number; signal?: AbortSignal };

/** 호출자가 생성한 자식과 파이프의 소유권을 넘겨받으며, 종료 시 자식 종료를 시도한다. */
export async function collectFromChildV0166(child: ChildProcessWithoutNullStreams, threadId: string, sourceId: string,
  options: CollectionOptions = {}): Promise<ChildThreadCollectionResult> {
  return collectOwnedChild(child, threadId, sourceId, options, collectCodexThreadPagesV0166);
}

/** 호출자가 생성한 자식에서 full turn 페이지를 수집하고 직접 자식의 종료를 관찰한다. */
export async function collectTurnsFromChildV0166(child: ChildProcessWithoutNullStreams, threadId: string, sourceId: string,
  options: CollectionOptions = {}): Promise<ChildTurnCollectionResult> {
  return collectOwnedChild(child, threadId, sourceId, options, collectCodexTurnPagesV0166);
}

async function collectOwnedChild<T>(child: ChildProcessWithoutNullStreams, threadId: string, sourceId: string,
  options: CollectionOptions, collect: (transport: CodexReadTransport, threadId: string, sourceId: string,
    options: CollectionOptions) => Promise<T>): Promise<{ collection: T | null;
      initialization_error: ChildThreadCollectionResult["initialization_error"];
      cleanup_status: ChildThreadCollectionResult["cleanup_status"] }> {
  let exited = child.exitCode !== null || child.signalCode !== null;
  let closed = false;
  const alreadyClosed = exited && child.stdin.closed && child.stdout.closed && child.stderr.closed;
  let finishExit!: () => void;
  const exitPromise = new Promise<void>((resolve) => { finishExit = resolve; });
  const onExit = (): void => { exited = true; finishExit(); };
  if (!exited) child.once("exit", onExit);
  const transport = new CodexReadTransport(child.stdout, child.stdin);
  const onChildError = (): void => { transport.close(); };
  const onChildClose = (): void => { closed = true; finishExit(); child.removeListener("error", onChildError); };
  const onStderrError = (): void => {};
  child.on("error", onChildError);
  child.once("close", onChildClose);
  child.stderr.on("error", onStderrError);
  child.stderr.resume();
  const result: { collection: T | null; initialization_error: ChildThreadCollectionResult["initialization_error"];
    cleanup_status: ChildThreadCollectionResult["cleanup_status"] } = { collection: null, initialization_error: null, cleanup_status: "unknown" };
  try {
    const maxPages = options.maxPages ?? 10;
    if (typeof threadId !== "string" || !threadId.trim() || threadId.length > 65536 ||
        typeof sourceId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(sourceId) ||
        !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20) {
      result.initialization_error = "invalid_input";
    } else {
      await transport.initialize(options.signal);
      result.collection = await collect(transport, threadId, sourceId, options);
    }
  } catch (error: unknown) {
    if (error instanceof ReadTransportError && (error.code === "cancelled" || error.code === "timeout" || error.code === "server_error")) {
      result.initialization_error = error.code;
    } else result.initialization_error = "transport_error";
  } finally {
    transport.close();
    child.stderr.destroy();
    if (!exited && !closed) {
      try { child.kill(); } catch { /* 종료를 확인할 수 없으면 unknown으로 남긴다. */ }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([exitPromise, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000); })]);
      if (timer) clearTimeout(timer);
    }
    result.cleanup_status = exited ? "exit_observed" : "unknown";
    child.removeListener("exit", onExit);
    if (child.stderr.closed) child.stderr.removeListener("error", onStderrError);
    else child.stderr.once("close", () => child.stderr.removeListener("error", onStderrError));
    if (closed || alreadyClosed) {
      child.removeListener("error", onChildError);
      child.removeListener("close", onChildClose);
    }
  }
  return result;
}
