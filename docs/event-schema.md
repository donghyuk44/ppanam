# 이벤트 스키마 — 작전실 채팅방에 나타날 수 있는 것의 전부

이 문서가 **디자인과 구현 사이의 계약**이다.
`/design` 아트보드도, 웹 UI 구현도, 훅 스크립트도 전부 이 목록만 보고 만든다.
여기에 없는 것은 화면에 나타나지 않는다.

---

## 0. 방

방은 두 종류다 (`state/teams.json` 의 `kind`). 종류가 다르면 **기록 조건이 다르다.**

| 종류 | 어떤 방 | 라운드 | 훅이 언제 기록하나 |
| --- | --- | --- | --- |
| `team` (기본) | 작전실 — 마케팅·개발·디자인·경영 | 있다 | **라운드가 열려 있을 때만.** 안 그러면 이 저장소에서 도는 모든 잡담이 흘러든다 |
| `office` | 총괄실 — 대표와 1:1 · **비서실**(`sera`) — 대표와 세라 1:1 (결정 132) | **없다** | **늘.** 방 자체가 대표와의 대화라 비울 것이 없다 |

판정은 `bus/bus.mjs` 의 `kindOf()` / `isOffice()` 가 한다.

`office` 방은 `state/teams.json` 에 세 값을 더 가질 수 있다 — 비서실이 그것으로 "세라의 보고만 뜨는 방" 이 된다(결정 132):

| 값 | 무엇 | 총괄실 | 비서실 |
| --- | --- | --- | --- |
| `owner` | 방 주인 — 대표 지시가 먼저 가는 자리(`session.ownerOf`) | (없음 = `chief`) | `secretary` |
| `speakers[]` | 이 방에 기록될 수 있는 화자. 밖의 화자는 `bus.emit` 이 **버린다**(오류가 아니라 null — 훅·안내·승인·카드 어느 것도 이 방에 못 들어온다) | (없음 = 누구나) | `["boss","secretary","system"]` — 나리(`system`)는 대표 초대(09-14). `only` 가 message 라 나리의 말만 남고 자동 안내(note)는 여전히 안 들어온다 |
| `only[]` | 기록될 수 있는 종류. 밖은 버린다 — 도구 줄·안내(note)·입장(enter)이 안 남는다 | (없음 = 모두) | `["message"]` |

버린 것은 서버 stderr 에 한 줄 남긴다(`emit 버림 sera/system note`). 판정은 `bus.roomRules(team)` · `bus.allowedIn(team, event)` — 순수, `round.mjs check` 가 돌린다.
비서실의 세라는 총괄실의 세라와 **같은 사람, 다른 세션**(`sera:secretary`) — 다섯 팀 상황판(`progress.json`)·대기 승인·열린 요청 블록을 읽고 대표 말로 요약해 보고한다(결정 98). 재료의 조립은 `session.mjs briefOf`(비서실이면 다섯 팀 것), 낱말은 하영.

```
teams/<방>/
  log.jsonl      영구 대화록 — 이 문서가 규정하는 것
  rounds.jsonl   라운드 요약 색인          (office 에는 없다)
  round.json     현재 라운드 상태          (office 에는 없다)
  cast.json      화자와 대표
  roadmap.json   5단계 결정과 마일스톤     (office 에는 없다)
  guide.md       방 주인의 인격 — 작전실
  chief.md       방 주인의 인격 — 총괄실
  outside.md     외부감사의 인격 (codex 프롬프트로 그대로 들어간다)
  in/            대표가 올린 자료
  out/           마일스톤 산출물
```

**자리 = 프로세스.** 방의 모든 claude 자리(`guide`·`chief`·`review`·`ops`)가 각자 세션을 갖는다 — 서브에이전트가 아니다.
서버가 자리마다 `claude -p` 를 띄우며 `PPANAM_TEAM`·`PPANAM_ACTOR` 를 넣고, 인격은 `teams/<방>/<자리>.md` 를
`--append-system-prompt` 로 붙인다 (`server/session.mjs assemblePrompt` = 인격 + 확정 조항 해석 + 일지 최근 문단 + 라운드 브리프).
모델·도구는 `cast.json` 의 `llm`·`disallow` 가 정한다(감사역은 Write·Edit 없음). 외부감사(`outside`)만 codex 별도 프로세스다.
전에는 내부감사·운영이 실무가 부를 때만 뜨는 서브에이전트라 방을 듣지도 서로 부르지도 못했다 — "서로 대화 안 하는데?" (2026-09-01).

모든 이벤트는 `team` 필드를 갖는다. 컴퓨터에서는 왼쪽 레일이 **안 보고 있는 팀**의
상태(진행 중 / 대기 / 대표 호출)까지 함께 보여주고, 폰에서는 한 방씩 본다.

## 1. 화자(actor)

서브에이전트의 `name` 은 소문자와 하이픈만 쓸 수 있고, 훅이 이 값을 `agent_type` 으로
그대로 넘겨준다. 따라서 화자 ID = 서브에이전트 `name` 으로 통일한다.

| actor | 한글 이름 | 실체 | 화면 위치 | 비고 |
| --- | --- | --- | --- | --- |
| `chief` | 총괄 | 총괄실 메인 세션 | 왼쪽 | 대표 지시를 팀에 배분. `office` 방에만 있다 |
| `guide` | 실무 | 작전실 메인 세션 | 왼쪽 | 실행 주무. Advisor + Librarian |
| `review` | 내부감사 | Claude 서브에이전트 | 왼쪽 | 감사. Tutor + Editor |
| `ops` | 개발·운영 | Claude 서브에이전트 | 왼쪽 | 두 번째 손 + 운영. **감사역이 아니다** |
| `outside` | 외부감사 | **별도 프로세스 (codex)** | 왼쪽 | 교차검증. 서브에이전트가 아니다 — 아래 참고 |
| `boss` | 대표 | 사람 | **오른쪽** | 사람이 직접 끼어든 발언 |
| `system` | — | 훅 / CLI | **가운데** | 말풍선이 아니라 배너 |

**방마다 쓰는 자리가 다르다.** 위 목록은 있을 수 있는 자리 전부고, 어느 방이 어느 자리를
쓰는지는 그 방의 `cast.json` 이 정한다. 마케팅은 `guide·review·outside`, 개발은
`guide·ops·outside`(감사는 외부 하나), 총괄실은 `chief·outside` 다.
**개발팀에 내부감사가 없는 이유**: 코드는 돌거나 안 돌거나라 외부감사가 실제로 실행해
보는 것이 더 강한 검증이고, 대신 비어 있던 운영 자리를 채웠다.

**외부감사는 서브에이전트가 아니다.** Claude Code 의 서브에이전트는 Claude 모델만
받으므로 GPT 를 에이전트로 등록할 수 없다. `bus/outside.mjs` 가 codex CLI 를 별도
프로세스로 띄우고, **그 답을 직접 대화록에 남긴다.** 클로드가 옮겨 적으면 그 순간
다시 클로드의 말이 되기 때문이다. 발언에는 `meta.engine` 으로 어느 엔진이었는지 남는다.

훅은 `PPANAM_ACTOR` 로 화자를 정한다. 과도기의 서브에이전트 이벤트는 캐스트 자리 이름(접두 포함)이면 그 자리로,
그 밖(임시 도구)은 기록하지 않는다 (`.claude/hooks/to-bus.mjs` 의 `actorOf`). 화자는 늘 위 표의 일곱 중 하나다.

말풍선 색·이름·모델은 `cast.json` 이 정한다. 별도 매핑 파일을 두지 않는다.

**자리의 직책과 하는 일** (요청 req_94013782, 결정 97·43 ⑥) — `cast.json agents[자리]` 의 `title`(직책, 짧은 명사) · `does`(하는 일, 한 줄).
옛 `role` 한 칸("실무 · 만들고 고친다")을 첫 ` · ` 에서 갈라 옮긴 것이다. 화면(사람 카드·헤더·툴팁)은 **`title` 만** 보여 주고 `does` 는 인격 파일·카드 안쪽용이다.
`/api/actor` 는 둘 다 돌려준다. 직책 글자를 바꾸는 것은 대표가 고른 뒤 따로(out/opsroom-words.md).

**자리의 엔진·모델·추론 강도** (결정 69) — `cast.json agents[자리]` 의 네 값. 대표가 관제탑 개인 카드에서 고친다(비용 직결 — 대표만).

| 값 | 무엇 | 없으면 | 어디에 닿나 |
| --- | --- | --- | --- |
| `model` | 엔진 — `claude` · `gpt`(codex) · `gemini`(임시 외부 감사) | — | 자리의 세션 종류. claude 는 `server/session.mjs`, gpt·gemini 는 `bus/outside.mjs` |
| `llm` | claude 모델 — `opus` · `sonnet` · `haiku` | 방의 모델(`state/teams.json`) | `claude --model` |
| `codexModel` | codex 모델 — `CODEX_MODELS` 목록(`bus/bus.mjs`) | 환경 `PPANAM_CODEX_MODEL`, 그것도 없으면 목록 첫 것 | `codex exec -m` · `resume -c model=` (전엔 전 자리 공통 환경변수 하나) |
| `geminiModel` | gemini 모델 — `GEMINI_MODELS` 목록(`gemini-3.6-flash` · `gemini-3.1-pro`) | 목록 첫 것 | 물음 파일의 `model` |
| `effort` | 추론 강도 — `low` · `medium` · `high` · `xhigh` | 엔진 기본(플래그 안 붙임) | `claude --effort` · `codex -c model_reasoning_effort=` (gemini 는 안 씀) |
| `suspended` | 외부감사 자리만 — "지금 못 부른다" 를 명시(결정 118 ②). 값은 복귀 예정일 `YYYY-MM-DD`, `none` 으로 해제(파일에는 지워짐) | 없음(= 부른다) | 판정 흐름이 이 걸음을 건너뛰고 `skip` note 를 남긴다(5-1절). `endRefusal` 이 그의 카드를 안 요구한다. 라운드 기록에 `outsideAudited:false` · `outsideWhy:'suspended'` |
| `fallback` | 기본 엔진이 못 돌면 누가 인계받나(결정 116 ②) — `gpt` · `gemini` · `none`(대표께 올림) | 다른 회사 엔진 중 나머지 하나(`bus.fallbackOf`) — 빈칸은 없다 | codex 계정 한도(쿨다운) 때 `outside.mjs` 가 이 호출을 폴백으로 돌리고 방에 한 번 알린다. 판정문 `meta.engine` 은 답한 엔진 |

**"다른 회사 엔진"** 은 `gpt`·`gemini` 둘 — 코드는 `'gpt'` 를 직접 비교하지 않고 `bus.isForeign(model)` 하나를 쓴다(흩어진 비교가 하나 빠지면 그 자리가 조용히 죽는다 — 결정 77).
`engineName(model)` 이 사람 말(`codex` · `gemini` · `claude`)이고 판정문 `meta.engine` 에는 부른 이름이 아니라 **답한 것**을 적는다(결정 78) — "gemini · gemini-3.6-flash".
**gemini 자리의 길은 셋, 위에서부터 되는 것**(`outside.mjs runGemini`): ① **Antigravity CLI `agy`** — 진짜 길(09-14 실측 통과: `agy -p "<프롬프트>" --output-format json --model <slug> --effort <low|medium|high> --print-timeout 5m [--conversation <id>]`
→ stdout 에 `{ conversation_id, status, response, … }`, `--conversation` 으로 이어붙임. 인자는 `bus.agyArgs`(순수), 봉투는 `bus.parseAgy`. `--effort` 는 필수라 자리에 없으면 `medium`, 우리 `xhigh` 는 `high`.
헤드리스 기본이 승인 필요한 도구를 거부해 읽기만 한다 — `--dangerously-skip-permissions` 는 안 붙인다. 설치 `curl -fsSL https://antigravity.google/cli/install.sh | bash`(→ `~/.local/bin/agy`), 첫 실행에 Google 로그인(대표 계정, Google AI Pro).
연기 시험 `node bus/outside.mjs --check --engine agy "…"`(기록 안 남김) ② HTTP 다리 `PPANAM_GEMINI_URL`(`tools/antigravity-bridge`, 가설 — agy 가 되니 안 쓴다) ③ 파일 왕복(아래 — agy 가 없을 때만).
**파일 왕복**(하네스가 창을 몰던 임시 길): `outside.mjs runGemini` 가
`state/gemini/ask/<id>.json { id, team, actor, model, prompt, resume, ts }` 를 쓰고(임시 파일 → rename), 하네스가 창을 몰아 `state/gemini/answer/<id>.json { id, answer, sessionId, ts }`
(또는 `{ error }`)를 쓰면 2초마다 보던 outside.mjs 가 읽고 **둘 다 지운다**. `PPANAM_OUTSIDE_TIMEOUT`(기본 5분) 안에 답이 없으면 codex 실패와 같은 길(방에 note, exit 1) — 세션은 안 버린다.
느리다(30초~1분, 하네스 세션이 돌 때만) — 판정 같은 큰 것에만. codex 계정 한도 쿨다운(`state/outside-cooldown.json`)은 gpt 자리에만 걸린다.
**프롬프트 크기**(대표 지적 09-14 — 마크 첫 호출 17,126자, 67% 가 방 대화록): ① 다른 회사 엔진은 침묵·제3자 차례를 안 받는다(5-1절 4·5) ② gemini 는 인격·확정조항·일지를
**대화마다 한 번** — 이어가는 호출(`resume`)엔 새 말만(codex 는 세션 압축 때문에 턴마다, M1 인격 이음) ③ 방 대화록에서 `note` 와 밤 시계 깨우기는 뺀다, 시스템 말은 300자.
세션 칸 `state/outside-sessions.json` 에 `engine` 이 붙는다 — 이어붙임은 같은 엔진 것만(codex → gemini 로 바꾼 자리에 codex id 가 남아 있어도 안 쓴다).

`POST /api/cast { team, actor, model?, llm?, codexModel?, geminiModel?, effort? }` — 순수 `bus.castChangeError(agent, patch)` 가 거르고(없는 자리·`boss`·`system`·
목록 밖 값·엔진에 안 맞는 모델 → `400`), 통과하면 **서버가** `cast.json` 을 쓴다(`bus.updateCastAgent` — 파일은 C 잠금이라 화면 요청을 서버가
대신 쓰는 것) + 방에 `note` "대표가 테라를 opus·high 로 바꿨습니다"(`meta.castChange { actor, from, to }`). **다음 턴부터** — claude 자리는
도는 턴을 안 끊고 턴이 끝나면(놀고 있으면 바로) 세션을 내려서 다음 `send` 가 새 인자로 다시 띄운다(id 는 남겨 `--resume` 으로 잇는다);
codex 자리는 `outside.mjs` 가 매번 `cast.json` 을 읽으니 저절로. **엔진(`model`) 을 바꾸면 그 자리의 세션 종류가 바뀐다**(결정 69 ①) —
codex 가 된 자리는 사회자가 `outside.mjs --team <방> --actor <자리>` 로 띄우고(그 자리 이름으로 말하고, 그 자리의 인격·일지·세션 칸
`방:자리` 를 쓴다 — 외부감사는 옛 칸 이름 `방` 그대로), claude 자리로는 `outside.mjs` 가 뜨지 않는다(exit 2). 대표가 이름 없이 말했는데
주인이 codex 자리면 `/api/say` 가 말풍선을 남기고 사회자를 깨운다(`conductor.wake`). 한 방의 codex 자리들은 한 번에 하나만 돈다(`outsideBusy`).
**외부감사는 다른 회사 엔진 고정** — 클로드가 외부감사인 척하지 않는다(CLAUDE.md), 판정 흐름도 `isForeign(outside.model)` 을 전제. 화면의 알약 셋(claude · codex · gemini)은
켜진 쪽이 disabled, 다른 쪽을 누르면 바뀐다(외부감사는 claude 만 못 누름 — codex ↔ gemini 는 된다). 응답 `{ agent, from, to, restart: 'now' | 'after-turn' | null }`.
`/api/boot` 의 `castOptions { engines, claude, codex, gemini, efforts }` 가 화면의 목록이다.

---

## 2. 레코드 형식

`teams/<팀>/log.jsonl` 에 한 줄에 하나씩 append 된다. 모든 이벤트가 같은 봉투를 쓴다.
(옛 이름 `bus/live.jsonl` 은 없다. 방마다 하나, 지우지 않는다.)

```json
{
  "id": "evt_3f9a2c1b",
  "ts": "2026-09-01T04:20:00.000Z",
  "team": "marketing",
  "round": 3,
  "milestone": 2,
  "actor": "review",
  "type": "verdict",
  "text": "3번 항목의 근거 링크가 죽어 있습니다.",
  "meta": { "verdict": "REVISE", "target": "guide", "attempt": 2 }
}
```

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `id` | ✔ | `evt_` + 랜덤 hex 10자. 페이지네이션의 기준점이기도 하다 |
| `ts` | ✔ | ISO 8601 UTC |
| `team` | ✔ | 어느 작전실인지 (`state/teams.json` 의 id) |
| `round` | ✔ | 현재 라운드 번호. 0이면 라운드 밖 |
| `milestone` | | 현재 마일스톤 번호 |
| `actor` | ✔ | 위 표의 ID |
| `type` | ✔ | 아래 3절의 값 |
| `text` | ✔ | 표시할 본문. 비어 있을 수 있음(`tool` 등) |
| `meta` | | 타입별 부가 정보 |

---

## 3. 이벤트 타입 8종

### `message` — 말풍선
가장 흔한 것. 에이전트나 사람의 발언.
`actor` 가 `boss` 면 오른쪽 노란 말풍선, 나머지는 왼쪽.
연속된 같은 화자의 발언은 아바타를 생략하고 묶는다.

- **출처**: `SubagentStop` 훅의 `last_assistant_message`
- `meta.partial` — 계약에만 있고 **미구현**이다. 타이핑 말풍선은 만들지 않았다 (2026-09-12 확인).

### `enter` — 등장 배너
에이전트가 라운드에 합류. 가운데 작은 알약 모양.
> 내부감사 님이 들어왔습니다.

- **출처**: `SubagentStart` 훅

### `tool` — 도구 사용 로그
접힌 상태의 얇은 모노스페이스 줄. 기본은 접혀 있고 눌러야 펼쳐진다.
채팅방이 도구 호출로 도배되면 안 되므로 **말풍선보다 훨씬 약하게** 표시한다.

- **출처**: `PreToolUse` / `PostToolUse` 훅
- `meta.tool`: 도구 이름, `meta.ok`: 성공 여부
- 화면은 같은 사람의 **연속 도구 줄을 한 줄로 접는다** — "테라 · 파일 7개 읽고 11개 고치는 중 (app.js, style.css …)".
  사람·동사·파일 이름만, 전체 경로는 펼쳐야 보인다. 다른 이벤트가 오면 "…중" 이 "…함" 이 된다 (대표 결정 30 —
  "Read · /Users/…" 18줄이 대표 화면을 채웠다). 대화록에는 한 건씩 그대로 남는다.
- **도구 줄은 발언이 아니다.** 요약(`teamSummary`)의 `lastText·lastActor·lastAt` 는 마지막 `message`·`verdict` 다 — 관제탑
  카드가 "/Users/…/world.mjs" 를 마지막 말로 보여 줬다 (독립검수 #10). 그 뒤에 온 도구 줄은 `lastTool { actor, tool, text, ts }`
  로 따로 실려 "테라 · app.js 고치는 중 · 2분 전" 한 줄이 된다.

### 생존 표시 — 누가 지금 일하는가 (대표 결정 28 ①·31 ①)
요약의 `sessions[자리] = { alive, busy, queued, lastSignal }`. `lastSignal` 은 서버가 그 세션의 스트림 이벤트(도구 호출·출력)를
마지막으로 받은 시각(10초 단위). 화면은 일하는 세션이 있으면 라운드 줄에 **"테라 작업 중 · 마지막 신호 2분 전"** 을 늘 띄우고
30초마다 다시 센다. 헤더 둘째 줄은 자리마다 "테라 작업 중 · 솔라 듣는 중 · 레오 자는 중" — 폰에서는 상태 칩이 숨으므로 이 글자가
전부다. 명단은 **이 방 사람만** — 총괄실 밖 방의 `cast.agents.chief` 는 옮겨온 말(5절 `meta.from`)의 화자로 빌린 것이라
`from: 'hq'` 가 달려 있고 헤더·칩·참여 카드에서 뺀다. codex 자리는 세션이 없으므로 돌리는 중(`busy`)·차례(`turn`)가 아니면
"자는 중" 이다 — 쉬는 codex 를 "듣는 중" 으로 그리지 않는다 (레오 R15 감사).

**생존 알림 `note`** (결정 31 ②, `session.mjs aliveNotes`): 일하는 세션이 있는데 그 방에 5분 동안 아무 줄도 안 남으면 서버가
`{ actor: 'system', type: 'note', meta: { alive: true }, text: "테라 아직 작업 중 (7분째, 마지막: app.js 고치는 중)" }` 를 남긴다.
서버가 5분 넘게 신호를 못 받았으면 "작업 중" 이라 하지 않고 "테라 6분째 신호 없음 (도구 호출도 출력도) — 15분이면 세션을
닫습니다". 대표 화면용이다 — `meta.alive` 는 참여자 귀(`conductor.unheard`·`outside.mjs`)에 넣지 않는다. `/api/team` 의 `summary` 도 부팅·방송과 같은 모양이다(세션·차례 포함) — 얇은 것을 주면 방에 들어간 직후 일하는
사람이 "자는 중" 으로 보인다 (독립검수 #1). 15분 신호가 없어 세션을 닫을 때의 안내는 "무응답" 이 아니라
"15분 동안 신호 없음 — 세션을 닫았습니다. 다음 지시로 이어집니다" (결정 31 ③).

### 사람별 집계 `people` — 관제탑 개인 탭 (대표 결정 40 · M2)
요약(`summaries[팀]`)의 `people[자리]` — 그 방의 사람마다 한 묶음. 열쇠는 `cast.json` 의 자리 이름(`guide`·`ops`·`outside` …)이고
`system` 은 없다. 대표는 `people.boss` 로 따로 모양이 다르다(아래). 헨리 설계 `teams/design/out/opsroom-tower-tabs.md` 3절·7절이
읽는 값이다. 이름·색·자리 이름은 `cast` 에 이미 있으니 여기 다시 싣지 않는다.

| 필드 | 무엇 | 어디서 |
| --- | --- | --- |
| `busy` | 지금 일하는 중인가 | claude 자리는 `sessions[자리].busy`, codex 자리는 사회자의 `outsideBusy`(`server/conductor.mjs`) **또는** `outside.mjs` 가 도는 동안 두는 표시 `state/outside-running/<방>.<자리>.json`(`bus.outsideRunning`, pid 살아 있을 때만) — CLI `--ask` 호출은 사회자가 모르니 표시 파일이 잡는다. 대표가 "레오 세션 초기화 했어?" 하고 본 "쉼"(09-13 13:48) |
| `alive` | 세션이 떠 있나 — true·false, codex 자리는 **null**(세션이 없다) | claude 자리는 `sessions[자리].alive` |
| `lastSignal` | 마지막 신호 시각(ISO) 또는 null | claude 자리는 `sessions[자리].lastSignal`(10초 단위). codex 자리는 **대화록의 마지막 발언(`message`·`verdict`) 시각** — 스트림이 없으니 말한 시각이 신호다 |
| `state` | 일 상태 — `working`·`bossCall`·`blocked`·`waiting`·`resting` | `bus.workStateOf(p, phase, now)` (아래). 화면은 이 값으로 알약을 고른다 — **마을 시계는 안 본다**(결정 58) |
| `lastSaidAt` | 마지막 발언 시각 또는 null | 대화록 전체에서 그 자리의 마지막 `message`·`verdict`. `(패스)` 로 시작하는 줄은 발언이 아니다 |
| `doing` | 지금 하는 일 한 줄 또는 null | 마지막 발언 **뒤에** 그 자리의 도구 줄이 있으면 `{ tool, text, ts }`(화면이 `toolPhrase` 로 "app.js 고치는 중" 을 만든다), 없으면 마지막 발언의 첫 문장 `{ text, ts }` |
| `todaySay` | 오늘 발언 수 | 서버의 오늘(현지 날짜) `message` 수. `(패스)` 제외 |
| `todayVerdict` | 오늘 판정 수 또는 null | `verdict` 수. 판정을 내는 자리(`review`·`outside`)만 숫자, 나머지는 **null** — 화면은 null 이면 항목을 안 그린다 |
| `bossCall` | `{ id, ts, text }` 또는 null | 이 라운드에서 대표에게 **결정이나 손을 청했는데**(`asksBoss` — 대표를 부른 문단에 물음표·"정해 주세요·골라·답해" 나 부탁(주세요·주시면·부탁·허용·실행)이 있다, 결정 52·66) 그 뒤 대표가 말하지 않았다. 부르기만 한 보고("대표님, 정리했습니다.")는 여기 안 실리고 `bossNotes` 에만. `text` 는 그 발언 첫 80자 — 카드의 `"손 하나 빌려도 될까…"`. 대표가 답하면 null. 팀 요약의 `bossCall` 과 같은 판별에 `text` 만 더한 것 |
| `journalFirst` | 일지 맨 위 문단의 첫 문장 또는 null | `session.journalFirstSentence` — 마을 카드의 "어제 한 줄" 과 같은 값 |

`people.boss` = `{ lastSaidAt, lastText, todaySay, todayDecisions }` — 이 방에서 대표가 마지막으로 한 지시(첫 200자)와 시각, 오늘 이 방에
한 지시 수, 오늘 이 방의 승인 요청에 대표(`by: 'boss'`)가 내린 판정 수. 대표가 **직접 친 말만** — 총괄이 옮겨온 것(`meta.via`, 4절)은
결정 원문이라 안 센다(`bus/dispatch.mjs lastBossSay` 와 같은 규칙). 대표는 한 사람이라 화면이 다섯 방의 값을 **합쳐서** 카드 하나로
그린다 — 지시·판정은 합, 마지막 지시는 가장 늦은 것. 대표 카드의 상태 알약(`자리에`·`자리 비움`)은 화면이 마지막 지시 10분 안인지로 정한다.
대표 카드의 "하는 일" 줄은 **대표 발언을 인용하지 않는다**(결정 58 ② — 6시간 전 말이 "하는 일" 로 떴다) — 화면이 `오늘 지시 N · 승인 대기 N ·
차례인 방 개발·디자인` 로 만든다(지시는 다섯 방 `todaySay` 합, 승인 대기는 대기 카드 수, 차례인 방은 종 배지와 같은 `needsBoss`·`bossCall` 방).
`lastText` 는 계약에 남지만 관제탑은 안 쓴다.

"오늘" 은 서버 프로세스의 현지 날짜다 — 마을 시계(`world.mjs`)의 `debugHour` 는 시각만 바꾸고 날짜는 안 바꾼다.

**일 상태 `state`** (결정 58 ①) — 관제탑은 마을 시계가 아니라 **일 상태**를 보여 준다. 일요일 저녁에 라운드가 돌아도 열넷이 "잠" 으로 뜨던
버그. 순수 함수 `bus/bus.mjs workStateOf(p, phase, now)` 가 정하고 서버가 `people[자리].state` 로 싣는다. 먼저 맞는 것이 이긴다:

| `state` | 알약 | 언제 |
| --- | --- | --- |
| `working` | 일하는 중 | `busy`, 또는 (대표 부름·막힘이 아닌데) `lastSignal` 이 **5분 안** — 턴이 막 끝나도 5분은 일하는 중이다 |
| `bossCall` | 대표 부름 | `bossCall` 이 있다(대표가 아직 답 안 함). `busy` 보다 뒤, 신호 5분보다 앞 — 부르고 기다리는 사람이 "일하는 중" 으로 가려지면 안 된다 |
| `blocked` | 막힘 | 팀의 `phase === 'blocked'` |
| `waiting` | 대기 | 세션이 떠 있다(`alive`), 또는 라운드가 없다(`phase !== 'running'`) — 차례나 라운드를 기다린다 |
| `resting` | 쉼 | 라운드가 도는데 세션이 없고 신호도 오래됐다 — 이 라운드에 안 끼어 있다. codex 는 세션이 없으니 5분 넘게 말이 없으면 여기 |

마을 시계(`night`·`rest`)는 마을 탭에만. 집계는 순수 함수 `bus/bus.mjs peopleOf(log, cast, { now })`·`workStateOf` 라 `round.mjs check` 가 돌려본다.
사람 카드의 "하는 일" 줄(`doing`)은 `working` 이 아니면 뒤에 `· N분 전` 을 붙인다 — 옛 발언을 지금 일로 읽지 않게.

**관제탑 탭 넷** (결정 40·50) — `전체`(첫 화면) · `팀`(지금의 팀 카드 다섯) · `개인`(위의 `people` 로 열넷 + 대표) · `요청`(팀 사이 요청 —
M3 데이터 전까지 빈 상태 문구). 마지막에 본 탭은 브라우저가 기억한다. `전체` 의 "오늘 보고" 줄은 요약의 `bossNotes[]` —
오늘 대표를 부른(`callsBoss`) 발언을 최근 것부터 30건까지 `{ id, ts, by, text(160자), ask }`. `ask` 는 결정이나 손이 필요한 말인가(`asksBoss` —
물음표 · "정해 주세요·골라·답해" · 부탁, 결정 52·66, 8절) — 화면은 `ask` 가 아닌 것을 보고로 그린다. **종 배지(`bossCall`)도 같은 판별이다**(M4) —
`ask` 인 말만 종이 되고, "대표님," 으로 시작해도 물음이 없으면 보고라 이 줄에만 남는다(하영·헨리 보고가 승인 요청으로 읽힌 09-13 17:28 건).
승인 대기와 막힘은 말이 아니라 상태라 따로 뜬다 — 승인은 대기 카드(6절), 막힘은 `needsBoss`(5절).

**"내가 할 일" 블록** (결정 13·19-3) — 관제탑 `전체` 의 첫 카드. 대표가 정하거나 눌러야 하는 것만: 알림 목록(아래)의 급한 종류
셋(대표 차례 → 승인 대기 → 막힘, 같은 순서)과 각 방 상황판 `progress.boss[]` 줄. 보고는 여기 안 오고 "오늘 보고" 줄로. 누르면 그 말풍선·승인 블록·방으로.

**알림 패널** (결정 68 — "배지만 있고 내용이 없으면 대충 구현") — 종을 누르면 패널이 열리고 **목록**이 보인다. 새 저장소는 없다:
순수 함수 `server/public/notify.js notificationsOf({ teams, summaries, approvals }, { now, read })` 가 부팅·방송으로 이미 온 값에서
목록을 만든다(화면과 `round.mjs check` 가 같은 것을 쓴다). 항목 `{ id, kind, team, by, text, ts, thumb, unread, target }`:

| `kind` | 어디서 | `text` | `target` |
| --- | --- | --- | --- |
| `boss` 대표 차례(빨강) | 팀 요약 `bossCall`(결정을 청했는데 답 없음) + `people[by].bossCall.text` | 그 말 앞머리 80자 | 그 방, 그 말풍선 |
| `approval` 승인 대기 | `approvals` 대기 중 C(대표 판단) | `what` | 관제탑 요청·승인 카드 |
| `blocked` 막힘 | 팀 요약 `needsBoss`(`blocked`·`attempts`·`silent`) | 이유 한 줄(`BOSS_WHY`) | 그 방 |
| `report` 보고 | `bossNotes[]` 중 `ask` 아닌 것(오늘) | 그 말 앞머리 160자 | 그 방, 그 말풍선 |

순서는 종류 순(대표 차례 → 승인 대기 → 막힘 → 보고), 같은 종류 안은 최근 것부터. `id` 는 `<kind>:<이벤트 id 또는 승인 id 또는 팀>` —
같은 일은 한 항목. `thumb` 은 그 말에 `out/` 그림 경로가 있으면 첫 장의 `/out/` url, 없으면 null(화면은 방 아이콘). `unread` 는
브라우저가 기억하는 읽음 목록(`localStorage`, id 집합)에 없는 것 — 항목을 누르거나 "모두 읽음" 이면 읽음. 종 배지 숫자는 **안 읽은 수**,
빨강은 대표 차례·승인·막힘 중 안 읽은 것이 있을 때. 항목 한 줄 = 팀 색 아바타(`by` 의 색, 없으면 팀) + 이름 · 한 줄 · "N분 전" · 오른쪽
썸네일 또는 방 아이콘 · 안 읽음 점. 패널 머리는 "알림" + ⚙(설정 — 지금은 자리만) + "모두 읽음". 폰 412 에서 전체 폭.

**막힌 것 — 한 목록** (결정 92 "뭐가 막혔나", M6 준비 — 화면은 도면(결정 100) 뒤, 낱말은 하영 몫이라 여기 이름은 임시).
지금은 "대표 차례" 를 세는 코드가 셋(`bossTurns` · `notificationsOf` · 팀 줄 알약)이라 타일은 3, 내가 할 일은 5 가 뜬다(`out/m6-screen-findings.md` #6).
새 화면·보고서 탭은 **이 목록 하나**를 자른다. 순수 함수 `server/public/notify.js blockedOf({ teams, summaries, approvals, requests, infra }, { now })`
— 서버는 값을 재서 넘기기만 하고(`peopleOf` 와 같은 경계) 화면과 `round.mjs check` 가 같은 함수를 쓴다. 항목 `{ id, kind, where, team, teamName, by, waitOn, text, since, wait, state, target }`:

| `kind` | 어디서 | `waitOn` (누가 움직여야 풀리나) | `since` |
| --- | --- | --- | --- |
| `boss` 결정을 청했는데 답 없음 | 팀 요약 `bossCall` + `people[by].bossCall.text` | `boss` | 그 말의 `ts` |
| `blocked` 방이 멈춤 | 팀 요약 `needsBoss`(`blocked`·`attempts`·`silent`) | `boss` | `lastSpokeAt` |
| `approval` 승인 대기 | `approvals` 대기 중 — C 는 대표, B 는 톰·제리 | C → `boss` · B → `chief` | 요청 `ts` |
| `request` 요청 블록이 답을 기다림 | `requests` 중 안 닫힌 것 — `open` 은 받는 쪽, `done` 은 요청한 쪽(받았다), `acked` 는 톰(확인) | `{ team, actor }` 또는 `chief` | `updatedAt` |
| `board` 실무가 적은 막힌 것 | 팀 요약 `progress.blocked[]` | 그 팀 실무 `guide` | `progress.at` |
| `infra` 밑바닥 | `infra.{server,codex,sessions,disk}` — 서버가 밖에서 잰 값 `{ ok, at, timeout, detail }` | `ops` | 잰 시각 `at` |

`wait` 는 `now - since`(ms) — 목록은 **오래 기다린 것이 위**(`since` 오름차순). 종류별 순서 없음 — 화면이 `waitOn` 으로 자른다(대표 것만 → "내가 할 일", 전부 → 관제탑).
`infra` 는 잰 값이 없으면 항목도 없다(안 잰 것은 막힘이 아니다). `ok:false` 면 `state:'down'`, 잰 시각이 `timeout` 보다 오래됐으면 **`ok` 가 무엇이든** `state:'unknown'` —
마지막 성공값이 남아 죽은 밑바닥이 산 것처럼 보이면 안 된다(레오, R25). `ok:true` 이고 시각이 신선하면 항목 없음. 잰 값에는 `at`·`timeout` 이 반드시 있다 — 없으면 `unknown`. 경계: 딱 `timeout` 은 신선, 넘으면 `unknown`.
**미래 시각**도 허용 시차(`INFRA_SKEW_MS` 1분)를 넘으면 `unknown` — 시계가 크게 틀린 기계의 값이 영원히 살아 있으면 안 된다(레오, R25).
재는 쪽은 `server/infra.mjs` — **2분마다**(하네스 밤 시계와 같은 틱) 넷을 재고 `state/infra.json` 에 **덮어쓴다**(자라는 파일 아님). 서버는 자기 자신에게 HTTP(`/api/approvals` 200) ·
codex 는 `which codex` · 세션은 메모리 맵의 좀비 수(`session.health`) · 디스크는 `df -k` 남은 양 3G 기준. 재기 하나가 10초 안에 안 끝나면 그 항목만 `ok:false`.
`timeout` 은 세 틱(6분). 화면에는 `/api/boot.infra` · ws `hello.infra` 로 오고 **틱마다** ws `{ kind:'infra', infra }` 가 온다(값이 같아도 `at` 이 새로워야 한다).
서버가 막 켜져 첫 재기 전이면 `null` — 안 잰 것은 막힘이 아니다.
`id` 는 `<kind>:<이벤트 id · 승인 id · 요청 id · 팀 · infra 키>` — 같은 일은 한 항목이라 알림의 읽음 목록과 같은 열쇠를 쓴다.

**한 것 — 한 목록** (결정 92 "누가 뭘 했나", M6 준비 — 위와 짝). 지금 화면은 "오늘 몇 번 말했나"(`people[].todaySay`)와 "마지막 한 문장"(`doing`)뿐이라
**누가 무엇을 끝냈는지**가 없다. 파일에는 다 있다 — 판정 카드·승인 판정·요청 블록·마일스톤·라운드. 순수 함수 `bus/bus.mjs doneOf(log, cast, { team, since, until, approvals })`
가 팀 하나의 대화록과 승인 레코드에서 평평한 목록을 만들고(파일 안 읽음, `round.mjs check` 가 돌린다), 서버가 팀마다 불러 합친다. 항목 `{ id, kind, team, by, ts, text, ref }`, **`ts` 내림차순**(최근 것이 위):

| `kind` | 어디서 | `by` | `ref` |
| --- | --- | --- | --- |
| `report` 대표에게 보고 | `message` 중 대표를 불렀지만 결정은 안 청한 것(`callsBoss && !asksBoss`) | 그 자리 | — |
| `verdict` 판정 카드 | `verdict` 이벤트 — `meta.stale`(늦게 온 판정)은 뺀다 | review·outside | `meta.sha` |
| `decision` 승인 판정 | 승인 레코드의 `decisions[]` 한 줄씩 | chief·outside·boss | 승인 id |
| `proxy` 대리 결정 | `note` 에 `meta.proxy` | `chief`(톰·제리) | 승인 id 또는 답한 이벤트 |
| `request` 요청 블록 닫힘 | `note` 에 `meta.request` + `status:'closed'` | — (팀) | 요청 id |
| `milestone` 통과 | `milestone` 이벤트 | — (팀) | 번호 |
| `round` 닫힘 | `round_end` 이벤트 | — (팀) | 판정 |
| `commit` 커밋 | `tool` 이벤트(`meta.tool: 'Bash'`) 의 첫 줄에 `git commit` — `-m` 뒤 글자(여는 따옴표와 같은 것이 닫는 것, 안의 다른 따옴표는 글자) | 그 자리 | — |
| `file` 산출물 갱신 | `tool` 이벤트(`Write`·`Edit`·`NotebookEdit`) 가 `teams/<팀>/out/` 을 가리킴 — 같은 자리·같은 파일은 창 안 **마지막 한 번**. `Read` 와 out/ 밖은 안 센다 | 그 자리 | `teams/…` 경로 |

**만든 것도 한 것이다** (나리 09-15, 위임 136 — "지금 세는 게 승인·판정 카드뿐이라 만든 사람은 안 보이고 감사만 보인다. 커밋을 열 개 넘게 한 테라, 시안 여덟 장을 고친 헨리가 한 것 0"). 커밋·산출물은 도구 줄에서 나오므로
**훅이 기록한 방에만** 선다 — 개발 실무가 마케팅 out/ 파일을 고치면 개발 방의 한 것이다(자리 기준). 관제탑 ② 사람 줄의 막대 길이는 이 수다.

창은 `since ≤ ts < until`(비교는 UTC ms — `ts` 는 저장이 UTC 라 그대로 `Date.parse`), 기본은 **우리 시각(서울, +09:00 고정) 오늘 0시** ~ 지금 —
`dayStartSeoul(now)`, 서버 프로세스 TZ 와 무관하다(결정 101 의 아홉 시간 오류가 집계에서 다시 나지 않게, 레오 R25). 아침 보고서(결정 80)는 "어젯밤" 창으로, 개인 카드는 `by` 로, 라운드 카드는 `ts` 로 자른다.
산출물 파일(`out/`)과 커밋은 여기 없다 — 누가 썼는지 파일이 말하지 않는다. 사람이 적은 `progress.done[]` 도 여기 안 온다(집계가 아니라 글이다).

**화면 넷 + 카드 — 무엇을 읽나 (결정 81·92, M6).** 구조의 정본은 `teams/hq/out/화면이-답하는-질문.md`(나리, 대표 위임 09-14, 톰·제리 B apr_95e50f49) — **탭마다 질문 하나, 가르는 축은 시간.**
여기는 그 탭이 **무엇을 읽나**만 — 화면 모양은 헨리 시안 뒤(결정 93), 낱말은 하영 확정본(opsroom-words.md 7절). 세는 코드는 `blockedOf`·`doneOf` 하나씩(위 목록 둘), 화면은 자르기만.
(첫 초안은 대시보드에 "뭐가 막혔나" 를 뒀다 — 정본이 뒤집었다. 막힌 것은 **지금**이라 관제탑이다.)

| 자리 | 질문 · 시간 | 읽는 것 | 어떻게 자르나 | 없을 때 |
| --- | --- | --- | --- | --- |
| 관제탑 | 지금 무슨 일이 벌어지고 있나 · **지금** | `blockedOf(...)`(화면이 센다 — `summaries`·대기 승인·열린 요청·`infra`) · `GET /api/done?since`(다섯 방 `doneOf` 합, 기본 오늘 0시~) · `summaries` 팀 줄 + `progress` 네 칸 | 헨리 시안 2판(`tower.svg`) 순서 고정, 위에서 아래로 넷뿐 — **① 뭐가 막혔나**(`waitOn !== 'boss'` 이고 `kind !== 'request'` — FAIL·상황판 막힘·결재 대기·밑바닥. **부탁 블록의 차례는 막힘이 아니다**(톰 09-15) — 요청 탭에. 오래된 것이 위, "N시간째"는 멈춤 뺀 것) **② 누가 뭘 했나 · 오늘**(팀원만 — 대표는 안 선다(톰 09-15), 여섯 줄, 넘치면 "더 보기" — 오늘 안에서만, 어제는 보고서(하영 내용 2판 9절 2 · 사전 3-5-1. R25 에 "어제까지" 라 적은 건 내 글자였지 정본이 아니었다)) **③ 내 차례**(`waitOn === 'boss'` = 결재 C·물어봄·FAIL + 상황판 `boss[]` — 종과 **같은 목록**) **④ 팀**(단계 N/M · 회차 · 알약, 누르면 상황판 네 칸 글자 그대로, 한 번 더 = 카드). 없으면 그 칸이 사라진다(②만 늘). 숫자는 넷뿐 — 막힌 것 수·내 차례 수·단계 N/M·회차(칸 제목에만 — 큰 숫자 타일은 하영 내용 2판 9절 5 로 뺐다, 톰 09-15). 통계 타일·오늘 보고 칸은 뺐다(②가 품는다). 그림은 헨리 numbers 한 벌 — 팀 줄 진행 막대·시간 띠, 막힌 것 줄 팀 점·빨간 점, ② 위 사람마다 시간 띠 | ①③ 칸 없음 · ② "오늘 끝낸 일이 아직 없어요." |
| 대시보드 | 앞으로 언제 뭐가 되나 · **앞** | 팀마다 로드맵 `now`·`wait` 마일스톤(`pass` 는 지난 것 — 안 온다) + 그 팀 `rounds.jsonl`(회차 길이) + `round.json`(지금 회차 시작) + `state/pauses.json` | 헨리 시안 1판(`teams/design/out/screens/ui/dashboard.svg`) **앞날 띠** — 줄 = 팀(비서실·마케팅·개발·디자인·경영), 가로 = 앞으로의 시간, 칸 = 단계. 채움 = 잡힌 예정, 점선 = 대표 답이 있어야 열림, 빨강 = 늦음/막힘(지금 선에서 오른쪽으로 자람). 예정 시각은 **timebox × 그 팀 회차 평균 길이**로 계산 — 손으로 안 적는다. 세는 숫자 없음. 아래 "대표 답이 있어야 열리는 단계" 카드(gated 단계만 — 결재·대표 차례는 관제탑 ③). 누르면 왜(펼친 줄) → 계획표 카드. 다섯 팀이 **한 화면**, 폰 412 도. plan-table.md(결정 128 1판) 는 그 아래 그대로 | "단계 없음 — 계획표가 오면 뜹니다." |
| 분석 | 왜 자꾸 이렇게 되나 · **뒤** | 라운드 기록(`rounds.jsonl`)·판정·승인·막힘의 되풀이 | 숫자 하나는 안 온다 — **다른 숫자와 견줄 때만**(같은 자리에서 몇 번째 막힘, 라운드 길이의 흐름). 항목은 대표가 `out/analysis-inventory.md` 에서 고른 것만(로드맵 M6) | "견줄 만큼 쌓이지 않았어요." |
| 보고서 | 어제 하루가 어땠나 · **어제 하루** | `doneOf` 를 창으로(어젯밤 = 어제 18시~오늘 9시 · 날짜 고름) + `progress.next[]` + `out/**` 그림(`listOut`, 창 안 mtime) + 대리 결정(`note meta.proxy`) + 사람 글(`teams/hq/out/reports/<날짜>.md`) | 결정 80 의 다섯 절, 폰에서 30초 — ① 사이 있었던 일 ② 대표님이 보실 것(= 관제탑 ① 과 같은 목록) ③ 오늘 각 방이 할 일 ④ 한마디(글 있는 날만) ⑤ 사이 나온 그림 + 맨 위 "대표님 대신 정한 것"(결정 85 ③). **틀은 경영팀**(대표 09-14) — 개발은 아래층(집계)만 | "이 사이엔 한 일이 없어요." |
| 카드 | 이 하나를 더 보고 싶다 · (깊이) | `GET /api/actor` · 승인 레코드 · 마일스톤 · 방 요약 | 탭이 아니라 **문** — 어느 화면에서든 **두 번 눌러** 닿는다(한 줄 → 펼친 줄 → 카드). 넷째 겹은 없다. 사람 카드는 결정 130 ① 의 정사각형(얼굴·이름·직책·열 줄 1번·상태 알약) | — |

서버 문: `GET /api/dashboard` → `{ text, at, now, teams: [{ id, name, room, color, stages: [{ n, title, status, plannedFrom, plannedTo, late, blockedWhy, gate }], roundMs }], bossGates: [{ kind, team, what, id }] }`
— `text` 는 결정 128 1판(plan-table.md)인데 **`## 팀별 단계` 절만 서버가 roadmap 에서 만들어 바꿔 끼운 것**(`bus.stageTable` + `bus.swapSection`, 톰 09-14 "손으로 세는 건 썩는다") — 톰이 쓰는 건 위(대표님이 물으신 것)·아래(대표님 손에 있는 것) 두 표뿐이고 그건 글자 그대로. `at` 은 파일 mtime. 정본은 표 파일 + roadmap 둘이 한 화면에 있는 것. `stages` 는 헨리 시안 맨 밑 줄 그대로: `status` = `running`(지금 단계, 채움) · `planned`(잡힌 예정, 채움 옅게) · `gated`(대표 답 뒤, 점선 — `gate` 에 무엇) · `blocked`(FAIL 로 막힘, 빨강) · `plannedFrom/To` ISO 또는 null(기간을 셀 수 없을 때 = gated) · `late` ms(plannedTo 를 지난 만큼, 아니면 0) · `blockedWhy` 한 줄.
**멈춘 시간은 빼고 센다** — `state/pauses.json` `[{ from, to, why }]`(대표가 "쉬어라" 한 구간, 나리·톰이 손으로 적는다) 를 `bus.readPauses()` 로 읽어, `late`·기다린 시간(`blockedOf` 의 `wait`)·회차 평균(`roundLengthMs`)에서 겹친 만큼 뺀다(`bus.pausedMs`, 순수). 09-14 낮~09-15 밤 멈춤이 "41시간 늦음"·"33시간째" 로 섰던 것(톰). 화면은 `boot.pauses` 로 받는다.
`roundMs` = 그 팀 닫힌 회차 최근 여덟의 평균 길이(멈춤 뺀 것, 없으면 기본 90분). 계산은 순수 함수 `bus.plansOf({ roadmap, state, rounds, progress, now })` — `round.mjs check` 가 돌린다. 지금 단계의 `plannedFrom` 은 지금 회차 `startedAt`, `plannedTo` 는 거기에 timebox 회차 수 × `roundMs`; 다음 단계들은 앞 단계 `plannedTo` 뒤로 잇는다. timebox 에 "대표" 가 있으면 `gated`.
`bossGates` = **gated 단계만**(`kind:'stage'` — 대표 답이 있어야 열리는 단계, 띠의 점선 칸과 같은 것). C 승인·상황판 `boss[]` 는 여기 **안 온다** — 그건 관제탑 ③ 내 차례의 목록이고, 같은 것을 두 군데 두지 않는다(톰 req_2749e30e, 09-15). 칸 이름 "대표 답이 있어야 열리는 단계"(낱말은 하영). ·
`GET /api/report?since&until` → `{ done: [팀별], next: {팀: []}, images: [], proxy: [], chief: md|null, nightly: { day, file, md }|null }` · 관제탑은 지금처럼 `summaries`(+`infra`, `blockedOf` 는 화면이 센다).
셋 다 **파일을 새로 만들지 않는다** — 있는 것을 읽어 조립할 뿐. 사람 글이 없어도 탭은 뜬다(아래층이 정본, 글은 그 위 한 문단 — `out/m6-screen-inventory.md` 3절). 자정 마감 한 장(아래)만 예외 — 그건 서버가 자정에 쓰는 파일이다.

### 자정 마감 — 하루 한 장 (M7 · 결정 45 ③ · chief.md "하루 마감 — 자정")

**언제.** 서버 틱이 우리 시각 날짜가 바뀐 것을 보면(`bus.dayStartSeoul`) **지난 하루**를 마감한다. 서버가 자정에 죽어 있었으면 다시 뜬 뒤 첫 틱에 마감한다 —
대표가 아침에 보는 것이니 빠뜨리지 않는다(빠진 날이 여럿이면 마지막 하루만, 그 앞은 파일이 없는 채로 남는다 — 지어내지 않는다). 한 날 한 번 — 파일이 이미 있으면 다시 쓰지 않는다
(`state/nightly.json { lastDay }` 는 흔적, 파일이 진실). 자정에 열려 있는 라운드는 **닫지 않는다** — "아직 열림" 으로 적는다(라운드를 닫는 것은 실무·대표의 일, 7절).

**팀마다 한 장.** `teams/<팀>/out/nightly/<YYYY-MM-DD>.md` (비서실은 뺀다 — 대화록이 보고뿐). 순수 함수 `bus/nightly.mjs nightlyOf({ team, name, day, log, rounds, approvals, progress, state, cast, now })` → `{ problems: [{ kind, text, ref? }], counts, md }`,
`round.mjs check` 가 돌린다. 파일을 읽고 쓰고 톰을 깨우는 것은 `server/nightly.mjs runNightly`(서버 틱) 뿐 — `node bus/round.mjs nightly [--day YYYY-MM-DD]` 는 안 쓰고 찍어 보는 미리보기다.
창은 그날 0시 ≤ ts < 다음 날 0시(우리 시각). 절은 다섯 — 세는 숫자는 절 제목에만:

| 절 | 무엇 | 어디서 |
| --- | --- | --- |
| 맨 위 한 줄 | "문제 없음 — 읽고 넘기셔도 됩니다" 또는 "문제 N건" + 목록 | 아래 `problems` |
| `## 라운드 N` | 그날 시작하거나 닫힌 라운드 — 번호 · 주제 · 마일스톤 · 판정(PASS/REVISE/FAIL/없음) · 시작~끝(우리 시각). 자정에 열린 것은 "아직 열림" | `rounds.jsonl` + `round.json` |
| `## 판정 N` | 그날 판정 카드 — 시각 · 누가 · PASS/REVISE/FAIL · 엔진 · 대상 첫 줄. `meta.stale` 은 안 센다 | `log` `verdict` |
| `## 승인 N` | 그날 올렸거나 판정된 승인 — id · 등급 · 무엇 · 상태 · 판정한 사람. 대기 중인 것은 "대기 (누구 차례)" | `approvals` |
| `## 막힌 것 N` | 자정 시점 — FAIL 로 막힌 방 · 상황판 `blocked[]` · C 대기 · 답 없는 대표 호출(`bossCall`) · 자정 넘긴 열린 라운드 | `state` · `progress` · `approvals` · `teamSummary` 의 셈 |
| `## 다음` | 상황판 `next[]` 그대로 | `progress` |

`problems` 는 막힌 것 중 **대표 손이 필요한 것**만 — `blocked`(FAIL 방) · `approval`(C 대기) · `bossCall`(답 없는 호출) · `attempts`(반박 상한). 상황판 `blocked[]` 와 B 대기는 문제가 아니라 팀·톰 몫이라 "막힌 것" 절에만 선다.

**총괄실 한 장 = 대표용.** `teams/hq/out/nightly/<YYYY-MM-DD>.md` — 맨 위 한 줄(문제 없음 / 문제 N건 — 팀·무엇, 그 팀 파일 링크) · `## 대표님 대신 정한 것`(그날 `proxy-decisions.md` 줄, 없으면 "없음") ·
`## 팀마다`(팀당 한 줄: 라운드·판정·승인·막힌 것 수 + 파일 경로) · `## 톰의 자정 일지`(아래). 결정 45 ③ 그대로 — **문제 없으면 읽고 넘기고, 문제면 그때 개입.** `teams/hq/out/daily/` 는 톰이 손으로 쓰는 아침 글이라 건드리지 않는다(`/api/report` 의 `chief`).

**총괄실 자정 일지.** 총괄실은 라운드가 없어 톰의 일지가 한 번도 안 걷혔다(`teams/hq/journal/` 에 `chief.md` 없음). 자정 마감이 톰 세션에 `⟦일지⟧` 턴(`bus.journalPrompt` 와 같은 문장, 라운드 대신 날짜)을 보내 한 문단을 받아
`teams/hq/journal/chief.md` 에 붙인다(`appendJournal`, 3분 초과·`(패스)`·빈 답은 없음 — 총괄실에 note). 다음 톰 세션이 뜰 때 `assemblePrompt` 가 이 문단을 인격 뒤에 붙인다 — 팀 자리와 같은 세 층.

**대표에게.** 총괄실에 `note`(system, `meta.nightly { day, problems, file }`) 한 줄 — "자정 마감 <날짜> — 문제 없음 · <파일>" 또는 "문제 N건". 문제가 있으면 그 뒤 톰에게 차례를 준다(`called`, 지시: 대표께 한 문장으로 **물어라** —
물음이어야 종이 울린다, 결정 52). 종·`needsBoss` 는 새 장치가 아니라 있는 것 — 막힌 방은 이미 `needsBoss`, C 대기는 이미 관제탑 ③ 에 선다. 자정 마감은 그걸 **한 장으로 모아** 아침 첫 화면에 놓는 것이다.
`/api/report` 는 창의 끝 날 총괄 페이지를 `nightly` 로 싣는다 — 보고서 탭 "어제 하루가 어땠나" 의 아래층 맨 위.
문이 있는 자리(지금): 작전실 말풍선의 얼굴·이름과 오른쪽 참여 줄 → 관제탑 사람 카드가 팝업으로(`app.js openPersonPop`, 부품은 `personCard` 하나) · 마을 인형 → `/api/actor` 카드 · 관제탑 사람 탭은 카드 자체. 대표는 카드 없음. 나리(system 자리)는 세션이 없어 이름·직책만 — 인격 파일이 생기면 그 첫 줄이 붙는다.
관제탑 "전체" 의 타일은 뺀다(결정 92 — 통계 타일 탈락). "내 차례"·팀 줄은 관제탑에 남는다 — 같은 것을 두 군데 두지 않는다(findings #5·#7). **상황판 탭은 없앤다** — 네 칸은 관제탑 팀 줄 안으로(낱말·파일·`progress.mjs` 그대로, 아래 절).

통과 조건(정본 맨 밑, 감사역이 잰다): 화면마다 질문 **하나** · 관제탑에서 막힌 것이 **스크롤 없이** · 대시보드에 다섯 팀 예정이 **한 화면** · 어디서든 **두 번 눌러 카드** · 상황판이라는 독립 자리 없음.

**상황판 — 지금 어디까지 왔나** (결정 23 — "상황판은 업데이트도 안 되고 이상한 걸로 채워져 있고"). 팀마다 `teams/<팀>/progress.json`
하나. 로드맵이 목적지라면 이건 현재 위치다. **실무가 턴 끝·라운드 닫기마다 갱신한다** — `node bus/progress.mjs --team <팀> --doing "…"
--blocked "…" --boss "…" --next "…"`(플래그는 여러 번, 준 항목만 통째로 바뀌고 안 준 항목은 그대로, `--clear <항목>` 으로 비움).
파일은 서버가 읽어 요약 `progress` 로 싣고(`summaries[팀].progress`), 세 곳이 쓴다:

| 값 | 무엇 |
| --- | --- |
| `at` · `by` · `round` | 갱신 시각(ISO) · 갱신한 자리 이름 · 그때 라운드 |
| `doing[]` | 지금 하는 것 — 한 줄씩 |
| `blocked[]` | 막힌 것 — 왜 막혔는지 한 줄씩. 없으면 빈 배열 |
| `boss[]` | 대표 차례 — 대표가 정하거나 눌러야 하는 것. 없으면 빈 배열 |
| `next[]` | 다음 — 이 라운드 뒤에 할 것 |
| `done[]` | (선택) 한 것 — 옛 모양의 `done`·`left`·`issues` 는 읽을 때 `done`·`next`·`blocked` 로 본다 |

① 방 오른쪽 상황판의 **첫 카드**(`app.js renderSide` — 이번 라운드 카드보다 위): 네 줄(하는 것·막힌 것·대표 차례·다음)과 "갱신 N분 전 · 테라".
파일이 없으면 "아직 상황판을 안 썼습니다 — 실무가 `progress.mjs` 로 씁니다". 갱신이 **이 라운드 시작보다 앞**이면 "낡음" 표시 — 안 쓴 걸 안 쓴 채로 보이게.
② **모든 자리의 프롬프트**에 붙는다(`session.mjs briefOf` 의 `## 상황판` 절 — codex 자리도 같은 조립) — 팀원이 읽고, 실무는 쓰라는 한 줄이 같이.
③ 관제탑 팀 카드의 "상황" 접기(같은 값). `round.mjs end` 는 이 라운드 동안 갱신이 없으면 경고 한 줄(거부는 아니다).

M6(화면이-답하는-질문.md, 톰·제리 B): **화면 자리 ① 은 없앤다** — 관제탑이 답하는 질문과 같아서, 네 칸은 관제탑 팀 줄을 펼치면(③) 글자 그대로 보인다. **파일·②(프롬프트 절)·`progress.mjs` 는 그대로** — 지우면 다섯 팀이 다 멈춘다(나리 덧붙임).

### `verdict` — 판정 카드
감사 결과. 말풍선이 아니라 **가운데 카드**로 크게 표시한다. 라운드의 분기점이므로
스크롤에서 한눈에 찾을 수 있어야 한다.

| `meta.verdict` | 의미 | 다음 동작 |
| --- | --- | --- |
| `PASS` | 통과 | 다음 마일스톤으로 |
| `REVISE` | 되돌려보냄 | 같은 마일스톤에서 라운드 재시작 |
| `FAIL` | 한계 도달 | 사람 호출 |

- `meta.target`: 누구에게 내린 판정인지 (`guide` 등)
- `meta.sha`: 감사가 본 커밋 — 감사를 시작할 때의 HEAD (40자) 또는 null. B 푸시의 문이 이 값을 본다 (6절 "푸시 문", 결정 63)
- `meta.attempt`: 이 **마일스톤**의 몇 번째 반박인지 (1~3). **3에서 자동 `FAIL`.** 라운드를 닫고 다시 열어도
  이어진다(`round.json` 의 `attempts[마일스톤]`, 다음 `startRound` 가 물려받는다). 0 으로 돌리는 것은 감사 `PASS`
  카드와 대표의 재개(`resumeRound`)뿐이다.
- **받아들인 지적은 반박이 아니다** (결정 84 — "개발팀 멈추는 거 짜증나는데": 09-13 세 번 다 실무가 동의하고 고쳤는데 멈췄다).
  `REVISE` 가 반박으로 세는 건 **실제로 갈릴 때만** — `bus.countsAsDispute(앞 REVISE, 이번)`: ① 앞 `REVISE` 뒤 **고친 커밋 없이**
  같은 `meta.sha` 로 다시 받았다(고치지 않고 다시 보인 것 = "그건 틀렸다"), 또는 ② 같은 지적이 되풀이된다(첫 줄이 같다, `sameIssue`).
  고쳐서(새 sha) 다른 지적을 받으면 `attempt` 는 그대로고 카드에 `meta.counted: false` 가 붙는다. 무한 루프 방지는 남는다 —
  갈린 반박 3회면 그대로 `FAIL`. 이 라운드의 첫 `REVISE` 는 앞 카드가 없으니 갈린 게 아니다 — 안 센다. 앞 카드는 **이 라운드** 안에서만 본다.
- `meta.stale: true`: 판정으로 세지 않는 카드 — 닫힌 라운드(idle)에 왔거나, 시작할 때의 라운드 번호가 지금과 다를 때.

### `round_start` — 라운드 시작 배너
가운데. 이 줄이 라운드의 경계다 — 대화록은 비워지지 않으므로 이 배너가 구분선이다.
실무 세션이 읽는 컨텍스트는 이 줄 아래부터다 (라운드마다 비우는 건 AI 컨텍스트뿐).
> **라운드 3 시작** · 마일스톤 2: 9월 캠페인 카피

### `round_end` — 라운드 종료 배너
가운데. 대화록은 그대로 남는다 — 지워지지도 보관되지도 않는다. 비워지는 것은 실무 세션의
컨텍스트뿐이다 (`session.reset`). 화면은 배너 아래에 다음 라운드를 이어 그린다.

### `milestone` — 마일스톤 진행 표시
로드맵 상 현재 위치. 상단 고정 바에 반영된다.
- `meta.index` / `meta.total` / `meta.title` / `meta.deliverable`

### `note` — 시스템 안내
그 외 알림 (외부감사 비활성, 반박 상한 도달 등). 가운데, 가장 약한 표시.

---

## 3-1. 방에 그림 올리기 (대표 결정 130 ② — "이미지 업로드하고싶은데 안 되네")

`POST /api/upload { team, mime, data(base64) }` 가 `teams/<팀>/in/<자동 이름>.<png|jpg|gif|webp>` 로 저장하고,
`그림을 올렸습니다: in/<파일>` 을 텍스트로 하는 `message` 이벤트(actor `boss`)를 남긴다 — 배달 규칙(idle 채팅·FAIL 풀기·호명·codex 자리)은 `/api/say` 와 같다.
`in/…` 은 `out/…` 과 같은 자리에서 잡힌다(`server/public/outlink.js` 의 `RE` 가 `(out|in)` 둘 다 본다) — 말풍선에 그림이 그대로 뜨고, `GET /in/<팀>/<경로>` 가 읽기 전용으로 연다(`bus.inFile`, `outFile` 과 같은 경계: `..`·숨김·없는 팀은 null).
`in/` 은 대표가 올린 것, `out/` 은 팀이 낸 산출물 — 방향이 다르다. 서버는 그 경로로 쓰지 않는다(업로드 저장 한 번뿐).

---

## 4. 총괄이 옮길 때 — 원문과 배분

총괄이 대표의 지시를 팀에 옮길 때 **요약만 보내지 않는다.**

나중에 감사역이 "이 지시의 근거가 어디 있냐"고 물었을 때 답할 것이 총괄의 요약뿐이면
그건 근거가 아니다. 요약은 반드시 무언가를 떨어뜨리고, 떨어진 것은 조용히 사라진다.
**관리자의 요약이 곧 오염이다.**

그래서 한 봉투로 보내되 **훅이 받는 즉시 두 개의 이벤트로 가른다.**

```
⟦대표 원문 — 손대지 않음⟧      → boss 이벤트. meta.via = "chief"
<대표가 쓴 그대로. 맞춤법도 안 고친다>

⟦총괄 배분⟧                    → chief 이벤트
<이 팀이 맡을 부분>
```

한 말풍선 안에 두 블록으로 두면 언젠가 섞인다. **스키마가 갈라놓아야 한다.**
화면에서도 원문은 오른쪽 대표 말풍선, 배분은 왼쪽 총괄 말풍선으로 갈린다.

`meta.via: "chief"` 는 **대표가 이 방에서 직접 한 말은 아니라는 표시**다.
총괄실 원문을 찾을 때 이 표시가 붙은 것은 건너뛴다 (`bus/dispatch.mjs`).

봉투를 만드는 것은 `bus/dispatch.mjs`, 가르는 것은 `bus/bus.mjs` 의 `splitRelay()`.

## 5. 기록되지 않는 것

대화록은 append-only 이므로 **무엇을 안 남기는지가 무엇을 남기는지만큼 중요하다.**
아래 셋은 화면에 나타나지 않는다.

| | 왜 |
| --- | --- |
| **들려주기** `⟦들려주기 — 기록하지 않음⟧` | 이미 대화록에 있는 말을 다른 세션의 **귀에** 넣는 것. 외부감사가 한 말을 실무가 들으려면 그의 세션에도 넣어야 하는데, 그대로 넣으면 대표 말풍선으로 또 남는다. 말한 사람이 이미 남겼다 |
| **`(패스)`** | 남길 말이 없다는 표시. 턴은 반드시 끝나고 끝나면 훅이 기록하므로, **침묵할 방법**을 따로 줘야 한다. 없으면 "돌고 있습니다" 같은 중계가 대화록의 절반을 채운다 |
| **하네스 알림** `<task-notification>` 등 | 백그라운드 작업 완료 같은 것. 대표가 한 말이 아닌데 프롬프트로 들어와 대표 발언으로 남는다. 감사역이 그걸 대표 지시로 읽는다 |

셋 다 `.claude/hooks/to-bus.mjs` 의 `UserPromptSubmit` · `Stop` 처리에서 걸러진다.
판정 함수는 `bus/bus.mjs` 의 `isQuietRelay()` 와 `stripSystemBlocks()`.

### 누구에게 한 말인가

첫머리에 캐스트 이름이 나오면 그 사람에게 차례가 간다 (`addressee()`).

> 안젤: **다니엘,** 이 근거가 1회 재구매만으로도 성립합니까?
> 다니엘: **안젤 씨,** 일반화하기에는 부족합니다.

질문에 답이 오지 않으면 대화가 아니라 독백이다. 다만 **감사역은 스스로 등장할 수
없으므로**(둘 다 방 주인이 불러야 한다), 방 주인의 귀에 "이 말은 누구에게 한
것인지"를 함께 넣어 그가 불러주게 한다.

**여러 명을 불렀으면 전부 차례를 받는다** (`addressees()`, 결정 22). 첫머리뿐 아니라 문단(빈 줄) 첫머리의 호명도
본다 — "대표님, … / 안젤, … / 다니엘, …" 이면 안젤·다니엘 순서로. 같은 사람은 한 번. (왕복 브레이크는 결정 120 으로 없다.)

**대표를 부른 말** — `callsBoss()`: 대표 이름 외에 "대표님·대표·댄" 도 호명이다. 화면은 그 말풍선에 멘션 표시를 한다 (결정 19-2).
**보고와 결정 요청은 다르다** (결정 52·66) — `asksBoss(text, cast)` = 대표를 부른 **문단** 안에 물음표·"정해 주세요·골라·답해", 또는
대표에게 해 달라는 부탁(주세요·주시면·해 주세요·부탁·허용·실행)이 있다 — 헨리 "zip 받아 풀어 주시면" 도 종이다. "올렸습니다·됐습니다" 는 보고.
"대표님, 보고드립니다.\n\n솔라, 이 수치 맞아?" 는 솔라에게 물은 것이라 보고다(레오 REVISE R23). 이름 없는 문단은 앞 문단의 상대에게 이어진다.
요약(`teamSummary.bossCall`)에는 "이 라운드에서 대표에게 결정을 청했는데 그 뒤 대표가 말하지 않은" 발언만 실리고, 탭 줄의 "대표 차례"
배지·종·빨간 점이 그것을 따른다. 부르기만 한 보고는 멘션 표시까지고, 관제탑 "오늘 보고" 줄(`bossNotes`, 3절)로 간다.

**총괄실에서 다른 방 사람을 부르면 그 방에도 같은 말이 남는다** (`conductor.crossPost`, 결정 21). 화자는 그대로(`chief`),
`meta.from: 'hq'` · `meta.origin: <원본 id>`. 그 방의 사회자가 사본을 보고 불린 사람을 깨운다. 사본은 다시 옮기지
않는다. 그 방이 닫혀 있어도(idle) 간다 — 서버가 그 방의 훅에 "이번 턴은 적어라" 표시(`bus.allowIdleChat`, 10분)를 켜고 사본을 남긴 뒤
불린 사람에게 직접 차례를 준다(사회자는 idle 이면 차례를 안 돌린다) — `/api/say` 의 닫힌 방 채팅과 같은 길(결정 127 ②, R26). 전엔 총괄실에
`note` "…옮기지 못했습니다" 만 남겼다. 막힌 방(blocked)은 사본만 남는다 — 차례는 대표가 풀고 난 다음 차례의 "못 들은 말" 로 듣는다(대표 판단 대기를
총괄 말로 풀지 않는다). 배달(`dispatch.mjs`)도 닫힌 방에 보낸다 — 막힌 방만 거른다. 대표 발언은 옮기지 않는다 — 지시는 배달(4절)로.

## 5-1. 사회자 — 누가 언제 말하는가

`server/conductor.mjs`. 방 = 대화록, 참여자 = 각자의 세션. 서버가 새 이벤트를 넘기면 사회자가 차례를 정해 **턴**을 보낸다.
턴 = 그 자리가 지난 차례 이후 못 들은 말(커서 `state/conductor.json`) + 종류별 지시문 한 줄. `⟦들려주기⟧` 로 가므로
훅은 기록하지 않는다. **듣기는 공짜다** — 차례가 올 때 새 말을 한꺼번에 읽는다. 말하기만 비용이다.

| 순위 | 규칙 |
| --- | --- |
| 1 호명 | 첫머리가 X 의 이름이면 X 차례. 대표가 부른 사람은 `/api/say` 가 바로 그에게 넣는다 |
| 2 판정 | `⟦판정 요청⟧` 턴은 서버가 만든다 (`/api/verdict`) |
| 3 대표 | 대표 발언은 주인(또는 대표가 부른 사람)에게 바로. 사회자는 다시 주지 않는다 |
| 4 침묵 | `PPANAM_LULL_MS`(기본 90초) 동안 message·tool 이 없고 아무도 busy 아니면, 가장 오래 침묵한 **클로드 자리** 한 명. (패스) 가능. 방당 시간당 `PPANAM_LULL_PER_HOUR`(기본 30). **다른 회사 엔진(codex·gemini)은 침묵·제3자 차례를 안 받는다** — 판정과 이름 불린 말에만(대표 지적 09-14: "(패스) 한 마디 받자고 17,000자") |
| 5 잡담 브레이크 | **일하는 대화는 안 끊는다**(결정 120·121 — 대표 "3번 넘으면 대화 못하게 하는 거 철회해" → "몇 번 제한을 둔다는 아이디어는 괜찮은데, 그게 일을 망치면 안 되지"). 안 세는 것: 이름을 불러 오간 차례(호명)·판정·요청 블록 안의 왕복 — 100번 오가도 그대로. 세는 것: **아무도 안 부른 침묵 차례(자동 응답)** 뿐 — 같은 둘이 침묵 차례로만 `PPANAM_MAX_CHAT`(3)회씩 오가면 누가 이름을 부르거나 다른 사람이 말할 때까지 침묵 차례를 안 준다(`chatLoop`, note "잡담이 길어져 잠시 쉽니다"). 어느 말이 침묵 차례에서 나왔는지는 사회자가 마지막으로 준 차례 종류(`lastGiven`)로 안다. 비용 선은 4 의 시간당 30 그대로 — 호명 왕복은 그 수에 안 든다. 한 자리에 한 번에 한 턴 |
| 6 문 | 라운드가 idle 이면 차례 없음(총괄실 예외). blocked 면 대표만. 세상의 시계(마을)가 근무 시간 밖의 침묵 차례를 끈다. **닫히는 중에 쌓인 차례는 버리지 않고 다음 라운드 첫 턴으로**(`carried`, 결정 25 — 7절 "닫는 정본") |

**판정 규약 — 첫 줄 한 단어.** 사회자가 `⟦판정 요청⟧ <대상>` 턴을 주면(`/api/verdict` · `round.mjs verdict`) 답의 첫 줄이
`PASS` / `REVISE` / `FAIL` 이다. 훅이 `UserPromptSubmit` 에서 턴 종류를 `state/turn/<방>.<자리>` 에 적고 `Stop` 에서 읽어
판정 카드(`recordVerdict`)로 남긴다 — 클로드 자리도 codex 도 같다. `say.mjs --verdict` 는 호환용이다. 첫 줄에 판정이 없으면
말로 남고(`meta.noVerdict`) 사회자가 한 번 더 묻는다. 순서는 내부감사 → (PASS 면) 외부감사. 둘 다 PASS 면 `note`
(`meta.verdictFlow: 'pass'`) — 라운드를 닫는 것은 실무나 대표다. `meta.stale` 카드(옛 라운드의 늦은 답)는 흐름에
세지 않고 계속 기다린다 — 지난 라운드의 PASS 가 이번 완료 note 를 만들면 안 된다 (레오 감사, 2026-09-13).
**누가 봤나는 기계가 읽는 칸에**(결정 118 ①): 흐름의 note 마다 `meta: { verdictFlow, steps, skipped, reason }` — `verdictFlow` 는 `start` · `skip`(외부감사 걸음을 건너뜀) ·
`pass` · `abort` · `timeout`, `steps` 는 실제로 물은 자리, `skipped` 는 건너뛴 자리, `reason` 은 `suspended`(중단 — 1절 `suspended`) · `not-foreign`(자리 엔진이 클로드) · `no-seat`.
**건너뛸 때는 조용히 빠지지 않는다** — `skip` note 가 방에 남는다("외부 감사 없이 판정합니다 — 레오 중단 중, 9/20 복귀 예정", CLAUDE.md "외부 모델이 연결돼 있지 않으면 작전실에 남긴다").
흐름은 `state/conductor.json` `_queue.<방>.flow` 에 저장돼 재시작에 살아남고(같은 라운드만), 기다리는 자리가 **호출 상한의 두 배**(기본 10분) 안에 판정을 안 내면
`timeout` note 와 함께 놓는다 — 전엔 메모리에만 있고 상한이 없어 `waiting:'outside'` 로 굳고 다음 `/verdict` 가 "이미 돌고 있습니다" 로 거부됐다(09-14 아침 실제).

**일지 — 라운드가 끝날 때 한 문단.** 서버가 라운드를 닫기 전에 이번 라운드에 말한 자리마다 `⟦일지⟧` 턴을 보내 한 문단을 받아
`teams/<방>/journal/<자리>.md` 맨 위에 붙인다(최신이 위). 대화록에는 남지 않는다. 외부감사는 `outside.mjs --turn journal` 이
제 일지에 쓴다. 다음 세션이 뜰 때 최근 문단이 인격 뒤에 붙는다(`assemblePrompt`). 세 층 중 자라는 층이 이것이다.
한 자리라도 못 받으면(시간 초과·빈 답·`(패스)`) `note` 를 남기고 그 자리에게만 한 번 더 묻는다. 두 번째도 못 받으면 `note` 로 밝히고 그대로 닫는다 — 조용히 0 으로 세지 않는다 (M1 인격 이음, 2026-09-13).

외부감사(codex)는 `bus/outside.mjs --turn <종류>` 로 깨운다 — 자기 커서(`state/outside-sessions.json` 의 `lastSeen`)로 못 들은 말을 붙인다.
**인격은 턴마다 앞에 붙는다** — 클로드 자리가 시스템 프롬프트로 받는 것과 같은 조립(`assemblePrompt(team, 'outside')`: 인격 + 확정 조항 + 일지 + 라운드 브리프). 첫 턴에만 주면 세션이 라운드를 넘기며 압축될 때 인격이 먼저 밀려난다. `--dry` 를 붙이면 codex 를 부르지 않고 그 턴이 받을 입력만 찍는다(기록·커서 이동 없음).
남들이 깨진 자리를 코드로 막은 것이다 — 작별 인사 20회 루프, 쳇바퀴, 감사 인사 무한 (`docs/cases.md` 1·11·17·20·33).

## 6. 승인 큐 — 대표가 없어도 팀이 달린다

`state/approvals.jsonl`. 대화록과 같이 **append-only** 다. 요청 한 줄, 판정 한 줄씩 쌓이고
읽을 때 접는다 (`bus/bus.mjs` 의 `listApprovals()`).

| 등급 | 무엇 | 누가 승인 | 대기 중이면 |
| --- | --- | --- | --- |
| **A 자동** | 브랜치 안 커밋 · 산출물 쓰기 · 라운드 열고 닫기 · 감사역 부르기 | 실무 혼자 | — |
| **B 총괄** | 방향 안의 일 — 원격 푸시 · 다음 마일스톤 착수 · 팀 사이 요청(6-1절) · 세션 재시작 · 마일스톤 순서 조정 · 인격 파일 재생성 · 화면 문구 · 브랜딩 글 | 톰 결정 **+** 제리 대조. **둘 다 PASS**. 그 팀 감사가 방에서 토론 | 톰·제리가 답할 때까지 |
| **C 대표** | 방향만 — 로드맵 목적지 변경 · 컷 리스트 · 비용 상한 · 외부 발송 · 본책 병합 | 대표만 | **큐에 남기고 다음 일감으로.** 관제탑 첫 화면 |

등급 문구는 대표 결정 46 (2026-09-13) — "방향만 맞으면 내가 승인하지 않아도 검수자들과의 토론으로 최소한의 승인절차로 진행해".
대표는 하루 보고서로 읽는다. 전에는 인격 파일 수정과 로드맵 변경 전부가 C 였다 — 방향(목적지·컷)만 남기고 나머지는 B 로 내려왔다.
인격 파일(`teams/<팀>/<자리>.md`)의 승인 표 문구는 이 표를 따라 고친다 — 그 파일들을 고치는 것 자체가 B 다.

책(에이전틱 코딩 15장) 원칙 5 그대로다 — *아키텍처 결정·보안 변경·통합 지점·최종 검증은 사람.*
*"이 감독 지점은 병목이 아니라 큰 대가를 치르는 실수를 막는 품질 게이트다."*

요청과 결과는 요청한 방에 `note` 로도 남는다 (`meta.approval`, `meta.grade`, `meta.status`).
새 이벤트 타입을 만들지 않는다 — 큐 파일이 진실이고 대화록은 흔적이다.

**흐름.** 실무가 요청 → B 면 총괄실 귀에 들어감(들려주기) → 톰이 결정하고 제리가 대조 →
둘 다 PASS 면 요청한 방 귀에 "통과" → 실무 진행. C 면 관제탑 카드에 뜨고 대표가 누른다.

**다음 마일스톤 착수는 서버가 올린다**(eaca922, 대표 실측 09-14 — 마케팅이 6단계 통과 뒤 여섯 시간 섰다). 라운드가 PASS 로 닫히며 그 마일스톤이 `pass` 가 되면
`endRound` 가 그 자리에서 `{ type:'milestone', n, title, autoOpen:true }` 행동을 단 **B 요청을 자동으로 올린다**(`by:'guide'`, 같은 요청이 떠 있으면 안 올림) —
닫힌 방엔 차례가 안 와서 실무가 `--next` 를 걸 수 없는 닫힌 고리 때문이다. 문(톰·제리)은 그대로. 통과하면 `notifier.applyAction` 이 `now` 로 옮기고
**라운드까지 연다**(`autoOpen` — 누가 먼저 열어 뒀으면 그대로). `bus/approve.mjs --request B --next` 로 손으로 올리는 길도 남아 있다.

**무효.** 잘못 들어간 요청은 지우지 않는다. `void` 줄을 한 줄 더 써서 접을 때 빠지게 한다
(`voidApproval(id, reason)` · `approve.mjs --void` — 총괄실에서만). 대화록과 같은 원칙이다.
하네스 검증 데이터 6건이 이렇게 무효가 됐다 (2026-09-02).

**누가 말하는지는 인자가 아니라 환경이 정한다.** 클로드 세션의 요청자·판정자는 서버가 넣는
`PPANAM_TEAM` 으로 정해진다 (총괄실이면 chief, 팀 방이면 guide). **방이 지정되지 않은 셸은
요청도 판정도 못 한다.** `--as` 가 환경과 다르면 거부된다. codex(제리·레오·다니엘)는 환경이
없다 — `outside.mjs` 가 자기 `--team` 을 대고 `decideApproval` 을 부르고, **bus 가 그 방을 검사한다**:
B 의 chief·outside 판정은 `team === 'hq'` 여야 한다. 자리 이름 `outside` 는 방마다 있어서
이 검사가 없으면 개발팀의 레오가 제리 몫의 대조를 기록할 수 있었다 (Fable 감사, 2026-09-02).
대표는 화면(`POST /api/approvals`)으로만 판정한다.
제리는 codex 샌드박스 안이라 파일을 못 쓴다 — 그녀의 첫 줄 PASS/REVISE 를 `outside.mjs` 가
그녀 이름으로 큐에 남긴다. 그 프로세스가 곧 그녀다.

**통과한 B 를 실행하는 것은 서버다.** `git push` 는 어느 세션의 허용 목록에도 없다 — 실무가
스스로 밀 수 있으면 톰·제리를 우회하는 길이 생긴다. `server/executor.mjs` 가 폴링 틱마다
통과한 B 중 `action.type === 'push'` 인 것을 찾아 대신 민다. 실행 흔적은 `state/executor.json`
(gitignore) 에 남아 재시작해도 두 번 밀지 않는다.

`action` 은 `approve.mjs --request B --push` 로 요청할 때 그 순간의
`{ type: 'push', remote: 'origin', branch, sha }` 가 요청 레코드에 박힌 것이다.
실행자는 **이 값만 믿는다.** 자유 텍스트를 정규식으로 훑어 푸시인지 짐작하지 않는다 —
그렇게 하던 첫 판은 레오가 FAIL 냈다 (2026-09-02: `detail` 의 push 도, "푸시하지 마라" 도 걸렸다).
실행 시점에 HEAD 의 브랜치·SHA 가 승인된 것과 하나라도 다르면 밀지 않고 `executed: 'stale'`
note 를 내며 "다시 요청하세요" 라고 한다 — 톰·제리는 그 SHA 를 통과시킨 것이지 지금 HEAD 가 아니다.
같을 때만 `git push origin <sha>:refs/heads/<branch>` 로 **승인된 SHA 를 못 박아** 민다 — 대조와 푸시
사이에 브랜치가 움직여도 origin 에는 톰·제리가 본 커밋만 간다 (레오 2차 감사가 재현한 틈).
총괄실에 들려주는 요청문에도 `대상: origin/<branch> @ <sha8>` 이 실린다. 결과는 요청한 방과 총괄실 둘 다에
`note` 로 남는다 (`meta.executed`: `pushed` · `push-failed` · `stale` · `invalid` · `unreviewed`).
**푸시 문 — 외부감사 PASS 뒤에만** (대표 결정 63, 2026-09-13 — "외부감사가 왜 있냐"). 톰·제리는 "올려도 되나" 를 보지 코드를 감사하지
않는다. 그래서 B 푸시는 **레오(그 방의 `outside`) 가 그 커밋을 PASS 한 뒤에만** 걸 수 있다. 순서: 레오 PASS → `--request B --push` → 톰·제리 → 실행자.
장치: 판정 카드(`verdict`)에 **감사가 본 커밋**을 `meta.sha` 로 박는다 — `outside.mjs` 가 감사를 **시작할 때** HEAD 를 잡아 `recordVerdict` 에
넘긴다(답이 돌아온 뒤의 HEAD 를 찍으면 감사 도중 들어온 커밋이 안 본 채로 PASS 가 된다 — 레오 REVISE, R22). 안 넘기는 경로는 그 순간의
`headSha()`(git 이 없으면 null). 요청(`requestApproval`)과
실행자(`executor.mjs`) 둘 다 `pushGateError(현재 라운드 이벤트, sha)` 를 본다 — 이 라운드의 **마지막** 외부감사 카드(`stale` 아닌 것)가 `PASS` 이고 그
`meta.sha` 가 미는 SHA 와 같아야 한다. 카드가 없으면 "레오 PASS 뒤에", 마지막이 REVISE 면 "PASS 뒤에", SHA 가 다르면 "PASS 뒤에 커밋했다 —
다시 감사받으라" 로 거부한다. 라운드가 닫혀 있으면(idle) 카드가 없으니 자연히 거부 — 푸시는 라운드 안에서 건다. 총괄실은 라운드가 없어 B 푸시를
못 건다(총괄실 코드는 팀 방에서 민다). 실행자는 큐 파일이 손으로도 써지므로 실행 직전에 **요청 레코드의 `round`** 이벤트로 다시 본다 —
못 열면 밀지 않고 `executed: 'unreviewed'` note.
`meta.sha` 없는 옛 카드는 문을 못 연다 — 오늘(09-13) 나간 두 푸시(ce1614c·785c461)는 이 문 전의 것이고 새 가지라 되돌리지 않는다.

**원격 기본 브랜치는 B 로 못 민다** — 메인 병합은 C 다. 어느 브랜치인지는 `bus.mjs` 의 `protectedBranch()` 하나가
`git symbolic-ref refs/remotes/origin/HEAD` 에서 읽고, 요청(`pushAction`)과 실행자(`invalidAction`) 둘 다 그것을 본다.
`main`·`master` 를 박아 두던 때는 기본 브랜치 이름이 다른 이 저장소에서 아무것도 못 막았다 (대표 결정 9, 2026-09-13).
origin/HEAD 가 없으면 요청도 실행도 거부한다 — `git remote set-head origin -a`.
승인 대조(`outside.mjs --ask "… apr_x …"`)는 총괄실 세션(`PPANAM_TEAM=hq`)만 시킬 수 있다. 다른 방도, 환경 없는 셸도
codex 를 부르기 전에 `note` 로 거부된다.
`--push` 없는 B 는 실행자가 할 일이 없다. 대신 요청에 다른 행동이 박혀 있을 수 있다 —
`--next` 는 `{ type: 'milestone', n }` (B, 통과하면 그 마일스톤이 `now`), `--roadmap` 은 `{ type: 'roadmap', file }`
(C, 통과하면 `out/` 의 제안 파일이 `roadmap.json` 으로). 이 둘은 셸이 아니라 상태를 바꾸는 일이라 `server/notifier.mjs` 가 한다.
로드맵은 사람도 세션도 손으로 고치지 않는다 — 현재 마일스톤의 `pass` 는 `endRound(PASS)` 가, `now` 는 B 통과가 옮긴다.
`now` 가 없으면 `startRound` 는 거부한다(번호를 명시하면 대표 결정으로 본다).

**알림은 서버의 일이다** (`server/notifier.mjs`). 폴링 틱마다 큐를 접어 아직 안 알린 것만 알린다 — B 요청은 총괄실 귀에,
결말(통과·반려·무효)과 실행 결과는 요청한 방 귀에. 알린 것은 `state/notifier.json` 에 남아 재시작해도 두 번 알리지 않는다.
팀 방은 라운드가 열려 있을 때만 들려주고, 닫혀 있으면 열릴 때 알린다. 전에는 알림이 요청·판정한 프로세스의 부수 효과라
서버가 꺼져 있을 때 올린 요청은 영영 총괄실에 안 닿았고(`apr_d25aaf62`), 제리가 마지막에 판정하면 실무는 통과를 못 들었다.

**카드는 읽고 누를 수 있어야 한다** (대표 결정 20-2 — "뭐에 대한 승인인지 주제·목적·이유 없이 승인 반려만 있다").
승인/반려 버튼만 있는 카드는 없다. 카드에 펼치는 것:

- **주제** `what` · **왜·바뀌는 것** `detail` — 줄바꿈 그대로(한 줄로 잘라 "옛 M4~M6 픽셀 타일은 컷" 이 `…` 뒤에 숨었다,
  독립검수 #2). 요청자는 `--detail` 에 "왜 · 바뀌는 것" 을 대표 말로 적는다 (결정 33 의 5줄 규칙과 같은 내용).
- **요청자 원문** — 요청 레코드의 `note` 가 그 방에 남은 요청 `note` 의 이벤트 id 다. 카드의 "방에서 보기" 가 거기로 건너간다.
- **행동** `action` 을 서버가 읽을 때 `preview` 로 풀어 싣는다 (`bus.approvalPreview`, `GET /api/boot`·`/api/approvals` 만 —
  큐 파일에는 안 쓴다). 종류별로:
  - `push` → `{ branch, sha, base, count, commits: [제목 앞 8개], files: [경로…] }` — base 는 `origin/<branch>` 가 있으면 그것,
    없으면 원격 기본 브랜치. 카드: "origin/<branch> @ <sha8> · 커밋 N · 파일 N (a, b …)".
  - `milestone` → `{ n, title, deliverable }` 로드맵에서. 카드: "마일스톤 N 착수 — 제목 · 통과 조건: …".
  - `roadmap` → 제안 파일의 `{ destination, milestones: [{ n, title, status }], cutList }`. 카드에 마일스톤 표와 컷 목록을
    펼친다. 파일을 못 읽으면 `{ error }` — 그대로 보여 준다(모르면서 승인하게 두지 않는다).
- 폰 폭에서 등급 칩이 띠가 되고 팀 라벨이 밖으로 밀리던 것(독립검수 #8)과 승인이 쌓이면 방 대화가 사라지던 것(#13)은 CSS —
  `.apr__what` 은 전체 폭, `.approvals` 는 40vh 안에서 스크롤.
- **산출물** `artifacts` — 그 요청이 가리키는 `out/` 파일들 (대표 결정 36 — "디자인 그림이 없는데 내가 어떻게 승인해").
  서버가 카드를 줄 때 붙인다(`bus.approvalArtifacts`, 큐 파일에는 안 쓴다): 요청의 `files`(`approve.mjs --out a.png,b.md`,
  `teams/<팀>/out/` 기준 상대 경로, 요청 시 있어야 한다) 와 `what`·`detail` 에 적힌 `out/…`·`teams/<팀>/out/…` 경로를 모아
  `[{ team, rel, url, kind, size?, at?, missing? }]`. `kind` 는 `image`(png·jpg·jpeg·gif·webp·svg) · `md` · `text`(txt·json·jsonl·csv) · `file`.
  카드는 목록을 링크로 펼치고, 그림은 카드 안에 그리고, md·text 는 눌러 펼쳐 읽는다. 없는 파일은 "파일이 없습니다" 로 —
  모르면서 승인하게 두지 않는다.

**산출물은 화면에서 열린다** (대표 결정 36). 서버가 `teams/<팀>/out/**` 을 **읽기 전용**으로 `GET·HEAD /out/<팀>/<경로>` 에 내보낸다
(`bus.outFile` — `..`·숨김 파일·없는 팀은 404, 쓰기 없음, `cache-control: no-cache`; HEAD 는 머리만 — `curl -I` 가 되게). md·txt·jsonl·csv 는 `text/plain` 으로
그대로 보이고, 그림은 그림으로, 모르는 확장자는 내려받기. 발언(`bubble`)과 승인 카드의 `what`·`detail` 에 적힌 `out/…` 경로는
링크가 된다 — 팀이 안 적힌 `out/…` 은 그 방의 것, `teams/<팀>/out/…` 은 그 팀의 것. 경로 찾기는 화면·서버·자가 시험이 같은
`server/public/outlink.js` 를 쓴다. 발언 밑에는 그림·md 미리보기가 최대 6개까지 붙는다(관제탑 카드의 마지막 말에는 안 붙는다).

### 대리 결정 — 대표가 10분 넘게 답이 없으면 톰·제리가 대신 (대표 결정 85)

"내가 10분 이상 반응이 없으면, 대리로 나 대신 톰이랑 제리가 결정하게 해." **이미 도는 B 길을 그대로 탄다** — 서버(`notifier.mjs` (e))가
틱마다 대표 차례를 보고, 10분 넘게 기다린 것을 총괄실에 `[등급 B]` 승인 요청 "대리 결정 — …" 으로 올린다(`action { type: 'proxy', kind, team, ref }`).
톰 결정 + 제리 대조 **둘 다 PASS** 여야 실행된다(① 하나라도 반대면 대표를 기다린다 — 반려된 대리 요청은 다시 올리지 않는다).

| `kind` | 언제 | 통과하면 서버가 |
| --- | --- | --- |
| `approval` | C 승인이 `pending` 으로 10분 넘게 | 그 C 를 **통과**로 판정(`decideApproval` `by: 'boss'`, 판정 줄에 `proxy: ['chief','outside']`) — 카드의 행동(로드맵 교체 등)은 평소처럼 실행 |
| `unblock` | 방이 `blocked`(FAIL) 로 10분 넘게 | `resumeRound(team, { proxy })` — note "대리 결정(톰·제리)으로 재개합니다 — …" |
| `answer` | 대표에게 결정을 청한 말(`bossCall`)이 10분 넘게 답 없음 | 그 방에 note "대리 결정 — 톰·제리: <톰의 이유>"(`meta.proxyAnswer: <그 말 id>`) — 요약·개인 카드의 `bossCall` 은 이 note 로 답한 것으로 본다 |

10분은 **둘 다** 여야 한다 — 그 일이 10분 넘게 기다렸고, 대표가 어느 방에서도 10분 넘게 말이 없었다(`bossQuietFor`). 같은 일에 대리 요청은 한 번(`state/notifier.json`
`proxied[열쇠]`). ② 방에는 늘 "대리 결정" 이라는 말이 남는다. ③ `teams/hq/out/proxy-decisions.md` 맨 위에 그날 대리 결정을 한 줄씩 적는다 —
자정 보고서(M7)가 "대표님 대신 정한 것" 절로 맨 위에 싣는다, 대표가 아침에 보고 뒤집을 수 있게. ④ **돈이 나가는 것과 바깥으로 나가는 것은 대리 대상이
아니다** — `proxyForbidden(text)`: 비용·상한·결제·돈·유료·외부·발송·메일·공개·병합 이 있으면 안 올린다. C 승인은 `what`·`detail` 로(`proxyEligible`, `action.type` 이 `cost`·`send`·`merge` 도 제외),
방의 물음(`answer`)은 **그 말 자체**로 — "유료 결제를 허용해 주세요" 를 질문 경로로 대리하면 금지선을 우회한다(레오 R23). 그건 대표만.
빠진 것도 조용히 사라지지 않는다 — 10분 넘게 기다린 것이면 총괄실에 note "대리로 정하지 않습니다 — 돈·바깥이라 대표만" 을 한 번 남긴다(`proxied[열쇠].excluded`).

## 6-1. 요청 블록 — 팀이 팀에게 직접 (대표 결정 45 ①·49·51·47)

한 팀의 일이 다른 팀 손을 타야 할 때(디자인 → 개발, 팀원·인물 추가 …) 톰이 손으로 옮기지 않고 **팀이 직접 연다.**
요청 하나 = 블록 하나. 블록 안에서만 두 작업자가 1:1 로 말하고, 톰이 감시자로 들어가고, 닫히면 대화는 파일로만 남는다.

**여는 법.** `approve.mjs --team <내 방> --request B "<무엇>" --to <팀>[:<자리>] [--why "<왜>"] [--due "<기한>"] [--until-milestone]`
— B 등급(톰+제리) 요청이고 `action` 은 `{ type: 'request', to: { team, actor }, why, due, mode }` 다. `to` 의 자리는 기본 `guide`(그 팀 실무).
`mode` 는 `once`(기본 — 됐다·받았다·확인으로 닫힘) 또는 `milestone`(`--until-milestone` — 요청한 팀의 **지금 마일스톤이 닫힐 때까지** 연다.
결정 47 의 "공동 프로젝트" 는 이 모드다: 두 실무가 한 블록 안에서 라운드를 넘겨 가며 같이 만들고, 켜고 끄는 스위치가 곧 이 옵션이다).
통과하면 `server/notifier.mjs` 가(상태를 바꾸는 일은 실행자가 아니라 알림자 — `--next`·`--roadmap` 과 같은 자리) 블록을 연다.
반려·무효면 블록은 생기지 않는다 — 톰이 REVISE 이유를 적고 요청한 방이 듣는다.

**블록 파일.** `state/requests/<id>.jsonl` (`id` 는 `req_` + 8자, 대화록·승인 큐처럼 **append-only**, 지우지 않는다). 줄의 `kind`:

| `kind` | 누가 | 무엇 |
| --- | --- | --- |
| `open` | 서버 (승인 통과 시) | `{ id, ts, approval, from: { team, actor }, to: { team, actor }, what, why, due, mode, until? }` — `until` 은 milestone 모드일 때 `{ team, milestone }` |
| `goal` | 톰(`hq`·`chief`) | 목표 한 줄 (결정 51 — 열 때 제시). `text` |
| `say` | 세 자리 중 하나 | `{ ts, by: { team, actor }, text }` — 두 작업자의 1:1 과 톰의 중간 점검이 같은 줄 |
| `done` | 받는 작업자 | "됐다" — `text` 는 무엇을 어디에 냈는지(`out/…` 경로 그대로 링크가 된다) |
| `ack` | 요청한 작업자 | "받았다" |
| `confirm` | 톰 | "확인" — **이 줄이 있어야 닫힌다**(결정 51: 됐다·받았다 뒤 톰이 확인). `text` 는 한 줄 소감 또는 빈 문자열 |
| `stop` | 톰 | 어긋나서 끊음(결정 51 "중간 점검 — 어긋나면 끊음"). `text` 에 이유. 닫힌다 |
| `close` | 서버 | milestone 모드에서 `until` 의 마일스톤이 `pass` 로 닫힐 때(`endRound(PASS)`). `text` 에 라운드 번호 |

접은 상태(`bus/requests.mjs foldRequest(lines)`): `status` 는 `open` → (`done` 뒤) `done` → (`ack` 뒤) `acked` → (`confirm`·`stop`·`close` 뒤) `closed`.
`closedBy` 는 `confirm`·`stop`·`close` 중 하나. milestone 모드는 `done`·`ack` 이 와도 `closed` 가 아니다 — 마일스톤이 닫히거나 톰이 확인·끊을 때만.
줄의 `by` 는 인자가 아니라 환경(`PPANAM_TEAM` → 방, 방의 실무 자리)이 정한다 — 승인과 같은 규칙(6절). 블록의 세 자리(`from`·`to`·`hq/chief`)
밖에서 온 줄은 거부한다. codex 는 스레드에 안 들어온다(감사는 방에서 한다).

**말하는 법.** `node bus/request.mjs --say <id> "…"` · `--done <id> "…"` · `--ack <id>` · `--confirm <id> ["…"]` · `--stop <id> "<이유>"` · `--goal <id> "…"` ·
`--list [--team <팀>] [--all]` · `--show <id>`. `--say` 한 줄은 상대 작업자와 톰의 **귀에 들어간다**(들려주기 — 기록하지 않음, `server/notifier.mjs` 가 폴링 틱마다
새 줄을 알린다. `state/notifier.json` 에 알린 줄 번호가 남아 두 번 안 들려준다). 세션이 안 떠 있는 방은 라운드가 열릴 때 밀린 줄을 한 번에 듣는다.
방 대화록에는 **시작·완료 한 줄씩만** `note` 로 남는다(`meta.request: id`, `meta.status: 'open' | 'closed'`, 두 방 모두). 스레드의 말은 대화록에 안 남는다 —
파일이 진실이고 대화록은 흔적이다(6절과 같은 원칙). `--say` 는 해당 방의 라운드가 닫혀 있어도 된다 — 블록은 라운드 밖에 산다.

**화면.** 블록은 카드다 — 요청한 방·받는 방·총괄실 세 곳과 관제탑 `요청` 탭. 카드: 머리에 `from → to` 두 이름과 상태 알약(`열림`·`됐다`·`받았다`·`닫힘`) ·
`what` · `why` · `due` · `goal` · 스레드 최근 3줄(누르면 전체) · 산출물(`done` 의 `out/…`, 6절 `artifacts` 와 같은 모양). 대표는 카드에서 안 누른다 —
대표 자리는 없다(결정 46 — 방향 안의 일은 B+토론). 데이터는 `GET /api/requests[?team=]` (접은 블록 목록, 최근 순) 과 `summaries[팀].requests`
(`{ open, closed }` 두 수 — 그 팀이 요청했거나 받은 것). 관제탑 `전체` 의 "요청 진행 / 완료" 타일은 다섯 방 합이 아니라 블록 수다(한 블록이 두 방에 걸친다).
하루 보고서(M6)에 "요청 N건 · 완료 M건" 은 이 수다.

**팀원·인물 추가 요청도 같은 길이다** (결정 45 ①). `--to marketing "인물 하나 — 개발팀 새 자리 '기록' 의 인물사전"` 처럼. 인물의 배정은 마케팅
방의 일이고, 인격 파일 생성은 여전히 B(결정 46 ①) — 블록은 요청과 대화를 나르지 권한을 바꾸지 않는다.

## 7. 무엇이 비워지고 무엇이 남는가

**세 가지가 서로 다르다.** 이걸 섞으면 설계가 무너진다.

| | 라운드마다 비우나 | 어디에 | 왜 |
| --- | --- | --- | --- |
| **AI 컨텍스트** | **비운다** | 없음 (계산해서 만듦) | 토큰·속도·성능. 다 기억시키면 느려지고 나빠진다 |
| **대화록** | **안 비운다** | `teams/<팀>/log.jsonl` | 카톡처럼 위로 올리면 반년 전 대화도 나와야 한다 |
| **산출물** | 별개 | `teams/<팀>/out/` | 마일스톤의 결과물. md·xlsx·이미지 |

### 대화록은 append-only

`log.jsonl` 은 **절대 지워지지 않는다.** 라운드가 끝나도 한 줄도 사라지지 않는다.
라운드 경계는 `round_start` / `round_end` 이벤트가 화면에 구분선으로 그릴 뿐이다.
카카오톡 대화방과 같은 성격이며, md 산출물과는 다른 **회의록**이다.

라운드 요약은 `teams/<팀>/rounds.jsonl` 에 한 줄씩 따로 쌓인다
(라운드 번호, 마일스톤, 판정, 반박 횟수, 이벤트 수, 시각).
대화록을 다시 훑지 않고도 "3라운드에서 무슨 판정이 났나"를 알 수 있게 하는 색인이다.

### 비워지는 건 AI 컨텍스트뿐

에이전트에게 넘기는 범위는 **현재 라운드의 이벤트**로 한정된다
(`readContext()` — `log.jsonl` 에서 `round === 현재` 인 것만 고른다).
지난 라운드의 결론이 필요하면 대화록 전체가 아니라 `rounds.jsonl` 의 요약이나
`out/` 의 산출물을 읽는다. 파일을 지우는 방식이 아니라 **읽는 범위를 좁히는 방식**이다.

### 라운드의 상태 — `phase`

`round.json` 의 `phase` 는 셋 중 하나다. 파일이 없으면 대화록에서 되살린다(`deriveState`).

| `phase` | 뜻 | 누가 바꾸나 |
| --- | --- | --- |
| `idle` | 라운드 없음. 훅이 기록하지 않는다 | `endRound` |
| `running` | 진행 중 | `startRound` · `resumeRound` |
| `blocked` | **FAIL — 대표 판단 대기.** 판정을 낼 수 없고(`recordVerdict` 거부, 외부감사 답은 말로만 남는다) **닫을 수도 없다**(`endRound` 거부). 레일·관제탑에 "대표 호출" | `recordVerdict`(반박 3회 또는 FAIL) |

막힌 방은 **대표가 그 방에 말하면 풀린다** — 입력창은 대표의 것이고 그 말이 곧 판단이다. 서버가 `/api/say` 에서
`resumeRound` 를 불러 `running`·반박 0 으로 되돌리고 `note`(`meta.resumed`)를 남긴다. 들려주기(quiet)는 풀지 않는다.
풀린 뒤에야 "라운드 닫기". 총괄실은 라운드가 없어 막히지 않는다 — 거기서 FAIL 은 한 마디일 뿐이다.
`needsBoss` 는 마지막 판정이 아니라 상태다 (전에는 FAIL 뒤 PASS 가 오면 경고가 꺼졌다 — 개발팀 09-02). 셋 중 하나면
참이고 `needsBossWhy` 에 이유가 실린다 (G-UX, 2026-09-13): `blocked` · `attempts`(열린 라운드의 반박이 상한) ·
`silent`(열린 라운드에서 하루 넘게 message·verdict 가 없음 — `lastSpokeAt`).

### 라운드를 PASS 로 닫는 조건

만든 사람이 스스로 통과시키지 못하게 `endRound` 가 본다 (`endRefusal`). 네 가지가 다 맞아야 `-v PASS` 가 된다.

1. 이 라운드에 `stale` 아닌 판정 카드가 있다.
2. 그중 마지막 카드가 `PASS` 다. 마지막이 `REVISE`·`FAIL` 이면 거부.
3. 그 카드 뒤에 사회자의 판정 완료 `note`(`meta.verdictFlow: 'pass'`)가 있다 — 판정은 `/verdict` 흐름으로 받는다.
4. **카드의 자리를 본다**(결정 118 ②) — 외부감사 자리가 다른 회사 엔진이고 중단(`suspended`)이 아니면 **그의 PASS 카드**가 있어야 한다. 전엔 안 봐서
   review 자리가 있는 방은 내부감사 클로드 혼자 단계를 넘길 수 있었다. 중단이면 없이 닫히되 기록에 남는다(아래).

거부되면 방에 `note`(`meta.endRefused`)가 남고 서버는 `409 { refused: true }` 를 돌려준다. 서버는 닫기를 미루기(202) 전에
먼저 본다. 통과한 `PASS` 는 로드맵의 그 마일스톤을 `pass` 로 옮긴다 — R3·R6·R8 의 "마일스톤 1 통과"(2026-09-12)는
이 조건이 없던 때 카드 없이, 또는 REVISE 카드 뒤에 찍힌 것이다. `rounds.jsonl` 은 고치지 않는다.
**누가 봤나가 기록에 남는다**(결정 118 ①): `milestone` 이벤트 `meta` 와 `rounds.jsonl` 행에 `auditors: [{ actor, verdict, sha, engine, ts }]`(이 라운드의 stale 아닌 카드,
자리당 마지막 하나 — `bus.auditorsOf`) · `outsideAudited: true|false` · 없으면 `outsideWhy`(`suspended` · `not-foreign` · `no-seat` · `no-card`). 판정 카드 `meta.engine` 은
답한 엔진(`codex · gpt-5.1` · `gemini · …` · `claude`). 라운드당 한 줄이라 "외부 감사 없이 통과한 단계" 를 한 번에 뽑는다 — 20일에 codex 가 돌아오면 그것만 다시 본다.

### 라운드를 닫는 정본은 서버다

라운드는 `POST /api/round {action:'end'}` 로 닫힌다. `bus/round.mjs end` 도 서버가 떠 있으면 서버에 부탁하고,
서버가 없을 때만 직접 닫는다. 이유는 둘이다.

- **일하는 중이면 턴이 끝난 뒤 닫는다** (`202 { deferred: true }`). 세션 안에서 바로 닫으면 그 턴의 마무리 보고가
  훅에서 버려진다 — `round.json` 이 이미 idle 이라서. 실무의 마무리 보고는 그 라운드의 것이다.
- **닫은 뒤 그 방의 세션 컨텍스트를 비우는 것은 서버만 할 수 있다** (`session.reset`). CLI 로 닫으면 세션 id 가 남아
  다음 라운드가 지난 컨텍스트를 안고 떴다.
- **받았다고 바로 답하고 뒤에서 닫는다** (`202 { accepted: true }`, 결정 26). 일지는 자리당 최대 3분이라 응답을 기다리게
  하면 CLI 가 5초 만에 "서버 없음" 으로 보고 직접 닫았고, 서버는 뒤늦게 "라운드 없음" 으로 던져 비우기를 건너뛰었다(R13).
  끝나면 `note` "라운드 N 닫힘 — 일지 K편" (`meta.closed`). CLI 는 연결 거부(ECONNREFUSED)일 때만 직접 닫고, 시간 초과에는
  직접 닫지 않는다. 닫는 중에 또 닫으면 `409`.

**닫으면서 다음 라운드를 이어 연다** (결정 25) — `round.mjs end --next [--milestone N] [--topic …]` → `{ action:'end', next: { milestone, topic } }`.
서버가 닫기(일지 → 닫기 → 비우기)를 끝낸 **그 자리에서** `startRound` 를 부른다 — 미룬 닫기(`deferred`)도 같다. 마케팅 R22 가
로드맵 교체 뒤 스스로 닫히고 다음 라운드를 여는 손이 없어 방이 멈춘 일. 마일스톤은 지정하지 않으면 로드맵의 `now`(같은 마일스톤을
잇는다) — `PASS` 로 닫아 `now` 가 없어졌으면 `startRound` 가 거부하고(다음 착수는 B) 서버는 `note` "닫았지만 다음 라운드를 열지
못했습니다 — …" 로 남긴다. 실무가 혼자 다음 마일스톤을 당겨오는 길은 아니다. 응답은 `{ accepted, round, next: true }`.

**닫히는 중 버려지는 차례는 다음 라운드 첫 턴으로 넘어간다** (결정 25, 5-1절 6 문) — 사회자가 `pending` 을 `carry` 로 옮기고
`note` "차례 N건(이름)을 다음 라운드 첫 턴에 넘깁니다", 다음 라운드가 열리면 그 자리에 `carried` 턴을 준다. 이 턴의 들려주기는
**닫힌 라운드의 못 들은 말부터** 잇는다(커서 뒤, 라운드 경계를 넘어) — 세션은 비워졌으니 무엇에 답하는지 귀에 있어야 한다.
닫힌 라운드의 호명이 `round_end`·`round_start` 와 **한 폴링에** 오면 그것도 새 라운드의 보통 호명이 아니라 넘어온 차례다(`staleCalls`,
레오 REVISE R23) — 보통 호명으로 주면 들려주기가 새 라운드만 읽어 그 말을 못 듣는다.
서버가 그 사이 재시작하면 넘길 것도 사라진다 — `note` 가 무엇이 넘어가려 했는지의 기록이다.

열린 라운드 위에 또 열지 않고(`startRound` 거부), 닫힌 라운드를 또 닫지 않는다(`endRound` 는 `phase` 를 본다).
외부감사처럼 오래 생각하는 참여자는 시작할 때의 라운드 번호를 답에 박는다 — 그 사이 라운드가 바뀌었으면
`meta.stale: true` 로 남고 새 라운드의 반박 횟수를 올리지 않는다.

방을 정하는 것은 서버가 세션에 넣는 `PPANAM_TEAM` 하나다. 예전의 `state/active-team`(터미널 opt-in)은 없다.

### 화면은 페이지네이션

브라우저는 처음에 최근 150건만 받는다. 위로 스크롤해 "이전 대화 더 보기"를 누르면
`before=<이벤트 id>` 로 그 앞을 더 받아 위에 끼워넣는다. 날짜가 바뀌는 지점에는
날짜 표시가 들어간다.

## 8. 표시 강도 (디자인 지침)

같은 채팅방 안에서도 **무게가 다르다.** 이 순서를 지켜야 화면이 읽힌다.

```
강함  ┃ verdict        판정 카드 — 가운데, 색 있는 테두리, 크게
      ┃ message        말풍선 — 기본
      ┃ round_start    라운드 배너 — 굵게, 강조색
      ┃ round_end      라운드 배너
      ┃ enter          등장 알약
      ┃ milestone      상단 고정 바 (대화 흐름에 끼어들지 않음)
      ┃ note           가장 약한 가운데 텍스트
약함  ┃ tool           접힌 모노스페이스 한 줄
```

도구 로그가 말풍선만큼 눈에 띄면 실패한 디자인이다.

## 9. 마을 — 대화록의 시각화

작전실·관제탑·분석 옆 네 번째 화면. 도트 마을에서 캐릭터가 자리에 앉아 있고, 발언이 말풍선으로 뜬다.

**원칙 하나. 마을은 대화록의 시각화다.** 캐릭터가 어디 있고 무엇을 하는지는 기록된 사건과 지도의 자리 표에서만 나온다.
LLM 이 좌표나 행동을 정하는 채널은 없다 (Project Sid 의 "말과 행동 불일치" — `docs/cases.md` 22). 그래서 비용이 0 이고 어긋날 수 없다.
사람인 대표만 예외다 — 방향키로 움직이고, 옆 사람에게 Enter 로 말을 건다. 그 말은 작전실과 같은 `/api/say` 로 간다.

| 것 | 어디 | 무엇 |
| --- | --- | --- |
| 지도 | `server/public/world/map.json` | `node tools/world/mapgen.mjs` 가 만든다. 손으로 고치지 않는다 |
| 장면 | `scenes.village` · `scenes.castle` | 마을(집·광장·카페·댄의 집·성 정면)과 회사(성 안 — 팀 사무실·총괄실·대표 집무실·로비). 각자 층(`ground·deco·wall·objects·over`)·충돌·방 이름표·포탈 |
| 자리 | `places` | `<팀>.desk.<자리>` · `<팀>.seat.n` · `<팀>.table` · `<팀>.door` · `hq.board` · `hq.bossdoor` · `boss.desk` · `castle.entrance` · `village.gate` · `plaza` · `cafe.seat.n` · `home.<팀>.<자리>` · `home.boss`. 각각 `{scene, x, y, dir}` |
| 포탈 | `scenes.*.portals` | `{x, y, to}` — 댄이 그 칸에 서면 `to` 자리로 옮겨지고 장면이 바뀐다. 성문 ↔ 회사 정문 |
| 그림 | `server/public/world/assets/` | 출처·라이선스는 `assets/LICENSES.md`. 여기 없는 그림은 화면에 없다 |
| 화면 | `server/public/world/world.js` · `world.css` | 캔버스가 그림, DOM 이 글(말풍선·이름표·띠). 말 → 조각은 `speech.js`(순수, `round.mjs check` 가 돌린다) |

**사건 → 연출** (W1 + W3)

| 사건 | 연출 |
| --- | --- |
| `message` (자리) | 화자 위 말풍선 — 만화처럼 **조각으로**(대표 원문 R25 "박스를 여러개로"): `speech.js splitSpeech` 가 줄바꿈·문장 끝에서 자르고 짧은 문장은 60자 안에서 붙여, 2.4초마다 하나씩 띄운다. 한 사람에 최대 셋(오래된 것부터 진다), 조각은 여섯까지 — 넘치면 마지막에 `…`, 전문은 ↗ 작전실. 누르면 좀 더 머문다. 같은 말이 1분 안에 또 오면(원문 배달로 세 방에 같이 기록) 한 번만. 첫머리에 이름을 불렀으면 그 사람을 바라본다 |
| `message` (boss) | 댄이 그 방 문(총괄실은 대표실 문)에 나타나 말한다. 댄이 직접 움직이는 중이면 그 자리에서. 조각 규칙은 같다 |
| `message` (마을에서 댄이 Enter 로 말 건 사람의 답) | 그 사람이 댄 옆까지 걸어와 마주 보고 말한다 |
| `message` (system) · `note` | 방 위에 띠 |
| `note` 승인 요청 (`meta.approval`) | 띠 + 요청자가 총괄실 게시판(`hq.board`)까지 걸어가 두루마리를 붙인다(말풍선) |
| `note` 승인 통과·반려 (`meta.status`) | 띠 + 톰이 게시판 앞에서 도장 — 통과 초록, 반려 빨강 |
| `round_start` | 띠 + 팀이 회의상(`<팀>.table`) 둘레에 모인다(25초) |
| `round_end` | 띠 + 흩어져 시계가 정한 자리로 |
| `verdict` | 판정자가 대상(`meta.target`, 기본 guide)의 자리 옆까지 걸어가 마주 보고 PASS/REVISE/FAIL 색 말풍선(도장). 다른 장면이면 제자리에서. FAIL 이면 방 이름표에 빨간 램프 60초 |
| `phase: blocked` (요약, 사건 아님) | 램프가 켜진 채로 실무가 대표실 문(`hq.bossdoor`) 앞에서 기다린다. 대표의 한 마디로 풀리면 자리로 |
| `tool` · 세션 busy | 화자 옆에 "⌨ 작업 중" |
| `enter` | 문에서 자기 자리까지 걸어온다 |
| (사건 없음) | 근무 중 놀고 있는 사람 하나가 40~90초마다 근처를 한 바퀴 돈다 — 살아 있는 느낌, 토큰 0 |

**시계와 루틴 (W2).** `server/world.mjs` 가 `state/world.json`(근무 9~18 · 점심 12~13 · 밤 23~7 · 주말 휴식 · 시험용 `debugHour`)로 `mode` 를 정하고
자리마다 `{ place, act }` 를 소켓 `world` 로 보낸다(`GET/POST /api/world`). 밤·휴식·저녁은 `home.<팀>.<자리>`(밤엔 `sleep`, z z z), 점심은 `cafe.seat.n` 다섯과 `plaza`,
근무는 `<팀>.desk.<자리>`(세션이 busy 면 `typing`). 화면은 밤에 어둡고 저녁에 붉다. 재생 중엔 사건의 시각으로 색조를 정하고, 그 방의 루틴 이동은 멈춘다.
**같은 시계가 사회자의 침묵 차례를 켜고 끈다** — 근무·점심 밖에서는 아무도 깨우지 않는다(codex 호출 0). 호명과 대표 지시는 시간과 무관하다. 대표는 사람이라 시계가 움직이지 않는다.

**재생.** `GET /api/log?team=<팀>&round=<n>` 이 그 라운드의 사건 전부를 준다(페이지네이션 없음). 화면의 재생은 이걸로 돈다 —
사건 사이 간격은 실제 간격을 0.6~2.6초로 눌러 배속한다. 재생 중인 방의 실시간 사건은 재생이 끝날 때까지 무시한다.

**실시간.** 소켓의 `events` 를 마을도 받는다. 탭이 닫혀 있으면 연출하지 않는다 — 대화록이 기록이고, 다시 열면 모두 자리에 있다.

**관람 (W3).** 캐릭터를 누르면 카드 — 지금(자리·상태), 누구(인격 파일의 첫 줄과 "## 너라는 사람" 절), 어제(일지 맨 위 문단의 **첫 문장** 한 줄 — `journal.first`, 그 아래 나머지 문단 — `journal.latest`, 결정 13), 최근 발언 여덟(누르면 작전실의 그 발언으로), 말 걸기. `GET /api/actor?team&actor`.
첫 문장은 `journalFirstSentence()`(`server/session.mjs`) 하나가 자른다 — 관제탑 개인 카드(M2)도 같은 함수를 쓴다. 일지 문단의 첫 문장은 "나는 …" 한 줄이라(일지 지시문) 그 자리의 오늘 마음가짐이다.
말풍선의 ↗ 와 카드의 발언은 작전실로 건너간다 — 그 방을 열고 발언을 가운데로 데려와 잠깐 빛낸다(화면에 없으면 위쪽을 더 불러오며 찾는다). 대표·system 은 카드가 없다.

계획 파일 C-4 의 연출 표는 이것으로 다 있다.
