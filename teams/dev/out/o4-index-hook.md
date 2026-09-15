# O4 — index.mjs 에 runMorning 훅 삽입 위치

`server/index.mjs` 는 직접 고치지 않았다(다른 사람이 건드리는 중이라 읽기만 하라는 지시). 여기 적은 줄 번호로 `runMorning` 을 부르는 사람이 대신 넣을 것.

줄 번호는 2026-09-16 이 시점(`server/nightly.mjs` 에 `runMorning` 추가한 커밋) 기준 — grep 으로 `runNightly({ session })` 를 다시 찾아 확인할 것, 그 사이 다른 사람이 index.mjs 를 고쳤으면 줄 번호가 밀려 있을 수 있다.

## 1. import 문 — 27행

지금:
```js
import { runNightly, yesterdayKey } from './nightly.mjs';
```
바꿀 것:
```js
import { runNightly, yesterdayKey, runMorning } from './nightly.mjs';
```

## 2. setInterval 안 — 780행 근처(`runNightly({ session })` 줄 바로 다음)

지금(779~780행):
```js
  // 자정 마감(M7) — 날짜가 바뀌어 있으면 지난 하루를 팀마다 한 장 + 대표용 한 장으로. 안에서 겹침·오류를 스스로 막는다(한 날 한 번).
  runNightly({ session }).catch((e) => console.error('nightly:', e.message));
```
바로 아래 한 줄 추가:
```js
  // 아침 한 장(M4 · 결정 140 ④ · 경영 req_e27af3c5) — 06:30(우리 시각) 이 지났으면 지난 06:30 이후를 한 장으로. 자정과 같은 스위치·같은 겹침 방지 뼈대.
  runMorning({ session }).catch((e) => console.error('morning:', e.message));
```

## 참고

- `runMorning` 은 `runNightly` 와 자리를 맞추려고 `session` 을 인자로 받지만(자정 마감의 톰 일지 호출과 같은 모양), 실제로는 정적 요약이라 세션을 쓰지 않는다 — 인자를 안 줘도 동작한다.
- 파일은 `teams/hq/out/daily/<날짜>.md` 에 쓴다. `server/index.mjs` `/api/report` 라우트(382~383행 부근, `dayKey`·`chief` 변수)가 이미 이 정확한 경로를 읽고 있다 — 그 라우트는 안 건드려도 된다. `runMorning` 이 이 파일을 채우기 시작하면 `/api/report` 의 `chief` 필드가 자동으로 그 내용을 실어 나른다.
- 그날 손으로 먼저 쓴 파일이 있으면(예: 2026-09-16.md, 유진·세라가 손으로 씀) 덮어쓰지 않고 `<날짜>-자동.md` 로 대신 쓰고 총괄실에 note 를 남긴다 — `/api/report` 는 원래 경로만 읽으므로 그 날은 자동 판이 화면에 안 실린다(의도된 것 — 손 글을 밀어내지 않는다).
- 게이트: `state/nightly.json` 의 `{ "on": true }` 스위치를 자정 마감과 공유한다. 지금은 그 파일이 없어(기본 꺼짐) `runMorning` 을 매 틱 불러도 실제로는 아무것도 안 쓴다. 켜는 결정은 대표 몫.
