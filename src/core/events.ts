/** 값이 null이면 해당 기록에서 확인할 수 없다는 뜻이다. */
export interface ObservedUsage {
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
}

export interface EventSource {
  /** 호출자가 지정한 형식이며 출처의 진위를 증명하지 않는다. */
  format: "codex_exec_jsonl";
  line: number;
  /** 호출자가 지정한 별칭이며, 출처의 진위나 고유성을 보증하지 않는다. */
  source_id: string | null;
  format_version: null;
  collected_at: null;
}

export interface NormalizedEvent {
  run_id: null;
  task_id: null;
  thread_id: string | null;
  parent_thread_id: null;
  agent_id: null;
  event_id: null;
  event_type: string;
  timestamp: null;
  source: EventSource;
  /** 파일의 주장만으로 실제 실행의 진위를 검증할 수 없다. */
  verification_status: "unverified";
  /** 이전 결과에는 item_type과 item_id가 없을 수 있다. */
  payload: { item_type?: "command_execution" | "agent_message" | null; item_id?: string | null; usage: ObservedUsage };
}

export type NormalizationResult =
  | { kind: "event"; event: NormalizedEvent }
  | { kind: "unsupported"; source: EventSource; reason: "invalid_record" | "unsupported_event_type" }
  | { kind: "diagnostic"; source: EventSource; code: "invalid_json" | "invalid_utf8" | "line_too_long" };
