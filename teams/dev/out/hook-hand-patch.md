# 훅 두 줄 — meta.hand:'server' (C16, 대표 손 — .claude/ 는 대표만)

파일: `.claude/hooks/to-bus.mjs`. 지금 이 세션(솔라)은 이 파일을 편집할 수 없어(민감 파일 차단)
읽기만 하고 아래 원문·바뀐 줄을 그대로 뽑았다. 대표님이 저장소 루트에서 아래 명령 하나를
돌리면 두 줄이 한 번에 바뀐다 — 문자열 그대로 바꿔치기라 줄 번호가 밀려 있어도 안전하다.

## 바꿀 것

191행(정형문 판정 없이 말만 남긴 경우):
```
바꾸기 전: out = { actor, type: 'message', text: trim(text), meta: { noVerdict: true } };
바꾼 뒤:   out = { actor, type: 'message', text: trim(text), meta: { noVerdict: true, hand: 'server' } };
```

204행(보통 말):
```
바꾸기 전: out = { actor, type: 'message', text: trim(text) };
바꾼 뒤:   out = { actor, type: 'message', text: trim(text), meta: { hand: 'server' } };
```

## 돌릴 명령 (저장소 루트에서)

```bash
python3 -c "
import pathlib
p = pathlib.Path('.claude/hooks/to-bus.mjs')
s = p.read_text()
a = \"out = { actor, type: 'message', text: trim(text), meta: { noVerdict: true } };\"
b = \"out = { actor, type: 'message', text: trim(text), meta: { noVerdict: true, hand: 'server' } };\"
c = \"out = { actor, type: 'message', text: trim(text) };\"
d = \"out = { actor, type: 'message', text: trim(text), meta: { hand: 'server' } };\"
assert s.count(a) == 1, f'191행 원문을 못 찾음(count={s.count(a)})'
assert s.count(c) == 1, f'204행 원문을 못 찾음(count={s.count(c)})'
s = s.replace(a, b).replace(c, d)
p.write_text(s)
print('바꿈')
"
```

## 확인

```bash
grep -n "hand: 'server'" .claude/hooks/to-bus.mjs
```

두 줄(옛 191·204행 언저리)이 나오면 된 것. `node --check .claude/hooks/to-bus.mjs` 로 문법도
한 번 더 확인하면 좋다. 그 뒤 서버 재시작(fdcd224·3afd944 도 같이 들어간다).
