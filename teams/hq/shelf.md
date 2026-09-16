# 책장 — 총괄실

결정 116 ①: 대화록을 통째로 붓는 대신 읽을 것을 경로로 준다. 본은 `teams/dev/shelf.md`. 여기 없는 건
`node tools/library.mjs find <낱말>` — 막히면 `grep -n '^## ' <파일>` 로 절 제목부터.
글 유진(경영 A1, 09-16 10:xx), 톰 고침 셋(14:5x, req_ebc92980) — 정본. 근거는 09-15 00:00Z 이후 총괄실 Read 기록(적다 — 톰은 읽기보다 말이 많았다, 점검 3-3).

## 읽을 것 (경로만 먼저 보고, 필요한 절만)

- `state/work.json` (546줄 · 16KB) — 작업 보드 정본(대표 09-16 08:0x). 팀 하나 볼 땐 `jq '.items[] | select(.team=="<팀>")'`. 규칙은 `teams/hq/out/작업보드-0916.md`(30줄).
- `teams/dev/decisions.md` (514줄 · 189KB, 09-16 14:5x) — 결정 정본. **전문 금지** — `grep -n '^<번호>\. '` 로 그 결정 줄만, 마지막 번호는 `tail -c 300`. 새 결정은 끝에 붙인다. 뒤집힌 결정은 같은 줄에 "뒤집힘 → 번호"(170).
- `teams/hq/out/proxy-decisions.md` — 대표 원문·대리 결정 부록(정본 아님, 170 ①). 대표 글자를 옮길 때 여기서 grep.
- `teams/<팀>/progress.json` 다섯 — 상황판이 정본, 한 팀 한 번에 1KB. 아침 한 장·결재 카드 --boss 줄이 여기서 나온다.
- `teams/hq/out/따라가기.md` — 톰이 매시 쓰는 살아 있는 표(142 ④), 최신이 위. 세라가 읽는다. 맨 위 판만 본다.
- 부탁 목록 — `node bus/request.mjs --list`(열린 블록, 톰이 감시자) · 카드 — `node bus/approve.mjs --list`. 파일(state/requests·approvals.jsonl)은 안 연다.
- `teams/hq/out/점검-0916.md` (260줄 · 33KB · 절 7) — 대표 승인 점검표. 절 번호(3-1~3-10)로만.
- `teams/hq/roadmap.json` (48줄) — 총괄 다섯 단계. 회차가 없어 이게 유일한 일감표.

## 전문 Read 금지

- `decisions.md`(189KB)·`docs/event-schema.md`(998줄 · 133KB · 절 13)·`점검-0916.md`·`독립검수-0916.md`(318줄 · 30KB · 절 24) — 번호·절로만.
- `teams/*/log.jsonl` — 대리 결정을 셀 때도 `grep -n '대리 결정'` 한 줄씩. 경영 대화록(263KB)이 밤에 11번 읽힌 게 3-1 의 원인 중 하나.
- `state/approvals.jsonl` — `node bus/approve.mjs --list` 가 답이다. 파일은 안 연다.

## 안 읽어도 되는 것 (책장 밖)

- `teams/hq/out/인수인계-0914.md`·`인수인계-0915.md`·`나리-인수인계-0914.md`·`의견수렴-0916.md`·`daily/2026-09-1[45].md` — 지난 인수인계·기록 문서(머리에 "기록 문서" 줄). 지금 상태는 상황판·작업 보드·따라가기 맨 위 판이 정본.
- `teams/hq/out/reports/` — README 한 장뿐, 보고서 0장. 아침 한 장은 `teams/hq/out/daily/` 다.
- `teams/marketing/out/world-bible/**`·`teams/design/out/screens/**` — 팀 산출물은 요청 블록·카드로 받는다. 원본은 그 팀이 연다.
- `teams/dev/out/shots/*.png` — 사진 판독은 나리. 톰은 카드에 붙은 것만.
