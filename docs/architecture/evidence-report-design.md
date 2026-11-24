# 2단계 근거 기반 관측 보고서

확인일: 2026-11-24 · [Issue #122](https://github.com/vni911/Agent-Slity/issues/122) · JSON 순수 API·오프라인 HTML·개발용 CLI를 한 기능 묶음으로 제공한다.

## 입력과 출력

`createNormalizationEvidenceReport(records)`와 `createChildTurnEvidenceReport(result)`는 지원하는 기존 스냅샷을 검증한 뒤 `agent-slity.evidence-report`, version1 객체를 반환한다. 파일/서버/모델 접근은 하지 않는다. 입력은 기존 제한된 정규화 serializer 또는 turn exporter→parser로 새로 복사하고, 출력 JSON도16MiB 이내인지 검사한다. 라이브러리 입력 상한은 허용 필드의 스냅샷 표현 기준이며 임의의 추가 필드까지 포함한 객체 전체 크기를 제한하는 것은 아니다. 크기 상한은 전체 메모리 상한이 아니다. 손상·예산 초과는 원문 없는 고정 TypeError다.

출력의 verification_status는 unverified, count_semantics는 observations_including_duplicates다. normalization summary는 records/events/diagnostics/unsupported와 지원 event 유형별 횟수이며 reported_usage는 값이 제공된 각 record의 사용량과 입력 인덱스다. 실제0과 미관측null을 유지한다. token 총합·고유 실행 수로 바꾸지 않는다.

turn 보고서는 기존 ChildTurnCollectionSummary를 보존한다. 초기화/수집 사유·자식 정리 unknown·지원/미지원 page·관측null/0을 그대로 유지한다. collaboration_tools는 지원 page의 보고된 tool 횟수이며 같은 item도 입력마다 센다. 지원 page가 없으면null, 지원된 빈 범위는빈객체다. reported_usage는null이다. 저장된 전체 사용량을 이 형식에서 조회했다고 가정하지 않는다.

보고서에는 원문·파일 경로·thread/turn/item ID·source alias·모델 설정을 복사하지 않는다. ID/alias는 후보 계산에만 사용하고 결과의 근거는 입력 배열의0기반 record_index 또는 page_index/turn_index/item_index로 남긴다. 이 기본 제외가 모든 민감정보의 익명화·비밀 탐지라는 뜻은 아니다. 보고된 사용량 같은 메타데이터도 공유 전 검토한다.

## 근거 수준과 규칙

상위 설계의 직접 관측/후보/미확인을 각각 input_observation/suspected/unknown으로 구분한다. input_observation은 **입력 값의 관측**이며 실제 프로세스 실행·실패·검증 성공의 독립 인증이 아니다. 반복이 실제 불필요한 낭비였다고 판단하지 않는다.

| rule_id / version1 | 근거와 수준 | 범위·오탐 한계 |
| --- | --- | --- |
| source_position_overlap | 같은 명시적 출처 별칭·줄의 정규화 결과 일치, suspected | 기존 findSourceOverlaps의 입력 인덱스. 원문 일치/고유 실행/낭비 확정이 아님. 별칭 재사용·재가져오기로 생길 수 있음 |
| source_position_conflict | 같은 별칭·줄의 정규화 결과 상충, suspected | 원본 수정이나 도구 오류를 단정하지 않음. 관측을 삭제하지 않음 |
| repeated_turn_id | 같은 명시적 page 출처 별칭과 turn ID의 반복 위치, suspected | 별칭/ID가 없으면 묶지 않음. 페이지 재조회/활성 기록 변화 등 합법적 중복 가능 |
| repeated_item_id | 같은 page 별칭·turn ID·item ID의 반복 위치, suspected | 지원 item만 대상. 유형이 달라도 동일 ID의 관측 후보이며 실제 같은 행동의 증명 아님 |
| reported_execution_error | normalization의 turn.failed/error 또는 저장 turn.status failed, input_observation | 입력이 그렇게 보고했음을 뜻하며 전체 과제/품질 실패 판정이 아님 |
| reported_command_failure | 저장 명령의 status failed 또는 명시적 nonzero exit_code, input_observation | 상태/종료 코드 상충도 임의 해결하지 않음. 그 명령이 테스트/빌드였는지나 전체 검증 결과는 모름 |
| validation_unobserved | 현재 수집 계약에 품질 검증을 확정할 근거가 없음, unknown | 검증을 실행하지 않았다거나 테스트가 실패했다고 바꾸지 않음. 근거 배열은빈배열 |

모든 finding은 rule_id/rule_version/evidence_level과 구체 references를 포함한다. 미지원 page를 건너뛰어도 실제 page 위치를 유지한다. 후보를 자동 삭제·병합·순위화하거나 추천/팀 실행으로 이어가지 않는다.

## 미확인 지표

unknown_metrics의 unique_executions/unique_agents/quality/elapsed_time_ms/total_tokens/efficiency/savings는null이다. 각각의 unknown_metric_reasons를 제공한다. 식별·전체 범위·사용량 누적 의미·과제 전체 타이밍·품질·동일 조건 대조군이 검증되지 않았기 때문이다. 사용자에게 보기 좋은 수치나 절감률을 만들어 넣지 않는다.

유효한 빈 파일/지원된 빈 page의 관측0은 해당 입력 범위의0이다. 소스 전체에 데이터가 없거나 오류/검증이 없었다는 결론이 아니다. last_page도 전체 기록 복원을 보증하지 않는다. 보고 사용량을 합산하는 기능·품질 평가·팀 추천·실험은 이 첫 구현에 없다.

## HTML과 CLI

```sh
node dist/cli/main.js --report normalization saved-normalization.json
node dist/cli/main.js --report-html turn tests/fixtures/child-turn-collection-demo.json > report.html
```

명시적 `normalization` 또는 `turn` 형식과 JSON 파일 하나를 받는다. raw JSONL 자동 감지·서버 실행·기존 세션 탐색은 하지 않는다. 입력은 기존 파일 리더의 UTF-8/BOM 없음/16MiB/일반 파일·경로 정책을 따른다. 모든 처리가 성공해야 stdout으로 한 번 출력하며 인수 오류는 종료2, 읽기·형식·출력 예산 오류는 종료1과 경로·원문 없는 고정 오류다. 자동 파일 저장은 없고 셸 리디렉션을 사용할 때는 원본과 다른 경로를 지정해야 한다.

HTML 렌더러는 공개 API가 아닌 CLI 내부 모듈이며 생성기로 검증·복사된 보고서 DTO만 받는다. 같은 관측·후보·unknown과 구체 위치를 표시하며 `<details>`로 근거를 펼친다. 외부 자원·스크립트 없이 inline CSS와 기본 HTML만 사용하고 텍스트를 이스케이프한다. CSP는 기본 자원·폼·base를 차단하고 inline 스타일만 허용한다. HTML도16MiB 이내에서 전부 생성한 뒤 출력한다. 상한은 마지막 CLI LF를 제외한 JSON/HTML 본문 기준이다. 임의의 외부 보고서 JSON을 HTML로 변환하는 입력 계약은 제공하지 않는다.

## 검증

[단위 검사](../../tests/unit/evidence-report.test.ts)는 관측/후보/미확인, null/0·중복/상충·빈 범위/미지원, 구체 위치·부분/정리 상태·hook 비호출·원문 제외를 검사한다. [실제 파일 통합 검사](../../tests/integration/evidence-report.integration.mjs)는 두 저장 형식→읽기→보고서와 파일 불변을 확인한다. 정확한 커밋/OS/명령/CI·skip·독립 리뷰는 Issue에 기록하며 합성 검사와 실제 Codex 지원을 구분한다.

[HTML 단위 검사](../../tests/unit/evidence-report-html.test.ts)와 [실제 CLI 검사](../../tests/integration/evidence-report-cli.integration.mjs)는 표시 수준·null/0·특수문자 이스케이프·잘못된 인수·두 입력 형식·UTF-8/스키마/예산 오류·경로/원문 제외·파일 불변을 검사한다. 실제 브라우저의 넓은/좁은 화면·근거 펼치기·네트워크와 콘솔 관측은 Issue에 별도 기록한다. 효율 비교나 2단계 전체 완료를 주장하지 않는다.
