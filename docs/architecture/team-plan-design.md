# 팀 선택과 규칙 기반 계획

확인일: 2026-11-24 · [Issue #124](https://github.com/vni911/Agent-Slity/issues/124) · 보고서 PR #123 위의 후속 기능 묶음.

## 계약과 완료 기준

사용자가 Solo·Small·Full·Manual을 명시적으로 선택하고 요청 조건에 따른 추천을 별도로 확인한다. 순수 API·제한된 JSON 파서·JSON/text CLI·합성 예제·문서·회귀·독립 리뷰·양OS CI를 한 PR에 포함한다. 이 계획은 실행하지 않으며 실행 상태는 `not_started`다. 모델·서버·파일 쓰기·자동 위임을 연결하지 않는다.

`TeamRequest`의 format은 `agent-slity.team-request`, version은1이다. `selection.mode`는 `solo`, `small`, `full`, `manual`이다. 기본 역할은 solo=`implementer`, small=`implementer,reviewer`, full=`researcher,implementer,reviewer`이며 프로젝트의 계획 기본값이다. 검증된 최적 인원·역할을 뜻하지 않는다. manual에서만 `selection.roles`를1~3개 명시하며 implementer를 반드시 포함하고 중복은 허용하지 않는다. 입력 순서를 보존한다. 다른 모드에 roles를 함께 지정하면 모순된 선택으로 거부한다.

`constraints.max_agents`는1~3의 정수다. 이 첫 버전의 제품 제한이며 실제 실행된 에이전트 수가 아니다. 명시한 선택이 이를 초과하면 입력을 거부한다. `task.independent_research`, `task.independent_review`는 각각 boolean 또는null이며 생략은 오류다. null은 확인 필요다. 값은 사용자가 **요청한 역할 조건**이며 독립 작업의 가능성·실제 활동·품질을 관측했다는 뜻이 아니다. 과제 원문·경로·개인 ID·모델·인증 정보를 받지 않는다.

`parseTeamRequestJson(json)`은 UTF-8 기준64KiB 이내의 primitive JSON 문자열을 읽고 허용 필드만 복사한다. BOM/잘못된 JSON·형식·값은 고정 TypeError `유효하지 않은 팀 구성 요청입니다.`다. JSON.parse의 중복 키는 마지막 값을 사용하며 진위 인증은 하지 않는다. `createTeamPlan(request)`도 필수 own-data 필드를 다시 검증·복사한다. getter·배열 iterator·toJSON은 호출하지 않는다. Proxy trap까지 비실행으로 보증하지 않는다. 추가 필드는 복사하지 않으며 임의 추가 객체의 전체 메모리 크기를 제한하는 계약은 아니다.

## 선택과 추천

출력 `agent-slity.team-plan`, version1은 `verification_status: unverified`, 명시적 selection의 역할·인원·source, constraints, 요청 task, recommendation, warnings와 `quality/efficiency: null`을 포함한다. 선택과 추천을 자동 교체하거나 요청 조건을 실제 실행의 인증으로 바꾸지 않는다.

규칙 `requested_role_requirements`, version1은 항상 구현 담당을 포함하고 true인 연구/리뷰 조건을 추가한다. 조건 두 개가 모두 알려진 경우에만 아래 후보를 만든다.

| 연구 요청 | 독립 리뷰 요청 | 추천 후보 |
| --- | --- | --- |
| false | false | solo: implementer |
| false | true | small: implementer, reviewer |
| true | true | full: researcher, implementer, reviewer |
| true | false | manual: researcher, implementer |

추천은 규칙 제안이며 효율·품질 우위의 실험 결과가 아니다. 입력 필드 경로·요청 값·규칙 버전·사유를 함께 제공한다. 조건 하나라도null이면 status=`unknown`, candidate=null이다. 알려진 요청 역할이 명시적 선택에 없으면 별도의 warnings에 누락 역할을 표시한다. false는 해당 역할의 금지를 뜻하지 않는다.

후보 인원이 max_agents보다 크면 status=`budget_blocked`와 후보/필요 인원을 남긴다. 제한에 맞춰 연구/리뷰 담당을 조용히 제거하지 않는다. 맞으면 status=`suggested`다. 구조·명시 선택 인원 검증을 먼저 수행하고 조건null이 있으면unknown을 우선하며 그다음 추천 예산을 판단한다. 알려진 조건만으로도 인원이 부족해 보여도 unknown의 후보를 임의 확정하지 않는다. 두 상태 모두 선택이나 실행에 반영하지 않는다. 역할 이름만으로 작업 독립성, 올바른 검증, 대기·충돌·중복 감소를 보증하지 않는다.

## CLI와 검증

```sh
node dist/cli/main.js --team-plan tests/fixtures/team-request-demo.json
node dist/cli/main.js --team-plan-text tests/fixtures/team-request-demo.json
```

명시된 JSON 파일 하나를 UTF-8/BOM 없음/원본64KiB/일반 파일·기존 경로 정책으로 읽는다. 같은 검증된 계획을 JSON 또는 한국어 text로 stdout에 전부 출력한다. 자동 저장은 없고 원본 내용을 쓰지 않는다. 인수 오류는 종료2, 처리 오류는 종료1·빈stdout·원문/경로 없는 고정stderr다. 정상 계획에서 unknown/budget_blocked/warnings는 출력 데이터이므로 종료0이다. 읽기 메타데이터 불변이나 동시 수정 중 일관된 스냅샷을 보증하지 않는다. 셸 리디렉션은 원본과 다른 경로를 사용한다.

필수 검증은 네 모드·네 규칙 조합·조건null·예산 경계·선택 보존·manual 순서·누락 역할 경고·실행 미시작·원문 제외·hook 비호출·고정 오류와 JSON/text의 동일 의미다. 실제 파일/빌드된 CLI로 인수·UTF-8/BOM/64KiB/스키마·없는 파일·Windows 장치 경로를 검사하고 입력/디렉터리 불변을 확인한다. 명령과 OS별 결과·skip·독립 리뷰는 Issue/PR에 남긴다. 실제 에이전트 실행이나 품질/효율 검증의 증거가 아니다.
