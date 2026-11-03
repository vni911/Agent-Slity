# Codex 저장 기록 스키마 조사

확인일: 2026-11-03. 목적은 기존 실행 기록을 모델 호출 없이 분석하기 위한 다음 구현의 근거를 정리하는 것이다. 현재 Agent Slity의 JSONL 어댑터는 제한된 `codex exec --json` 출력만 다루며 App Server 저장 기록을 가져오지 않는다. 이 문서는 구현 또는 실제 환경 지원을 뜻하지 않는다.

## 확인 범위

- Windows에 설치된 `codex-cli 0.166.0`에서 `codex.cmd --version`과 `codex.cmd app-server generate-json-schema --help`를 실행했다. 홈 디렉터리를 찾지 못해 PATH 별칭을 만들 수 없다는 경고가 있었지만 버전·도움말 명령은 종료 코드 0이었다.
- 임시 디렉터리에 `codex.cmd app-server generate-json-schema --out <임시_디렉터리>`와 `codex.cmd app-server generate-json-schema --experimental --out <다른_임시_디렉터리>`를 각각 실행했고 종료 코드 0과 생성 파일을 확인했다. 공식 문서는 생성 스키마가 실행한 CLI 버전에 종속된다고 설명한다. [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)
- 생성 파일의 스키마 구조만 읽었다. App Server 실행, 실제 사용자 기록·인증 파일 조회, 모델 호출은 하지 않았다. Windows에서 생성한 스키마는 WSL의 설치 버전이나 런타임 동작을 검증하지 않는다.

## 저장 기록 조회와 완전성

현재 공식 문서는 `thread/read`를 재개·구독 없는 저장 스레드 메타데이터 조회로, `thread/turns/list`와 `thread/items/list`를 페이지 조회로 설명한다. `itemsView`를 생략하면 `summary`이므로 전체 항목으로 간주하지 않는다. `thread/items/list`는 저장소가 해당 기능을 지원하지 않으면 오류가 날 수 있다. 커서·페이지 실패·미지원 상태를 기록해야 하며, 조회가 끝났다는 사실만으로 저장되지 않은 실시간 이벤트까지 복원됐다고 판단하지 않는다. [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)

기본 생성 스키마의 `v2/ThreadReadParams.json`, `ThreadTurnsListParams.json`, `ThreadItemsListParams.json`은 각각 `threadId`를 필수로 표시한다. 페이지 응답 세 종류의 스키마에는 `data`, `nextCursor`, `backwardsCursor`가 있다. `ThreadItemEntry`에는 `turnId`, `item`과 선택적 `startedAtMs`, `completedAtMs`가 있다. 필드의 존재는 실제 기록의 값이나 조회 성공을 보증하지 않는다.

현재 공식 문서에서 `thread/list`의 `sourceKinds`를 생략하거나 빈 배열로 두면 `cli`와 `vscode`만 기본 선택되며 `exec`·하위 에이전트가 빠질 수 있다. `useStateDbOnly: true`는 JSONL 스캔을 통한 메타데이터 복구를 피하는 옵션이다. 이것만으로 서버 전체가 쓰기나 다른 부작용 없이 동작한다고 보장할 수 없다. 사용자의 명시적 선택, 격리된 합성 환경과 실제 부작용 검증이 필요하다. [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)

## 관계·항목·사용량의 증거 경계

- 설치 버전의 기본 `ThreadReadResponse.json` 스키마에서 `Thread`의 `parentThreadId`는 하위 에이전트의 부모 ID로 설명되며 null일 수 있다. `sessionId`는 세션 트리에 공유되는 ID이고 `forkedFromId`는 분기 출처다. 셋을 같은 관계로 취급하지 않고, 빠진 값은 `unknown`으로 남긴다.
- 기본 `ThreadListParams.json`에는 `parentThreadId`·`ancestorThreadId` 필터가 없었고 `--experimental` 생성 결과에는 있었다. 현재 공식 문서도 두 필터에 실험 API 활성화가 필요하다고 설명한다. 생성 스키마에 필드가 있다는 사실만으로 특정 서버·저장소에서 조회가 성공한다고 주장하지 않는다. [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)
- **버전 차이:** 설치 버전의 `ThreadItemsListResponse.json`에 정의된 협업 항목 태그는 `collabAgentToolCall`이며 `senderThreadId`, `receiverThreadIds`, `agentsStates` 등을 포함한다. 확인일의 공식 문서는 `collabToolCall`과 `receiverThreadId`, `newThreadId` 등을 설명한다. 두 형식을 무조건 같은 것으로 가정하지 말고 실행 버전에 맞는 스키마와 합성 자료로 각각 검증해야 한다. [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)
- 설치 버전 스키마는 `Thread.model`과 `reasoningEffort`를 현재 설정 또는 마지막 저장 설정으로 설명하며 turn별 실제 실행 모델의 증거가 아니라고 명시한다. 공식 문서의 `thread/tokenUsage/updated`는 활성 스레드의 알림이다. 과거 저장 기록에서 이 알림과 사용량을 완전하게 복원할 수 있는지는 **확인 필요**다.
- 스레드 경로·작업 디렉터리·명령·메시지·항목 내용·ID에는 민감정보가 있을 수 있다. 원문을 기본 공개하지 않고 합성 테스트를 사용한다. 비공개 추론 원문을 표시하거나 저장했다고 주장하지 않는다.

## 다음 검증 후보

별도 승인된 구현 단계에서 버전별 응답을 합성 fixture로 재현하고, 페이지 누락·미지원·관계 정보 부재·중복·순서 역전을 테스트한다. 실제 서버를 대상으로 읽기 전용 동작과 로컬 데이터 변화 여부를 격리 환경에서 확인하기 전까지 실환경 연동·완전 복원·비용 절감을 주장하지 않는다.
