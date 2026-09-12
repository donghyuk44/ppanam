# 재생 픽스처

마을 탭의 통과 조건("마케팅 R14 를 재생하면 하영·안젤·다니엘이 제자리에서 순서대로 말한다")을 누구나 재현하기 위한 실물 대화록이다.
`marketing-r14.json` 은 메인 체크아웃 `teams/marketing/log.jsonl` 의 2026-09-01 R14 사건 21건을 그대로 옮긴 것이다(가공 없음).

    http://localhost:4321/?fixture=marketing-r14#marketing/world

로 열면 그 방에서 자동 재생된다. 화면 없이 확인하려면 브라우저 콘솔에서 `(await import('/world/world.js')).snapshot()`.
