# 훅 두 줄 — meta.hand:'server' (C16, 대표 손 — .claude/ 는 대표만)

**정본은 `tools/patch-hook-hand-0916.mjs`다** — 이 파일이 먼저 있었고, `actor === 'system'` 일 때만
`hand: 'server'` 를 찍는다(나리 결정 09-16: 계약 173행·app.js 641행이 system 만 읽으므로 세라까지
넓히는 건 나중에 계약 줄과 같이 따로). 대표님이 저장소 루트에서 아래 한 줄만 돌리면 된다.

```bash
node tools/patch-hook-hand-0916.mjs
```

- 두 줄이 정확히 한 번씩 있을 때만 바꾸고, 아니면 아무것도 안 건드리고 멈춘다.
- 이미 고쳐져 있으면("hand: 'server'" 가 이미 있으면) 그냥 "이미 고쳐져 있음" 이라 하고 끝난다 — 두 번 돌려도 안전.
- 원본은 `.claude/hooks/to-bus.mjs.bak-0916` 으로 남는다.

## 확인

```bash
grep -n "hand: 'server'" .claude/hooks/to-bus.mjs
```

두 줄이 나오면 된 것. `node --check .claude/hooks/to-bus.mjs` 로 문법도 한 번 더 확인하면 좋다.
그 뒤 서버 재시작.

## (지난 판, 이제 안 씀)

이 문서의 이전 판은 python3 한 줄로 모든 화자에 `hand:'server'` 를 찍는 안이었다 — 나리가 좁게
가기로 정해서(actor==='system' 만) 위 도구로 정리했다. python 안은 필요 없다.
