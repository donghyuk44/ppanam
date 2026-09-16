# 책장 — 마케팅

결정 116 ①: 대화록을 통째로 붓는 대신 읽을 것을 경로로 준다. 본은 `teams/dev/shelf.md`. 여기 없는 건
`node tools/library.mjs find <낱말>` — 세션에서 맨 명령이 막히면 `grep -n '^## ' <파일>` 로 절 제목부터 본다.
글 유진(경영 A1, 09-16 10:xx) — 하영이 맞다고 해야 정본. 근거는 09-15 00:00Z 이후 마케팅 방 Read 기록(`log.jsonl` tool·Read).
하영 봄(09-16 13:5x, req_844a6476) — 맞다. 더한 것: 읽을 것 셋(카드 글·아침 한 장 꼴·40줄 틀 — 오늘 실제로 연 파일) · "손에 드는 명령 셋" 절(인격 40줄의 임시 명령 줄이 여기로 오면 빠진다, 40-fold.md 2절) · 사진 줄 한 마디. 줄 수는 오늘 것으로.

## 읽을 것 (경로만 먼저 보고, 필요한 절만)

- `teams/marketing/out/opsroom-words.md` (654줄 · 7판 · 절 12) — 낱말 사전 정본. **하루에 12번 읽힌 파일** —
  전문이 아니라 `grep -n '^## '` 로 절을 찾고 그 절만(`Read offset/limit`). 낱말 하나 찾을 땐 `grep -n '<낱말>'`. 새 낱말은 0-3 부터.
- `teams/marketing/out/screen-text-frames.md` (273줄 · 31KB · 절 9) — 화면 글 틀(T1~T9·H1~H5). 5번 읽힘. 절 이름으로 좁힌다.
- `teams/marketing/out/boss-lines.md` (82줄 · 10KB) — 대표 화면 사람 말 본보기 열둘. 짧으니 통째로 읽어도 된다.
- `teams/marketing/out/card-words.md` (81줄 · 3판) — 카드 글 규칙(팀 상황·판정·결재 카드·탭). 카드 글자를 만질 때만.
- `teams/marketing/out/daily-words.md` (109줄 · 2판) — 아침 한 장을 서버가 채우는 사람 말 꼴. 아침 한 장 줄이 이상할 때.
- `teams/marketing/out/world-bible/40-persona/40-fold.md` (62줄 · 2판) — 인격 40줄 틀. 접을 때만, 1절 표와 반려 셋 문단.
- `teams/marketing/roadmap.json` (지금 단계·컷리스트) — 회차 시작에 한 번.
- `teams/hq/out/대표-화면-글-규칙-0916.md` (72줄 · 8.5KB) — 결정 140 정본, 2절만.

## 손에 드는 명령 셋 (40줄 인격의 "책장이 붙기 전 임시" 줄이 여기로 온다)

- 결재·요청 올리기 — `node bus/approve.mjs --team marketing --request B|C "무엇" --detail "…" [--to <팀>:<자리> --why "…"] [--out a.md,b.md]`
- 요청 블록 주고받기 — `node bus/request.mjs --say|--done|--ack <req_id> "…"` · 열린 것 `--list --team marketing`
- 상황판 — `node bus/progress.mjs --team marketing --doing "…" --blocked "…" --boss "…" --next "…"` — 턴 끝마다·회차 닫기 전에.

## 전문 Read 금지

- `opsroom-words.md`(103KB)·`screen-text-frames.md`(31KB)·`opsroom-content-2.md`(196줄 · 32KB)·`screen-30s-test.md`(155줄 · 25KB) —
  절 제목(`^## `)으로 좁혀서만. 사전 한 판을 통째로 읽으면 그 턴 예산의 반이 간다(점검-0916 3-1 "하영이 사전 파일을 밤새 여섯 번").
- `teams/hq/out/점검-0916.md`(260줄 · 33KB) — 3번 읽힘. 필요한 절 번호(3-1~3-10)만.
- `docs/event-schema.md`(998줄 · 133KB)·`teams/dev/decisions.md`(456줄 · 164KB) — 결정 번호·절 이름으로 `grep -n` 한 뒤 그 줄 근처만.

## 안 읽어도 되는 것 (책장 밖)

- `teams/marketing/out/world-bible/**` (452KB) — 인격 열다섯·세계관은 만들 때만. 화면 글 작업엔 안 연다.
  인격 한 장이 필요하면 `40-persona/<자리>.md` 그 한 장만.
- `teams/dev/out/shots/*.png` — 화면 사진은 나리가 판독해 카드에 붙인다. 30초 시험 때 자기 화면 하나만 — 그리고 내가 낸 요청 블록의 `--done` 사진은 ack 전에 내가 연다(오늘 C13, 슬래시 메뉴 안 열린 사진에 ack 안 한 것).
- `teams/design/out/screens/ui/*.svg` — 시안 원본은 헨리 몫. 글 틀엔 png 한 장이면 된다.
- `teams/*/log.jsonl`·`rounds.jsonl` — 대화록 전문은 안 연다. 지난 말은 회차 안 들려주기로 온다.
