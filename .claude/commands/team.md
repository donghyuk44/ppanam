---
description: 작전실을 바꾼다 (마케팅 / 개발 / 디자인 / 경영재무)
argument-hint: [marketing|dev|design|finance]
allowed-tools: Bash(node bus/*), Bash(cat state/*), Bash(echo *)
---

현재 팀 현황:

```!
node bus/round.mjs status
```

지금 활성 팀: !`cat state/active-team 2>/dev/null || echo "(설정 안 됨 — 기본값 사용)"`

요청받은 팀: **$0**

$0 가 비어 있으면 위 현황을 보여주기만 하고 멈춘다.
값이 있으면 `state/active-team` 에 그 값을 적는다 (훅이 이 파일을 읽어 어느 작전실에
기록할지 정한다). 없는 팀 이름이면 있는 팀 목록을 알려주고 바꾸지 않는다.
