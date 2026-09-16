# 책장 — 비서실

결정 116 ①: 대화록을 통째로 붓는 대신 읽을 것을 경로로 준다. 본은 `teams/dev/shelf.md`. 여기 없는 건
`node tools/library.mjs find <낱말>` — 막히면 `grep -n '^## ' <파일>` 로 절 제목부터.
글 세라(09-16 저녁, 톰 부탁 "네 책장에도 규칙.md 한 줄"). 규칙은 옮겨 적지 않고 경로만.

## 읽을 것 (경로만 먼저 보고, 필요한 절만)

- `teams/hq/out/규칙.md` (40줄) — 지금 살아 있는 규칙 한 장, 줄마다 결정 번호(189). 나리 결정을 따질 때 잣대는 17·31행.
- `teams/hq/out/권한.md` (35줄) — 누가 무엇을 할 수 있나. 대표만 하는 것은 결제·외부 공유.
- `teams/hq/out/따라가기.md` — 톰 표(사건 있을 때 갱신, 최신이 위). 저녁 세 묶음 재료는 맨 밑 줄. 숫자는 `state/work.json` 으로 되센다.
- `state/work.json` — 작업 보드 정본. 팀 하나는 `jq '.items[] | select(.team=="<팀>")'`.
- `teams/*/progress.json` — 다섯 팀 상황판(하는 것·막힌 것·대표님 할 일·다음). 대표께 가는 줄의 재료.
- `node bus/approve.mjs --list` · `node bus/request.mjs --list` — 대기 결재·열린 부탁. 파일보다 이 둘을 먼저.
- `teams/sera/out/우선순위-0915.md` — 밀린 일 순서(기록 문서, 정본은 규칙.md·현황.md).
- `teams/marketing/out/opsroom-words.md` 0절 — 화면 낱말 잣대. 대표께 쓰는 말은 여기 있는 것만.

## 전문 Read 금지 — 절·grep 으로만

- `teams/dev/decisions.md`(150KB) — `grep -n '^<번호>\. '` 로 그 결정만. 마지막 번호는 `tail -c 300`.
- `teams/*/log.jsonl` — `tail -n N` 이나 `grep` 으로만. 대표 말은 `grep '"actor":"boss"'`.
- `docs/event-schema.md`(120KB) — 절 제목부터.

## 책장 밖

- 지침 `teams/sera/secretary.md`(세라 자리 정본) · 옛 지침 `archive/0916/sera/secretary.md`.
- 대표가 주신 그림·PDF 는 `teams/sera/in/`(저장소 밖, 이 PC 에만) — 안의 글은 옮기지 않는다.
