# 팀 작업 공간 MVP

확인일: 2026-11-24 · [Issue #124](https://github.com/vni911/Agent-Slity/issues/124) · [통합 PR #125](https://github.com/vni911/Agent-Slity/pull/125)

## 완료 범위

지원 스냅샷 읽기·JSON/HTML 근거 보고서·명시적 팀 선택·규칙 추천에 실행 제어·고정 합성 비교·Electron/React 화면을 연결한다. 기존 #123 보고서 PR은 미병합 종료하고 내용을 #125에 포함했다. 이 문서의 MVP는 해당 제품 흐름을 뜻하며 실제 계정/버전별 Codex 검증, 서명/설치 프로그램/Release, 전환경 지원과 일반적인 효율 우위의 완료를 뜻하지 않는다. #91은 별도 실환경 수용 검증이 남아 열린 상태다. 선택형 Harness²는 기본 흐름에 자동 도입하지 않는다.

## 실행과 비교 계약

`executeTeam(request, options)`는 검증한 명시 선택만 실행한다. 추천으로 교체하지 않는다. 역할별 결과를 다음 단계에 전달하며 의존 순서는 조사→구현→리뷰다. manual의 선언 순서는 selection에 그대로 남고 실제 수행 순서는 steps 배열로 확인한다. 각 역할은 별도 실행이다. 동시 에이전트 협업·상시 메시지 버스나 공유 메모리 구현을 주장하지 않는다.

provider=`synthetic`은 고정 과제 `2 + 2의 결과를 숫자 하나로 답하세요.`만 허용한다. 각 역할은 메모리 내 합성 fixture이며 구현 결과 `4`를 기대값과 대조한다. quality=passed는 이 작은 합성 검사만 뜻한다. OS 자식이 없으므로 cleanup_status는unknown이다. 실제 모델·토큰 사용·작업 품질은 관측하지 않았다.

provider=`codex`는 사용자가 지정한 절대 일반 실행 파일과 절대 작업 폴더를 검증한다. shell을 쓰지 않고 `--ask-for-approval never --sandbox read-only exec --json --ephemeral --color never --skip-git-repo-check -`를 고정 인수로 요청한다. 과제와 앞 단계 출력은 stdin으로 전달한다. 메시지/명령을 셸 문자열로 합치지 않는다. 배치 파일·장치·Windows UNC/ADS 경로는 거부한다. 입력 과제 최대8,000문자, 전체 제한100~300,000ms, stdout 원문은 단계별1MiB 상한이다. stderr는 보관하지 않는다. 지원 JSONL의 최종 agent_message·한 개의 turn.completed usage만 관측하고 누락/불명 형식·중복 완료는 실패다. 오류 원문을 반환하지 않는다.

Codex 실행 파일의 진위/버전, 사용자 인증·설정·hook은 이 앱이 인증하지 않는다. 앱이 인증 파일을 읽거나 공개하지 않으며 Codex의 기존 로그인/설정은 명시적으로 실행한 프로그램이 사용할 수 있다. read-only는 모델 도구에 **요청한 정책**이다. Codex 시작의 CODEX_HOME 쓰기·네트워크나 설정 hook의 부작용이 없다고 보증하지 않는다. 실제 계정 모델 호출·버전 호환성은 검증하지 않았다. [공식 exec 인수](https://learn.chatgpt.com/docs/developer-commands?surface=cli)를 참고한다.

취소/시간 초과/오류는 뒤 단계를 중지하고 직접 소유한 자식에 SIGTERM, 제한 유예 후 SIGKILL을 시도한다. 결과는 stdout EOF와 직접 자식 close를 별개로 관측한다. close를 보지 못하면unknown이고 스트림을 닫고unref하여 부모의 무한 대기를 피한다. 하위 프로세스 전체 종료를 보증하지 않는다. 실패한 단계의 부분 output/usage는 내보내지 않는다. 이전 완료 단계는 남는다. 실제 Codex의 quality는항상unknown이며 status=completed를 품질 성공으로 해석하지 않는다. 내부 테스트용 executor 주입 함수는 협조적 취소 구현을 전제로 하며 임의의 영구 대기 Promise를 강제 종료하는 공개 플러그인 계약은 아니다.

`compareSyntheticTeams`는 동일 고정 과제·합성 실행기·제한에서 Solo/Small/Full을 순차 한 번씩 실행한다. 취소/오류 시 미실행 결과를 만들지 않는다. 과제 ID·환경/Node 버전·실제 소요 시간과 fixture 품질을 보존한다. 단일 합성 실행의 시간은 벤치마크가 아니며 efficiency는null이다. 실제 모델 비용·품질 통제 실험/통계적 우위를 검증하지 않았다.

## 데스크톱과 저장

`npm ci` → `npm run desktop:install` → `npm run build` → `npm run desktop`으로 실행한다. Electron45 패키지의 런타임 다운로드는 별도 설치 명령이며 기본 라이브러리 검사/번들 빌드는 OS GUI를 요구하지 않는다.

팀 작업에서 모드·조건을 정하고 계획을 확인한다. 합성 데모가 기본이다. 실제 Codex는 별도 provider 선택, native 실행 파일/작업 폴더 선택, 과제 입력 후 `Codex 실행 · 모델 호출`을 눌러 실행한다. 이 동작은 과제·이전 출력과 지정 작업 폴더 접근을 선택한 Codex에 넘긴다. 기존 인증을 자동 수집하지 않으며 원문/출력은 자동 저장·공개하지 않는다. 취소 후 관측 결과를 확인한다.

기록 보고서에서 입력 형식을 선택해 native 파일 열기로 기존 지원 스냅샷 하나를 읽는다. 원본 내용을 수정하지 않는다. 보고서·실행·비교는 각각 명시 저장 버튼으로 저장하며 기존 no-overwrite publisher를 재사용한다. publication과 임시 정리 상태를 구분한다. 실행 출력에는 민감정보가 있을 수 있으므로 저장/공유 전 검토한다. 파일 자동 탐색이나 자동 재시도는 없다.

Electron 화면은 `slity://app`의 고정 로컬 자원만 제공한다. 경로 경계/확장자 검사·CSP·외부 네트워크 요청 차단, sandbox/contextIsolation=true, nodeIntegration=false를 적용한다. navigation·새 창·webview·권한 요청을 막는다. IPC는 고정 메서드와 동일webContents/mainFrame/URL 발신자를 확인하고 renderer에서 임의 파일 경로를 받지 않는다. preload는 raw ipc/event를 노출하지 않는다. 네트워크 차단은 renderer에 관한 것이며 별도 Codex 프로세스의 네트워크 차단 주장과 다르다. [Electron 보안 지침](https://www.electronjs.org/docs/latest/tutorial/security)을 참고한다.

## 검증과 로컬 패키지

`npm run check`는 타입/린트(JSX 포함)/단위/코어+Vite빌드/실제 파일·고정 자식·CLI 통합을 실행한다. `npm run desktop:smoke`는 실제 Electron에서 격리된 임시 프로필로 계획·실행·취소·비교·파일 열기·명시 저장/덮어쓰기 거부, sandbox/Node격리·좁은 화면을 검사한다. native dialog는 합성 경로로만 대체하며 앱의 실제 IPC/리더/publisher를 사용한다. Chromium sandbox를 유지하고 우회 옵션을 쓰지 않는다. 화면 캡처 시 focus를 빼앗지 않는 showInactive를 사용한다. Windows CI는 Electron 설치와 smoke도 실행하고 Linux CI는 라이브러리/번들까지 검사한다. [Playwright Electron 검증 API](https://playwright.dev/docs/api/class-electron)를 사용한다. 정확한 커밋/카운트·독립 리뷰는 Issue/PR에 기록한다.

`npm run desktop:package`는 Windows 실행 폴더를 `artifacts/AgentSlity-win32-x64`에 만든다. `AgentSlity.exe`와 동반 resources/라이선스·문서를 함께 유지한다. 기존 폴더는 덮어쓰지 않는다. 다른 로컬 출력 이름은 `node scripts/package-desktop.mjs AgentSlity-final`처럼 영문/숫자/._-의 단일 이름으로 지정한다. artifacts 자체의 실제 경로와 junction/symlink를 검사하고 기존 최종 폴더를 거부한다. 신뢰하는 로컬 작업 공간에서 쓰며 검증 후 외부 프로세스가 부모를 교체하는 경쟁까지 차단했다고 보증하지 않는다. 서명·자동 업데이트·설치 프로그램·Release 게시를 하지 않는다. 패키지 폴더와 합성 실행 산출물은 Git에서 제외한다.

실제 합성 화면: [팀 작업](images/mvp-team.png), [기록 보고서](images/mvp-report.png), [좁은 화면](images/mvp-narrow.png). 개인 기록·실제 모델 활동의 검증 화면이 아니다.
