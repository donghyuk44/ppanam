# N3 — 로밍 자리 기록 설계 (솔라, 세라 검수 전)

## 문제 (대표 13:2x "설계미스인거지. 개선안 찾아봐")

나리·세라(system·secretary)는 집(hq·sera) 세션 하나로 어느 방에서든 불린다(N1, ROAM). 다른 방에서
불리면 `server/conductor.mjs callHomeElsewhere` 가 집 세션에 묻고, 답이 오면 **부른 방에** 직접
`emit(team, {...meta:{via:home}})` 으로 남긴다 — 여기까지는 맞다.

문제는 그 답을 낸 세션의 훅(`.claude/hooks/to-bus.mjs` Stop)이 **독립적으로 또** 집 대화록에 같은
말을 남긴다는 것 — 훅은 세션의 `PPANAM_TEAM` 환경(늘 집)만 보고 기록하므로, callHomeElsewhere 가
부른 방에 이미 남긴 것과 별개로 집에도 원본이 쌓인다. 접힘(테라 e64a40d)과 표시(솔라 610fea7,
meta.roam)로 화면은 가렸지만, **대화록 자체에 원본이 두 벌**인 것은 그대로다 — 대표가 총괄실에서
그 원본 줄을 그대로 봤다("왜 개발 방에 답한 게 여기 있어" 류).

## 고칠 것 — 원본은 그 방에만

`turn.kind === 'called' && turn.extra`(로밍 답 — server/conductor.mjs 가 이미 이 표시로 구분해 둠, 솔라
610fea7)면 훅이 **그 자리에서 빠진다**(bail) — callHomeElsewhere 가 이미 부른 방에 정본을 남겼으니
집 쪽에서 또 남길 이유가 없다. meta.roam 표시·접힘 부품(app.js foldBubble)도 이제 쓸 데가 없어진다
— 원본이 애초에 하나뿐이라서.

## system 도 cast 의 자리 하나로 (세라 예)

지금 코드 아홉 군데가 `actor === 'system'`을 따로 뺀다(peopleOf·crossPost·addressees·훅…, 점검-코드리뷰
-0916 #설계). 자리를 하나 더 늘릴 때마다(예: 나중에 다른 로밍 자리) 아홉 곳을 또 손대야 한다는 뜻이다.

이 설계는 그 아홉 곳을 하나로 줄이자는 게 아니다 — 대부분은 "총괄실·대표 말은 특별하다"는 진짜
규칙(예: crossPost 가 대표 말은 안 옮기는 것)과 얽혀 있어 억지로 합치면 다른 규칙이 깨진다. 대신
**원칙 하나**만 세운다: 자리가 "로밍이냐 아니냐"는 `ROAM_HOME`(지금 conductor.mjs, `{system:'hq',
secretary:'sera'}`) 하나로만 묻는다 — `actor === 'system'` 처럼 이름을 직접 비교하는 곳을 보면 그때마다
`ROAM_HOME[actor]` 로 바꿀 수 있는지 본다. 지금 아홉 곳을 전부 훑어 바꾸는 건 이 카드의 범위 밖(코드
점검 문서가 "설계 쪽, 코드 밖"으로 이미 분리해 뒀다) — 새 코드를 쓸 때 지킬 원칙만 여기 적는다.

## 남는 일 — 세션이 새로 뜰 때의 맥락 (다음 카드)

로밍 세션은 개별 호출마다 부른 방의 최근 대화(`unheard(team, actor)`)를 그때그때 받는다 — 이건
이미 맞다(`callHomeElsewhere` 가 부른 방 기준으로 `unheard` 를 부른다). 비어 있는 건 **세션이 처음
뜨거나 다시 뜰 때**(`briefOf`) — 지금은 집 방(hq)의 상태만 보여줘서, 방금까지 다른 방에서 무슨 말을
했는지 그 세션 자신도 모른다.

제안: `briefOf` 가 집 방일 때, "오늘 이 자리가 다른 방에서 한 마지막 말"을 방마다 한 줄씩 모아
붙인다(그 자리가 message 로 답한 것 중 오늘·그 방의 마지막 것). 구현하려면 `ROAM_HOME` 을
`server/conductor.mjs` 에서 `bus/bus.mjs` 로 옮겨야 한다 — `server/session.mjs` 가 `conductor.mjs` 를
가져오면 돌아 가져오기(conductor 가 이미 session 을 가져온다)가 생긴다. 이 이동 자체는 위험이
낮지만(값 하나 옮기는 것) 되짚어야 할 자리가 여럿이라(conductor.mjs 여러 곳·이 문서 위 훅 패치도
`turn.extra` 로 이미 방 이름을 알고 있어 영향 없음) 별도 카드로 뗀다.

## 순서

1. 훅 패치(위 "고칠 것") — 지금 바로, 위험 낮음, `tools/patch-hook-no-home-copy-0916.mjs` 로.
2. `ROAM_HOME` 을 bus.mjs 로 옮기고 `briefOf` 에 로밍 자취 절 추가 — 다음 카드.
3. 접힘 부품(app.js foldBubble)·meta.roam 표시는 1이 끝나면 더 안 쓴다 — 테라 쪽, 서두르지 않는다
   (옛 기록엔 이미 meta.roam 이 남아 있어 그 카드들만 접힘을 계속 쓴다, 지우지 않는다).
