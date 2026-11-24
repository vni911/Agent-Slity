# 제3자 자료 고지

## 현재 포함된 자료

제3자 프로젝트의 구현 소스나 과거 Agent Desk 코드를 직접 복사하지 않는다. 개발·CI 도구와 Electron/React 런타임을 의존성으로 사용하며 로컬 실행 패키지에는 해당 런타임과 번들 코드가 포함된다. 공개 검사에는 자체 작성한 합성 fixture를 사용하며 실제 모델 출력·벤치마크 데이터셋은 포함하지 않는다. 자체 작성 자료에 적용하는 [Apache License, Version 2.0](LICENSE) 원문은 [Apache Software Foundation](https://www.apache.org/licenses/LICENSE-2.0.txt)에서 가져왔으며 영문 원문을 보존한다.

## MVP 런타임과 검증 의존성

2026-11-24 npm registry와 설치 패키지의 라이선스 메타데이터를 확인하고 package-lock에 고정했다. 외부 구현 소스의 직접 이식 없이 공식 패키지를 사용한다.

| 패키지 | 버전 | 라이선스 | 용도·원본 |
| --- | --- | --- | --- |
| Electron |45.4.1|MIT 및 동봉 Chromium/제3자 고지|데스크톱 런타임, [원본](https://github.com/electron/electron) |
| React / React DOM |19.3.1|MIT|renderer 번들, [원본](https://github.com/facebook/react) |
| Playwright Core |1.65.1|Apache-2.0|개발용 실제 Electron 검사, [원본](https://github.com/microsoft/playwright) |

로컬 패키지는 Electron 배포본의 LICENSE 내용을 ELECTRON-LICENSE로 유지하고 LICENSES.chromium.html도 보존한다. 자체 라이선스는 LICENSE와 AGENT-SLITY-LICENSE로 복사한다. React·React DOM의 설치된 LICENSE도 REACT-LICENSE/REACT-DOM-LICENSE로 함께 복사한다. Playwright는 개발 검사에만 사용하며 실행 패키지에 포함하지 않는다. 상표/아이콘 사용 권한이나 서명·공식 지원을 주장하지 않는다.

## 개발 도구와 CI

2026-11-02 기준 `package-lock.json`의 직접 개발 의존성과 라이선스 메타데이터는 다음과 같다. 각 도구의 저작권·라이선스 원문은 링크한 원본과 설치된 패키지에서 확인한다.

| 도구 | 잠금 버전 | 라이선스 | 출처 |
| --- | --- | --- | --- |
| TypeScript | 6.0.3 | Apache-2.0 | [원본](https://github.com/microsoft/TypeScript) |
| ESLint | 10.14.0 | MIT | [원본](https://github.com/eslint/eslint) |
| typescript-eslint | 8.72.1 | MIT | [원본](https://github.com/typescript-eslint/typescript-eslint) |
| Vitest | 5.0.5 | MIT | [원본](https://github.com/vitest-dev/vitest) |
| Vite | 8.3.5 | MIT | [원본](https://github.com/vitejs/vite) |
| @types/node | 24.19.2 | MIT | [원본](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| actions/checkout | 7.0.1 | MIT | [라이선스](https://github.com/actions/checkout/blob/v7.0.1/LICENSE) |
| actions/setup-node | 7.1.0 | MIT | [라이선스](https://github.com/actions/setup-node/blob/v7.1.0/LICENSE) |

간접 의존성의 정확한 버전과 메타데이터는 `package-lock.json`을 참고한다. 향후 배포물에 의존성을 포함할 경우 각 구성요소의 라이선스와 고지 의무를 별도로 검토한다.

## 향후 연동 대상

Google Research Harness²는 이후 선택적 어댑터로 검토할 별도의 외부 프로젝트다. 현재 Harness² 코드, 벤치마크와 연동 기능은 포함하지 않는다. 정확한 원본 저장소, 버전, 라이선스와 재배포 조건은 조사 단계와 실제 도입 전에 확인해야 한다. 프로젝트를 언급했다고 제휴, 보증이나 호환성을 의미하지 않는다.

Codex는 명시적 실행 연동 대상이며 실제 계정·버전 호환성은 미확인이고 실행 파일은 포함하지 않는다. Agent Slity는 Google이나 OpenAI의 공식 제품이 아니다. 외부 프로젝트 이름은 해당 프로젝트를 식별하기 위한 것이며, 그 상표나 자료의 사용 권한을 부여하지 않는다.

## 외부 자료 도입 전 확인

원본 프로젝트와 URL, 고정 버전 또는 커밋, 영향을 받는 파일, 라이선스 식별자와 원문, 저작권·NOTICE 요구사항, 수정 내용, 확인 날짜와 재배포 제한을 기록한다. 코드, 이미지 등 자산, 문서와 데이터셋에 서로 다른 조건이 적용되면 각각 검토한다.

필요한 출처 표시와 원본 고지를 보존한다. 외부 도구를 참조하거나 감싼다고 벤치마크나 제3자 데이터를 재배포할 권리가 자동으로 생기지 않는다. 권리나 라이선스 호환성이 불분명하면 `확인 필요`로 표시하고 가져오지 않는다.

과거 Agent Desk v0.3/v0.4 자료도 같은 검토를 거쳐 별도 PR로 제안한다. 과거 프로젝트 전체를 이 저장소에 복사하지 않는다.
