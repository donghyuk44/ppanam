# R13 가드 — 라운드 닫기 규칙을 코드로 (2026-09-13)

작업 커밋: **ee91991** (7beb345 위 하나). 대표 지시 09-13 12:37, 결정 17·18 포함.

## 들어간 것

| # | 지시 | 어디 | 어떻게 |
| --- | --- | --- | --- |
| 1 | `end -v PASS` 는 카드·마지막 PASS·완료 note 가 있을 때만. blocked 면 못 닫음. 반박 횟수는 마일스톤 키 | `bus/bus.mjs` `endRefusal`·`assertEndable`·`deriveState`·`startRound`·`recordVerdict`·`resumeRound` | `round.json` 에 `attempts[마일스톤]` 이 남고 다음 `startRound` 가 물려받는다. 0 복귀는 PASS 카드·`resumeRound` 만 |
| 2 | 닫힌 라운드의 판정은 stale | `recordVerdict` | `phase === 'idle'` 이면 `meta.stale: true` (총괄실 제외) |
| 3 | `--summary`·`--topic` | `bus/round.mjs` | 플래그 우선, 남은 단어는 뒤로 호환 |
| 4 | 보호 브랜치를 원격 기본 브랜치로 | `bus/bus.mjs` `protectedBranch()`·`pushAction()` → `approve.mjs`·`server/executor.mjs` | `git symbolic-ref refs/remotes/origin/HEAD`. 모르면 요청·실행 둘 다 거부 |
| 5 | 환경 없는 셸의 대조 요청 거부 | `bus/outside.mjs` | codex 를 부르기 전에 `if (apr && caller !== 'hq')` → note + exit 1 |
| 6 | finance R1 닫기 · 솔라 오기 · README | `teams/finance/log.jsonl` round_end · `teams/dev/outside.md` · `README.md` 세 군데(캐스트 표·Phase 3·승인 체인/Phase 6) | 했음. `AGENTS.md`·`.codex` 는 rm 이 세션에서 막혀 대표 몫 |
| 7 | progress.json 게이트 언어 | `teams/dev/progress.json` | doing[0] = 지금 게이트 — 막힌 것 · issues = 대표가 할 일 |
| 8 | 턴 상한을 마지막 신호에서 재기 (결정 17) | `server/session.mjs` `arm()` | 스트림 이벤트마다 타이머 리셋. 진짜 무응답만 죽는다 |
| — | 계약 | `docs/event-schema.md` | 판정 카드 `attempt` 가 마일스톤의 것 · `stale` · "PASS 로 닫는 조건" 절 · 보호 브랜치 · 대조 거부 |
| — | 서버 | `server/index.mjs` | `/api/round end` 가 미루기(202) 전에 `assertEndable` → `409 { refused: true }` |

## 통과 시험 — `node bus/round.mjs check` (임시 방 `_check`, 2026-09-13 04:00 UTC)

```
✓  카드 없이 end -v PASS              ✓ 거부
✓  REVISE 뒤 end -v PASS             ✓ 거부
✓  PASS 카드만, 완료 note 없이         ✓ 거부
✓  정식 흐름 → 닫힘 + 로드맵 pass      ✓
✓  닫힌 방의 판정 → stale              ✓
✓  반박 횟수를 다음 라운드가 물려받음   ✓ 1/3
✓  FAIL(blocked) 뒤 닫기               ✓ 거부
✓  대표 재개 → 반박 0 · 닫힘           ✓
✓  원격 기본 브랜치(claude/automation-realtime-chat-noisn8) 푸시 요청 ✓ 거부
✓  다른 브랜치 푸시 요청               ✓ 허용
```

대표가 정한 넷 중 셋(카드 없이·REVISE 뒤·정식 흐름)은 위 임시 방에서 (결정 18 — 실제 R13 은 `-v PASS` 로 닫지 않는다).
넷째 "메인 체크아웃에서 `approve --request B`" 는 같은 코드 경로(`pushAction`)에 원격 기본 브랜치 이름을 넣어 거부를 봤다 —
메인 체크아웃(`~/Documents/ppanam`, 그 브랜치)에서 실제로 `approve.mjs --push` 를 돌린 것은 아니다. 이 워크트리의 코드가
거기 없어서다. 레오가 격리 실행으로 돌려볼 수 있으면 그것이 실측이다.

방 안에서 실제로 남은 기록(R13): `outside.mjs --team dev --ask "… apr_deadbeef 대조"` → "대조 요청을 거부했습니다" note (5번).

**레오 1차 감사(REVISE):** 지적 — `server/conductor.mjs` 판정 흐름이 `stale` 카드를 안 걸러 옛 라운드의 늦은 PASS 가 이번 완료 note 를
만들 수 있었다. 고침(0e3abe8): `onFlowEvent` 가 `meta.stale` 이면 note 를 남기고 계속 기다린다. 계약 5-1 절에 한 줄. 2차 감사 PASS —
레오가 함수 본문을 격리 실행해 stale PASS·REVISE 는 대기 유지, 정상 PASS 만 흐름 종료를 확인.

**정정 — 넷째 시험은 실측되지 않았다.** 레오가 "메인 체크아웃에서 `approve --request B --push` 가 거부됐다" 고 했지만(독립검수 지적, 09-13),
그 체크아웃(bf81ead)의 옛 `approve.mjs` 는 150행에서 `PPANAM_TEAM` 없는 셸을 "방이 지정되지 않은 셸에서는 요청할 수 없습니다" 로
먼저 끊는다 — 보호 브랜치 검사(그때는 main/master 하드코딩)까지 가지도 않았다. codex 샌드박스에는 그 환경이 없으니 거기서 막힌 것이다.
가드 4번의 근거는 지금도 `check` 의 `pushAction(원격 기본 브랜치)` 거부뿐이다. 문자 그대로의 시험(그 브랜치 체크아웃에서 이 코드로
`--push` 요청)은 결정 9(본책 반영) 뒤에 한다. 위에서 "실측" 이라 쓴 문장을 이걸로 대신한다 — 지우지 않고 정정한다.

## 안 된 것 · 대표 몫

- 서버는 옛 코드로 떠 있다 — 가드는 새 프로세스에서만 산다. 재시작은 세션 재시작(B)이라 내가 안 한다. 재시작 전엔 화면·API 의 닫기에 가드가 없다.
- `AGENTS.md`·`.codex/` 삭제 — `rm` 이 세션에서 막힌다. `rm AGENTS.md && rm -r .codex` (미추적이라 이것뿐).
- 네 탭 폰 폭 스크린샷 — 이 샌드박스에 브라우저가 없다(Chrome 실행·orca 둘 다 승인 필요). Android Chrome 폰 폭으로 찍어 `teams/dev/out/` 에.
- R13 은 attempt 0 에서 시작했다 — 새 규칙 전의 R10·R11 FAIL(각 3회)은 물려받지 않는다. `round.json` 이 0 이었고, 대표의 R13 지시가 사실상 재개다.
