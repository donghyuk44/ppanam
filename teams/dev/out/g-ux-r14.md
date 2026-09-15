# R14 G-UX 첫 반나절 (2026-09-13)

배분(방에 적은 대로): 이번 R14 = 27 · 19-1 · 19-2(+needsBoss·승인 블록·닫기 숨김·부팅 탭) · 26 · 22 · 21. 다음 R15 = 20/20-2 · 23 · 19-3 · 25 · 마을 최소 패치(13). 24 는 목록만(`out/analysis-inventory.md`).

## 들어간 것

| # | 지시 | 어디 | 어떻게 |
| --- | --- | --- | --- |
| 27 | 412px 가로 넘침 | — | **CSS 결함을 찾지 못했다. 스크린샷이 500px 레이아웃이다** — 아래 "27 관찰" |
| 19-1 | 입력창 여러 줄 · 잠금 해제 · 보내면 주제 채워진 열기 폼 | `index.html` `#input` textarea · `app.js` fitInput/sendSay · `style.css` | Enter 보내기, Shift+Enter 줄바꿈, 폰(pointer: coarse)은 ↵ 버튼. 라운드 밖에서 보내면 첫 줄이 주제로 채워진 열기 폼, 열리면 그 말이 첫 지시 |
| 19-2 | 대표 호명 알림 | `bus.mjs callsBoss`·`teamSummary.bossCall` · `app.js` renderBossBadge · `draw` | 탭 줄에 "대표 차례 N" 배지(막힌 방 + 부른 방 + C 승인), 탭 제목 `(N)`, 말풍선에 "@ 대표님을 불렀습니다" 표시 |
| G-UX | needsBoss 확장 | `bus.mjs teamSummary` | blocked · attempt≥3 · 열린 라운드 24시간 침묵. `needsBossWhy` |
| G-UX | 승인 블록 모든 탭 최상단 | `index.html` `#approvals` → `.app` 첫 줄 · `style.css` grid-row | 대기 건수가 바뀔 때만 목록을 다시 받는다 |
| G-UX | blocked 면 닫기 숨김 · 부팅 탭 | `app.js` renderHead·renderTower·boot | 주소에 화면이 없으면 대표 차례가 있을 때 관제탑, 아니면 방 |
| 26 | 닫기 5초 | `server/index.mjs` `/api/round end` 202 accepted · `session.mjs` 닫힘 note · `round.mjs viaServer` | 서버는 즉시 202, 뒤에서 일지→닫기→비우기, 끝나면 note. CLI 는 ECONNREFUSED 만 직접 닫고 시간 초과(15초)는 멈춘다 |
| 22 | 여러 명 호명 | `bus.mjs addressees` · `conductor.mjs` | 문단 첫머리 호명 전부, 부른 순서대로 큐. 브레이크는 첫 상대에게만 |
| 21 | 총괄실 호명은 그 방에도 | `conductor.mjs crossPost` | 톰이 다른 방 사람을 부르면 그 방에 같은 말(chief, meta.from) → 그 방 사회자가 깨운다. 닫힌 방이면 총괄실에 note |
| 30 | 연속 도구 줄 접기 | `app.js` drawTool/groupLabel · `style.css` `.toolgroup` | 같은 사람의 연속 tool 이벤트를 `<details>` 한 줄로 — "테라 · 파일 7개 읽고 11개 고치는 중 (app.js, style.css …)". 전체 경로는 펼쳐야(제목 속성). 다른 이벤트가 오면 "…중"→"…함". 대화록은 그대로 |
| — | 계약 | `docs/event-schema.md` | 호명 여러 명 · callsBoss/bossCall · crossPost meta.from · needsBossWhy · 닫기 202 accepted · 도구 줄 접기 |

## 27 관찰 — 스크린샷은 412 가 아니라 ~500px 레이아웃이다

`out/shots/r13-room-412w.png` 에서 말풍선 "레오, 고맙습니다. 초록불 — 3분 걸린 REVISE 였네요. 시스템" 은 한 줄로 x≈75 에서
잘릴 때까지 ~340px 이고 글자 폭으로 계산하면 ~400px 줄이다. `.stack{max-width:82%}` 가 412 뷰포트면 (412−32)×0.82 ≈ 312px 에서
줄이 바뀌어야 한다. 관제탑 카드도 12px 여백에서 시작해 412 를 넘고, 마을 도구막대는 `flex-wrap` 인데 500 근처에서 접혔다.
셋 다 **레이아웃 폭 ≈ 500px** 에 맞는다 — 데스크톱 Chrome 은 창 폭을 ~500 아래로 못 줄인다. `--window-size=412` 는 창이지
뷰포트가 아니다. CSS 에서 폭을 강제하는 규칙(min-width·100vw·grid 명시 배치)은 없다.

그래서 CSS 는 손대지 않았다. **다시 찍어야 안다** — 뷰포트 에뮬레이션으로: Playwright `page.setViewportSize({width:412,height:915})`
또는 CDP `Emulation.setDeviceMetricsOverride`(mobile:true). 그래도 넘치면 그때 CSS 결함이다. 시스템에게 부탁.

## 레오 1차 감사(REVISE)

- `round.mjs viaServer` 가 `ECONNRESET` 도 "서버 없음" 으로 보고 직접 닫았다 — 계약은 ECONNREFUSED 만. 붙었다 끊긴 것은
  서버가 받고 닫는 중일 수 있어 이중 닫기. 고침: ECONNREFUSED 만 null, 나머지는 멈춘다.
- 27: 레오가 412px 뷰포트로 열어 보니 문서 폭 412, 넘침 없음(옛 번들 서버) — 스크린샷이 500px 레이아웃이었다는 관찰과 맞는다.

## 안 돌려본 것 (정직하게)

- 화면은 브라우저가 없어 못 봤다 — `node --check` 만. 레오가 격리 실행으로 열어 보면 그것이 실측이다.
- 21 crossPost · 22 addressees · 26 닫기 흐름은 서버 안에서만 돈다. 서버 재시작 뒤 방에서 실제로 확인해야 한다
  (톰이 "하영, …" 하면 마케팅 방에 뜨는지 · 대표가 "테라, … / 솔라, …" 하면 둘 다 깨는지 · 닫기 note 가 남는지).
- 자가 시험: `node bus/round.mjs check` 10/10 ✓ (가드 회귀 없음).
