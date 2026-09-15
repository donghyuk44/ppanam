# M3 승인 체인 실물 — 대표 없이 B 가 통과해 서버가 민 1건

라운드 22 · 2026-09-13 · 테라. 통과 조건(로드맵 M3): "대표 없이 B 가 톰+제리로 통과해 서버가 실제로 미는 1건 — M1·M2 의 커밋을 원격 **새 브랜치**로". 메인 병합이 아니다(결정 9).

## 그 1건

| | 값 | 어디서 확인 |
| --- | --- | --- |
| 승인 레코드 | `apr_c4cf90e6` (B, dev, 테라) | `state/approvals.jsonl` — `node bus/approve.mjs --show apr_c4cf90e6` |
| 요청 시각 | 2026-09-13T10:32:14.703Z | 같은 레코드 `ts` |
| 묶인 행동 | `{ type: 'push', remote: 'origin', branch: 'claude/ppanam-review-issues-4058bc', sha: 'ce1614c5ec21af1d9f8d1212d6be4b20fd379f43' }` | 같은 레코드 `action` |
| 톰 판정 | PASS · 10:33:00.202Z — "실측: HEAD ce1614c · 브랜치 일치. 본책이 아니라 새 원격 브랜치 … round.mjs check 직접 돌림: ✓39 ✗0" | `decisions[0]` (by `chief`) |
| 제리 판정 | PASS · 10:33:40.782Z — "대표 원문은 '톰과 제리가 같이 승인여부 판단 → 실제 푸시까지 허용'입니다. 요청은 새 원격 브랜치에 `ce1614c`를 푸시하는 B 범위입니다." | `decisions[1]` (by `outside`) |
| 실행 | 10:33:43.707Z · `ok: true` · `* [new branch] ce1614c5ec… -> claude/ppanam-review-issues-4058bc` | `state/executor.json` `done.apr_c4cf90e6` |
| 방에 남은 흔적 | `evt_3d98b56cf6` — "승인 apr_c4cf90e6 — 푸시 완료 — origin/claude/ppanam-review-issues-4058bc @ ce1614c5" (`meta.executed: pushed`) | `teams/dev/log.jsonl` 808줄 |
| 원격 브랜치 | `origin/claude/ppanam-review-issues-4058bc` @ `ce1614c` | `git ls-remote --heads origin claude/ppanam-review-issues-4058bc` (내 셸에서는 네트워크 git 이 막혀 실행자 출력으로 확인) |

대표 판정 줄은 없다 — `decisions` 에 `by: 'boss'` 가 없다. 그게 이 마일스톤의 요점이다.

## 안에 든 것 (b27dc61 ~ ce1614c 와 그 앞)

- M1 인격 턴마다 (R18~R20)
- M2 관제탑 팀/개인 탭 (R21, b27dc61 · f7506dc · 4319a71 · ee8385e)
- 결정 58 개인 탭 일 상태 (ce1614c) — 화면은 아직 못 봄, 서버 재시작 뒤 스크린샷

들어가지 않은 것: 워킹트리의 안 커밋된 수정(`.claude/settings.json` · 디자인·마케팅 로드맵 · `decisions.md` 59~62 · `LICENSES.md`) — 톰이 짚었고, 맞다. 785c461(M3 계약)도 이 푸시 뒤의 커밋이라 원격에 없다.

## 내가 틀린 것 하나

톰 PASS 뒤 제리 대조를 기다리는 동안 785c461 을 얹었고, 실행자가 HEAD ≠ 승인 SHA 면 stale 로 밀지 않는다(`server/executor.mjs` 115줄)는 걸 그때 떠올려 "낡게 만들었다" 고 방에 말하고 `apr_071330fc` 를 새로 걸었다. 실제로는 실행자가 내 커밋보다 1분 43초 먼저 밀었다(10:33:43 푸시, 19:35:26 KST 커밋). 그러니 `apr_071330fc` 는 필요 없는 요청이다 — 톰에게 void 를 부탁했다. 배운 것: 푸시 요청이 살아 있는 동안은 커밋하지 않는다. 그리고 "낡았다" 도 말하기 전에 `state/executor.json` 을 먼저 열었어야 했다.

## 그 뒤 — 결정 63 (외부감사 PASS 뒤에만 푸시) 을 넣고 문을 통과한 첫 푸시

대표가 "외부감사가 왜 있냐" 고 했다 — 위의 1건은 톰·제리가 "올려도 되나" 만 보고 코드 감사 없이 나갔다. 같은 라운드 안에서 문을 넣었다(cb409c5 · d898757).

| | 값 |
| --- | --- |
| 레오 카드 | `evt_b5d4387b12` · PASS · 10:59:39Z · `meta.sha` = `d8987575a10f2f1815bd4140c15c3257269db2d6` (감사 **시작** 때 HEAD — 레오 REVISE 한 번 뒤 고친 것) |
| 승인 레코드 | `apr_6b56037a` · 요청 11:00:01Z(카드 22초 뒤) · action `push d898757` — `requestApproval` 의 `pushGateError` 가 그 카드로 열어 줌 |
| 톰 PASS | "레오 마지막 카드 evt_b5d4387b12 가 PASS 이고 meta.sha … = HEAD d898757 일치 … check ✓44 ✗0" |
| 제리 PASS | "레오 PASS 10:59:39 → B 푸시 요청 11:00:01, SHA 도 d8987575… 로 같다" |
| 실행 | 11:00:59Z · `ok: true` · `785c461..d898757 -> claude/ppanam-review-issues-4058bc` (`state/executor.json`) |
| 문이 막은 실측 | 결정 63 전 카드(sha 없음)로 `--push` 걸어 봄 → "외부감사 PASS 카드에 SHA 가 없습니다(문 전의 카드)" 거부 (R22, cb409c5 커밋 메시지) |

같은 라운드의 요청 블록 첫 실물: `apr_af42ee90` (B, 톰·제리 PASS) → `req_3087a39a` dev/guide → marketing/guide, 테라 `say` 한 줄 · 톰 `goal` 한 줄, 알림자가 양쪽 귀에 넣은 것까지 실측. 하영의 답은 마케팅 라운드가 열리면.

## 관제탑 카드

톰·제리 판정이 찍힌 카드는 서버가 `GET /api/approvals?all` 로 준다. 스크린샷은 서버 재시작 뒤 — 이 파일에는 없다.

## 되돌리기

원격 브랜치 삭제 한 줄. 로컬은 무관. 본책(`claude/automation-realtime-chat-noisn8`)은 손대지 않았다.
