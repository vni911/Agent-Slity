import { describe, expect, it } from "vitest";
import { collectCodexTurnPagesV0166, ReadTransportError } from "../../src/index.js";
import type { TurnReadClient } from "../../src/index.js";
const page = (nextCursor: unknown) => ({ data: [{ id: "turn", itemsView: "full", status: "completed",
  items: [{ type: "userMessage", id: "user", content: [{ text: "PRIVATE_TEXT" }] }] }], nextCursor });
function client(pages: unknown[]) {
  const cursors: (string | undefined)[] = [];
  const api: TurnReadClient = { async readThread() { return { thread: { id: "thread", cwd: "PRIVATE_PATH" } }; },
    async listTurns(_thread, cursor) { cursors.push(cursor); return pages[cursors.length - 1]; } };
  return { api, cursors };
}
describe("turn 페이지 수집", () => {
  it("사전 취소에서는 서버를 조회하지 않는다", async () => {
    let calls = 0;
    const api: TurnReadClient = { async readThread() { calls++; return {}; }, async listTurns() { calls++; return {}; } };
    const controller = new AbortController(); controller.abort();
    expect(await collectCodexTurnPagesV0166(api, "thread", "sample", { signal: controller.signal }))
      .toMatchObject({ status: "partial", reason: "cancelled", pages: [] });
    expect(calls).toBe(0);
  });
  it("여러 페이지와 중복을 보존하고 서버 커서를 그대로 전달한다", async () => {
    const c = client([page("PRIVATE_CURSOR"), page(null)]);
    const result = await collectCodexTurnPagesV0166(c.api, "thread", "sample");
    expect(result).toMatchObject({ status: "last_page", reason: "last_page", verification_status: "unverified" });
    expect(result.pages).toHaveLength(2);
    expect(c.cursors).toEqual([undefined, "PRIVATE_CURSOR"]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });
  it("반복·누락·잘못된 커서와 view를 미완료로 남긴다", async () => {
    for (const [pages, reason] of [[[page("x"), page("x")], "cursor_repeated"],
      [[page(undefined)], "cursor_unknown"], [[page(2)], "cursor_invalid"], [[page("")], "cursor_invalid"],
      [[{ data: [{ id: "t", itemsView: "summary", items: [] }], nextCursor: null }], "invalid_page"]] as const) {
      const c = client([...pages]);
      expect(await collectCodexTurnPagesV0166(c.api, "thread", "sample")).toMatchObject({ status: "partial", reason });
    }
  });
  it("오류와 페이지 한도에서 이미 받은 페이지를 보존한다", async () => {
    const limited = client([page("x")]);
    expect(await collectCodexTurnPagesV0166(limited.api, "thread", "sample", { maxPages: 1 }))
      .toMatchObject({ status: "partial", reason: "page_limit", pages: [{ kind: "page" }] });
    for (const reason of ["server_error", "timeout", "cancelled"] as const) {
      const c = client([]); let calls = 0;
      c.api.listTurns = async () => { if (calls++ === 0) return page("x"); throw new ReadTransportError(reason); };
      const result = await collectCodexTurnPagesV0166(c.api, "thread", "sample");
      expect(result).toMatchObject({ status: "partial", reason });
      expect(result.pages).toHaveLength(1);
    }
  });
  it("입력 검증·ID 불일치·전송 오류에서 후속 요청을 하지 않는다", async () => {
    const c = client([]);
    await expect(collectCodexTurnPagesV0166(c.api, "", "sample")).rejects.toThrow(TypeError);
    await expect(collectCodexTurnPagesV0166(c.api, "thread", "bad/source")).rejects.toThrow(TypeError);
    await expect(collectCodexTurnPagesV0166(c.api, "thread", "sample", { maxPages: 21 })).rejects.toThrow(RangeError);
    expect(await collectCodexTurnPagesV0166(c.api, "other", "sample")).toMatchObject({ reason: "thread_mismatch" });
    c.api.readThread = async () => { throw new Error("PRIVATE_ERROR"); };
    const result = await collectCodexTurnPagesV0166(c.api, "thread", "sample");
    expect(result).toMatchObject({ reason: "transport_error" });
    expect(c.cursors).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });
  it("응답하지 않는 클라이언트도 취소하고 이전 페이지를 보존한다", async () => {
    const controller = new AbortController(), c = client([]);
    let second!: () => void; const started = new Promise<void>(r => { second = r; }); let count = 0;
    c.api.listTurns = () => { if (count++ === 0) return Promise.resolve(page("x")); second(); return new Promise(() => {}); };
    const pending = collectCodexTurnPagesV0166(c.api, "thread", "sample", { signal: controller.signal });
    await started; controller.abort();
    expect(await pending).toMatchObject({ reason: "cancelled", pages: [{ kind: "page" }] });
  });
  it("페이지 커서는 한 번만 읽고 full 빈 페이지도 명시적으로 종료한다", async () => {
    let reads = 0;
    const changing = new Proxy({ data: [] }, { getOwnPropertyDescriptor(target, key) {
      if (key === "nextCursor") return { configurable: true, value: reads++ === 0 ? null : "PRIVATE_CURSOR" };
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    expect(await collectCodexTurnPagesV0166(client([changing]).api, "thread", "sample"))
      .toMatchObject({ status: "last_page", pages: [{ turns: [], next_page: "none" }] });
    expect(reads).toBe(1);
  });
});
