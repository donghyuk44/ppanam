# P2 — `node tools/…` 맨 명령이 막히는 원인 (32회차, 솔라)

권한-현황-0916.md 3절 1번 — "팀 세션이 `node tools/…` 를 맨 명령으로 돌려 되는지, 안 되면 거부문 그대로 — 원인 확정."

## 실측

`cd` 없이, 절대 경로 없이, 저장소 루트에서 그대로 돌렸다.

| 명령 | 결과 |
| --- | --- |
| `node tools/boss-words-check.mjs` | 막힘 — "This command requires approval" |
| `node tools/library.mjs toc` | 막힘 — 같은 거부문 |
| `node bus/approve.mjs --help` (대조) | 통과 |
| `node --check server/usage.mjs` (대조) | 통과 |

안젤·하영의 06:44 실측(권한-현황-0916.md 2절)과 같은 증상 — "명령 앞에 cd 나 절대 경로"가 원인이라는 추정은 틀렸다. **맨 명령이어도 막힌다.**

## 원인

`.claude/settings.json` 의 허용 줄:

```
"Bash(node tools/:*)"
```

이 줄만 디렉터리 접두어(`tools/`) 뒤에 파일명 없이 콜론이 바로 온다. 다른 모든 줄은 파일명까지 적혀 있다 — `Bash(node bus/say.mjs:*)`, `Bash(node bus/approve.mjs:*)` 처럼. 실제 명령은 `tools/` 바로 뒤에 공백 없이 파일명이 붙는다(`tools/boss-words-check.mjs`) — `tools/` 뒤에 공백이 오는 형태(`node tools/ <뭔가>`)는 애초에 존재할 수 없는 명령이라, 이 규칙은 어떤 실제 명령과도 안 맞는다. `cd:*` · `mkdir:*` · `cp:*` 처럼 경로가 안 붙는 맨 명령 접두어는 되고, 파일명이 필요한 디렉터리 접두어(`tools/`)만 이 형태로 못 맞는다.

## 고칠 것 (대표 손 — settings.json 은 분류기가 나리를 막는다)

`.claude/settings.json` 25번째 줄을

```
"Bash(node tools/:*)"
```

에서

```
"Bash(node tools/*)"
```

로(콜론 없이 별표를 슬래시 바로 뒤에) 바꿔 주십시오. `tools/` 밑 어떤 파일이 와도 맞습니다 — 지금처럼 스크립트마다 한 줄씩 추가할 필요가 없어집니다.
