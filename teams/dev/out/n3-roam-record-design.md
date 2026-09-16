# N3 — 로밍 자리 기록 설계 고침 (솔라, 설계안 — 구현 아님. 세라 검수 뒤 구현)

## 문제 (대표 13:00 총괄실 "설계 미스인거지. 개선안 찾아봐")

지금(N1) — 나리(system)·세라(secretary)는 세션이 집(hq·sera) 하나뿐이라, 다른 방에서 불리면
`callHomeElsewhere`(server/conductor.mjs)가 집 세션에 그 방 사정을 들려 묻고, 답을 **두 군데**에
남긴다:

1. 집 세션 자체가 답했으니 **훅이 집 방(hq·sera) 대화록에 진짜 기록**으로 남긴다(원래 하던 대로).
2. `callHomeElsewhere`가 그 답을 **부른 방에도 사본**으로 남긴다(`meta.via:<집>·meta.hand:'server'`).

그래서 나리가 dev·marketing·design 방에서 불릴 때마다 하는 대답이 전부 hq 대화록에도 쌓인다 —
총괄실이 다섯 방의 잡담으로 채워진다. 오늘 낮에 이걸 `meta.roam` 표시 + 화면 접기(솔라 610fea7·
테라 e64a40d)로 덮었지만, 그건 **증상을 가린 것**이지 원인을 고친 게 아니다 — 대표가 짚은 지점이
바로 이거다: 애초에 왜 답이 두 곳에 남는가.

## 제안 — 원본은 부른 방에만

### A. 집 방 기록을 끈다 (훅 쪽, `.claude/hooks/to-bus.mjs` — 대표·관리 창 손)

`callHomeElsewhere`가 `session.sendAndWait(home, ..., { kind: 'called', extra: team, internal: true })`
로 turn 을 주는데, 이 `extra`(부른 방)가 이미 훅의 `turn.extra` 로 전달된다(`writeTurn`). 훅의
Stop 처리가 `turn.kind === 'called' && turn.extra`(로밍 relay 턴 — 이 조합은 지금 `callHomeElsewhere`
만 쓴다, 다른 호출부는 이 kind 를 안 씀)면 집 방에 기록하지 않고 `bail()`한다 — `사람 말은
callHomeElsewhere 가 부른 방에 이미 남긴다` 한 줄.

`sendAndWait`의 텍스트 회수는 훅과 무관하다(session.mjs drain() 이 stream 의 `msg.result` 를 직접
읽어 promise 를 푼다) — 훅이 안 적어도 `callHomeElsewhere`는 그대로 답을 받는다. 이걸로 **원본이
부른 방 하나에만** 선다. `meta.via`·`meta.roam`·화면 접기 장치는 더 안 쓴다(죽은 코드가 되니
이 변경과 같이 걷어낸다).

### B. 세션 맥락 — "오늘 말한 방들의 마지막 줄"을 모아 조립

A 만 하면 문제가 하나 생긴다 — 집 방 로그에 로밍 relay 턴이 하나도 안 남으니, 세션이 재시작하거나
`--reset` 으로 새로 뜨면 "오늘 내가 어느 방에서 뭘 답했는지"를 잃는다(같은 프로세스가 죽지 않고
살아 있는 동안은 모델 자체 문맥에 남아 있어 괜찮지만, 재시작하면 다시 조립해야 한다).

제안: `bus.mjs` 에 순수 함수 하나 —

```js
/** 이 자리가 오늘(서울 0시 기준) 말한 방마다 마지막 한 줄. 로밍 자리 브리프가 쓴다. */
export function roamTodayLinesOf(actor, { now = Date.now() } = {}) {
  const dayStart = dayStartSeoul(now);
  return listTeams()
    .map((t) => {
      const log = readLog(t.id).filter((e) => e.actor === actor && (e.type === 'message' || e.type === 'verdict') && new Date(e.ts).getTime() >= dayStart);
      const last = log[log.length - 1];
      return last ? { team: t.id, room: t.room ?? t.id, ts: last.ts, text: firstSentence(last.text) } : null;
    })
    .filter(Boolean);
}
```

`briefOf`(session.mjs, 세션이 새로 뜰 때)가 로밍 자리(`ROAM_HOME[actor]`가 있으면)에는 평소 절
대신 이 목록을 한 절로 붙인다 — "## 오늘 말한 방들\n- 개발 방: … (13:1x)\n- 마케팅 방: … (12:0x)".
`callHomeElsewhere`의 anchor 에도 짧게 한 줄 더("오늘 다른 방에서도 몇 마디 했다") 넣을지는 열린
물음(아래).

## 손대는 곳 (구현 때, 지금은 안 함)

- `.claude/hooks/to-bus.mjs` — Stop 처리에 로밍 relay 턴 bail 한 줄. 대표·관리 창 손, 패치 스크립트로.
- `server/conductor.mjs` `callHomeElsewhere` — `meta.via` 로직은 그대로 두거나(부른 방 사본에 "집에서
  옮겨온 답"이라는 표시는 여전히 필요할 수 있다 — 열린 물음) `meta.roam`/화면 접기 걷어내기.
- `bus/bus.mjs` — `roamTodayLinesOf` 새로 추가.
- `server/session.mjs` `briefOf` — 로밍 자리 절 추가.
- `server/public/app.js`·`card.js` — `meta.roam` 접기 부품이 안 쓰이면 걷어낸다(테라 몫, A 가 결정되면).

## 열린 물음 — 세라 검수 전, 아직 결정 아님

- **A 를 얼마나 세게 가나.** `meta.via` 사본 자체는 유지(부른 방에서 "나리가 답함" 표시는 필요)하되
  집 방 원본만 끄는 게 지금 제안이다 — 사본까지 없애면 부른 방에 아무 기록도 없어져 더 이상한 일이
  된다. 맞는지 확인 필요.
- **B 의 절 길이.** 다섯 방 전부 한 줄씩이면 브리프가 길어진다 — 오늘 말한 방만(위 코드가 이미 그렇다)
  으로 충분한지, 아니면 최근 N개로 자를지.
- **총괄실 자체에서 나리가 말한 것**(로밍이 아니라 진짜 집 대화)은 그대로 hq 로그에 남는다 — A 는
  relay 턴(`turn.extra` 있는 것)만 막는다, 헷갈리지 않게 확인.
- **세라도 같은 규칙인가.** ROAM_HOME 이 `{system:'hq', secretary:'sera'}` 둘이라 같은 코드 경로를
  같이 탄다 — 비서실도 다른 방에서 불리면 같은 문제였을 것, 확인만 하면 된다(설계는 이미 공통).

## 안 하는 것 (지금 범위 밖)

- 'system' 을 진짜 cast 자리 하나로 접어 아홉 군데 특별 처리(peopleOf·crossPost·addressees·훅…)를
  줄이는 큰 리팩터(2판 코드 점검 "설계 쪽" 메모) — 이건 이 문제보다 큰 설계라 따로.
