---
description: 내부감사와 외부감사를 불러 이번 라운드 산출물을 감사한다
argument-hint: [감사할 산출물 경로 또는 설명]
allowed-tools: Bash(node bus/*), Read, Glob, Grep
---

현재 상태:

```!
node bus/round.mjs status --team "$(cat state/active-team 2>/dev/null || echo marketing)"
```

이번 라운드 컨텍스트:

```!
node bus/round.mjs context --team "$(cat state/active-team 2>/dev/null || echo marketing)"
```

외부감사: !`node bus/outside.mjs --status 2>&1 || true`

이 팀의 감사역:

```!
T=$(cat state/active-team 2>/dev/null || echo marketing)
if [ -f ".claude/agents/$T-review.md" ]; then echo "내부감사 → $T-review"
elif node -e "const a=require('./teams/'+process.argv[1]+'/cast.json').agents; process.exit(a.review?0:1)" "$T" 2>/dev/null; then echo "내부감사 → review (공용)"
else echo "내부감사 → **없음.** 이 팀은 외부감사만으로 판정한다"; fi
echo "외부감사 → node bus/outside.mjs --team $T --ask ..."
```

---

감사를 돌린다. 대상: **$ARGUMENTS**

**내부감사는 서브에이전트, 외부감사는 CLI 다.** 외부감사는 다른 회사 모델이라
서브에이전트로 띄울 수 없다 — 별도 프로세스로 돌고 자기 말을 직접 작전실에 남긴다.
**네가 외부감사의 답을 옮겨 적지 마라.** 옮기는 순간 그건 다시 클로드의 말이 된다.

1. **내부감사**를 Agent 툴로 부른다(이름은 위 참조). 산출물 경로와 이번 마일스톤의
   통과 조건을 함께 넘긴다.
2. 내부감사가 `PASS` 를 냈으면 **외부감사**을 부른다.

   ```bash
   node bus/outside.mjs --ask "<검증할 것. 산출물 경로와 통과 조건을 함께>"
   ```

   외부감사가 판정을 첫 줄에 내면 그대로 대화록에 기록된다. 네가 할 일은 없다.
   클로드 둘이 합의한 지점이야말로 외부 시각가 필요한 곳이기 때문이다.
   내부감사가 `REVISE` 를 냈으면 외부감사는 건너뛰고 고치는 게 먼저다.
3. 두 판정을 종합한다.
   - 둘 다 `PASS` → 라운드를 닫는다.

     ```bash
     node bus/round.mjs end -v PASS "무엇이 확정됐는지 한 줄"
     ```
     그리고 `teams/<팀>/roadmap.json` 에서 그 마일스톤을 `pass` 로,
     다음 것을 `now` 로 바꾼다.
   - 하나라도 `REVISE` → 지적을 반영해 고치고 다시 `/verdict`.
   - `FAIL` (반박 3회 소진) → **고치려 들지 말고 멈춘다.** 대표에게
     무엇이 막혔고 어떤 판단이 필요한지 두세 문장으로 보고한다.

## 지킬 것

- 감사역이 낸 판정을 네가 뒤집지 않는다. 이견이 있으면 근거를 더 대서 다시 받는다.
- 외부감사가 "설정 안 됨"이라고 하면 **그 사실을 작전실에 남긴다.**
  교차검증 없이 통과시켰다는 기록이 남아야 한다.
