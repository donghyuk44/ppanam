# 책장 — 개발

결정 116 ①: 대화록을 통째로 붓는 대신 읽을 것을 경로로 준다. 여기 없는 건
`node tools/library.mjs find <낱말>` — 단, 이 명령이 맨 명령으로 막혀 있다(P2,
teams/dev/out/p2-tools-permission.md). settings.json 이 고쳐지기 전까지는 "안 되면
grep 으로 직접 찾는다" 로 대신한다.

## 읽을 것 (경로만 먼저 보고, 필요한 절만)

- `teams/hq/out/규칙.md` — 살아 있는 규칙 한 장, 줄마다 결정 번호(결정 189, 톰). 감사 부르는 길(이름이 아니라 카드·판정 흐름)이 18행. 여기 옮겨 적지 않는다 — 그 파일이 정본.
- `bus/bus.mjs` (2295줄) — 방·라운드·상황판·일지 코어. `endRound`·`startRound`·`emit` 같은 함수 이름으로
  grep 해서 그 함수만 본다.
- `bus/round.mjs` (1457줄) — 라운드 진행·`check`(회귀 시험 113개). 시험을 고칠 땐 비슷한 시험을 하나 찾아
  그 옆에 붙이는 식으로, 전체를 다시 읽지 않는다.
- `server/src/app.js` (편집은 여기서만 — `server/public/app.js` 는 `build:public` 이 이 파일에서 다시
  만드는 산출물이다. `public/app.js` 를 고치면 다음 빌드가 조용히 덮어쓴다, R29 에서 실제로 겪은 일)
  — 대표 화면(관제탑) 클라이언트. 화면 한 칸을 고칠 땐 그 칸 이름(`bossLine`·`progress` 등)으로 grep.
- `docs/event-schema.md` (993줄) — 대화록 이벤트 계약. 이건 .md 라 `node tools/library.mjs find <절 이름>`
  으로 절을 먼저 찾을 수 있다(위 막힘 참고).

## 전문 Read 금지

이 넷은 grep(함수명·섹션 주석 `── 이름 ──`로 좁히기)으로 절만 본다. `bus.mjs`·`round.mjs`·`app.js`는
`.mjs`/`.js` 코드라 `tools/library.mjs`의 색인 대상이 아니다(그 도구는 `.md`·`.txt`·`.json` 문서만 읽는다
— `tools/library.mjs` 8번째 줄 `EXTS`). `event-schema.md`만 `find`로 절을 찾을 수 있다. 전문을 통째로
Read 하면 그 자체로 프롬프트 예산을 다 쓴다.

## 명령 (지침 "명령은 책장에" — 결정 189 로 지침에서 옮겨 온 셋, 옛 글 archive/0916/dev/guide.md 31행)

- 결재 카드 — `node bus/approve.mjs --team dev --request B|C "무엇" --detail "…"` (`--small` 작은 B · `--to <팀>:<자리>` 다른 팀에 부탁 · `--restart` · `--push`)
- 요청 블록 답·닫기 — `node bus/request.mjs --say|--done|--ack <id> "…"`
- 상황판 — `node bus/progress.mjs --team dev --doing "…" --blocked "…" --boss "…" --next "…"` (준 항목만 바뀜, `--clear <항목>`). 턴 끝마다·회차 닫기 전에.
- 판정 부르기 — `node bus/round.mjs verdict --team dev --target <자리> "…"` · 회차 닫기 `node bus/round.mjs end --team dev --summary "…"`(단계가 남았으면 `-v PASS` 없이) · 회귀 시험 `node bus/round.mjs check`
- 화면 — `node tools/build-public.mjs`(app.js 고친 뒤 꼭) · 사진 `node tools/screen-shot.mjs <out.png> <팀>/<화면> <W> <H> [탭] [포트] [준비 JS]` · 자 `node tools/boss-words-check.mjs`

## 안 읽어도 되는 것 (책장 밖)

- `teams/marketing/out/world-bible/**` — 마케팅 팀의 세계관·인물 바이블. 개발 세션이 코드를 고치는 데
  필요 없다. 화면에 낼 텍스트가 필요하면 마케팅이 이미 다듬어 넘긴 문구(요청 블록·out/ 산출물)를 받는다.
