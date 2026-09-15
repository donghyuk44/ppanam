# Gemini(agy) 외부감사 다섯 자리 — 실전 확인

2026-09-14 · 솔라 · R25. 테라가 나눈 셋 중 ① — 파일만 열어 확인, 코드는 안 건드렸다.

## 다섯 자리 표

| 팀 | 자리 | cast.json model | 실제 log.jsonl 마지막 engine | 상태 |
| --- | --- | --- | --- | --- |
| dev | 레오 | gemini | `gemini · gemini-3.6-flash` | 됨 — 판정·note 여러 건 |
| hq | 제리 | gemini | `gemini · gemini-3.6-flash` | 됨 — 승인 대조 PASS 포함 |
| marketing | 다니엘 | gemini | `gemini` (모델 이름 없이) | 됨 — PASS 1건(00:46:06Z = 09:46 KST), 안젤 판정과 같이 통과 |
| design | 마크 | gemini | `codex · gpt-5.6-sol` (안 바뀜) | **아직 안 불림** — cast 는 바뀌었는데 이 자리로 부른 기록이 없다 |
| finance | 빅터 | gemini | (log 에 engine 필드 없음) | **아직 응답 없음** — `state/outside-sessions.json` 엔 세션이 잡혔다(아래) |

## `state/outside-sessions.json` — 지금 잡힌 세션

```
hq:      id a0580dca-… · engine gemini
dev:     id 15a73ed5-… · engine gemini
finance: id 50721942-… · engine gemini
```

**marketing 이 빠져 있다.** 다니엘이 위 표에서 실제로 PASS 를 냈는데도 이 파일엔 키가 없다 — `remember()` 가 안 불렸거나 그 뒤 `forget()` 됐다는 뜻인데, 로그에 세션을 버렸다는 note 는 없다. 다음 호출 때 새 conversation 으로 시작할 가능성이 있다 — 이어붙이기가 끊긴 채로 갈 수 있으니 확인이 더 필요하다.

**두 번째 호출이 같은 conversation id 로 이어가는지**는 이 파일 하나로는 못 본다 — `id` 는 최신 값만 남고 이전 값과 비교할 이력이 없다. hq·dev 둘 다 지금 값 하나뿐이라 "이어갔다"를 확정 못 한다. 확인하려면 다음 호출 전후로 이 파일을 다시 열어 `id` 가 같은지 보는 수밖에 없다.

## 엔진 표기 차이

marketing 만 `gemini`(모델 이름 없이), 나머지는 `gemini · gemini-3.6-flash`. 기능은 됐지만 판정 카드에 찍히는 라벨이 자리마다 다르다 — 다니엘이 답할 때 cast.json 의 `geminiModel` 이 아직 없던 순간이었을 것. 지금 cast.json 은 다섯 자리 다 `geminiModel` 이 있으니 다음 호출부턴 맞게 나올 것으로 보이나, 실측은 다음 호출 때.

## 안 불린 자리

- **design(마크)** — cast 는 gemini 인데 최근 호출 기록이 없다. 도면·낱말 흐름이 design 방에서 계속 도는 중이라 자연히 안 불렸을 수 있다. 판정이 걸리면(REVISE 왕복 등) 그때 처음 gemini 로 갈 것 — 문제 생기면 그때 본다.
- **finance(빅터)** — 세션은 잡혔는데(`state/outside-sessions.json`) 로그엔 아직 응답이 없다. 요청 중이거나 방금 붙은 팀이라 처음 도는 걸로 보인다.

## 결론

셋(레오·제리·다니엘)은 실전에서 답했다 — Gemini 대체는 **부분적으로 확인됨**. 나머지 둘(마크·빅터)은 아직 안 불렸거나 응답 전이라 됐다고 말할 수 없다. session store 의 marketing 누락은 작은 구멍이라 도면 뒤 코드 고칠 때 같이 보면 될 것 — 지금 화면 작업을 막는 건 아니다.
