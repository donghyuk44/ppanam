# M6 준비 — 지금 화면이 무엇을 어디서 읽나 · 보고서 탭 데이터 · 알림 묶음 뼈대

2026-09-14 · 테라 · 라운드 25 · 결정 81·92·93·100·105
도면(결정 100, 헨리 1판 `design/out/blueprint-1.md`)이 대표 승인을 기다린다. 화면 모양은 도면 → 낱말 → 피그마 뒤다.
그 전에 할 수 있는 셋을 여기 적는다 — ① 지금 화면이 어디서 무엇을 읽나 ② 보고서 탭이 읽을 데이터가 이미 있나 ③ 알림을 무엇으로 묶나.
**여기엔 화면 모양이 없다.** 새 화면이 답할 질문 둘(대표가 고름, 결정 92)은 **누가 뭘 했나** · **뭐가 막혔나** — 2절이 그 둘을 지금 데이터로 답할 수 있는지 잰다.

## 1. 지금 화면 — 무엇을 어디서 읽나

원천은 하나다: 서버가 팀마다 만드는 **요약**(`server/index.mjs:85 summaryOf`)이 부팅(`/api/boot`)과 ws 방송으로 화면에 온다. 요약은 `bus/bus.mjs teamSummary(1200)` · `peopleOf(1280)` · `bossNotesOf(1360)` 이 `log.jsonl` · `round.json` · `roadmap.json` · `progress.json` · `journal/*.md` · `state/approvals.jsonl` · `state/requests/` 를 읽어 만든다. 화면은 이 요약을 **네 군데서 다르게 잘라 보여 준다** — 그래서 같은 셋이 세 군데에 뜬다(findings #5·#7).

| 화면 | 블록 | 읽는 값 | 원천 | 코드 |
| --- | --- | --- | --- | --- |
| 공통 | 종·알림 패널 | 종류 넷(boss·approval·blocked·report) | `notificationsOf({teams, summaries, approvals})` — summaries 의 bossCall·needsBoss·people[].bossCall·bossNotes + 승인 C. 읽음은 브라우저 localStorage | `public/notify.js` · `app.js:236 renderBossBadge` · `:249 renderBellMenu` |
| 공통 | 승인 카드(맨 위) | 대기 승인 전부(B·C) + preview·artifacts | `/api/approvals` ← `state/approvals.jsonl` | `app.js:1090 renderApprovals` |
| 공통 | 왼쪽 레일 | 팀마다 점(alert·running·idle)·"R n · 마일스톤 m"·배지("대표" 또는 안 읽은 수) | summaries.needsBoss·bossCall·phase·round·milestone; unread 는 브라우저만 | `app.js:161 renderRail` |
| 작전실 | 머리 둘째 줄·라운드 줄 | 자리마다 상태 글자, 판정 중 누구 차례, 반박 n/3 | summary.phase·round·topic·conductor.flow/pending·attempt·sessions[].lastSignal | `app.js:312 renderHead` · `:374 renderWork` |
| 작전실 | 대화록 | 이벤트 8종 | `/api/log?team&before`(페이지) + ws `events` | `app.js:529 draw` · `:717` |
| 작전실 | 상황판 카드 여섯 | 지금 어디까지(doing·blocked·boss·next + 낡음) / 요청 / 이번 라운드 / 로드맵(목적지·마일스톤·컷리스트) / 참여 / 일지 | progress.json · `/api/requests` · summary · roadmap.json · cast+sessions · `latestJournal` | `app.js:397 renderSide` |
| 관제탑 전체 | 타일 셋 | 대표 차례 n · 승인 대기 n · 요청 진행/완료 | `bossTurns()`(needsBoss‖bossCall 방 + 승인 C) · approvals.length(B 포함) · requestsAll | `app.js:1211 renderTowerAll` |
| 관제탑 전체 | 내가 할 일 | 알림의 급한 것(boss·approval·blocked) + 각 방 progress.boss 줄 | notifications + summaries[].progress.boss | 같은 곳 |
| 관제탑 전체 | 팀 다섯 줄 | 알약(대표 차례·대표 부름·막힘·진행 중·대기)·R n·작업 중 누구·승인 대기 n | summaries | 같은 곳 |
| 관제탑 전체 | 오늘 보고 | 대표를 불렀지만 결정은 안 청한 오늘 말(최근 12) | summaries[].bossNotes 중 `!ask` | 같은 곳 |
| 관제탑 팀 | 카드 다섯 + 지시 입력 | summary 전부 + 라운드 열고 닫기 | summaries · `POST /api/say` · `POST /api/round` | `app.js:1534 renderTowerTeams` |
| 관제탑 개인 | 대표 카드 + 열다섯 카드 | 상태 알약(working·bossCall·blocked·waiting·resting)·지금 하는 것(마지막 문장/도구)·오늘 발언 n·오늘 판정 n·일지 첫 문장·모델 고르기 | summaries[].people(`peopleOf` + 세션 상태) · `/api/actor`(인격·일지) · `POST /api/cast` | `app.js:1293 renderTowerPeople` |
| 관제탑 요청 | 요청 블록 목록 | from·to·status·말 | `/api/requests` ← `state/requests/` | `app.js:1522 renderTowerAsks` |
| 분석 | 타일 다섯 + 표 넷 | 끝난 라운드·통과/되돌림/중단·마일스톤 m/n·대화록 n·산출물 n / 라운드 이력·발언 비중·마일스톤·산출물 | `/api/analysis` ← `rounds.jsonl`(60) · log 집계(byActor·tools) · roadmap · `listOut`(out/ **바로 밑 파일만** — `out/shots/`·`out/three/` 는 안 센다, `index.mjs:172`) | `app.js:1730 loadAnalysis` · `:1755 renderAnalysis` |
| 마을 | 3D + 조작판 | 자리·말풍선·시계·다시보기 | `/api/world` + ws `world` · `world/*.json` | `world/world.js` · `index.html:138~154` |

**한 줄로**: 원천은 요약 하나인데 **"대표 차례" 를 세는 코드가 셋**이다 — `bossTurns()`(레일·타일·문서 제목), `notificationsOf`(종·내가 할 일), 팀 줄 알약(`renderTowerAll`). 셋이 조금씩 다른 걸 센다(타일은 승인 C 만, "승인 대기" 타일은 B 까지, "내가 할 일" 은 progress.boss 를 더한다) — findings #6 "3 이야 5 야" 가 여기서 난다. 새로 짤 때 **세는 함수는 하나**여야 한다.

## 2. 대표 질문 둘 — 지금 데이터로 답이 되나

### 누가 뭘 했나

| 있는 것 | 어디 | 모양 |
| --- | --- | --- |
| 사람마다 마지막 한 문장 / 만지던 도구 | `people[].doing` | `{ text, tool, ts }` — **지금** 하나뿐, 이력 없음 |
| 오늘 발언 수·판정 수 | `people[].todaySay`·`todayVerdict` | 수 — "뭘" 이 없다 |
| 일지 첫 문장 / 최신 문단 | `people[].journalFirst`·`/api/actor` | 라운드 닫힐 때 한 문단 — 어제까지 |
| 라운드마다 판정·주제·반박·건수 | `rounds.jsonl` | 팀 단위. 누가 했는지 없음 |
| 판정 카드 | log `verdict` 이벤트 | 누가(review·outside) 무엇에(sha) PASS/REVISE — **사람에게 묶인 "한 것"** 중 제일 또렷 |
| 승인 판정 | `state/approvals.jsonl` `decisions[]` | 톰·제리·대표가 무엇을 통과/반려 |
| 요청 블록 | `state/requests/` | 누가 누구에게 무엇을 넘겼고 닫혔나 |
| 산출물 파일 | `out/` (`listOut` — 바로 밑만) | 이름·크기·시각. 누가 썼는지 없음 |
| 상황판 "한 것" | `progress.json done` | 실무가 손으로 쓴 줄 |
| 커밋 | git | 메시지에 "레오 REVISE R24" 처럼 사람이 글로만. author 는 대표 계정 하나 |

**없는 것**: "한 것" 을 **사람 × 날짜**로 모은 집계가 없다. 지금 화면은 "오늘 몇 번 말했나"(수)와 "마지막 한 문장" 만 보여 준다. 판정 카드·승인 판정·요청 블록·산출물 넷은 파일에 다 있는데 **사람에게 묶는 함수가 없다.** 이게 새 계약이 만들 첫 번째 것이다 — 순수 함수로 `bus.mjs` 에 두고 `round.mjs check` 가 돌리는 모양(peopleOf 와 같은 자리).

### 뭐가 막혔나

| 있는 것 | 어디 | 지금 뜨는 곳 |
| --- | --- | --- |
| 방이 FAIL 로 멈춤 / 반박 3 / 하루 조용 | `summary.needsBoss`·`needsBossWhy` | 레일 점+배지 · 타일 · 내가 할 일 · 알림 blocked · 팀 줄 알약 |
| 누가 대표에게 결정을 청했는데 답 없음 | `summary.bossCall` + `people[].bossCall.text` | 레일 배지 · 타일 · 내가 할 일 · 알림 boss · 팀 줄 알약 · 개인 카드 |
| 대표가 판정할 승인(C) | approvals grade C | 승인 카드 · 타일 · 내가 할 일 · 알림 approval |
| 톰·제리가 판정할 승인(B) | approvals grade B | 승인 카드 · "승인 대기" 타일에만 수로 |
| 열린 요청 블록 — 누가 답을 안 하나 | `state/requests/` status·마지막 말한 쪽 | 관제탑 요청 탭·상황판 요청 카드 — **"기다리는 쪽" 은 안 보여 준다** |
| 실무가 적은 막힌 것 | `progress.blocked` | 상황판 카드만. 관제탑엔 안 온다 |
| 차례가 쌓여 안 나가는 자리 | `conductor.pending`·`inflight` | 라운드 줄 "차례: …" 글자만 |
| **밑바닥이 죽음**(솔라 지적) — 서버 자체 · 레오(codex) 연결 · 세션 죽음 · 디스크 | 서버: 화면만 안다(ws 끊김 `liveDot` · `renderWork` "화면이 서버와 끊김") · codex: `outside.mjs:236` 이 note "외부 모델이 연결되어 있지 않습니다" 를 대화록에 남길 뿐 요약에 표시 없음 · 세션: `sessions[].alive=false` 인데 phase running → `people.state=resting` 으로만 · 디스크: 결정 106 ③ 의 총괄실 경고 note | **어디에도 "막힘" 으로 안 뜬다.** needsBoss 가 방 상태만 보기 때문. 지금은 솔라가 curl 로 손수 본다 |

**있는 것은 다 있다 — 방 안에서는.** 방 밑이 죽은 것은 목록에 없어서 새 목록에 `where: infra` 한 종류를 둔다 — 서버·codex·세션·디스크 넷. 재는 건 서버가 밖에서(솔라: `curl :4321` · `outside.mjs --status` · `state/*sessions.json` 대 실제 프로세스 · `df`), 집계 함수는 값만 받는다(`peopleOf` 와 같은 경계). **잰 값에는 잰 시각과 timeout 을 같이 담는다**(레오) — 마지막 성공값이 남아 죽은 밑바닥이 산 것처럼 보이면 안 된다. 시각이 timeout 보다 오래되면 "모름" 으로.

하네스가 밤새 돌린 시계 둘(밤 시계 2분 · 디스크 시계 20분)에서 넘긴 것 넷 — 그대로 가져간다: ① **틱마다 무조건 한 줄** 남긴다(깨울 때만 남기면 안 도는 걸 모른다) ② 셸을 부르면 **성공했는지 확인**한다(`execFile` 에 `input` 은 동기 전용이라 무시된다 — 빈 말이 나가고 매번 실패) ③ codex 는 3~7분 도는 동안 방이 조용해 보인다 — `conductor.outsideBusy`(`conductor.mjs:165`) 를 같이 본다, 이게 넷 중 codex 항목 ④ 헤드리스 크롬 임시 프로필이 디스크를 채웠다(211개 11GB) — 재는 쪽이 채우면 안 된다. 숫자: 방 멈춤 5분 · 틱 2분 · 같은 방 다시 깨우기 전 8분 · 디스크 경고 3G. 하네스 스크립트는 `out/watchdogs/`(README · nightwatch · diskwatch · village-shot)에 있다 — 진짜가 들어오면 하네스가 끈다. `village-shot.mjs` 는 M6 폰 412 실측에 그대로 쓴다(GPU 없는 깃발 셋 · 끝나면 임시 프로필 지움). 문제는 넷~다섯 군데가 같은 것을 따로 센다는 것**(1절 마지막 줄). 새 계약은 "막힌 것" 을 **한 목록**으로 만든다 — 항목마다 `{ what, who(기다리는 사람), since(언제부터), where(방/승인/요청/infra) }` — 그리고 레일·타일·알림·내가 할 일이 **그 목록 하나를** 자른다. 무게는 `since` 로: 오래 기다린 것이 위.

## 3. 보고서 탭 — 결정 80 의 다섯 항목, 데이터가 있나

| 항목 | 데이터 | 있나 | 비고 |
| --- | --- | --- | --- |
| ① 어젯밤 사이 있었던 일(팀마다 한 줄) | `rounds.jsonl` 마지막 줄들 · log 의 `round_end`·`verdict`·`milestone` · journal 최신 문단 | 있음 | "밤사이" 를 자르려면 결정 101(우리 시각) 먼저 — 지금 `ts` 는 세계표준시 |
| ② 오늘 대표님 차례 | 2절 "뭐가 막혔나" 목록 | 있음 | 같은 목록을 쓴다 — 보고서와 화면이 다른 수를 내면 안 된다 |
| ③ 오늘 각 방이 할 일 | `progress.json next` | 넷만 | dev·design·hq·marketing 에 있음. **finance 는 progress.json 자체가 없다**(`teams/finance/` 실측) — "없음" 으로 나와야 한다 |
| ④ 톰의 한마디 | — | **없음** | 톰이 쓰는 것인데 저장 자리가 없다. 보고서 파일 안에만 있을 값 |
| ⑤ 어제 나온 그림 | `out/**/*.png` mtime · 알림의 `thumb`(`findOutPaths`) | 반만 | 그림은 `out/shots/`·`out/screens/` 같은 **하위 폴더**에 있는데 `listOut` 은 바로 밑만 읽는다(1절). 재귀로 바꾸거나 그림만 따로 |
| + 대표님 대신 정한 것(결정 85 ③) | `hq/out/proxy-decisions.md` + 각 방 note `meta.proxy` | 있음 | 실측 둘 다 1건(디자인 apr_52bac2db, 같은 건). 파일이 흔적, 대화록이 원본(`notifier.mjs:181`) — 탭은 **대화록 줄**을 센다 |
| 보고서 파일 자체 | `teams/hq/out/reports/<날짜>.md` | **없음 — 폴더도 없다** | 결정 80 이 "톰이 쓴다" 인데 아직 한 장도 없다. 탭이 열어 볼 파일이 0장 |

**뜻**: 보고서 탭의 재료 다섯 중 넷은 파일에 있고, 톰의 한마디와 보고서 파일 자체가 없다. 그래서 탭은 두 층이 된다 — **아래층**은 서버가 파일에서 조립하는 것(①②③⑤+대리 결정, 톰이 안 써도 뜬다), **위층**은 톰이 쓴 `reports/<날짜>.md`(④ 포함, 있는 날만). 어느 쪽이 정본인지는 계약에서 정한다 — 내 생각은 아래층이 정본, 톰 글은 그 위에 얹는 한 문단. 도면 뒤에 묻는다.

## 4. 알림 — 무엇으로 묶나 (뼈대만)

지금(`notify.js`): 종류 넷 순서 고정(boss → approval → blocked → report), 같은 종류 안은 최근순, 총괄실 교차 글만 합침. findings 1~4 가 이 위에서 난다.

뼈대 — **대표 질문 둘이 곧 묶음 둘**이다:
- **막힌 것** = 2절의 "막힌 것" 목록 그대로(boss·approval C·blocked·요청 블록 답 기다림). 순서는 `since` — 오래 기다린 것이 위. 여기가 빨강.
- **한 것** = report + 판정 PASS + 마일스톤 통과 + 라운드 닫힘 + 새 그림. 최근순.
- 묶음 안에서 **같은 사람의 연속 항목은 한 덩어리**(findings #4) — 머리 한 줄에 이름·팀, 밑에 항목들.
- 오른쪽 60px 팀 상자는 없앤다(findings #2) — 이름 옆에 팀이 이미 있다. 그림이 있을 때만 그 자리에 썸네일.
- 본문은 안 자른다(findings #1) — 160자 그대로, 접힘은 덩어리 단위.
- 종이 보고에 우는 것(findings 맨 위): `asksBoss` 를 순수 함수 시험으로 — 완료 보고 꼴("…했습니다·됐습니다·넣었습니다·확인했습니다") 이고 물음표·부탁 동사가 없으면 보고.

계약 자리는 `docs/event-schema.md` 3절 "알림 패널"(230행) — **도면 뒤에 고쳐 쓴다.** 낱말(막힌 것·한 것)은 하영 몫이라 여기 이름은 임시다.

## 5. 마을 조작판 (결정 105) — 손잡이 실측

`index.html:138~154` 에 누를 수 있는 것 **열하나**(마을·회사 · 어디로 · 이동 · 팀 · 라운드 · 재생 · 속도 · 배율 · 따라가기 · 시험용 시각) + 재생 중에만 뜨는 멈춤 + 글자 둘(시계·상태). 폰 412 에서 줄 다섯(결정 105 실측).

기준 "처음 들어온 사람이 손잡이를 하나도 안 만지고 마을을 볼 수 있는가" 로 가르면:
- **안 만져도 되는 것(기본값이 답)**: 장면=마을 · 시각=실제 · 속도·배율·따라가기=기본. 처음 온 사람은 아무것도 안 눌러도 지금 마을이 보여야 한다 — 지금도 그렇긴 한데 **줄 다섯이 마을을 가린다.**
- **늘 보일 것 하나**: "어디로 갈까"(마을·회사 + 어디로 + 이동 → 하나로).
- **서랍(눌러야 열림)**: 다시보기(팀·라운드·재생·멈춤·속도·따라가기) · 시험용 시각.
- **없앨 후보**: 배율 — Three.js MapControls 휠·핀치가 이미 한다(컷리스트 "캔버스 마을에 휠·핀치 줌 넣기 — MapControls 가 대신한다").

이것도 화면 모양이라 **헨리 시안 뒤**에 만든다. 다만 조작판은 도면(구조)과 무관한 마을 탭 안 일이라, 도면 승인을 안 기다리고 헨리에게 먼저 물어도 된다 — 대표님 판단.

## 6. 로드맵 M6 글이 결정 92 와 어긋난다

`teams/dev/roadmap.json` M6 deliverable 에 "24 분석 탭은 대표가 out/analysis-inventory.md 에서 고른 항목만 남기기" 가 남아 있다. 결정 92 가 그 물음을 "잘못된 물음" 이라 했다 — 항목 고르기가 아니라 새로 짜기. 로드맵 고치기는 C 라 여기 적어 두고 대표님께 올린다.

## 7. 순서

도면 1판 승인(대표) → 낱말 여섯(하영) → 헨리 피그마 시안 → **계약 먼저**(`event-schema` 에 대시보드 탭·보고서 탭 새 절, 알림 패널 개정, "막힌 것"·"한 것" 집계 함수 모양) → 화면 → 폰 412 실측 → 레오.
계약에 들어갈 집계 함수 둘(2절)은 도면과 무관하게 지금 순수 함수로 만들어 둘 수 있다 — 화면이 없어도 `round.mjs check` 로 돌아간다. 이건 대표님·헨리 답 기다리는 동안 하겠다.
