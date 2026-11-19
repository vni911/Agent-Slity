# 1단계 합성 수용 검증 근거

관련 Issue: [#108](https://github.com/vni911/Agent-Slity/issues/108) · 기준 코드: `3f4715c91f4f053a19f24fb66a91f05902a923df` 이후 이 Issue의 테스트 변경 · 확인일: 2026-11-19

이 문서는 [아키텍처의 필수 합성 시나리오 10개](overview.md#실험과-수용-기준)를 입력·기대 결과·검사에 연결한다. 검사 범위는 합성 자료와 아래의 제한된 라이브러리 경로다. 합성 시나리오의 통과는 1단계 전체 제품 완료나 실제 에이전트 실행·관계의 진위 검증을 뜻하지 않는다. `unverified`, 누락의 `null`/`unknown`, 실제 관측된 `0`을 구분한다.

## 시나리오와 근거

테스트 이름으로 해당 검사를 찾을 수 있다. 단일·다중 에이전트는 각각 하나·여러 개의 스레드 ID가 기록된 합성 입력으로 표현하며 실제 에이전트 프로세스의 수를 인증하지 않는다.

| 시나리오 | 합성 입력과 기대 결과 | 검사 근거 |
| --- | --- | --- |
| 단일 에이전트 | `solo` ID의 시작·항목·완료 JSONL을 읽어 정규화→JSON 내보내기→관측 후보 그룹으로 연결한다. 줄 순서, 명시적 ID, 사용량 null/0과 원본 내용을 보존하고 메시지 원문은 내보내지 않는다. | [phase-one-acceptance.test.ts](../../tests/unit/phase-one-acceptance.test.ts)의 `단일 스레드 기록` |
| 다중 에이전트 | `parent`·`child` ID가 명시된 JSONL을 같은 경로로 처리한다. 서로 다른 스레드의 동일 item ID와 반복 관측의 위치·유형을 보존한다. 부모 관계를 exec 이벤트에서 추정하지 않는다. 별도 `thread/read` 관측에서 명시적 부모 후보를 확인한다. | [phase-one-acceptance.test.ts](../../tests/unit/phase-one-acceptance.test.ts)의 `다중 스레드 기록`, `부모가 늦게 도착` |
| 순서 역전 | 완료가 시작보다 앞선 항목, 자식이 부모보다 앞선 관측, item 시각 20→0→20인 turn 응답을 정렬·삭제하지 않는다. 원래 위치와 출처 값을 남긴다. | [item-observations.test.ts](../../tests/unit/item-observations.test.ts)의 `완료가 먼저`, [parent-thread-candidates.test.ts](../../tests/unit/parent-thread-candidates.test.ts)의 `역순`, [recollection.integration.mjs](../../tests/integration/recollection.integration.mjs) |
| 중복 | 같은 출처 별칭·줄의 일치/충돌 후보를 구분하고 입력을 삭제하지 않는다. 재수집 결과에도 반복 turn·item이 남으며 요약은 고유 실행 수 대신 입력 관측 횟수를 센다. | [source-overlap.test.ts](../../tests/unit/source-overlap.test.ts)의 `같은 별칭`, `서로 다른 결과`, [recollection.integration.mjs](../../tests/integration/recollection.integration.mjs) |
| 누락 | thread/source/부모 ID 누락, 명시적 부모 null, 미지원 위치를 구분한다. 없는 관계를 이름·세션·포크로 채우지 않고 원래 입력 위치를 남긴다. 누락률은 계산하지 않는다. | [thread-observations.test.ts](../../tests/unit/thread-observations.test.ts)의 `ID 또는 출처 누락`, [parent-thread-candidates.test.ts](../../tests/unit/parent-thread-candidates.test.ts)의 `출처·부모 누락`, [codex-app-server-thread-read.test.ts](../../tests/unit/codex-app-server-thread-read.test.ts)의 `명시적 null` |
| 이름과 ID 불일치 | 이름이 대상 ID와 같아도 실제 ID가 다르면 후보로 연결하지 않는다. 이름이 달라도 명시적 ID가 일치하는 관측만 후보로 연결한다. 이름만 있고 ID가 없는 관측은 미지원이다. | [phase-one-acceptance.test.ts](../../tests/unit/phase-one-acceptance.test.ts)의 `이름이 같아도` |
| 사용량 없음 | 입력 토큰의 실제 0과 미제공된 출력·캐시·추론 토큰의 null을 구분한다. 음수·잘못된 값과 완료 외 이벤트의 사용량도 추정하지 않는다. | [phase-one-acceptance.test.ts](../../tests/unit/phase-one-acceptance.test.ts)의 `단일 스레드 기록`, [codex-exec-normalizer.test.ts](../../tests/unit/codex-exec-normalizer.test.ts)의 `0은 보존`, `완료 이벤트가 아닌` |
| 실패·중단 | 서버 오류·시간 초과·취소 및 연결 EOF를 사유로 남기고 이미 받은 페이지를 보존한다. 수집 상태와 직접 자식 종료 관측을 구분한다. | [turn-page-collector.test.ts](../../tests/unit/turn-page-collector.test.ts)의 `오류와 페이지 한도`, `응답하지 않는 클라이언트`, [turn-collector.integration.mjs](../../tests/integration/turn-collector.integration.mjs)의 `후속 turn 요청 취소`, [recollection.integration.mjs](../../tests/integration/recollection.integration.mjs) |
| 연결 복원 | 첫 페이지를 받은 뒤 두 번째 요청에서 합성 프로세스가 정상 종료해 실제 EOF를 만든다. 호출자가 새 프로세스/연결로 초기화와 첫 페이지부터 다시 요청한다. 이전 partial 결과·JSON은 불변이고 새 결과는 별개다. 마지막 페이지 도달, 역순·중복·null/0·미지원 위치와 원문 제외를 검증한다. | [recollection.integration.mjs](../../tests/integration/recollection.integration.mjs), [synthetic-reconnect-server.mjs](../../tests/fixtures/synthetic-reconnect-server.mjs) |
| 미지원 형식 | 알 수 없는 exec 이벤트와 손상된 입력은 미지원/진단으로 남긴다. full이 아닌 turn page와 알 수 없는 item은 해당 범위의 미지원으로 남긴다. 미지원 page 내부의 관측 수를 0으로 바꾸지 않는다. | [codex-exec-normalizer.test.ts](../../tests/unit/codex-exec-normalizer.test.ts)의 `알 수 없는 이벤트`, [codex-app-server-turns.test.ts](../../tests/unit/codex-app-server-turns.test.ts)의 `full이 아닌`, [child-turn-summary.test.ts](../../tests/unit/child-turn-summary.test.ts)의 `미지원 page 내부` |

## 재연결 시험의 정확한 범위

[합성 서버](../../tests/fixtures/synthetic-reconnect-server.mjs)는 연결마다 `initialize`→`initialized`→`thread/read`→`thread/turns/list` 순서와 지정 thread ID, full/asc/limit100, 첫 요청의 cursor 미지정을 검사한다. 잘못된 요청은 종료2다. 첫 실행은 두 번째 페이지 요청에서 종료0을 발생시키며 시험은 종료 코드와 `partial/transport_error`, 기존 한 페이지와 `exit_observed`를 확인한다. 새 프로세스는 같은 합성 페이지를 두 페이지로 제공한다.

새 결과는 turn3개·item6개이며 반복 ID도 각각 센다. 첫 결과는 turn2개·item4개인 부분 수집으로 유지된다. 사용자 메시지의 미제공 완료 시각은 null, 명령의 명시적 종료 코드·시간 값은 0이다. raw 메시지·명령·경로·cursor sentinel은 정규화/내보내기/요약 결과에 없다. exporter→parser 왕복과 새 결과 요약까지 검사한다. 종료 관측은 직접 합성 자식에 한정한다.

이는 **호출자가 새 연결에서 처음부터 재수집한 경로의 검증**이다. 자동 재연결·재시도, 커서에서 이어받기, 여러 결과의 자동 병합·중복 제거, 두 조회 간 일관된 스냅샷이나 원본 변경 시 충돌 해결 기능은 제공하지 않는다. 같은 별칭·ID는 출처 인증이 아니다. 늦게 도착한 부모 관측도 새 입력 배열로 후보를 다시 계산하며 기존 결과나 영구 저장소를 갱신하는 기능은 아니다.

## 실행과 판정

저장소 루트에서 Node.js 24로 실행한다. 단위 검사는 src를 사용하고 통합 검사는 이 작업 공간에서 빌드한 dist를 사용한다.

```sh
npm ci
npm test -- tests/unit/phase-one-acceptance.test.ts
npm run build
node --test tests/integration/recollection.integration.mjs
npm run check
```

실행 결과와 독립 리뷰는 [Issue #108](https://github.com/vni911/Agent-Slity/issues/108)에 기록한다. 통과 여부와 OS별 skip은 실제 출력으로 확인하며, 이 문서만으로 실행을 주장하지 않는다. 합성 서버는 Node 하위 프로세스로서 stdin/stdout 프로토콜만 처리하고 모델·실제 Codex·Docker·WSL·개인 인증·기록을 사용하지 않는다. 네트워크 차단 컨테이너 시험은 아니다.

## 전체 1단계 판정에서 남기는 경계

- 10개 항목의 위 경로 검증과 아키텍처의 모든 구현 요구가 완료됐다는 주장은 구분한다. 현재 관계 연결은 명시적 값의 후보이며 실제 동일 실행·부모 관계를 인증하지 않는다.
- [기존 설계](overview.md#경계와-데이터-흐름)의 로컬 저장 계층은 출처·수집 상태·정규화 결과의 일관된 보존을 다룬다. 현재 JSON 저장/왕복만으로 저장 계층 전체 완료를 판정하지 않는다. SQLite는 후보 기술이며 필수로 확정하지 않았다. 최소 범위·형식별 완료 조건과 단계적 구현안은 [저장 설계 초안](local-storage-design.md)에 정리하며, 해당 저장 동작과 지원을 구현·검증했다는 뜻은 아니다.
- 영구 커서·안전한 체크포인트·저장 수명은 [오프라인 설계](offline-collector-design.md#제안하는-전송수집-경계)에서 별도 설계 대상으로 남겨두었다. 이번 시험으로 구현되었다고 해석하지 않는다.
- 실제 서버 증거는 [Issue #91](https://github.com/vni911/Agent-Slity/issues/91)의 특정 커밋·Codex 0.166.0·격리 Linux·합성 legacy 기록 범위로 제한된다. 이 작업의 합성 테스트가 해당 실제 서버 시험을 재실행하거나 지원 범위를 확대한 것은 아니다. 해당 시험에서 `thread/items/list`는 미지원이었고 전체 복원·사용자 환경의 Windows/WSL은 확인 필요다. Issue #91은 열린 상태를 유지한다.
- 효율 보고서·팀 추천·팀 실행·실험·데스크톱 UI는 후속 단계다. 수용 근거를 정리한 뒤에도 해당 단계의 별도 요청을 기다린다.
