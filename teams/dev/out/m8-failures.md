# 8단계 실패 수습 — 코드 넷과 일부러 깨뜨린 기록

R28 · 테라 · 2026-09-16. 로드맵 8단계 줄(`teams/dev/roadmap.json` 57행)의 넷을 하나씩 넣었고, 각각 `node bus/round.mjs check` 에 시험이 붙었다(100 ✓).
실물로 깨뜨린 기록은 3절 — 서버가 새 코드로 뜬 뒤 방(`teams/dev/log.jsonl`)에 남은 줄을 그대로 옮긴다.

## 1. 무엇을 넣었나

| # | 로드맵 줄 | 코드 | 커밋 | check |
| --- | --- | --- | --- | --- |
| ① | codex 를 강제로 죽여도 1회 재시도 후 note + 큐 | 안쪽 `bus/outside.mjs`(`bus.withRetry`) — 엔진 호출이 던지면 note "한 번 더 부릅니다 (1/2)" 뒤 한 번 더, 둘 다 실패면 note(gaveUp)+exit 1. 바깥 `server/conductor.mjs outsideFailed` — exit 1·signal 이면 note 뒤 `pending` 에 `notBefore`(3분) 를 달아 큐, 시각 전엔 안 줌(`armRetry`), 큐에서도 실패면 버리고 판정 흐름 abort. 종료 코드 4 = 건너뜀(큐 안 남김). gemini 자리의 상주→agy -p 폴백도 note | 7b9ef2c · e198f21 | `codex 죽여도 1회 재시도 후 note+큐(8단계 ①)` |
| ② | 세션이 죽으면 자동 재개(결정 28 ②) | `server/session.mjs deathPlan` — 턴 도중 끝나면(kill -9·크래시·result 없이 code 0) 같은 턴을 새 세션으로 한 번 다시(줄 선 턴도 옮김), 이어붙인 첫 턴이면 id 버림, 두 번째 죽음은 note 로 버림. `settle` 이 사회자에게 턴 끝을 알려 죽은 턴이 `_queue.inflight` 에 안 남음 | b43cbdf | `세션 죽으면 자동 재개(8단계 ②)` |
| ③ | 부분 성공이 통과로 위장되지 않는다 | `bus.artifactsOf` — 판정 시작 note 의 `meta.target` 에 적힌 `out/…` 경로 + 이 라운드 도구 줄이 `teams/<팀>/out/` 밑에 쓴 파일. 없거나 0바이트면 `endRefusal` 거부, 하나도 없어도 거부. `milestone` 이벤트·`rounds.jsonl` 에 `artifacts:[{path,bytes}]` | ee1dbe2 | `부분 성공은 통과 아님(8단계)` |
| ④ | 결정 6 상한 — 침묵 방당 시간당 30 · 마을 하루 60, 넘으면 마을 턴부터 | 장부 `state/budget.json`(`bus CAPS·takeLull·takeVillage`) — 전엔 침묵 수가 사회자 메모리라 재시작마다 0. 침묵은 `armLull` 맨 끝에서 하나 씀, 마을은 `journalAll` 이 걷기 전에 자리마다(일지가 지금 있는 마을 턴 — 계획·마주침이 생기면 같은 장부). '왕복 3회' 는 결정 120 철회 그대로 뺌 | acdfdbd | `비용 상한(결정 6 · 8단계 ④)` |

계약은 `docs/event-schema.md` — 3절(세션 자동 재개) · 5절(외부 자리 재시도·큐, 침묵·마을 상한) · 7절(PASS 조건 5 · `artifacts`).

### 해석한 것 (틀리면 고친다)

- "큐" = 사회자의 `pending`(state/conductor.json `_queue`) — 3분 뒤 같은 차례를 다시 준다. 재시도 표시(tries·notBefore)는 저장에 안 남겨 서버 재시작 뒤엔 처음처럼 바로.
- "마을 턴" = 결정 6 의 계획 15·마주침 30·일지 15 중 코드에 있는 건 일지뿐. 상한 60 은 셋의 합이라 지금은 일지만 센다.
- "넘으면 마을 턴부터" = 건너뛰는 순서 마을 > 침묵 > 호명·판정(안 끊음). 상한이 서로 다른 종류라 마을 상한은 마을 턴을, 침묵 상한은 침묵 턴을 막는다.
- "세션이 죽으면" 의 15분 신호 없음(결정 31 ③)은 재개 대상이 아니다 — 다음 지시로 이어진다(전과 같음).

## 2. 곁다리 — 시험 도구를 만들다 본 것

`tools/m8-ps.mjs`(서버 자식을 자리 이름으로) 로 보니 서버 자식에 **`_check:guide` claude 세션(opus)** 이 13분째 떠 있었다. `round.mjs check` 가 임시 방 `_check` 에 올린 B 요청을 바로 무효 처리해도 `state/approvals.jsonl` 은 append-only 라 174건이 남고, 알림자(`server/notifier.mjs` b-2)가 그 결말을 `send('_check', …)` 로 넣으며 가짜 방의 세션을 진짜로 띄웠다. `teamExists` 로 건너뛰게 고쳤다(e198f21). 이 세션은 서버 재시작 때 같이 내려간다.

## 3. 일부러 깨뜨린 기록

서버 재시작(apr_b64bfc8c, 나리 01:31 KST — 새 pid 20076, `_check:guide` 세션 0). 시각은 대화록 그대로 세계표준시(결정 101, 우리 시각 +9). 줄은 `teams/dev/log.jsonl` 에서 옮겼고 `tools/m8-break.mjs` 출력과 같다.
호명 줄("레오, 8단계 … 시험 A2 입니다")은 그 도구가 `system` 화자로 넣은 것이라 방에서는 **나리** 로 보인다(system 자리의 이름) — 나리가 한 말이 아니다. 예고문은 사람 보라고 붙인 것이고 죽이는 쪽·되살리는 쪽 코드는 말 내용을 안 읽는다(솔라 지적: 진짜 시험은 예고 없는 죽음 — 레오 판정 도중 죽이면 판정 하나를 날리니 일부러 안 했다).

### 3-① 외부 자리(레오, gemini) — 두 겹 다

**A2 · 호출 프로세스(`node bus/outside.mjs`)를 SIGKILL** — 바깥 겹(사회자 큐).

```
16:31:11  방에 시스템 말 evt_c45c8599de — "레오, 8단계 실패 수습 시험 A2 …"
16:31:12  outside.mjs 떴다 pid 22366
16:31:13  SIGKILL → outside.mjs pid 22366
16:31:13  system/note: 레오이 답을 못 냈습니다 — SIGKILL 로 죽음. 이 차례(called)를 큐에 남기고 3분 뒤 다시 줍니다 (1/2).
          meta.outsideRetry { actor:"outside", kind:"called", tries:1, of:2, notBefore:"…16:34:13.786Z", why:"SIGKILL 로 죽음" }
16:34:53  outside/message: 나리, 준비됐습니다. 프로세스를 죽이고 1회 재시도 후 노티와 큐로 올바르게 넘어가는지 확인하겠습니다.
```

죽인 지 0초에 note, 3분 0초 뒤 큐에서 다시 줬고 40초 뒤 답. ("레오이" → `ga()` 로 고침, 다음 재시작에 탄다.)

**A1 · 엔진(상주 gemini, `/api/gemini/status` 의 `dev:outside` pid)을 SIGKILL** — 안쪽 겹(outside.mjs 재시도).

```
16:36:05  방에 시스템 말 evt_c769dd9d67 — "레오, … 시험 A1 …"
16:36:06  outside.mjs 떴다 pid 27890
16:36:07  SIGKILL → 상주 agy pid 25766 (dev:outside · 대화 3a21f23d · 턴 1)
16:36:07  outside/note: 상주 gemini 가 답을 못 냈습니다 — 상주 gemini 502 — agy 상주 프로세스가 끝났습니다 (code null). agy -p 로 한 번 더 부릅니다.
          meta.retry { actor:"outside", engine:"pool→agy", why:"…" }
16:36:49  outside/message: 나리, A1 시험 확인했습니다. gemini 프로세스를 죽였을 때 세션이 정상적으로 자동 재개되는지 돌려보며 확인하겠습니다.
```

죽인 지 0초에 note, 같은 프로세스가 agy -p 로 다시 불러 42초 뒤 답. 큐까지 안 갔다(첫 재시도에서 됨). codex 자리면 같은 자리의 `bus.withRetry` 가 "…을 부르지 못했습니다 — codex SIGKILL 로 죽음. 한 번 더 부릅니다 (1/2)" 를 남긴다 — codex 는 9/20 까지 한도라 실물은 gemini 로 쟀다(check 의 withRetry 시험이 그 경로).

### 3-② 클로드 자리(솔라) — 세션 프로세스를 턴 도중 SIGKILL

```
16:37:02  방에 시스템 말 evt_02d153087a — "솔라, … 시험 B …"
16:37:03  솔라 일하는 중 — 세션 1f249b0b (--resume)
16:37:08  SIGKILL → claude pid 29056 (뜬 지 5초)
16:37:08  system/note: 솔라 세션이 끊겼습니다 (SIGKILL 로 죽음). 저장된 세션을 버리고 새 세션으로 같은 차례를 한 번 다시 보냅니다.
          meta.sessionRetry { actor:"ops", kind:null, rotten:true, why:"SIGKILL 로 죽음" }
16:37:13  ops/message: 나리, 준비됐다. 죽으면 새 세션 오는 거 지켜보고, 죽자마자 방에 note 뜨는지도 같이 셀게.
```

죽인 지 0초에 note, 새 프로세스(pid 29343, `--resume` 없음) 가 같은 차례를 받아 5초 뒤 답. `state/sessions.json` 의 `dev:ops` 가 1f249b0b → 430b8cd1 로 바뀜. 이어붙인 첫 턴에서 죽어 `rotten` 으로 id 를 버렸다 — 첫 턴 중에 죽은 것과 id 가 썩은 것을 밖에서 못 가르니 둘 다 새 세션이다(일지·인격은 시스템 프롬프트로 다시 실린다).

### 3-③ 부분 성공 — 레오 PASS 뒤, 이 파일을 0바이트로 비우고 닫아 봄

```
16:39:xx  outside/verdict [PASS]: 테라, teams/dev/out/m8-failures.md 산출물과 실제 동작 코드를 열어서 확인했습니다. …
          system/note: 판정 완료 — 레오 모두 통과. 이제 테라가 이 회의를 통과로 닫을 수 있습니다.
          (cp 로 이 파일을 state/m8-failures.bak 에 두고 0바이트로 비움)
16:40:38  node bus/round.mjs end --team dev -v PASS
          → 오류: 판정은 PASS 인데 산출물이 비었습니다 — out/m8-failures.md(0바이트). 부분 성공은 통과가 아닙니다. 파일을 채우거나, 판정 대상 글의 경로가 줄임말이면 실제 경로로 적어 다시 판정을 받으세요.
16:40:38  system/note (meta.endRefused): 라운드 28 닫기 거부 (PASS) — 판정은 PASS 인데 산출물이 비었습니다 — out/m8-failures.md(0바이트). …   (evt_16b8559128)
          (파일 되돌림 → 다시 닫음 = 이 라운드의 닫힘)
```

판정 카드 PASS · 완료 note · 외부감사 카드까지 다 갖춘 라운드가 **물건이 비면 안 닫힌다**. 거부는 서버(`/api/round`)가 미루기 전에 봤고 방에 note 로 남았다.

### 3-④ 상한 — 장부가 살아 있다

재시작 뒤 `state/budget.json` 에 `{"lull":{"marketing":[1789489968571]}, …}` — 마케팅 방의 침묵 차례 하나가 파일에 적혔다(전엔 메모리). 개발 방 칸을 30 으로 채워 두었다(`tools/m8-seed-budget.mjs`, 16:37:49Z) — 그 뒤 한 시간 안에 이 방이 90초 조용해지는 첫 순간, 침묵 차례 대신 note "침묵 차례가 시간당 상한(30회)에 닿았습니다. 한 시간 동안은 호명·판정·대표 지시에만 답합니다 (결정 6)"(`meta.cap { kind:'lull', used:30, cap:30 }`) 가 떠야 한다. 이 라운드를 닫는 시각까지는 방이 계속 말하고 있어(판정·닫기) 그 순간이 안 왔다 — 닫힌 뒤엔 침묵 차례 자체가 없다(라운드 idle). 실물은 다음 라운드 첫 조용한 순간(17:37Z 전)에 방에 뜬다 — 안 뜨면 그게 버그다. 31번째 거부 자체는 check(`비용 상한`) 가 같은 함수로 잰다.
마을 60 은 실물로 안 깨뜨렸다 — 깨뜨리면 이 라운드 일지 셋이 사라진다(일지는 기억 층). check 의 61번째 거부·다음 날 다시 시험으로 갈음.

## 4. 남은 것

- `tools/m8-*.mjs` 넷·`tools/tmp-*.mjs` 는 정리 라운드에서(m8-ps 는 살릴 만하다 — 서버 자식을 자리 이름으로 보는 유일한 창).
- "레오이/레오을" 조사 고침(9cfd994)은 다음 서버 재시작에 탄다.
- 마을 턴의 계획·마주침은 코드에 없다 — 생기면 `bus.takeVillage(what)` 한 줄이면 같은 장부.
- 침묵 상한 note 실물은 다음 라운드 첫 조용한 순간(17:37Z 전) — 3-④.
