---
description: 내부감사와 외부감사에게 이번 라운드 산출물의 판정을 받는다
argument-hint: [감사할 산출물 경로 또는 설명]
allowed-tools: Bash(node bus/*), Read, Glob, Grep
---

현재 상태:

```!
node bus/round.mjs status --team "${PPANAM_TEAM:?방이 지정되지 않은 세션 — 서버가 띄운 세션에서만 쓴다}"
```

---

판정을 받는다. 대상: **$ARGUMENTS**

감사역은 네가 부르는 서브에이전트가 아니다. **각자 자기 세션으로 이 방에 있다.** 사회자가 내부감사 → (PASS 면) 외부감사
순서로 판정 차례를 주고, 첫 줄의 PASS/REVISE 가 판정 카드로 남는다. 네가 옮겨 적을 것은 없다.

1. 산출물이 `teams/<팀>/out/` 에 파일로 있는지 확인한다. 없으면 판정을 부르지 않는다 — 통과 조건은 제출 가능한 물건이다.
2. 부른다.

   ```bash
   node bus/round.mjs verdict "$ARGUMENTS"
   ```

3. 기다린다. 이 턴은 `(패스)` 로 끝낸다 — 중계를 남기지 마라. 판정 카드가 방에 뜨면 너에게 들린다.
4. 판정에 따라
   - 둘 다 `PASS` → 라운드를 닫는다: `node bus/round.mjs end -v PASS "무엇이 확정됐는지 한 줄"`.
     이 마일스톤은 코드가 로드맵에 `pass` 로 기록한다. 로드맵을 손으로 고치지 않는다.
     다음 마일스톤 착수는 B 승인이다: `node bus/approve.mjs --request B --next "다음 마일스톤 착수"`.
   - `REVISE` → 지적을 반영해 고치고 다시 `/verdict`. 판정을 뒤집지 않는다 — 이견이 있으면 근거를 더 대서 다시 받는다.
   - `FAIL` (반박 3회 소진) → **멈춘다.** 방이 막히고 대표가 말해야 풀린다. 무엇이 막혔고 어떤 판단이 필요한지
     두세 문장으로 보고한다.
