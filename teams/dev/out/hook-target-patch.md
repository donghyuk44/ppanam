# 훅 한 줄 — 판정 기록의 대상(target) (작은 B apr_132205cc, 나리 PASS · 세라 조건 — 관리 창 손, `.claude/` 는 대표·관리 창만)

**정본은 `tools/patch-hook-target-0916.mjs`다** — 저장소 루트에서 아래 한 줄만 돌리면 된다. hook-hand-patch 와 같은 꼴.

```bash
node tools/patch-hook-target-0916.mjs
```

- 그 줄이 정확히 한 번 있을 때만 바꾸고, 아니면 아무것도 안 건드리고 멈춘다.
- 이미 고쳐져 있으면(`const targetSeat` 가 있으면) "이미 고쳐져 있음" 이라 하고 끝난다 — 두 번 돌려도 안전.
- 원본은 `.claude/hooks/to-bus.mjs.bak-target-0916` 으로 남는다. 훅은 이벤트마다 새로 돌아 **재시작 없음**.

## 무엇이 바뀌나 — 186행 (124행은 그대로)

지금(186행) — 대상이 `'guide'` 로 박혀 있어 솔라(ops) 것을 판정해도 테라 판정으로 적힌다:

```js
          try { bus.recordVerdict(team, { actor, verdict: v.verdict, text: trim(v.body), target: 'guide' }); }
```

바뀐 뒤(186~188행) — 차례에 저장된 요청 첫 줄(124행 `writeTurn` 의 extra = `⟦판정 요청⟧` 뒷글 200자)에서 `대상: <자리>` 를 읽는다:

```js
          // 대상은 요청 첫 줄의 '대상: <자리>'(bus.verdictInstruction — 작은 B apr_132205cc, 서로 감사 결정 125). 없으면 옛 차례라 guide — check 가 '대상 없는 요청 0건' 을 잰다
          const targetSeat = /대상:\s*(guide|ops|review|chief|secretary|system)\b/.exec(turn.extra ?? '')?.[1] ?? 'guide';
          try { bus.recordVerdict(team, { actor, verdict: v.verdict, text: trim(v.body), target: targetSeat }); }
```

124행은 그대로다 — 이미 요청 첫 줄을 통째로 저장하고 있어서(`bus.writeTurn(team, ME, kind, target, sid)`) 서명을 안 바꾼다. `?? 'guide'` 는 옛 차례(대상이 안 실린 것)만 위한 것.

## 값이 들어오는 쪽 — 버스(솔라, D1 뒤)

- `bus.verdictInstruction` 의 첫 줄 `⟦판정 요청⟧ out/x.md …` 에 ` · 대상: ops` 처럼 **자리 id** 를 싣는다(만든 사람의 자리 — 결정 125 서로 감사).
- `bus/outside.mjs` 563행도 `target: 'guide'` 고정이다 — 레오 길은 훅을 안 지나므로 거기도 같은 규칙으로(요청의 '대상:' 을 읽어 넘김).
- `round.mjs check` 에 '대상 없는 판정 요청 0건' 한 줄 — 세라 조건. 이게 서야 `?? 'guide'` 가 병을 조용히 잇지 않는다.

## 확인

```bash
grep -n "const targetSeat" .claude/hooks/to-bus.mjs
node --check .claude/hooks/to-bus.mjs
```

한 줄이 나오고 문법이 통과하면 된 것. 조각 사본 `teams/dev/out/_hook-target-copy.mjs` 에 같은 스크립트를 먼저 돌려 확인했다(12행, `node --check` 통과).
