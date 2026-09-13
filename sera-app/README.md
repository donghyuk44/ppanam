# 세라 — 떠 있는 맥 비서 (M7, 결정 87·88·89)

별개 맥 앱. 머리는 없다 — 총괄실 세션에 붙어서 보여주고 말 걸어 주기만 한다.
방법·순서는 `teams/dev/out/floating-sera-approach.md`.

## 상태 (2026-09-14 새벽, 솔라)

**오늘 밤은 Electron 으로 간다.** 이 맥에 Rust(`cargo`) 가 없고, 대표가 주무시기 전 마지막 말이
"아침에 세라가 반겨주면 좋겠다" 였다 — 설치 승인을 기다리면 아침에 못 뜬다. Tauri 는 껍데기만 다시 짜면 되는
빚으로 남겨 둔다(아래 `src-tauri/` 그대로 둠).

아침에 처음 여는 사람은:

```
cd sera-app
npm install
npm start
```

`main.js` 가 창을 연다(투명·테두리 없음·늘 위·크기 고정, 그림자 없음). 화면(`index.html`·`app.js`·`style.css`)은
Tauri 로 옮길 때도 그대로 쓴다 — `-webkit-app-region: drag` 는 Electron 용, `data-tauri-drag-region` 은 Tauri 용으로 같은 파일에 같이 뒀다.

### 나중에 Tauri 로 옮길 때

`src-tauri/` 는 Tauri 공식 문서 기준으로 적은 구조지, 실제로 컴파일해 확인한 게 아니다. `cargo` 가 생기면:

```
cd sera-app/src-tauri && cargo tauri dev
```

`tauri.conf.json` 의 버전 키가 그때 최신과 다를 수 있다 — 안 되면 `npm create tauri-app@latest` 로 새로 받아
`index.html`·`app.js`·`style.css`·창 옵션만 옮기는 게 더 빠를 수 있다.

## 구조

- `index.html` · `app.js` · `style.css` — 창 안 화면. 투명 배경, 캐릭터 자리(지금은 자리표시 원), 알약 막대(고치기·소리·알림 세 자리).
- `app.js` 가 `http://localhost:4321/api/boot` 를 폴링하고 `/ws` 를 연다 — 서버 코드는 손대지 않는다(결정 88).
- `src-tauri/` — 창 옵션(`transparent: true`, `alwaysOnTop: true`, 테두리 없음, 클릭-스루는 나중).
