# 책장 — 디자인

결정 116 ①: 대화록을 통째로 붓는 대신 읽을 것을 경로로 준다. 본은 `teams/dev/shelf.md`. 여기 없는 건
`node tools/library.mjs find <낱말>` — 막히면 `grep -n '^## ' <파일>` 로 절 제목부터.
글 유진(경영 A1, 09-16 10:xx) — 헨리가 맞다고 해야 정본. 근거는 09-15 00:00Z 이후 디자인 방 Read 기록.

## 명령 (지침 "명령은 책장에" — 옛 지침 31행에서 옮김, 결정 189)

- 상황판: `node bus/progress.mjs --team design --doing "…" --blocked "…" --boss "…" --next "…"` (준 항목만 바뀜, `--clear <항목>`) — 턴 끝·회차 닫기 전.
- 결재: `node bus/approve.mjs --team design --request B|C "무엇" --detail "…"` (작은 B 는 `--small`, 다른 팀에 부탁은 `--to <팀>`) · 요청 블록 `node bus/request.mjs --say|--done|--ack <id> "…"`.
- 회차: `node bus/round.mjs verdict --target guide "…"` (판정 대상은 직접 적는다) · 닫기 `node bus/round.mjs end --team design "…"` — `-v` 는 나리가 말할 때만.
- 사진: `node tools/screen-shot.mjs <out.png> design/<room|tower|dashboard|report|analysis> 412 915` — `out/shots/` 는 저장소 밖.

## 읽을 것 (경로만 먼저 보고, 필요한 절만)

- `teams/design/out/ui-spec.md` (234줄 · 43KB · 절 14) — 화면 시안 규격 정본. **하루에 8번 읽힌 파일** — 화면 이름(현황·앞으로·보고서·카드) 절만.
- `teams/design/out/screens/ui/png/<화면>.png` — 시안 그림. 지금 고치는 화면 한 장만 연다(tower·dashboard 4번, analysis 3번, report 2번 읽힘). `tower.png` 는 저장소엔 없고(`.gitignore` 183행, 100KB 그림 목록) 이 PC 본 체크아웃엔 있다 — 다른 PC·워크트리면 없으니 `tower.svg` 글자 줄만 `grep -n '<text'`(유진·헨리 09-16).
- `teams/design/out/kit/characters.json` (185줄 · 11KB) — 얼굴·인형 색표. 자리 하나 볼 땐 `grep -n '"<자리>"'`.
- `server/public/style.css` (1151줄 · 73KB, 09-16 04:5x 기준 — 줄 수는 자란다) — 실물 색·간격. **전문 금지** — 화면 칸 이름(`.report`·`.tower`)으로 `grep -n` 한 뒤 그 블록만. `card.css`(117줄)는 통째로 돼도 된다.
- `teams/design/out/screens/diff-0916.md` (133줄 · 20KB · 절 12) — 시안 대 실물 다른 점. 화면 절만.
- `teams/marketing/out/opsroom-words.md` — 화면 글자 사전. **시안에 글자를 넣기 전에 대본다**: 0-3 표준어 잣대(33~48행, "이 낱말 쓰는 서비스 셋" 못 대면 안 쓴다)와 1절 말 사전(166행부터, 우리 말 → 사람 말). 사전에 없는 낱말은 그리기 전에 마케팅 방에 한 줄 묻는다(결정 190, 하영 답이 정본). 절 이름으로만 연다 — 전문 금지.
- `teams/design/out/triptude-map.md` (91줄) — 19회차 대응표, 지금 적용 중(apr_21370997). 부품 하나 볼 땐 번호 줄만(`grep -n '^| 3 '`). 값의 출처는 `out/ref/triptude-city-compare-tokens.md`(30줄, 통째 가능) · 현재 장은 `out/screens/fig-0916-{team-card,dash-412,dash-1280,table}.png` 넷 — 고치는 한 장만 (헨리 09-16 보탬).

## 전문 Read 금지

- `style.css`(73KB)·`ui-spec.md`(43KB)·`direction.md`(134줄 · 22KB)·`screens/ui/*.svg` — svg 는 글자 줄만 `grep -n '<text'`. 시안 svg 통째 Read 는 좌표 숫자로 예산을 다 쓴다.
- `teams/marketing/out/screen-text-frames.md`(31KB) — 화면 글은 절 이름(H1~H5) 으로만.
- `teams/hq/out/카드-체계-0916.md`(67줄) 는 짧다 — 이건 통째 가능.

## 안 읽어도 되는 것 (책장 밖)

- `teams/design/out/gpt/`·`gpt64/` — 접은 도트 시안(20MB, 저장소 밖). 다시 안 연다.
- `teams/design/out/screens/*.png` 중 `blueprint`·`dolls-lineup`·`seoul-toy` — 지난 방향 그림. 마을은 지금 그림 그대로(나리 09-16).
- `teams/design/out/kit/colormap-uv*.md`·`parts-plan.md` — 인형 부품 작업 때만.
- `teams/marketing/out/world-bible/**` — 세계관은 하영 몫. 얼굴 한 장 그릴 때 인격 한 장(`40-persona/<자리>.md`)만.
- `teams/*/log.jsonl` — 대화록 전문은 안 연다.
