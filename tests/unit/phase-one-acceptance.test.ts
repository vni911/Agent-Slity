import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportNormalizationJson, findParentThreadCandidates, groupItemObservations, groupThreadObservations,
  normalizeCodexExecLine, normalizeCodexThreadReadV0166, readJsonlFile } from "../../src/index.js";
import type { NormalizationResult } from "../../src/index.js";

async function withRecords(values: unknown[], verify: (results: NormalizationResult[]) => void) {
  const directory = await mkdtemp(join(tmpdir(), "agent-slity-acceptance-"));
  const path = join(directory, "synthetic.jsonl");
  const contents = values.map(value => JSON.stringify(value)).join("\n") + "\n";
  try {
    await writeFile(path, contents, { flag: "wx" });
    const results: NormalizationResult[] = [];
    for await (const line of readJsonlFile(path)) results.push(normalizeCodexExecLine(line, "synthetic"));
    verify(results);
    expect(await readFile(path, "utf8")).toBe(contents);
  } finally { await unlink(path); await rmdir(directory); }
}

describe("1단계 합성 기록 수용 검증", () => {
  it("단일 스레드 기록을 읽어 식별자 관측·JSON으로 연결하고 사용량 null/0을 보존한다", async () => {
    await withRecords([
      { type: "thread.started", thread_id: "solo" },
      { type: "item.completed", thread_id: "solo", item: { id: "answer", type: "agent_message", text: "PRIVATE_MESSAGE" } },
      { type: "turn.completed", thread_id: "solo", usage: { input_tokens: 0 } },
    ], results => {
      const before = structuredClone(results);
      const parsed = JSON.parse(exportNormalizationJson(results)) as { results: NormalizationResult[] };
      expect(parsed.results).toEqual(before);
      const threads = groupThreadObservations(parsed.results);
      expect(threads.groups.map(group => [group.thread_id, group.observations.map(o => o.index)]))
        .toEqual([["solo", [0, 1, 2]]]);
      expect(groupItemObservations(parsed.results).groups.map(group => group.item_id)).toEqual(["answer"]);
      const completed = parsed.results[2];
      if (completed.kind !== "event") throw new Error("완료 관측이 아닙니다.");
      expect(completed.event.payload.usage).toEqual({ input_tokens: 0, output_tokens: null,
        cached_input_tokens: null, reasoning_output_tokens: null });
      expect(threads.verification_status).toBe("unverified");
      expect(JSON.stringify(parsed)).not.toContain("PRIVATE_");
      expect(results).toEqual(before);
    });
  });

  it("다중 스레드 기록의 같은 item ID·중복을 실제 동일 실행으로 합치지 않고 근거로 보존한다", async () => {
    const item = { type: "item.completed", thread_id: "child", item: { id: "shared", type: "command_execution", command: "PRIVATE_COMMAND" } };
    await withRecords([
      { type: "thread.started", thread_id: "parent" },
      { type: "item.completed", thread_id: "parent", item: { id: "shared", type: "agent_message", text: "PRIVATE_MESSAGE" } },
      { type: "thread.started", thread_id: "child" }, item, item,
    ], results => {
      const parsed = JSON.parse(exportNormalizationJson(results)) as { results: NormalizationResult[] };
      expect(parsed.results).toEqual(results);
      const threads = groupThreadObservations(parsed.results);
      expect(threads.groups.map(group => [group.thread_id, group.observations.map(o => o.index)]))
        .toEqual([["parent", [0, 1]], ["child", [2, 3, 4]]]);
      const items = groupItemObservations(parsed.results);
      expect(items.groups).toHaveLength(1);
      expect(items.groups[0].observations.map(o => [o.index, o.thread_id, o.item_type])).toEqual([
        [1, "parent", "agent_message"], [3, "child", "command_execution"], [4, "child", "command_execution"],
      ]);
      expect(items.verification_status).toBe("unverified");
      expect(JSON.stringify([parsed, threads, items])).not.toContain("PRIVATE_");
    });
  });

  it("부모가 늦게 도착하면 재처리한 새 후보만 갱신하고 이전 미연결 관측은 바꾸지 않는다", () => {
    const child = normalizeCodexThreadReadV0166({ thread: { id: "child", parentThreadId: "parent" } }, "synthetic");
    const input = [child];
    const before = structuredClone(input);
    const old = findParentThreadCandidates(input);
    const oldSnapshot = structuredClone(old);
    expect(old.groups).toEqual([{ source_id: "synthetic", parent_thread_id: "parent", child_indices: [0], parent_candidate_indices: [] }]);
    const parent = normalizeCodexThreadReadV0166({ thread: { id: "parent", parentThreadId: null } }, "synthetic");
    const updated = findParentThreadCandidates([...input, parent, parent]);
    expect(updated.groups).toEqual([{ source_id: "synthetic", parent_thread_id: "parent", child_indices: [0], parent_candidate_indices: [1, 2] }]);
    expect(updated.verification_status).toBe("unverified");
    expect(old).toEqual(oldSnapshot);
    expect(input).toEqual(before);
  });

  it("이름이 같아도 ID가 다르면 연결하지 않고 이름이 달라도 명시적 ID 일치만 후보로 삼는다", () => {
    const values = [
      { id: "child", parentThreadId: "correct", name: "misleading" },
      { id: "wrong", name: "correct" },
      { id: "correct", name: "different" },
      { name: "correct", text: "PRIVATE_MESSAGE" },
    ];
    const input = values.map(thread => normalizeCodexThreadReadV0166({ thread }, "synthetic"));
    const result = findParentThreadCandidates(input);
    expect(result.groups).toEqual([{ source_id: "synthetic", parent_thread_id: "correct", child_indices: [0], parent_candidate_indices: [2] }]);
    expect(result.unsupported_indices).toEqual([3]);
    expect(result.verification_status).toBe("unverified");
    expect(JSON.stringify([input, result])).not.toContain("PRIVATE_");
  });
});
