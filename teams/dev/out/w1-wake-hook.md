# W1 — "뒤에" 주인을 실제로 깨우는 훅 자리 (server/conductor.mjs 몫)

작업보드 4절 ③: bus.mjs 의 `announceUnblocked()`(bus/bus.mjs)는 `recordVerdict()`가 PASS 를 최종 확정할 때
(`advanceWorkOnPass()`로 state/work.json 의 항목을 "통과"로 옮긴 직후) 불린다. 병목이 완전히 풀린 항목마다
그 팀 방에 `note` 이벤트를 남긴다:

```js
emit(it.team, {
  actor: 'system', type: 'note',
  text: `${ga(passedWhat)} 끝나 ${eul(who)} 부릅니다 — [${it.id}] ${it.what}`,
  meta: { workAutoCall: it.id, causedBy: passedId, seat: it.seat },
});
```

이 note 는 **말만 남긴다 — 세션을 실제로 깨우지 않는다.** 세션을 깨우는 `wake(team, actor)` 는
server/conductor.mjs(729줄 근처, `export function wake`)에 이미 있고, `/api/say` 가 대표 대신
codex 자리를 깨울 때 이 함수를 쓴다.

## 지금 자동으로 안 깨는 이유

conductor.mjs 의 사회자 이벤트 루프(650~671줄, `for (const e of events)` 안)는 시스템 발언을 이미 보고 있다:

```js
if (e.actor === 'system') {
  // 시스템 발언은 차례 계산에서 빠지되, 첫머리에 이름을 불렀으면 그 사람을 깨운다
  for (const to of addressees(e.text, cast)) {
    if (to !== 'boss' && participants(team).includes(to)) { enqueue(team, to, 'called'); armLull(team); }
  }
  continue;
}
```

`addressees(e.text, cast)` 는 **문장 맨 앞에서 이름을 부른 것**만 호명으로 읽는다(관제탑 관례 "이름, …").
W1 의 note 는 "OOO가 끝나 △△△을 부릅니다" 형태라 이름이 문장 가운데 있다 — 이 경로로는 안 걸린다.
`meta.workAutoCall`·`meta.seat` 을 note 에 이미 심어 뒀으니(2026-09-16 커밋), 문장을 다시 파싱할 필요 없이
그 필드를 바로 쓸 수 있다.

## 걸 자리 (제안)

같은 루프 안, 위 `if (e.actor === 'system')` 블록 안에 한 줄을 보태는 게 가장 자연스럽다 — 이미 시스템
발언을 거르고 있는 자리라 이벤트 종류 검사(`e.type === 'note'`)만 더하면 된다:

```js
if (e.actor === 'system') {
  if (e.type === 'note' && e.meta?.workAutoCall && e.meta?.seat) {
    wake(team, e.meta.seat);   // 작업 보드 "뒤에" 호명(W1) — 문장 파싱 대신 meta.seat 을 바로 쓴다
  }
  for (const to of addressees(e.text, cast)) { ... }   // 기존 호명 경로는 그대로 둔다(이름이 앞에 오는 다른 note 도 있다)
  continue;
}
```

주의할 점 세 가지:
1. `wake()`는 `participants(team).includes(actor)` 를 먼저 본다 — 그 자리가 지금 이 팀의 참가자가 아니면(예: 다른 팀 자리를 잘못 적었으면) 조용히 `false` 를 돌려준다. 실패를 알고 싶으면 반환값을 note 로 남기는 것도 고려.
2. `wake()`는 `enqueue(team, actor, 'called')` 만 한다 — 그 자리 세션이 지금 다른 일로 바쁘면(`busy(team, actor)`) 큐에 쌓였다가 다음 턴에 받는다. codex 자리(outside)를 부르는 거라면 위 716줄의 `busy` 체크·`note` 패턴을 참고해 "지금 답하는 중이라 다음 차례에 듣습니다" 를 남기는 게 일관적이다.
3. `announceUnblocked()`가 이미 방(`it.team`)에 note 를 emit 했으므로, 이 훅에서 또 note 를 남기지 않는다 — `wake()` 호출 하나면 된다. 중복 호출 방지: `wake()`가 멱등하지 않다(호출마다 enqueue) 하지만 `announceUnblocked()` 자체가 같은 통과 id 에 대해 한 번만 불리므로(`recordVerdict` 안에서 한 번) 문제 없다.

## 왜 여기서(W1)는 안 걸었나

server/conductor.mjs 는 이번 작업 범위 밖 — 다른 서브에이전트/사람이 동시에 건드리는 중이라 읽기만 하라는
지시(작업보드 4절 ③, 솔라 지시)를 따랐다. `bus.mjs` 쪽 `announceUnblocked()`는 이미 필요한 재료
(`meta.workAutoCall`·`meta.seat`)를 note 에 심어 뒀으니, conductor.mjs 를 담당하는 쪽이 위 세 줄만
보태면 끝난다.
