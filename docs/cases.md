# 실패 사례 카탈로그 — 남들이 깨진 곳, 우리가 깨진 곳

살아 있는 에이전트 마을을 만들려는 시도는 여럿 있었고 대부분 같은 자리에서 깨졌다.
이 파일은 그 자리를 모은다. **잘 된 것이 아니라 깨진 것을 모은다.** 설계 결정의 근거가
"좋아 보여서" 가 아니라 "저기서 깨졌으니까" 여야 하기 때문이다.

살아 있는 문서다. 사고가 나면 한 줄 늘린다. 형식: 번호 · 출처 · 증상 · 원인(그들의 진단) ·
우리 대응 · 반영 위치. 근거 없는 줄은 쓰지 않는다 — 출처를 열어 확인하고 쓴다.

## 사례

| # | 출처 | 증상 | 원인(그들의 진단) | 우리 대응 | 반영 위치 |
| --- | --- | --- | --- | --- | --- |
| 1 | 순순빌리지 ep2 0:33 | 대화가 쳇바퀴처럼 같은 얘기를 돈다 | 루틴·이벤트 부재("각자의 루틴이 있으면 어떨까") | 사회자의 브레이크·침묵 간격·시간당 상한, 세상의 시계 루틴, 라운드(일감)가 대화의 축 | `server/conductor.mjs` · `server/world.mjs` |
| 2 | 순순빌리지 ep2 1:28 | 기억이 중첩되지 않고 덮어써진다("하나의 저장소만 갖다 보니") | 저장 구조 | append-only 일지 + 라운드 컨텍스트 + 요약 색인 | `teams/<팀>/journal/` · `rounds.jsonl` |
| 3 | 순순빌리지 ep2 2:00 | 없는 인물 '린' 을 만들어 셋이 확신하고 대화가 그 위에 쌓임 | 근거 검증 없음 | 캐스트는 닫힌 집합, 호명은 cast 로 검증, 근거 없는 인용 금지, 외부감사가 사실을 본다 | `bus/bus.mjs addressee` · CLAUDE.md |
| 4 | 순순빌리지 ep1 3:24·5:19·7:14 | 창조주의 이벤트를 무시("They don't seem to care"), 비밀 임무를 남에게 말함, 자기가 스파이인 줄 모름 | 메타데이터 "창조주 반응에 무관심", 역할이 프롬프트뿐 | 대표 발언은 최우선 턴, 원문 그대로 배달, 자리 = 프로세스 | `server/conductor.mjs` · `bus/dispatch.mjs` |
| 5 | 순순빌리지 ep1 9:32 | 기억이 밀려나 임무를 잊음("his memory got pushed back") | 컨텍스트 밀림 | 세션이 뜰 때 일지 앞 N문단 + `decisions.md` 해석을 다시 넣는다 | `server/session.mjs assemblePrompt` |
| 6 | 순순빌리지 ep2 5:20 | 메타데이터+시스템 프롬프트+기억+상호작용이 쌓여 프롬프트가 꼬임 | 스택 무제한 | 조립 함수 하나, 층은 셋(인격·일지·라운드)으로 고정, 크기 상한 | `server/session.mjs` |
| 7 | 순순빌리지 ep2 2:32 | 계속 볼 수 없어 요약 에이전트 SAI 를 따로 만들어야 했다 | 관람의 한계 | 관제탑이 첫 화면, 톰의 하루 한 장(자정 마감), 마을은 관람용 | 관제탑 · M2 |
| 8 | 순순빌리지 블로그 | 관전 스트리밍이 자주 끊김, 모바일 없음 | 급한 개발 | 로컬 WebSocket, 재접속 시 재동기화, 모바일은 나중 | `server/public/app.js` |
| 9 | 순순빌리지 블로그 | "AI 로 프로토타입은 되지만 서비스 수준은 추가 작업이 많다", 게임 개발을 모르는 팀원 | 프로토타입 ≠ 서비스 | 로컬 도구로 한정, 엔진 없이 Canvas, CC0 에셋 | 마을 탭 설계 |
| 10 | 순순빌리지 ep1 1:52 | 캐릭터마다 다른 모델(Sonnet 4.6 / GLM 4.7 / Nova 2 Lite) — 싼 모델도 역할에 따라 충분 | 비용 | 자리별 모델 티어 | `cast.json` · M6 |
| 11 | 순순빌리지 ep1 6:02 | 말이 안 끊겨 "대화 중 끼어들기 금지" 를 기능으로 넣음 | 동시 발화 | 한 방 한 목소리 — busy 면 큐, 큐는 합쳐서 한 턴 | `server/conductor.mjs` |
| 12 | Stanford 스몰빌 §7.2 | 기억이 커지자 장소를 잘못 고름(점심을 바에서) | 검색·선택 실패 | 장소는 LLM 이 정하지 않는다 — 세상의 시계와 방 상태가 정한다 | `server/world.mjs` |
| 13 | Stanford 스몰빌 §7.2 | 사용 중 화장실에 들어감, 닫힌 가게에 들어감 | 공간 규범 미이해 | 같음 | `server/world.mjs` |
| 14 | Stanford 스몰빌 §7.2 | 지시 튜닝 탓에 과잉 공손, "거의 거절하지 않음", 남의 관심사를 제 것으로 | 모델 성향 | 감사역은 다른 엔진, "합의 만들지 마라", 판정은 첫 줄 한 단어 | `teams/*/outside.md` · 판정 규약 |
| 15 | Stanford 스몰빌 §7.2 | 윤색("내일 발표할 거래"), 이웃을 18세기 경제학자 애덤 스미스로 | 세계지식 혼입 | 파일 근거 · 외부감사 대조 | CLAUDE.md |
| 16 | Stanford 스몰빌 §8 | 25명 2일 = 수천 달러 · 며칠 | 호출 수 | 듣기는 공짜(차례에 몰아 읽기), 밤엔 정지, 상한, 상주 프로세스는 놀 때 0 | `server/conductor.mjs` |
| 17 | AI Town #283 · #284 | 작별 인사 20회+ 루프, 대화를 못 끝냄 | 종료 조건 없음 | 종료는 코드 — 브레이크, 첫 줄 판정, (패스) | `server/conductor.mjs` |
| 18 | AI Town #284 | LLM 호출 600초 타임아웃, 엔진 재시작 반복, 세대 불일치 | LLM 을 루프 안에서 기다림 | 사회자는 기다리지 않는다(큐), 턴 타임아웃 · 1회 재시도 · note | `server/session.mjs` · M3 |
| 19 | AI Town ARCHITECTURE.md | (교훈) 시뮬레이션과 LLM 분리, 2인 대화 상태기계, 히스토리 버퍼로 부드러운 이동 | — | 상태는 서버, 연출은 브라우저 | 마을 탭 설계 |
| 20 | CAMEL · ChatDev | 역할 뒤집힘, 지시 반복, 빈 약속("I will…"), 감사 인사 무한 루프 | 역할이 프롬프트뿐 | 자리 = 프로세스(역할 뒤집힘이 구조적으로 불가), 중계 문장 금지 + (패스) | `server/session.mjs` · 인격 파일 |
| 21 | MAST (arXiv 2503.13657, 1,642 trace, 실패율 41~87%) | 단계 반복 15.7% · 종료 조건 미인지 12.4% · 추론-행동 불일치 13.2% · 검증 부재/오검증 17.3% | 조직 설계 결함 | 종료·반복은 사회자 규칙, 검증은 감사 2인 + 파일 근거 + 승인 SHA 대조 | `server/conductor.mjs` · `server/executor.mjs` |
| 22 | Project Sid (Altera) | "Sure thing!" 하고 다른 행동, 상상의 곡괭이, 환각이 사회적으로 전파 | 병렬 출력 모듈 | 행동 채널이 없다 — 마을의 연출은 기록된 사건에서만 파생된다 | `server/world.mjs` · 마을 탭 |
| 23 | Project Sid | 내재 동기(생존·호기심) 부재로 사회가 스스로 발전 안 함 | — | 동기는 로드맵·마일스톤·라운드가 준다. 자유 사회가 아니라 일하는 조직 | `teams/*/roadmap.json` |
| 24 | "The Failure Happens Before the Drift" (arXiv 2609.05514) | 페르소나 절반이 처음부터 발현 안 됨, 상세 인구통계가 오히려 해침, 설득체가 불성실 예측, 문체 동질화 | 모델 사전분포 | 말투 표본, 인격 스모크 테스트, 보고서·설득 말투 금지, 인격은 짧게 | `bus/cast.mjs check` · 인격 파일 |
| 25 | "Attractor States" (arXiv 2606.30571) · Persona Collapse | 모델 고유 끌개로 대화가 수렴, 한 모델의 특성이 상대에 전염 | 자기 대화 | 방마다 엔진을 섞는다, 다른 엔진이 감사한다 | `cast.json` |
| 26 | LLM NPC 게임 평가 | 잠근 캐릭터는 반복·지루, 푼 캐릭터는 환각으로 줄거리 파괴 | 양극 | 일이 있는 방(줄거리 = 로드맵), 잡담은 점심 한 칸 | `server/world.mjs` |
| 27 | 우리 09-01 (`docs/plan.md` 부록 B) | `Stop` 훅 async → 마지막 발언 7회 중 6회 유실 | 종료 경계의 경합 | 종료 훅은 동기 + timeout — 회귀 검사 항목 | `.claude/settings.json` |
| 28 | 우리 09-01 09:20 (마케팅 대화록) | 하네스 세션의 보고가 마케팅 방에 기록됨 | `defaultTeam()` 폴백 | 방이 지정되지 않은 세션은 기록하지 않는다 | `.claude/hooks/to-bus.mjs` |
| 29 | 우리 09-02 (Fable 감사) | 제리의 대조 REVISE 가 총괄실 반박 카운터에 쌓여 대표 호출로 잠길 뻔 | 라운드 없는 방 | 총괄실은 세지 않는다 | `bus/bus.mjs recordVerdict` |
| 30 | 우리 09-02 (총괄실 대화록) | 검증 데이터 6건이 승인 큐에 실물처럼 남음, 톰이 없는 `out/` 을 "확인" 하고 PASS | 판정 근거 미검증 | void 기록, 톰의 판정 기준은 파일 실재 | `bus/approve.mjs --void` · `teams/hq/chief.md` |
| 31 | 우리 09-02 04:34 (개발 대화록) | FAIL 두 번 뒤에도 작업 계속, PASS 로 경고 소거 | 규칙이 산문뿐 | FAIL 은 `phase: blocked` — 대표의 말로만 풀린다 | `bus/bus.mjs recordVerdict` |
| 32 | 우리 09-01 R14 (마케팅 대화록) | "둘 다 돌고 있습니다"·"답 오면 붙이겠습니다" 중계가 대화록 절반 | 턴은 끝나야 하고 끝나면 기록됨 | (패스) + 인격, 사회자가 매 턴 "말할 게 없으면 패스" 를 명시 | `server/conductor.mjs` |
| 33 | 우리 09-01 R9 (마케팅 대화록) | 다니엘이 첫 턴만 듣고 이후 귀머거리 → 대표: "서로 대화 안 하는데?" | 통로 없음 | 커서 기반 듣기 — 차례가 오면 지난번 이후 새 말을 전부 읽는다 | `bus/outside.mjs` · `server/conductor.mjs` |

## 출처

- 순순빌리지: https://soonsoon.io/ai-spum-agent-soonsoon-village/ (2026-03-17) · 에피소드 1 https://www.youtube.com/watch?v=4vEnaoGR9Dw · 에피소드 2 https://www.youtube.com/watch?v=1cwoPreqrJ0
- Generative Agents: Interactive Simulacra of Human Behavior — arXiv 2304.03442 §7.2 Boundaries and Errors, §8 Discussion
- AI Town (a16z-infra): https://github.com/a16z-infra/ai-town — ARCHITECTURE.md, issues #283 "Agents stuck in goodbye loop", #284 "Multiple Critical Failures"
- CAMEL — arXiv 2303.17760 · ChatDev — arXiv 2307.07924
- Why Do Multi-Agent LLM Systems Fail? (MAST) — arXiv 2503.13657
- Project Sid: Many-agent simulations toward AI civilization — arXiv 2411.00114
- The Failure Happens Before the Drift — arXiv 2609.05514 · Attractor States Emerge in Multi-Turn LLM Conversations — arXiv 2606.30571
- 우리 사고: `teams/*/log.jsonl`, `docs/plan.md` 부록 B, `teams/dev/progress.json`

## 사고가 나면

1. 대화록에서 줄을 찾아 **번호·시각**을 적는다. 기억으로 쓰지 않는다.
2. 증상과 원인을 나눈다. 원인을 모르면 "미확인" 이라 쓴다.
3. 대응이 코드면 파일 경로를, 규칙이면 문서 절을 적는다. "주의한다" 는 대응이 아니다.
