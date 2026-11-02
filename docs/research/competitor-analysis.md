# 0.2 선행 프로젝트 조사와 차별화 검증

확인일: 2026-11-02. 조사 대상은 아래 URL로 특정한다. 같은 이름의 다른 프로젝트가 있으므로 이름만으로 동일 프로젝트라고 판단하지 않는다. 코드·테스트는 정적으로 읽었으며 실행하거나 실험 결과를 재현하지 않았다. 명시하지 않은 기능이 없다는 뜻은 아니며, 확인 범위 밖은 **확인 필요**다. 라이선스 표기는 법률 검토나 재배포 허가가 아니다.

## 핵심 결론

- 반복 탐색·실패·과도한 위임·검증 누락 감지와 검증 증거의 신선도는 Agent Efficiency에 이미 있다. 실험 코호트와 과제 집합 해시도 구현돼 있다.
- OpenCollab은 사용량 원장과 테스트 결과 파서를 제공한다. amux에는 감사 기록 재생과 `UNKNOWN` 처리가 있으며, CooperBench는 단일·협업 실행 및 테스트 평가를 제공한다.
- 따라서 **낭비 감지, 사용량 집계, 검증 증거, 미확인 값 표시, 단일·팀 비교 각각을 신규 발명이나 독자적인 차별점으로 주장할 수 없다.**
- 검증할 가설: 동일 과제·커밋·환경에서 품질과 시간, 관측 가능한 사용량을 함께 비교하고 출처·누락을 설명하면 실사용자의 팀 구성 판단에 도움이 될 수 있다. 이 조합의 신규성·효용·비용 절감은 **확인 필요**이며, 기존 도구와 같은 조건에서 비교해야 한다.

## 1. Google Research Harness²

- **문제·기능:** 모델을 고정한 채 프롬프트·도구 안내 등 하네스 구성을 개선한다. [재귀 실행 코드](https://github.com/google-research/harness2/blob/14fefe7fd33a69c6db975a92f62eec91c6fcf36c/harness2/core/recursion.py)에 유효성 검사·재시도가 있다.
- **중복·한계:** 평가와 반복 개선은 향후 실험 목표와 겹친다. 이를 일반 작업에 자동 적용하거나 우리 환경에서 개선이 재현됐다고 주장할 근거는 없다. [Codex 실행 코드](https://github.com/google-research/harness2/blob/14fefe7fd33a69c6db975a92f62eec91c6fcf36c/harness2/substrate/codex.py)는 샌드박스 및 승인 우회 옵션을 포함하므로 그대로 실행하지 않는다.
- **가설:** 샌드박스를 유지하는 별도 어댑터로 연결할 수 있는지 이후 확인한다. **라이선스:** Apache-2.0. 벤치마크·제3자 자료는 별도 확인. [저장소](https://github.com/google-research/harness2).

## 2. Codex Subagent Router

- **문제·기능:** 하위 에이전트의 모델·추론 강도 선택을 지원한다. [라우터 코드](https://github.com/guilhem/codex-subagent-router/blob/2487cec70242ceba7b5c887ed1d5b7127ffb6e50/plugins/codex-subagent-router/scripts/jev_router.mjs)는 이미 지정한 모델·추론 강도·역할을 건너뛰고, 선택 결과를 요청 입력에 넣는다.
- **중복·한계:** 설정 선택은 향후 팀 선택과 겹친다. 요청 입력만으로 실제 실행 모델이 적용됐다는 증거가 되지는 않는다. 전체 실행 추적 범위는 확인 필요.
- **가설:** 요청 설정과 공식 실행 증거를 분리해 표시할 때 판단이 개선되는지 확인한다. **라이선스:** MIT. [저장소](https://github.com/guilhem/codex-subagent-router).

## 3. Jev Router

- **대상 특정:** 동명 구현이 여럿이라 [flaviusapop/jev-router](https://github.com/flaviusapop/jev-router)를 조사했다. 사용자가 다른 저장소를 지칭했는지는 확인 필요.
- **문제·기능·중복:** [Codex 프록시 코드](https://github.com/flaviusapop/jev-router/blob/0ada4f883127ea9e5cd0e00521b442ce804b17c9/src/codex-proxy.mjs)는 모델 등급과 추론 강도 라우팅을 다룬다. 모델 선택·사용량 절감 목표가 겹친다.
- **한계·가설:** 이 코드만으로 실제 팀 전체 품질·사용량 비교를 확정할 수 없다. 단일 과제에서 품질을 유지한 선택 여부를 별도 검증한다. **라이선스:** MIT.

## 4. Agent Deck

- **대상 특정:** [asheshgoplani/agent-deck](https://github.com/asheshgoplani/agent-deck). 동명 프로젝트가 있어 사용자 의도와의 일치는 확인 필요.
- **문제·기능·중복:** 에이전트 세션 관리와 관측을 제공한다. [비용 명령](https://github.com/asheshgoplani/agent-deck/blob/2e897f2a62f6dd570628d2021a0994a3a7db1f4f/cmd/agent-deck/costs_cmd.go)은 세션·모델·예산을 다루며 [Codex 상태 훅](https://github.com/asheshgoplani/agent-deck/blob/2e897f2a62f6dd570628d2021a0994a3a7db1f4f/cmd/agent-deck/codex_hooks_cmd.go)도 있다. 대시보드·사용량 목표와 겹친다.
- **한계·가설:** Codex 비용 출력 파싱은 해당 README에서 미검증으로 표시한다. 관측 가능 범위와 검증 증거를 사용자에게 얼마나 명확히 제시할 수 있는지 확인한다. **라이선스:** MIT.

## 5. amux

- **대상 특정:** [mixpeek/amux](https://github.com/mixpeek/amux). 같은 이름의 독립 프로젝트가 여럿이므로 사용자 의도와의 일치는 확인 필요.
- **문제·기능·중복:** 에이전트 세션과 사용량을 다룬다. [감사 재생 코드](https://github.com/mixpeek/amux/blob/19211119d9be94ceaf84fde19f005d6640e9bb26/crates/amux-server/src/db/replay.rs)는 읽기 전용 재생과 누락 시 `UNKNOWN`을 다룬다. 감사·누락 처리와 겹친다.
- **한계·가설:** 코드 주석은 turn 단위 계측이 완성되지 않았음을 설명한다. 전체 Codex 이벤트가 재생된다고 확정하지 않는다. 불완전한 기록에서 판단 보류가 유용한지 비교한다. **라이선스:** [MIT + Commons Clause](https://github.com/mixpeek/amux/blob/19211119d9be94ceaf84fde19f005d6640e9bb26/LICENSE), 판매 제한 포함. 순수 MIT로 표기하지 않으며 호환성은 별도 확인.

## 6. Agent Efficiency

- **문제·기능:** 반복 행동·실패·위임 제한·변경 후 검증 누락을 정책으로 다룬다. [정책](https://github.com/agent-efficiency/agent-efficiency/blob/3aec46e34ab2603a45926f9be0a3df7464a9fe03/plugins/agent-efficiency/src/agent_efficiency/bundled/policies/core.json), [검증 영수증](https://github.com/agent-efficiency/agent-efficiency/blob/3aec46e34ab2603a45926f9be0a3df7464a9fe03/plugins/agent-efficiency/src/agent_efficiency/verification/receipts.py)은 검사·작업공간 해시를 통한 증거 신선도를 다룬다. [실험 코드](https://github.com/agent-efficiency/agent-efficiency/blob/3aec46e34ab2603a45926f9be0a3df7464a9fe03/plugins/agent-efficiency/src/agent_efficiency/experiments.py)에 observe/advise 코호트와 과제 집합 해시가 있다.
- **중복·한계:** 가장 직접적인 중복이다. Codex 어댑터의 존재만으로 모든 하위 스레드와 실제 모델 실행이 관측된다고 결론 내리지 않는다.
- **가설:** 같은 과제에서 팀 구성 비교와 관측 누락 설명을 결합했을 때 기존 도구 대비 추가 의사결정 가치가 있는지 검증한다. **라이선스:** [MIT](https://github.com/agent-efficiency/agent-efficiency/blob/3aec46e34ab2603a45926f9be0a3df7464a9fe03/LICENSE). [저장소](https://github.com/agent-efficiency/agent-efficiency).

## 7. AgentPrune

- **문제·기능·중복:** [논문](https://arxiv.org/abs/2410.02506)은 멀티에이전트 통신 중복과 그래프 가지치기를 연구한다. [코드](https://github.com/yanweiyue/AgentPrune/blob/c544dd6a1858c02c6d5d371d23c6e6ff55e0be21/AgentPrune/graph/graph.py#L317)는 공간·시간 연결 마스크를 줄인다. 통신 낭비 감소 목표가 겹친다.
- **한계·가설:** 연구의 실험 결과를 Codex 팀의 일반적 효과로 옮겨 주장할 수 없다. 관측된 반복이 실제로 불필요한지 품질과 함께 평가한다. **라이선스:** 루트 LICENSE를 찾지 못해 확인 필요. [저장소](https://github.com/yanweiyue/AgentPrune).

## 8. OpenCollab

- **문제·기능·중복:** [사용량 원장](https://github.com/RISE-X-Lab/OpenCollab/blob/f4007a4ed4f839138961e83da3b24384752c7789/opencollab/adapters/llm/usage_ledger.py)은 입력·출력·캐시·추론 토큰과 추정 표시를 다루고, [테스트 결과 파서](https://github.com/RISE-X-Lab/OpenCollab/blob/f4007a4ed4f839138961e83da3b24384752c7789/opencollab/adapters/tools/evidence/_test_results.py)는 pytest 결과를 파싱한다. 사용량과 검증 근거는 직접 중복된다.
- **한계·가설:** 이 두 파일만으로 모든 실행기와 테스트 프레임워크의 지원을 판단할 수 없다. Codex 기록의 실제 관측 범위와 누락 설명을 비교한다. **라이선스:** [Mulan PSL v2](https://github.com/RISE-X-Lab/OpenCollab/blob/f4007a4ed4f839138961e83da3b24384752c7789/LICENSE). [저장소](https://github.com/RISE-X-Lab/OpenCollab), [논문](https://arxiv.org/abs/2609.38345).

## 9. CooperBench

- **문제·기능·중복:** 협업 코딩 작업에서 충돌과 성능을 평가한다. [협업 실행기](https://github.com/cooperbench/CooperBench/blob/63b9d44d9f39a02fccf5bf0052db48a917a011fd/src/cooperbench/runner/coop.py), [평가 코드](https://github.com/cooperbench/CooperBench/blob/63b9d44d9f39a02fccf5bf0052db48a917a011fd/src/cooperbench/eval/evaluate.py), [Codex 파서 테스트](https://github.com/cooperbench/CooperBench/blob/63b9d44d9f39a02fccf5bf0052db48a917a011fd/tests/agents/codex/test_parsers.py)가 있다. 단일·협업 비교와 토큰 파싱 자체가 선행 구현이다.
- **한계·가설:** 벤치마크 결과가 모든 실제 작업에 일반화되는지는 확인 필요. 사용자의 로컬 과제에서도 품질·시간·관측 사용량 비교가 재현 가능한지 검증한다. **라이선스:** [pyproject.toml](https://github.com/cooperbench/CooperBench/blob/63b9d44d9f39a02fccf5bf0052db48a917a011fd/pyproject.toml)은 MIT로 표기하나 루트 LICENSE 및 포함된 제3자 코드·데이터셋 조건은 별도 확인 필요. [저장소](https://github.com/cooperbench/CooperBench), [논문](https://arxiv.org/abs/2601.13295).

## 10. Evolving Agent Teams

- **문제·기능·중복:** [논문](https://arxiv.org/abs/2610.36848)은 실행 피드백으로 팀 구성을 개선한다. [설정 파서](https://github.com/caoshiyi/EAT/blob/31588e67ef7b44ccc2233b087bd108733960e441/agent_team/parse_team_config.py)는 역할·시간 제한·모델·최대 팀 크기를 다루고 [감독자 지침](https://github.com/caoshiyi/EAT/blob/31588e67ef7b44ccc2233b087bd108733960e441/agent_team/SUPERVISOR.md)은 팀 개선·사용량 기록을 다룬다. 팀 선택·평가 목표가 겹친다.
- **한계·가설:** 논문 결과를 우리 환경의 재현이나 일반 우위로 주장하지 않는다. [실행 스크립트](https://github.com/caoshiyi/EAT/blob/31588e67ef7b44ccc2233b087bd108733960e441/agent_team/launch_team.sh)의 권한 확인 우회 옵션을 그대로 이식하지 않는다. 명시적 사용자 선택과 안전한 관측을 결합했을 때의 가치를 검증한다. **라이선스:** [Apache-2.0](https://github.com/caoshiyi/EAT/blob/31588e67ef7b44ccc2233b087bd108733960e441/LICENSE). [저장소](https://github.com/caoshiyi/EAT).

## 조사 및 검증 기록

- Search Agent `/root/search`: 조사 완료. 파일 수정 없음. Agent Efficiency·라우터·Harness²·Agent Deck·amux 구현과 라이선스를 조사하고 검증자에게 직접 전달했다.
- Verification Agent `/root/verify`: 독립 조사와 교차 검증 완료. 파일 수정 없음. OpenCollab·CooperBench·AgentPrune·EAT를 조사하고 라우팅 요청과 실행 증거 구분, 라이선스 및 보안상 반례를 확인했다.
- 리더가 Agent Efficiency 실험, amux 재생, Harness² Codex 실행기, Codex Subagent Router의 고정 버전 코드를 별도로 열어 핵심 주장과 일치함을 확인했다.
- 이 조사는 정적 근거에 한정된다. 성능, 실제 환경 연결, 프로젝트 전체 기능과 라이선스 호환성은 실행·별도 검토 전까지 확인 필요다.
