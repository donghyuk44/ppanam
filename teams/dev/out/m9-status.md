# 9단계 현황 나머지와 뒷정리 — 상황 (R29, 테라)

로드맵 9단계(apr_d378699b 통과, 착수 apr_abcda678). 통과 조건: ①②③ 각각 412 한 장 · 나리가 412 로 셋 눌러 보고 못 깨뜨림 · 레오 PASS.
커밋 — 69958c0(①) · 7b75d0f → 345c56b · 5a93b40(③) · bd2e65b(④). 곁: e7e6efa(T1~T9, 이 단계 전) · fd3301c · 6e89515(디자인 6단계 head=1). 재시작 셋(apr_aea4134f · apr_221f8a20 · apr_f19d8c94), 나리가 켬.
사진(나리, out/shots/): r29-tower-teams-412 · r29-tower-people-412 · r29-person-pop-412 · r29-analysis-412 · r29-dashboard-412(T1~T9). 결재 팝업은 대기 카드가 있을 때.
오늘 밤 화면을 두 번 깨뜨렸다(02:33 괄호 · 02:5x analysisPicture) — 서버가 작업 트리 app.js 를 그대로 내주는데 편집 중간 상태를 저장했다. 그 뒤로 app.js 는 out/ 사본에서 고쳐 node --check 뒤 통째로 바꿔 넣는다.

## ① 현황 팀 탭 = 헨리 team.svg · 사람 탭 = person.svg — 69958c0

팀 카드(관제탑 팀 탭, `renderTowerTeams`) — 시안 2판-b 위에서 아래로:

| 시안 | 화면 | 값 |
| --- | --- | --- |
| 머리 — 팀 · 알약 | `.tcard__top` — 0-1 방 이름(총괄실·마케팅팀·개발팀·디자인팀·경영팀) + `pill` | 알약 글자는 현황 ④ 팀 줄과 같은 넷 |
| "1장 4단계 화면 시안 · 16회차 · 검토 기다림" | `.tcard__sub` — `N단계 제목 · N회차` (+ 대표 차례면 왜) | "1장" 은 안 옮겼다 — 뜻을 못 정했다(헨리에게 물을 것) |
| 단계 3/6 — 끝난 것 채움 · 지금 굵은 테두리 + 회차 네모 · 남은 것 점선 | `.tcard__stage[data-st=pass|now|wait]` + `.tcard__rounds` | 요약에 새로 실은 `milestones[]`·`roundsInMilestone` — **서버 재시작 뒤** |
| 이 회차 — 하는 것 · 막힌 것 · 대표님이 보실 것 · 다음 | `.tcard__kv` 넷, 막힌 것 빨강, 없으면 "없어요" | progress.json 글자 그대로 |
| 다른 팀에 부탁한 일 N | `.tcard__ask` — 이 팀이 연 열린 요청 블록, 누르면 요청 탭 | requestsAll(팀 탭에서도 받아 옴) |
| 사람 — 칩 · 이름 직책 · 하는 일 · N분 전에 움직임 · 알약 | `.tcard__person`, 누르면 사람 카드 | people[자리] |
| (시안에 없음) 마지막 발언 · 진행 막대 · 접힌 상황판 | 뺐다 | |
| (시안에 없음) 말하기 · 회차 시작/마무리 줄 | 뒀다 — 대표 손잡이 | 나리·레오 판단 — 시안대로 빼려면 한 줄 |

사람 카드(`personCard`) — 시안 2판:

- 줄 셋: 이름·직책·알약 / 지금 하는 일 / N분 전에 움직임. 쉬는 중·자리 비움은 "왜 · N분 전에 움직임" 한 줄.
- ▸ 대표님께 물어봄 — `▸ "…" · N분 전`(bossCall, 있을 때만).
- ◂ 대표님이 부르셨어요 → 받았나 — **새 값** `people[자리].bossAsk { id, ts, text, replied }`(이 라운드 대표가 이름을 부른 마지막 말, via 아님). 화면: 답했어요 · N분 전 / 받았어요, 답 쓰는 중 / 자리 비움 / 못 와요 · 왜. **서버 재시작 뒤**.
- 뺀 것: 일지 첫 문장 줄(시안 메모 "일지 줄 없음" — 마을 카드에는 그대로). 둔 것: 엔진·모델·강도 줄(결정 69, 대표 손잡이).
- 계약: docs/event-schema.md 3절 사람별 집계 `bossAsk` · 도구 줄 절 밑 "단계 목록". check 102 ✓ (bossAsk 새 줄).

412 사진: 나리 — `#dev/tower` teams · people. 이 세션은 screen-shot.mjs 가 막혀 있다.

## ② 결재 카드 연 팝업 412 — 만든 것 없음(7단계 이월은 사진뿐)

결재 알약 → `openApprovalPop` 팝업은 7단계(R26·27)에 이미 있다. 남은 건 412 사진 한 장 — 나리.

## ③ 분석 — 헨리 분석 1판(analysis.svg, 09-16 02:34)대로 다시 — 345c56b · 5a93b40

7b75d0f(첫 층 그림 한 층만)는 나리 R29 실측에서 걸렸다 — 옛 타일이 자기 통계·하나짜리, 표가 412 에서 무너짐. 헨리 1판이 그 사이 왔고(하영 대조 req_024d2098) 그대로 지었다.

| 칸 | 그림 | 문장(하영 3-2) | 값 |
| --- | --- | --- | --- |
| ① 어디서 자꾸 막히나 | 팀마다 같은 자 띠 — 옅음 = 올린 결재, 짙음 = 돌려보낸 것, 튀는 팀 하나만 빨강 | 돌려보낸 결재 — {팀} a건 중 b(다섯 팀 같은 순서) | `stuckOf`: 팀별 카드 수 / REVISE 를 받은 카드 수(무효 뺌) |
| ② 무엇이 느려졌나 | 지난 회색 · 이번 위·아래 색 띠 둘, 같은 자 | {팀} 회차 길이 — 지난 회차 N → 이번 회차 M · 멈춘 N은 뺐어요 | `slowedOf`: 닫힌 회차 마지막 둘(시험 회차 뺌, 멈춤 뺌). 제일 나빠진 팀 · 제일 좋아진 팀 |
| ③ 같은 일이 몇 번째인가 | 회차 네모를 같은 자리에 겹침, 세 번째부터 빨강, 네모 수 = 값 | {팀} {카드} — {때}·{때}, 같은 자리에서 세 번째에 통과 / {팀} N단계 — a회차부터 b회차(사이가 비면 "사이 N회차에 걸쳐") | `repeatsOf`: 같은 카드(`(2차 …)`·`(… 고침)` 꼬리 뗌) · 같은 단계 여러 회차 |

빈칸 말: 견줄 회차가 아직 없어요 — 회차 둘이 끝나면 떠요 · 같은 자리를 두 번 간 일이 없어요. 세 겹: 그림+문장 → 펼친 줄(어느 카드·어느 회차) → 결재 카드(대기 중) / 그 방.
서버 문 `GET /api/analysis?all=1` → `{ now, teams, stuck[{ team, what, total, count, ids, worst }], slowed[{ team, what, prev, cur, pausedMs, prevRound, curRound, curStartedAt, dir }], repeats[{ team, kind, what, at[], ids?, nth, passed }] }` — 시안 113행. 순수 함수 셋 + `cardBase`·`roundLensOf`, check 104 ✓.
뺀 것: 옛 타일(끝난 회차·통과·단계·대화 기록·낸 것)·회차 표·발언 막대·단계·낸 것 표 — 자기 통계·하나짜리. 옛 `/api/analysis?team=` 문은 남아 있다(안 부른다).
나리 실측(02:58 재시작 뒤): 정본 조건 통과 · 깨뜨린 것 둘(회차 네모 수 = 값 · "사이 N회차에 걸쳐") → 5a93b40. 412 사진: `out/shots/r29-analysis-412.png`(5a93b40 전 것 — 다시 찍을 것).

## ④ 뒷정리

| 항목 | 한 것 |
| --- | --- |
| 임시 파일 셋 | **못 지웠다** — 이 세션은 `.claude/` 밑 경로라 rm 이 막힌다. 지울 목록: `tools/tmp-blocked-check.mjs` · `tools/tmp-bosscall.mjs` · `tools/tmp-mark-sample.mjs` · `tools/tmp-r28-survey.mjs` · 루트 `tmp-boss-lines.mjs` · `tmp-bosscall.mjs` · `tmp-frames-data.mjs` · `tmp-svg-text.mjs`(누구 것인지 모름 — 헨리 svg 글자?) · `state/m8-break.json` · `state/m8-failures.bak` · `teams/dev/out/_app-check.mjs` · `_lineup-check.mjs` · `_build-roadmap-proposal.mjs`(내 것). m8-break·m8-kill·m8-ps·m8-seed-budget 은 8단계 시험 도구라 둔다(node --test 로 돈다). 나리 또는 솔라 손 |
| 조사 고침 9cfd994 확인 | 재시작(apr_aea4134f)으로 떴다. 틀린 조사 마지막 실물은 16:31Z "레오이 답을 못 냈습니다"(고치기 전). 고친 뒤 실물은 다음 레오 실패 note 때 — 지금은 코드(`toollabel.js ga/eul`)로만 |
| bossQuietFor 의 via 인용 제외 | `bus/bus.mjs bossQuietFor` — `e.actor === 'boss' && !e.meta?.via` 만 센다. 코드로 확인, 이미 그렇다 |
| 총괄실이 받는 부탁을 실장이 닫을 수 있게 | bd2e65b — `requests.mjs rolesOf`: 톰은 chief 이면서 to/from hq/chief 자리. 전엔 자기 앞 부탁에 done, 자기가 낸 부탁에 ack 을 못 썼다. check 103 ✓. CLI 는 바로, 서버 쪽은 재시작 뒤 |

## 재시작

69958c0(bus.teamSummary milestones·peopleOf bossAsk) · bd2e65b(requests.mjs) 는 서버가 다시 떠야 화면에 온다 — B 카드 따로. 옛 서버 + 새 app.js 는 단계 목록만 비어 보이고 깨지진 않는다.

## R30 — 잔손질 2 (나리 여섯, 09-16 새벽)

| # | 무엇 | 커밋 · 실측 |
| --- | --- | --- |
| ① 결재 팝업 412 | 대기 카드(apr_d69cfc35 재시작)로 나리가 찍음 — `out/shots/r30-approval-pop-412.png`. 잡은 둘(카드 '왜'·'원문' 같은 글 · 대표 단추 자리에 "지금은 톰·제리가 정해요" 없음)은 총괄실 → 잔손질 3 | 나리 04:2x |
| ② 마을 이름표 낱말 | `map.json` 카페→찻집 · 개발·디자인·마케팅·경영 작전실→N 방. jq 로 라벨 열여섯 다시 셈, 코드는 zone 열쇠로 찾아 글자만 바뀜 | 89088b6 |
| ③ 계약 345행 옛 문장 | 분석 줄에서 "항목은 대표가 out/analysis-inventory.md 에서 고른 것만" 삭제(안젤·하영, 정본 41~44행과 안 맞물림). 같은 줄의 "칸 셋은 H4 뒤" 도 345c56b 로 이미 된 일이라 지금 물건대로 다시 씀 | 411e834 |
| ④ 반쪽 app.js 서빙 막기 | 솔라 — `server/src/app.js` 원본, `npm run build:public`(tools/build-public.mjs) 이 `node --check` 뒤 temp+rename 으로 `public/` 에. public 을 직접 고치면 다음 빌드가 덮는다(머리 주석·상황판) | 23c5ee8 안(정정 353eef3) · 나리 04:22 실행 ✓ |
| ⑤ 감사 자리(결정 125) | `round.json auditor` — `round.mjs start --auditor ops` · `auditor ops` · `end --next --auditor` · `/api/round` start(솔라). 판정 카드를 낼 수 있는 자리 = outside · review(있으면) · auditor(`bus.verdictSeats`), 밖은 `recordVerdict` 거부(say.mjs 도). 흐름 안 걸음 = auditor ?? review. 닫는 조건 6 — 만든 사람 규칙을 파일 단위로(`editsOf`·`selfPassError`): 자기가 고친 파일을 남도 고쳤으면 거부, 아니면 그 고침 뒤 다른 자리 PASS 가 있어야. 계약 7절 "감사 자리" + 닫는 조건 6(R25 규칙이 코드에만 있었다). check 105 | 23c5ee8 · 83b317a(조사) · R30 실측: 테라 `--as guide --verdict` → "감사 자리가 아닙니다" 거부, `auditor ops` → note |
| ⑥ 로드맵 교체 뒤 열린 회차 단계 | 솔라 — `notifier.mjs applyAction` 마일스톤 착수 분기: 열린 라운드가 있으면 round.json milestone·attempt 를 새 값으로. 개발 R29·경영 R3 두 번 난 병(13:59Z 착수는 고침 전이라 경영 M2 는 나리가 손으로 pass) | 23c5ee8 안(정정 353eef3) |

곁: `parts.json` hq-system(나리) 한 줄 — 헨리 req_3284923e, b36e8e9(톰 확인으로 닫힘). 이 회차 감사 자리 = 솔라(04:14 note). 재시작 카드 apr_d69cfc35 — ⑤⑥·/api/round 는 켜야 돈다.
공유 index 사고 둘(23c5ee8·353eef3 이 솔라가 스테이징한 파일을 쓸어 담음) — 정정 커밋으로 남기고, 그 뒤부턴 `git commit -- <경로>` 로 그 파일만.
