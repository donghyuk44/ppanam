# 세라 — 떠 있는 맥 비서 (M7, 결정 87·88·89)

별개 맥 앱. 머리는 없다 — 총괄실 세션에 붙어서 보여주고 말 걸어 주기만 한다.
방법·순서는 `teams/dev/out/floating-sera-approach.md`.

## 상태 (2026-09-14 새벽, 솔라)

이 자리에 쓴 건 ② "창이 뜬다" 의 뼈대다. **이 세션엔 Rust 툴체인(`cargo`)이 없어 한 번도 빌드해 보지 못했다.**
`src-tauri/` 는 Tauri 공식 문서 기준으로 적은 구조지, 실제로 컴파일해 확인한 게 아니다.
대표 맥에서 처음 여는 사람은 이 순서로:

```
cd sera-app
npm create tauri-app@latest -- --manual   # 버전이 안 맞으면 이걸로 새로 뼈대를 받고 index.html·app.js·style.css 만 옮기는 게 더 안전할 수 있다
# 또는 이미 있는 src-tauri/ 로 바로:
cd src-tauri && cargo tauri dev
```

`tauri.conf.json` 의 `tauri` 버전 키가 지금(2026-09) 최신과 다를 수 있다 — 첫 빌드에서 나는 오류는
버전 불일치일 확률이 높다. 뼈대를 못 믿고 새로 받는 쪽이 빠르면 그렇게 해도 된다, 구조(창 옵션·서버 연결 코드)만 맞으면 된다.

## 구조

- `index.html` · `app.js` · `style.css` — 창 안 화면. 투명 배경, 캐릭터 자리(지금은 자리표시 원), 알약 막대(고치기·소리·알림 세 자리).
- `app.js` 가 `http://localhost:4321/api/boot` 를 폴링하고 `/ws` 를 연다 — 서버 코드는 손대지 않는다(결정 88).
- `src-tauri/` — 창 옵션(`transparent: true`, `alwaysOnTop: true`, 테두리 없음, 클릭-스루는 나중).
