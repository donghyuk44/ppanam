# 책장 — 마케팅

읽을 것을 경로로 준다. 여기 없는 건 `node tools/library.mjs find <낱말>`. 긴 파일은 `grep -n '^## ' <파일>` 로 절 제목부터 보고 그 절만 연다.

## 읽을 것 (경로만 먼저 보고, 필요한 절만)

- `teams/marketing/out/opsroom-words.md` (8판 · 236줄 · 절 9) — 낱말 사전 정본. 낱말 하나 찾을 땐 `grep -n '<낱말>'`, 절은 `^## `. 새 낱말은 0절 규칙 둘부터. 옛 7판(3절 세 장면의 말·7절 테라에게)은 `archive/0916/marketing/opsroom-words-7.md`.
- `teams/marketing/out/screen-text-frames.md` (273줄 · 절 9) — 화면 글 틀(T1~T9·H1~H5). 절 이름으로 좁힌다.
- `teams/marketing/out/boss-lines.md` (82줄) — 대표 화면 사람 말 본보기 열둘. 짧으니 통째로 읽어도 된다.
- `teams/marketing/out/card-words.md` (81줄) — 카드 글 규칙(팀 상황·판정·결재 카드·탭). 카드 글자를 만질 때만.
- `teams/marketing/out/daily-words.md` (109줄) — 아침 한 장을 서버가 채우는 사람 말 꼴. 아침 한 장 줄이 이상할 때.
- `teams/marketing/out/bar/marketing.bar.md` — 마케팅 물건이 통과하려면, 다섯 줄. 판정 전에 한 번.
- `teams/marketing/out/world-bible/40-persona/40-fold.md` (62줄) — 인격 40줄 틀. 접을 때만, 1절 표와 반려 셋 문단.
- `teams/marketing/roadmap.json` — 지금 단계·컷리스트. 회차 시작에 한 번.
- `teams/hq/out/대표-화면-글-규칙-0916.md` (72줄) — 결정 140 정본, 2절만.

## 바로 쓰는 명령 셋

- 결재·요청 올리기 — `node bus/approve.mjs --team marketing --request B|C "무엇" --detail "…" [--to <팀>:<자리> --why "…"] [--out a.md,b.md]`
- 요청 블록 주고받기 — `node bus/request.mjs --say|--done|--ack <req_id> "…"` · 열린 것 `--list --team marketing`
- 상황판 — `node bus/progress.mjs --team marketing --doing "…" --blocked "…" --boss "…" --next "…"` — 턴 끝마다·회차 닫기 전에.

## 전문 Read 금지

- `screen-text-frames.md`(31KB)·`opsroom-content-2.md`(32KB)·`screen-30s-test.md`(25KB)·`archive/0916/marketing/opsroom-words-7.md`(129KB) — 절 제목(`^## `)으로 좁혀서만. 옛 사전 한 판을 통째로 읽으면 그 턴 예산의 반이 간다.
- `teams/hq/out/점검-0916.md`(260줄 · 33KB) — 필요한 절 번호(3-1~3-10)만.
- `docs/event-schema.md`(998줄 · 133KB)·`teams/dev/decisions.md`(456줄) — 결정 번호·절 이름으로 `grep -n` 한 뒤 그 줄 근처만.

## 안 읽어도 되는 것 (책장 밖)

- `teams/marketing/out/world-bible/**` (452KB) — 인격 열다섯·세계관은 만들 때만. 화면 글 작업엔 안 연다. 인격 한 장이 필요하면 `40-persona/<자리>.md` 그 한 장만.
- `teams/dev/out/shots/*.png` — 화면 사진은 나리가 판독해 카드에 붙인다. 30초 시험 때 자기 화면 하나만. 단, 내가 낸 요청 블록의 `--done` 사진은 ack 전에 내가 연다.
- `teams/design/out/screens/ui/*.svg` — 시안 원본은 헨리 몫. 글 틀엔 png 한 장이면 된다.
- `teams/*/log.jsonl`·`rounds.jsonl` — 대화록 전문은 안 연다. 지난 말은 회차 안 들려주기로 온다.
- `archive/0916/marketing/` — 09-16 정리 전 옛 지침. 지금 규칙이 아니다.
