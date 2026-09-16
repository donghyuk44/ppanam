# 책장 — 경영

결정 116 ①: 대화록을 통째로 붓는 대신 읽을 것을 경로로 준다. 본은 `teams/dev/shelf.md`. 여기 없는 건
`node tools/library.mjs find <낱말>` — 유진 세션은 맨 명령이 막혀 있어(09-16 `node tools/boss-words-check.mjs` 두 번 거부) `grep -n '^## ' <파일>` 로 절 제목부터.
글 유진(경영 A1, 09-16 10:xx) — 노라가 봐야 정본. 근거는 09-15 00:00Z 이후 경영 방 Read 기록.

## 읽을 것 (경로만 먼저 보고, 필요한 절만)

- `teams/finance/out/daily-template.md` (96줄 · 10KB) — 아침 한 장 틀·재료·본보기. 4단계 동안 정본, 통째 가능.
- `teams/finance/out/report/아침한장-잣대.md` (22줄) · `daily-first-check.md` — 잣대 두 줄과 첫 실물 검수표. 짧다.
- `teams/hq/out/daily/<오늘>.md` — 검수 대상 실물. 어제 것(`2026-09-15-경영틀.md`·`2026-09-15.md`·`2026-09-14.md`)은 비교할 때만 — 밤에 daily 넷을 2~3번씩 읽었다, 한 번이면 된다.
- `teams/finance/out/report/매뉴얼.md` (93줄 · 9KB) — 결정 80 다섯 절 안쪽 자료. 4번 읽힘 — "쓰는 순서·빈 틀" 절(56~93행)만.
- `server/public/bosswords.js` (14행 `bossOk`) — 자 정본. `tools/boss-words-check.mjs` 는 이걸 가져다 쓴다.

## 전문 Read 금지

- `teams/finance/log.jsonl` (263KB) — **밤에 11번 읽힌 파일**, 이 방 3-1 의 제일 큰 구멍. 지난 말은 회차 들려주기로 오고, 찾을 땐 `jq -r 'select(.actor=="review") | .text' | tail`.
- `bus/bus.mjs` (2295줄) — 3번 읽힘. `grep -n 'function <이름>'` 으로 그 함수만(`endRound`·`endRefusal` 처럼).
- `teams/dev/decisions.md`(164KB) — 결정 번호로 `grep -n '^<번호>\. '` 한 줄. `docs/event-schema.md`(133KB) — 절 이름으로.
- `teams/finance/out/사서-물음-다섯.md`(157줄 · 20KB) — 1단계 기록. 사서 4판 때만.

## 안 읽어도 되는 것 (책장 밖)

- `teams/finance/out/library/**` (1.0MB · 220장) — 색인 캐시. 사람이 읽는 게 아니라 `find` 가 읽는다.
- `teams/finance/out/report/조사.md`·`비교.md`·`시안-2026-09-14.md`·`감사-M2-유진.md` — 2단계 닫힌 기록. 잣대는 `잣대.md`(71줄) 하나면 된다.
- `teams/marketing/out/world-bible/**`·`teams/design/out/**` — 다른 팀 원본은 카드·블록으로 받는다. 화면 글 규칙만 `teams/hq/out/대표-화면-글-규칙-0916.md` 2절.
- `teams/finance/ref/` — 나리 시안 html(기준 아님, 로드맵 baseline).
