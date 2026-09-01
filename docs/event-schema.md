# 이벤트 스키마 — 작전실 채팅방에 나타날 수 있는 것의 전부

이 문서가 **디자인과 구현 사이의 계약**이다.
`/design` 아트보드도, 웹 UI 구현도, 훅 스크립트도 전부 이 목록만 보고 만든다.
여기에 없는 것은 화면에 나타나지 않는다.

---

## 1. 화자(actor)

서브에이전트의 `name` 은 소문자와 하이픈만 쓸 수 있고, 훅이 이 값을 `agent_type` 으로
그대로 넘겨준다. 따라서 화자 ID = 서브에이전트 `name` 으로 통일한다.

| actor | 한글 이름 | 실체 | 화면 위치 | 비고 |
| --- | --- | --- | --- | --- |
| `guide` | 길잡이 | Claude 서브에이전트 | 왼쪽 | 실행 주무. Advisor + Librarian |
| `review` | 되짚기 | Claude 서브에이전트 | 왼쪽 | 감사. Tutor + Editor |
| `outside` | 바깥눈 | 외부 GPT | 왼쪽 | 교차검증. Roommate + 기술감사 |
| `boss` | 대표 | 사람 | **오른쪽** | 사람이 직접 끼어든 발언 |
| `system` | — | 훅 / CLI | **가운데** | 말풍선이 아니라 배너 |

말풍선 색은 각 서브에이전트 `.md` frontmatter 의 `color` 필드에서 가져온다
(`red`/`blue`/`green`/`yellow`/`purple`/`orange`/`pink`/`cyan` — 공식 필드).
별도 매핑 파일을 두지 않는다.

---

## 2. 레코드 형식

`bus/live.jsonl` 에 한 줄에 하나씩 append 된다. 모든 이벤트가 같은 봉투를 쓴다.

```json
{
  "id": "evt_3f9a2c1b",
  "ts": "2026-09-01T04:20:00.000Z",
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
| `id` | ✔ | `evt_` + 랜덤 hex 8자 |
| `ts` | ✔ | ISO 8601 UTC |
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
- `meta.partial: true` 면 아직 생성 중 (stream-json `text_delta`). 타이핑 표시.

### `enter` — 등장 배너
에이전트가 라운드에 합류. 가운데 작은 알약 모양.
> 되짚기 님이 들어왔습니다.

- **출처**: `SubagentStart` 훅

### `tool` — 도구 사용 로그
접힌 상태의 얇은 모노스페이스 줄. 기본은 접혀 있고 눌러야 펼쳐진다.
채팅방이 도구 호출로 도배되면 안 되므로 **말풍선보다 훨씬 약하게** 표시한다.

- **출처**: `PreToolUse` / `PostToolUse` 훅
- `meta.tool`: 도구 이름, `meta.ok`: 성공 여부

### `verdict` — 판정 카드
감사 결과. 말풍선이 아니라 **가운데 카드**로 크게 표시한다. 라운드의 분기점이므로
스크롤에서 한눈에 찾을 수 있어야 한다.

| `meta.verdict` | 의미 | 다음 동작 |
| --- | --- | --- |
| `PASS` | 통과 | 다음 마일스톤으로 |
| `REVISE` | 되돌려보냄 | 같은 마일스톤에서 라운드 재시작 |
| `FAIL` | 한계 도달 | 사람 호출 |

- `meta.target`: 누구에게 내린 판정인지 (`guide` 등)
- `meta.attempt`: 이 라운드의 몇 번째 반박인지 (1~3). **3에서 자동 `FAIL`**

### `round_start` — 라운드 시작 배너
가운데. 이 줄 위쪽은 이전 라운드가 아니다 — 채팅창이 이미 비워진 뒤이기 때문.
> **라운드 3 시작** · 마일스톤 2: 9월 캠페인 카피

### `round_end` — 라운드 종료 배너
가운데. 이 이벤트가 기록된 직후 `live.jsonl` 이 보관되고 비워지며,
서버가 파일 크기 0을 감지해 **화면을 초기화**한다.

### `milestone` — 마일스톤 진행 표시
로드맵 상 현재 위치. 상단 고정 바에 반영된다.
- `meta.index` / `meta.total` / `meta.title` / `meta.deliverable`

### `note` — 시스템 안내
그 외 알림 (바깥눈 비활성, 반박 상한 도달 등). 가운데, 가장 약한 표시.

---

## 4. 화면 초기화 규약

라운드 종료는 **별도 신호를 보내지 않는다.**

```
round_end 기록 → live.jsonl 을 rounds/round-NNNN/events.jsonl 로 보관
              → live.jsonl 을 0바이트로 truncate
              → 서버가 폴링 중 size < offset 을 감지
              → WebSocket 으로 { kind: "reset" } 브로드캐스트
              → 브라우저가 대화 영역을 비움
```

파일 크기가 줄어드는 것 자체가 신호다. 이렇게 하면 서버가 죽었다 살아나도,
브라우저를 새로고침해도 상태가 어긋나지 않는다.

---

## 5. 표시 강도 (디자인 지침)

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
