# 책장 — 경영

결정 116 ①: 대화록을 통째로 붓는 대신 읽을 것을 경로로 준다. 본은 `teams/dev/shelf.md`. 여기 없는 건
`node tools/library.mjs find <낱말>` — 유진 자리에서 돈다(09-18 14:15 실측, 본문 0바이트 · `teams/finance/out/library/실측/2026-09-18-1430.txt` 3절). 목차는 `toc`, 접힌 폴더는 `toc <폴더>`, 절·줄은 `show <경로>`.
글 유진(경영 A1, 09-16 10:xx · 5단계 09-18 고침) — 노라가 봐야 정본. 근거는 09-15 00:00Z 이후 경영 방 Read 기록.

## 읽을 것 (셋 — 경로만 먼저 보고, 필요한 절만)

- `teams/hq/out/규칙.md` (53줄 · 11KB, 09-18 14:3x 잼) — 지금 살아 있는 규칙 한 장(결정 189). 뒤집힌 결정은 여기 없다 — 원문은 `teams/dev/decisions.md` 에서 번호로. 세션 시작에 먼저, 통째 가능.
- `teams/finance/out/daily-template.md` (96줄 · 11KB) — 아침 한 장 틀·재료·본보기. 통째 가능.
- `teams/finance/out/report/아침한장-잣대.md` (21줄 · 3KB) — 아침 한 장 잣대. 짧다.

나머지는 사서에게 — 아침 한 장 실물(`teams/hq/out/daily/<오늘>.md`)·검수표(`daily-first-check.md`)·매뉴얼·자(`server/public/bosswords.js` `bossOk`)는 그 일을 할 때 `find` 로 찾아 그 절만.

## 전문 Read 금지

- `teams/finance/log.jsonl` (263KB) — **밤에 11번 읽힌 파일**, 이 방 3-1 의 제일 큰 구멍. 지난 말은 회차 들려주기로 오고, 찾을 땐 `jq -r 'select(.actor=="review") | .text' | tail`.
- `bus/bus.mjs` (2295줄) — 3번 읽힘. `grep -n 'function <이름>'` 으로 그 함수만(`endRound`·`endRefusal` 처럼).
- `teams/dev/decisions.md`(164KB) — 결정 번호로 `grep -n '^<번호>\. '` 한 줄. `docs/event-schema.md`(133KB) — 절 이름으로.
- `teams/finance/out/사서-물음-다섯.md`(157줄 · 20KB) — 1단계 기록. 사서 4판 때만.

## 안 읽어도 되는 것 (책장 밖)

- `teams/finance/out/library/**` (2.5MB · 색인 493장, 09-18 14:3x) — 색인 캐시. 사람이 읽는 게 아니라 `find` 가 읽는다. 목차 `toc.md` 한 장(≤10,000바이트)만 사람 것.
- `teams/finance/out/report/조사.md`·`비교.md`·`시안-2026-09-14.md`·`감사-M2-유진.md` — 2단계 닫힌 기록. 잣대는 `잣대.md`(71줄) 하나면 된다.
- `teams/marketing/out/world-bible/**`·`teams/design/out/**` — 다른 팀 원본은 카드·블록으로 받는다. 화면 글 규칙만 `teams/hq/out/대표-화면-글-규칙-0916.md` 2절.
- `teams/finance/ref/` — 나리 시안 html(기준 아님, 로드맵 baseline).
