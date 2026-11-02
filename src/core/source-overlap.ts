import type { NormalizationResult } from "./events.js";
import { exportNormalizationJson } from "./json-export.js";

/** 일치는 정규화 결과의 일치이며 원본이나 실제 이벤트의 일치를 뜻하지 않는다. */
export interface SourceOverlap {
  source_id: string;
  line: number;
  indices: number[];
  status: "matching_normalized" | "conflict";
}

/** 같은 출처 별칭과 줄 번호의 후보를 찾는다. 입력 결과를 제거하거나 수정하지 않는다. */
export function findSourceOverlaps(results: readonly NormalizationResult[]): SourceOverlap[] {
  // 직렬화기의 허용 필드와 값 검증을 재사용해 임의 원문 속성을 비교에 사용하지 않는다.
  const normalized = JSON.parse(exportNormalizationJson(results)) as { results: NormalizationResult[] };
  const groups = new Map<string, { overlap: SourceOverlap; first: string }>();
  for (const [index, result] of normalized.results.entries()) {
    const source = result.kind === "event" ? result.event.source : result.source;
    if (source.source_id === null) continue;
    const key = JSON.stringify([source.source_id, source.line]);
    const value = JSON.stringify(result);
    const existing = groups.get(key);
    if (existing) {
      existing.overlap.indices.push(index);
      if (existing.first !== value) existing.overlap.status = "conflict";
    } else {
      groups.set(key, {
        overlap: { source_id: source.source_id, line: source.line, indices: [index], status: "matching_normalized" },
        first: value,
      });
    }
  }
  return Array.from(groups.values(), ({ overlap }) => overlap).filter(({ indices }) => indices.length > 1);
}
