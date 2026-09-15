# R15 G-UX 둘째 — 반나절 B "승인 카드를 읽고 누를 수 있게" (2026-09-13)

배분(시스템 05:01 + 15:5x): 결정 31 ② 먼저 → #2(결정 20·20-2) · #8 · #13 · #3 · #9 + 결정 34 종 배지.
카드 형식은 `teams/design/ref/samples/reddit-mobile.png`(글 카드 = 누가·언제·제목·본문·반응, 위→아래), 종·배지는
`naver-mobile.png`(오른쪽 위 종 + 빨간 수 배지)를 따랐다 — `teams/design/out/reference-samples.md` 2·3절.

## 들어간 것

| # | 증상 | 어디 | 어떻게 |
| --- | --- | --- | --- |
| 31 ② | 5분 생존 note | `session.mjs aliveNotes` · `conductor.unheard` · `outside.mjs` | (7491d2a) busy 세션이 있는데 방에 5분간 줄이 없으면 "테라 아직 작업 중 (7분째, 마지막: app.js 고치는 중)". 신호도 5분 없으면 "6분째 신호 없음 — 15분이면 닫습니다". `meta.alive` 는 참여자 귀에 안 넣는다 |
| #2 · 20-2 | 카드에 주제·목적·바뀌는 것이 없고 detail 이 한 줄로 잘림, 푸시의 브랜치·SHA 안 보임 | `bus.mjs approvalPreview` · `index.mjs pendingCards` · `app.js previewNode/renderApprovals` · `style.css .apr*` | 카드 = 누가·언제(+방에서 보기) → 주제 → 왜·바뀌는 것(detail 줄바꿈 그대로, 비었으면 "안 적혔습니다") → 행동 표 → 버튼. 행동은 서버가 읽을 때 `preview` 로 푼다 — 푸시: 기준·커밋 수·제목·파일 목록 / 착수: 마일스톤·통과 조건 / 로드맵: 목적지·마일스톤 표·하지 않는 것. 못 읽으면 error 를 그대로 |
| 20-2 | 요청자 원문 | `bus.mjs requestApproval` | 요청 note 의 이벤트 id 를 레코드 `note` 에 박아 카드 "방에서 보기" 가 `jumpTo` 로 건너간다 |
| #8 | 폰에서 등급 칩이 띠, 팀 라벨이 화면 밖 | `style.css .apr` | 격자 → 세로 쌓기(flex column). 폰 전용 격자 규칙 삭제 |
| #13 | 승인 3건이면 방 대화가 사라짐 | `style.css .approvals` | `max-height: 40vh; overflow-y: auto` |
| #3 | 빈 방에서 열기 폼이 화면 한가운데 | `style.css .room` | 행 여섯을 명시하고 자식마다 `grid-row` 못박음 |
| #9 | 대표를 부른 방이 카드에 '진행 중', 레일 점 회색 | `app.js renderRail/renderTower` | 레일 점·배지와 카드 깃발이 `bossCall` 도 읽는다 — "헨리가 불렀습니다 · 12분 전". needsBoss 깃발은 이유(BOSS_WHY) 글자로 |
| 34 | 종 배지 | `index.html #bell` · `style.css .bell*` · `app.js renderBossBadge/renderBellMenu` | "대표 차례 N" 알약 → 모든 탭 오른쪽 위 고정 종. 0 이면 회색 종, 있으면 빨간 배지(99+). 누르면 목록(막힌 방·부른 방·승인)이 열리고 고르면 그 방/관제탑. 종 자리는 side·tower·world 머리와 폰 띠·승인 블록의 오른쪽 여백으로 비웠다 |
| — | 계약 | `docs/event-schema.md` 6절 "카드는 읽고 누를 수 있어야 한다" · 3절 생존 알림 note | |
| — | 자가 시험 | `bus/round.mjs check` | 생존 알림 문장 둘 · 로드맵 미리보기 · 파일 없음 error · 푸시 미리보기(실제 git). 21/21 ✓ |

## 안 한 것

- 결정 20 ② "실무가 질문+선택지 2~4개를 올리면 카드로 뜨고 누르면 그 방에 '대표 결정: …' 로 기록" — 새 이벤트 계약이 필요한 별개 물건.
  이 반나절엔 승인 카드까지. 다음 항목으로 계약부터.
- 결정 34 "방 목록에 방마다 미확인·대표 차례 수" — 레일에 이미 안 읽음 수·'대표' 배지가 있다(bossCall 도 이번에 읽음). 별도 수정 없음.
- 검수 #21 반려 보내기 버튼 — 버튼 최소 높이 36px 만 같이 올렸다. 이유 칸 옆 "반려 보내기" 는 E.

## 안 돌려본 것 (정직하게)

- 화면은 브라우저가 없어 못 봤다. 종 고정 위치가 관제탑·마을 머리와 겹치는지, 412 에서 카드 표(`.apr__pv td`)가 접히는지는 레오가 본다.
- `preview` 는 새 프로세스에서만 온다 — 옛 서버면 카드에 "내용을 못 받았습니다 (옛 서버?)" 가 뜬다. 그게 맞다.
