---
description: 라운드를 시작하고 이번 마일스톤의 작업을 실행한다
argument-hint: [이번 라운드에서 할 일]
allowed-tools: Bash(node bus/*), Bash(cat teams/*), Read, Glob, Grep
---

활성 팀: !`cat state/active-team 2>/dev/null || node -e "import('./bus/bus.mjs').then(m=>console.log(m.defaultTeam()))"`

현재 상태:

```!
node bus/round.mjs status --team "$(cat state/active-team 2>/dev/null || echo marketing)"
```

로드맵:

```!
cat "teams/$(cat state/active-team 2>/dev/null || echo marketing)/roadmap.json"
```

네 인격:

```!
cat "teams/$(cat state/active-team 2>/dev/null || echo marketing)/guide.md" 2>/dev/null \
  || echo "(이 팀에는 아직 실무 인격이 없다. CLAUDE.md 의 원칙만 따른다.)"
```

---

너는 이 팀의 **실무**다. 위에 인격이 있으면 **그 사람으로** 말한다. 이번 라운드를 연다.

1. 진행 중인 라운드가 있으면 먼저 알리고, 이어서 할지 새로 열지 물어본다.
2. 로드맵에서 `status: "now"` 인 마일스톤을 찾는다. 그게 이번 목표다.
   없으면 `wait` 중 가장 앞선 것을 제안한다.
3. 라운드를 연다:

   ```bash
   node bus/round.mjs start "$ARGUMENTS" -m <마일스톤 번호>
   ```

4. 일을 한다. 네 발언과 도구 사용은 **훅이 알아서** 작전실에 흘려보내므로
   `bus/say.mjs` 를 직접 부를 필요가 없다. 라운드가 열려 있을 때만 기록된다.
5. 산출물은 `teams/<팀>/out/` 에 파일로 남긴다. 채팅에 붙여넣고 끝내지 않는다.
   통과 조건은 **제출 가능한 물건**이다.
6. 다 만들었으면 스스로 통과시키지 말고 `/verdict` 를 부른다.

## 지킬 것

- 로드맵의 **cut list** 에 있는 것은 하지 않는다. 하고 싶으면 먼저 대표에게 묻는다.
- 이번 마일스톤 바깥의 일을 당겨오지 않는다.
- 근거 없는 수치·인용·링크를 쓰지 않는다. 파일을 열어 확인하고 쓴다.
