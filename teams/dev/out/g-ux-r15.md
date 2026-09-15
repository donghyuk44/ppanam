# R15 G-UX 둘째 — 반나절 A "지금 상태를 바로 알기" (2026-09-13)

배분(시스템 05:01): A = 검수 #1 · #5 · #10 + 결정 31 헤더 한 줄 → B = #2(결정 20·20-2) · #8 · #13 · #3 · #9 + 결정 34 종 배지.
한 커밋에 한 반나절. 이 파일은 A 다.

## 들어간 것

| # | 증상 | 어디 | 어떻게 |
| --- | --- | --- | --- |
| #1 | 방에 들어가면 일하는 사람이 "자는 중" | `server/index.mjs` `summaryOf()` · `/api/team` | 부팅·방송이 쓰던 요약 조립을 `summaryOf(team)` 으로 떼어 `/api/team` 도 같은 것을 준다(세션·차례·캐스트 포함). 전에는 `teamSummary` 만 줘서 `summary.sessions` 가 비었다 |
| #1 | 소켓 hello 의 요약을 버림 | `app.js` ws.onmessage | hello 의 `summaries` 도 반영. `selectTeam` 은 받은 요약을 `summaries[id]` 에도 넣어 레일·관제탑과 어긋나지 않게 |
| #5 | 폰에서 누가 듣는·일하는 중인지, 서버와 끊겼는지 볼 곳이 없음 | `app.js` `renderWork()` · `index.html` `#liveDot` | 헤더 둘째 줄(전에는 이름 나열)이 "테라 작업 중 · 솔라 듣는 중 · 레오 자는 중". 연결 점은 칩(폰에서 숨음) 밖으로 빼고, 끊기면 둘째 줄 앞에 "화면이 서버와 끊김 — 다시 붙는 중" |
| 31 ① | 생존 표시 | `session.mjs` `arm()`·`status()` · `app.js` `renderWork()` | 서버가 스트림 이벤트를 받은 시각을 `sessions[자리].lastSignal`(10초 단위)로 싣고, 라운드 줄이 일하는 세션이 있으면 항상 "테라 작업 중 · 마지막 신호 2분 전 (· 대기 N)". 30초마다 다시 센다 |
| 31 ③ | 15분 닫힘 문구 | `session.mjs` `arm()` | "…아무 신호가 없어 세션을 닫았습니다" → "— 15분 동안 신호 없음(도구 호출도 출력도). 세션을 닫았습니다. 다음 지시로 이어집니다." |
| #10 | 관제탑 카드 마지막 줄이 파일 경로·CLI 문장 | `bus.mjs` `teamSummary` · `app.js` renderTower · `toollabel.js` `toolPhrase` | `lastText/lastActor/lastAt` 는 마지막 message·verdict 만. 그 뒤 도구 줄은 `lastTool` 로 따로 → 카드에 "테라 · app.js 고치는 중 · 2분 전". 본문은 `bubble()` 로 굵게·기호 정리(말풍선 모양은 CSS 로 벗김, 세 줄 클램프) |
| 시스템 ② | "실무이 일하는 중" 조사 오류 | `app.js` | 고정 문자열 삭제 — 이름으로 "테라 작업 중". 관제탑 카드의 "일하는 중" 도 이름으로 |
| 시스템 ① | `#bossBadge` 글자 "대표 차례 2" 인데 hidden | `app.js` renderBossBadge | 지금 대표 차례 0 (bossCall·needsBoss 전부 null, 대기 승인 없음 — `round.mjs status`·`approve.mjs --list` 실측). 숨김이 맞고 글자만 옛것이 남은 것. 숨길 때 글자도 비우게 고침 |
| — | 계약 | `docs/event-schema.md` | `lastTool` · `sessions[].lastSignal` · 생존 표시 절 · `/api/team` 요약 모양 · 15분 문구 |
| — | 자가 시험 | `bus/round.mjs check` | 둘 추가 — 발언 뒤 tool·note 를 넣고 `lastText` 가 발언인가 · `lastTool` 이 "guide · app.js 고치는 중" 으로 풀리나. 16/16 ✓ |

## 안 한 것

- 결정 31 ② "5분 동안 방에 아무 줄도 안 남으면 서버가 '○○ 아직 작업 중(N분째, 마지막: app.js 고치는 중)' note" — 배분이 "헤더 한 줄" 이라 안 넣었다. `lastSignal`·`toolPhrase` 가 생겼으니 붙이면 십여 줄. B 에 넣을지 대표·시스템이 정한다.
- 결정 32 ⑤ "초록 점은 살아 있는 세션만" — 칩 점은 이미 `stateOf` 로 off 면 회색이다. 둘째 줄 글자도 같은 값. 별도 수정 없음.

## 안 돌려본 것 (정직하게)

- 서버는 R14 코드(04:56)로 떠 있고 이 세션이 그 위에서 일하는 중이라 재시작하지 못했다. `lastSignal`·`/api/team` 요약·헤더 줄은 **새 프로세스에서만 산다.** 재시작 뒤 `node teams/dev/out/shots/probe-r15.mjs dev` 가 `/api/team` 의 `session·sessions` 를 찍는다(내 권한으로는 못 돌렸다 — 레오·시스템 몫).
- 화면은 브라우저가 없어 못 봤다 — `node --check` 여섯 + `check` 16/16. 412 뷰포트에서 둘째 줄 길이("테라 작업 중 · 솔라 듣는 중 · 레오 듣는 중")가 잘리는지는 레오가 본다.
