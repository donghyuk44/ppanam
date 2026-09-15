# 책장 — 개발

결정 116 ①: 대화록을 통째로 붓는 대신 읽을 것을 경로로 준다. 여기 없는 건
`node tools/library.mjs find <낱말>` (문서 전용 — 아래 "안 읽어도 되는 것" 참고).

## 읽을 것 (경로만 먼저 보고, 필요한 절만)

- `bus/bus.mjs` (2295줄) — 방·라운드·상황판·일지 코어. `endRound`·`startRound`·`emit` 같은 함수 이름으로
  grep 해서 그 함수만 본다.
- `bus/round.mjs` (1457줄) — 라운드 진행·`check`(회귀 시험 113개). 시험을 고칠 땐 비슷한 시험을 하나 찾아
  그 옆에 붙이는 식으로, 전체를 다시 읽지 않는다.
- `server/public/app.js` (2497줄) — 대표 화면(관제탑) 클라이언트. 화면 한 칸을 고칠 땐 그 칸 이름
  (`bossLine`·`progress` 등)으로 grep.
- `docs/event-schema.md` (993줄) — 대화록 이벤트 계약. 이건 .md 라 `node tools/library.mjs find <절 이름>`
  으로 절을 먼저 찾을 수 있다.

## 전문 Read 금지

이 넷은 grep(함수명·섹션 주석 `── 이름 ──`로 좁히기)으로 절만 본다. `bus.mjs`·`round.mjs`·`app.js`는
`.mjs`/`.js` 코드라 `tools/library.mjs`의 색인 대상이 아니다(그 도구는 `.md`·`.txt`·`.json` 문서만 읽는다
— `tools/library.mjs` 8번째 줄 `EXTS`). `event-schema.md`만 `find`로 절을 찾을 수 있다. 전문을 통째로
Read 하면 그 자체로 프롬프트 예산을 다 쓴다.

## 안 읽어도 되는 것 (책장 밖)

- `teams/marketing/out/world-bible/**` — 마케팅 팀의 세계관·인물 바이블. 개발 세션이 코드를 고치는 데
  필요 없다. 화면에 낼 텍스트가 필요하면 마케팅이 이미 다듬어 넘긴 문구(요청 블록·out/ 산출물)를 받는다.
