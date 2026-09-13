# ppanam 인수인계 — 2026-09-13 06:00 KST

새 세션의 첫 프롬프트로 그대로 붙인다. 읽은 뒤 메모리·계획표·계약을 열어 확인하고 일한다. 대표(함동혁, 댄)에게 묻지 않고 알 수 있는 것은 묻지 않는다.

---

너는 ppanam 의 하네스 세션이다. ppanam 은 부서별 AI 팀이 라운드 단위로 일하고 서로 감사하며, 대표가 웹 단톡방(작전실)과 도트 마을에서 말을 거는 **살아 있는 회사**다. 목적은 그림 공장이 아니라 **살아 있는 사람들과 완성된 작전실**이다. 스프라이트와 마을은 수단이다.

## 1. 최우선 순서 — 바꾸지 않는다

대표 원문 요지(2026-09-13): "인격도 제대로 못 잡고 있는데 이걸 최우선으로 잡고 고쳐라. 그게 끝나거나 컨텍스트가 압축돼도 최우선 목표로 지정하고, 이전 계획표에서 해결되지 않은 부분을 이어서 작업해서 우리 작전실을 완벽히 해결할 수 있도록 해." / "인격에서 중요한 건 회차가 반복되고 컨텍스트가 압축돼도 자기의 정체성과 아이덴티티를 잃지 않도록 연결고리를 셋팅하는 거야."

1. **인격** — 열다섯 자리가 각자 사람처럼, 제 말투로 말한다. 정체성 연결고리가 라운드·압축·재시작을 넘어 산다.
2. **계획표 미해결** — `/Users/donghyukham/.claude/plans/ppanam-enumerated-walrus.md` 의 A~E 중 남은 것(아래 5절).
3. **마을 타일·나머지 걷기 시트** — 그 뒤.

메모리 `~/.claude/projects/-Users-donghyukham-Documents-ppanam/memory/top-priority-persona.md` 가 같은 순서를 담고 있다. 세션이 새로 뜨거나 압축되면 먼저 읽는다.

## 2. 지킬 것

- **작업 위치**: 워크트리 `/Users/donghyukham/Documents/ppanam/.claude/worktrees/ppanam-review-issues-4058bc`, 브랜치 `claude/ppanam-review-issues-4058bc`. 메인 체크아웃(`~/Documents/ppanam`)은 다른 브랜치라 같은 파일이 아니다. 거기로 `cd` 하지 않는다.
- **git**: push 하지 않는다. bare `git stash` 금지(스택이 공유된다). 커밋은 일 단위로, 메시지는 한국어로 "무엇이 왜".
- **서버**: `preview_start` 이름 `ppanam`(포트 4321)으로만 띄운다. Bash `npm start` 는 막힌다. 재시작은 busy 세션이 없을 때만 `preview_stop` → `preview_start`. 정적 파일(`server/public/**`)은 재시작 없이 새로고침으로 반영된다.
- **권한**: `.claude/settings*.json` 은 대표만 고친다. 새 CLI 가 필요하면 allow 한 줄을 대표에게 요청한다.
- **계정·비밀·결제**: 계정 생성, 비밀번호·API 키·토큰 입력, OAuth 동의, 결제는 하지 않는다. PixelLab 계정 페이지의 Secret 을 쓰지 않는다. 구독은 대표가 결정한다.
- **C 등급 파일**(인격 `teams/<팀>/<자리>.md`, 로드맵, 캐스트)은 대표가 정한다. 이번 인격 절 추가는 대표의 명시적 지시였다. 다음 수정도 지시가 있을 때만.
- **참고 이미지**(넥슨·카카오 등)는 `teams/*/ref/` 에만 두고 git 밖(gitignore). 스타일 참고일 뿐 그림을 가져오지 않는다.
- **중계는 사실만**. 팀 방에 내 판단을 대표 결정처럼 옮기지 않는다("64 로 간다" 사고).
- base64·바이너리를 손으로 옮기지 않는다. 파일은 `file_upload`·경로로 다룬다.
- 클로드는 외부감사인 척하지 않는다. codex 가 안 붙어 있으면 그 사실을 방에 남긴다.

## 3. 지금 상태

**커밋 (최근 것부터, 모두 이 워크트리)**
`77cb0ac` 마크·톰 걷기 시트 · `53a4e62` 헨리·클레멘타인 걷기 시트 · `946811b` 게시판·램프·문 앞 대기(W3 완료) · `811da3b` 카드 위치 · `36a4272` 캐릭터 카드 + 말풍선→작전실 · `be349a2` W3 연출 · `17c87e2` W2 시계·루틴 · `4d5b3c3` 사회자가 system 호명도 깨움 · `6fff789` 인격 "너라는 사람" 절 · `f12efd5` 64px 정지 그림 열다섯. 미추적 `AGENTS.md`·`.codex/` 는 손대지 않았다(대표 확인 대기).

**인격 — 된 것**
- 인격 파일마다 `## 너라는 사람`(codex 자리는 `## 당신이라는 사람`): 기질, 말투 표본 다섯 줄, 좋아함/싫어함, 관계, 대표 앞에서. 재무팀 세 자리는 이름이 없어 파일도 없다.
- 사회자(`server/conductor.mjs`) 지시문이 "네 말투로 한두 문장 — 사람에게 말하듯". 턴마다 닻 "너는 ○○다."
- 확인: 헨리·클레멘타인은 방 안 대화로(09-12), 톰·하영·테라·안젤은 `node bus/cast.mjs check <팀> <자리>` 로(09-13) 제 말투 확인. 제리·솔라·다니엘·레오·마크(codex)는 방 안 다음 차례에서 본다 — `outside.mjs --check` 는 연결 확인일 뿐 인격 검사가 아니다.

**정체성 연결고리 — 넷**
1. 인격 파일은 세션이 뜰 때마다(`--resume` 포함) `--append-system-prompt` 로 다시 붙는다 → 압축·재시작을 넘어 산다. 조립은 `server/session.mjs` `assemblePrompt` 하나(인격 + decisions 해석 + 일지 최근 5문단 + 라운드 브리프, 상한 12KB).
2. 일지 `teams/<팀>/journal/<자리>.md` — 라운드가 닫힐 때(`closeRound`) 서버가 각자에게 한 문단을 받아 맨 위에 붙인다. 첫 문장은 반드시 "나는 …"(이름·기질·마음가짐). 확인: `node bus/cast.mjs prompt <팀> <자리>` 에 일지가 실리는지.
3. 턴마다 "너는 ○○다. … 네 말투로" 닻.
4. 말투 표본 다섯 줄이 목소리를 고정.
마을 카드(캐릭터 클릭)가 같은 인격 절과 일지를 보여주므로 대표도 눈으로 확인할 수 있다.

**마을 — 된 것** (계약 `docs/event-schema.md` 9절이 정본)
- W2 시계·루틴: `server/world.mjs`, `state/world.json`(근무 9~18·점심 12~13·밤 23~7·주말 휴식·시험용 `debugHour`), `GET/POST /api/world`, 소켓 `world`. 밤·휴식은 집(z z z), 점심은 카페·광장, 근무는 책상. 같은 시계가 사회자의 침묵 차례를 켜고 끈다.
- W3 연출 전부: 회의 모임, 도장 걷기, 호명 바라보기, 대표에게 다가와 답하기, 잔동작, 재생은 사건 시각 색조, 승인 요청 → 게시판(`hq.board`) 걷기, 통과·반려 → 톰이 게시판에서 도장, FAIL → 방 이름표 램프 60초, blocked → 램프 + 실무가 대표실 문(`hq.bossdoor`) 앞 대기.
- 관람: 캐릭터 카드(`GET /api/actor?team&actor` — 지금·누구·일지·최근 발언 여덟·말 걸기), 말풍선 ↗ 와 카드 발언 → 작전실의 그 발언으로 점프(오래된 것은 위쪽을 더 불러오며 찾는다).
- 캐릭터: 열다섯 정지 그림(ChatGPT 64px)이 서 있고, **대표·헨리·클레멘타인·마크·톰 다섯은 PixelLab 8방향으로 걷는다**. `server/public/world/assets/cast/manifest.json`.
- 서버 시계는 실제 시각으로 돌려놨다. 낮 모습은 도구막대 "시험용 시각" 또는 `curl -X POST localhost:4321/api/world -d '{"debugHour":15}'`.

**PixelLab** — 무료 40회 중 33회 사용(09-13 06:00). 한 캐릭터 = 회전 1 + 걷기 S·E·N 각 2 = 7회(서쪽은 카드의 미러 버튼으로 무료). 남은 7회로 한 명 더 가능. 그 뒤는 하루 5회 느린 생성 또는 Tier 1(월 $12) — 대표 결정.

## 4. 대표 결정 대기 (물어볼 것, 결정 전엔 가정하고 다른 일을 한다)

1. PixelLab 결제 여부 — 열 자리(제리·하영·안젤·다니엘·테라·솔라·레오·재무 셋)를 더 걷게 하려면 Tier 1. 아니면 하루 5회씩.
2. 재무팀 세 자리 이름·프로필 → 인격 파일 + cast.json.
3. 미추적 `AGENTS.md`·`.codex/` — 의도인지, 지울지.
4. settings allow 두 줄: `"Bash(node tools/pixel/fix.mjs:*)"`, `"Bash(node tools/pixel/check.mjs:*)"`.
5. 계획표 E-3 의 나머지(deny 규칙, 침묵 차례 90초·시간당 30, 근무 시간표 기본값, guide 모델).

## 5. 남은 일 (순서대로)

1. **인격**: codex 다섯 자리를 방 안에서 확인(라운드 열고 호명 한 번). 재무팀 인격 파일(이름 받은 뒤). 일지가 두세 라운드 쌓인 뒤 첫 문장 규약이 유지되는지 재확인. 인격 파일을 고칠 때마다 `cast.mjs check`.
2. **작전실 UX 잔여**: 대표가 30분 말이 없으면 댄이 퇴장하고 "대표 부재"가 보이는 것, 세션의 대기 지시 수를 책상 위 서류로. 실제 라운드 한 판을 마을로만 보고 설명할 수 있는지(W3 통과 조건) 대표와 함께 한 번.
3. **걷기 시트 나머지 열 자리** — 결정 뒤. 순서 제안: 제리 → 하영·안젤 → 테라·솔라 → 다니엘·레오 → 재무.
4. **W4 꾸미기**: 마을 타일(M4/M5, 한국 전통 판타지 우리 템플릿), 팀 방 개성, 상황판 일지 카드.

## 6. 시작 절차

```bash
cat ~/.claude/projects/-Users-donghyukham-Documents-ppanam/memory/MEMORY.md
git -C /Users/donghyukham/Documents/ppanam/.claude/worktrees/ppanam-review-issues-4058bc log --oneline -12
```
그다음 `preview_start`(이름 `ppanam`) → 브라우저에서 `http://localhost:4321/#design/world` 를 열어 카드(캐릭터 클릭)와 재생(디자인 R11)이 되는지 본다. 대표 결정이 필요한 것은 한 번에 모아 묻고, 답을 기다리는 동안 5절의 다른 일을 한다.

## 7. 확인 명령

```bash
node bus/cast.mjs check design ops            # 인격 스모크 테스트(기록 안 남김, claude 자리만)
node bus/cast.mjs prompt design guide         # 조립된 시스템 프롬프트에 일지가 붙는지
curl -s 'localhost:4321/api/actor?team=design&actor=ops' | head -c 600
curl -s -X POST localhost:4321/api/world -H 'content-type: application/json' -d '{"debugHour":15}'   # 시험용 낮. 끝나면 null
curl -s -X POST localhost:4321/api/round -H 'content-type: application/json' -d '{"team":"design","action":"end"}'  # 라운드 닫기 → 일지 턴
```
마을 자동 검증(브라우저 JS): `const W = await import('/world/world.js'); W.snapshot()` — 장면·자리·말풍선·재생 상태. `W.onEvents('design', [사건])` 로 가짜 사건을 넣어 연출을 본다(기록엔 안 남는다). 픽스처 재생: `?fixture=marketing-r14`.

## 8. 그림 파이프라인 (요령은 메모리 `gpt-sprite-pipeline.md`)

```bash
tools/pixel/still.sh <팀-자리> ~/Downloads/xxx.png           # ChatGPT 64px 정지 그림 → out/sprites64/<이름>.png
node tools/pixel/pad.mjs out/sprites64/<이름>.png out/gpt64/<이름>-pl-ref.png   # PixelLab 참고용 40×64 (폭 32 미만은 튕긴다)
node tools/pixel/plwalk.mjs <팀-자리> ~/Downloads/<PixelLab zip>               # zip → out/sprites64/<이름>-walk.{png,json}
node tools/pixel/cast-manifest.mjs                                              # 마을 manifest 다시 쓰기
node tools/pixel/check.mjs out/sprites64/<이름>-walk.png --cell 92x92 --palette out/palette.json   # 칸은 시트 json 의 cell
```
(`out/` = `teams/design/out/`, gitignore. 정지 그림 요청서는 `out/gpt/requests64/*.json`, 팔레트는 `out/palette.json`.)
PixelLab 웹 자동화: 업로드는 숨은 `<input type=file>` 을 넣고 `file_upload` → React `onDrop`. 회전 "Generate v3 Rotation" → 캐릭터 페이지 "Add Your First Animation" → Walking(V3) → "Generate in Background"(남쪽) → 방향 카드의 🚀(동·북) → 서쪽 카드의 ⏮(미러, 무료) → Export → "Spritesheet (PNG + JSON)". Tier 0 은 동시 작업 3개, 갤러리 카드는 다 그려진 뒤 좌표로 연다, browser_batch 는 90초 안에 끊는다. 캐릭터 페이지 id 는 메모리에.

## 9. 함정

- 사회자는 `actor==='system'` 발언도 호명이면 깨운다(4d5b3c3). 그전엔 헨리가 20분 멈췄다.
- 재생 중 `endDetour` 는 시계가 아니라 제 책상으로 돌려보낸다(밤에 낮 회의를 재생해도 집으로 가지 않게).
- 카드는 `.world__view`(스크롤 상자) 밖에 있어야 지도를 따라 사라지지 않는다.
- `state/world.json` 은 상태라 gitignore. 시험용 시각을 켜 두고 끝내지 않는다.
- macOS 엔 `timeout` 이 없다. `bus/cast.mjs check` 는 질문을 stdin 으로 준다.
- 한 방 한 목소리: busy 세션이 있으면 서버를 재시작하지 않는다.

## 10. 사람들

| 팀 | 자리 | 이름 | 엔진 | 걷기 |
| --- | --- | --- | --- | --- |
| 총괄실 hq | chief | 톰 | claude(opus) | ✓ |
| | outside | 제리 | codex | 정지 |
| 마케팅 | guide | 하영 | claude | 정지 |
| | review | 안젤 | claude(sonnet) | 정지 |
| | outside | 다니엘 | codex | 정지 |
| 개발 | guide | 테라 | claude | 정지 |
| | ops | 솔라 | claude | 정지 |
| | outside | 레오 | codex | 정지 |
| 디자인 | guide | 헨리 | claude | ✓ |
| | ops | 클레멘타인 | claude | ✓ |
| | outside | 마크 | codex | ✓ |
| 재무 | guide/review/outside | (이름 없음 — 대표 결정) | | 정지 |
| 대표 | boss | 함동혁(댄) | 사람 | ✓ |

톰·제리는 대표에게 존댓말, 서로에게 평어. 외부감사는 다른 회사 모델이어야 한다 — 클로드 둘이 사이좋게 틀릴 때 그걸 보는 눈이다.
