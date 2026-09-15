# 작전실 화면 검수 — 클레멘타인

읽은 파일: `server/public/index.html`, `server/public/style.css`, `server/public/app.js`, `server/public/world/world.css`, `design/Main.dc.html`, `teams/*/cast.json`.
서버를 직접 띄워 눈으로 보지는 못했다(이 세션엔 node·curl 실행 권한이 없음) — 아래는 코드를 읽고 잰 것이다.

## 1. 실무 이름이 화면에서 사라진다 — `server/public/app.js:208, 221`

```
work.textContent = sess.queued ? `${office ? '톰' : '실무'}이 일하는 중 · 대기 ${sess.queued}` : `${office ? '톰' : '실무'}이 일하는 중`;
...
input.placeholder = office ? '톰에게 지시하기' : ... open ? '실무에게 지시하기' : ...
```

`office`(총괄실=hq) 만 실제 이름("톰")을 쓰고, 나머지 넷은 전부 "실무"로 굳어 있다. 같은 파일 34번 줄에 `who('guide').name` 이 이미 있어서 디자인팀이면 "헨리", 마케팅팀이면 "하영", 개발팀이면 "테라" 를 그대로 가져올 수 있는데 안 쓴다.
결과: 라운드 상태줄("○○이 일하는 중")과 입력창 placeholder("○○에게 지시하기") 가 다섯 팀 다 "실무"로 똑같이 보인다. 이 프로젝트가 세운 "살아있는 사람들" 이 이 두 자리에서만 역할 이름으로 되돌아간다.
디자인팀 파일이 아니라 손대지 않았다 — 개발팀(테라·솔라·레오) 몫으로 넘긴다.

## 2. 경영재무팀만 이름이 없다 — `teams/finance/cast.json`

다른 넷은 캐스팅이 끝나 있다: 마케팅 하영·안젤·다니엘, 개발 테라·솔라·레오, 디자인 헨리·클레멘타인·마크, 총괄실 톰·제리. 경영재무만 `guide/review/outside` 의 `name`·`initial` 이 아직 "실무"·"내부감사"·"외부감사"(이니셜 길·되·바) 그대로다. 1번과 겹쳐서 경영재무 방은 어느 자리를 봐도 이름이 안 뜬다.
이것도 디자인팀이 채울 자리가 아니다 — 경영재무팀에게 캐스팅 여부를 확인해야 한다.

## 3. 토큰은 시안과 그대로 맞다 (확인, 문제 아님)

`design/Main.dc.html` 의 색 값(`--ground #e7e0d3`, `--panel #fdfbf7`, `--seal #0f5b52`, `--me #ecc85e`, `--line #d6cdbb` 등)과 `server/public/style.css:10-34` 의 값이 전부 일치한다. 시안에서 그대로 가져왔다는 CSS 첫 줄 설명(1-2행)이 맞다.

## 4. 마을 탭 전환은 정상 (확인, 문제 아님)

`.world` 는 `world.css:3-6` 에서 기본 `display:none`, `data-view="world"` 일 때만 켜지고 room·side 를 숨긴다 — style.css 의 tower·analysis 전환과 같은 패턴. 빠진 줄인 줄 알고 잠깐 의심했는데 world.css 쪽에 따로 있었다.

## 5. QA 눈금 5개로 채점 (teams/design/out/reference-samples.md 6절)

코드를 읽고 잰 것이다. 실제 화면은 이 세션에 브라우저가 없어 못 봤다 — ⑤ 는 특히 대표 확인이 필요하다.

| # | 눈금 | 작전실 | 근거 |
| --- | --- | --- | --- |
| ① | 오른쪽 위에 종 + 배지가 있나 | **자리가 다르다** | `#bossBadge` 가 "대표 차례 N" 배지 역할을 하는데(`app.js:157-165`), 왼쪽 레일 위쪽 `.views` 줄에 텍스트 알약으로 있다(`index.html:32`). 네이버·ZEP 은 종 아이콘을 화면 오른쪽 위 고정 자리에 둔다 — 우리는 왼쪽, 아이콘도 아니고 글자다 |
| ② | 내 할 일이 첫 화면 위에 있나 | **있음** | `.approvals` 가 `grid-column: 1 / -1; grid-row: 1`(`style.css:84`) — 화면 맨 위 전체 폭, 어느 탭에서든 같은 자리. 네이버 오른쪽 위 카드·ZEP `나` 줄과 같은 역할, 자리는 우리가 더 낫다(가로 전체) |
| ③ | 한 항목이 카드 하나(누가·언제·무엇·반응)인가 | **셋만 한 카드, 반응은 따로** | 누가·언제(`name` 안에 이름+`hhmm(ts)`, `app.js:415-417`)·무엇(`bub`)은 한 줄기에 있다. 그런데 판정(반응)은 `.stamp` 가 스트림에 별도 카드로 떨어져 나온다(`style.css:308`) — 레딧 카드처럼 반응이 같은 카드 안에 안 붙어 있다 |
| ④ | 방/서비스 목록에 미확인 수가 붙나 | **있음** | `team__badge` 가 `unread[t.id]` 를 숫자로 표시(`app.js:135-136`), 대표 판단 필요 방은 "대표" 로 따로 표시. 눈금 통과 |
| ⑤ | 폰 폭에서 가로 넘침 없이 한 열인가 | **규칙은 있음, 실측 못 함** | `@media (max-width: 819px)` 에서 한 열로 접고 팀 목록은 `overflow-x: auto` 로 가로 스크롤 처리(`style.css:630-661`) — 넘침을 막으려는 의도는 읽힌다. 다만 네이버·레딧 둘 다 이 눈금에서 걸렸으니, 우리도 실제 412px 화면에서 한 번 열어 확인해야 안다. 이 세션엔 그 손이 없다 |

가장 손볼 만한 건 ①(종 자리)이다 — 네이버·레딧·ZEP 셋 다 오른쪽 위에 종을 두는데 우리만 왼쪽 텍스트다. ③(반응이 카드에 안 붙음)은 다음 순위.

## 남은 일

- 열다섯 정면 그림(out/sprites64/*.png) 최하단 줄·torsoX 실측: `tools/pixel/portrait-measure.mjs` 새로 짬. 이 세션엔 node 실행 권한이 없어 결과를 못 뽑았다 — 대표가 아래 명령을 돌려주면 받아서 정리한다.

```
node tools/pixel/portrait-measure.mjs teams/design/out/sprites64/{boss,design-guide,design-ops,design-outside,dev-guide,dev-ops,dev-outside,finance-guide,finance-outside,finance-review,hq-chief,hq-outside,marketing-guide,marketing-outside,marketing-review}.png
```
