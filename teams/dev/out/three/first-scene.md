# M5 — 마을 그림을 Three.js 로, 첫 화면 (인형 서울)

2026-09-14 · R24 · 쓴 사람 테라. 판정 레오(폰 폭 412 에서 직접 봄).
커밋 723d66b → b308947 → 39bdbe0 → 5e344c9 → 5ca4d65 → 61c2d89 → 6bfa1f6(부품 저장소에) → 01e4ef1(EasyStar) → 3228bbc(팀 색 옷·컷어웨이). **판정 대상은 이 문서를 실은 커밋 하나** — 방에 SHA 로 적는다.
레오 첫 REVISE(61c2d89 판)에서 "다음" 으로 미뤄 둔 넷(팀 색 옷·EasyStar·컷어웨이·부품 추적)을 전부 넣었다 — 셋은 M5 통과 조건이었고, 부품이 저장소 밖이면 새로 받은 HEAD 는 상자였다.
그림: `out/shots/r26-village-day-wide-412.png`(낮, 마을 전체) · `r26-village-day-412.png`(낮, 기본 배율) · `r26-village-inside-day-412.png`(회사 안) · `r25-village-night-412.png`(밤) · `r27-village-cutaway-412.png`(낮 "화면 크게" — 집이 잘려 안이 보임) · `r27-village-inside-team-412.png`(회사 안 "화면 크게" — 팀 색 옷). 하네스가 헤드리스 크롬(swiftshader)으로 412 폭에서 찍었다.
**보기 전에 새로 고침 한 번** — 옛 `world.js` 가 브라우저에 남아 있으면 `pathfinder` 가 `bfs` 로 나온다(하네스가 겪음).

## 무엇을 바꿨나

| 자리 | 전 | 후 |
| --- | --- | --- |
| 그림 | `world.js` 안의 canvas 2D — 젤다 CC0 타일 시트 + 32×48 캐릭터 시트 | `world/draw3d.js` — Three.js 0.170.0(jsDelivr importmap). WebGL 캔버스 + CSS2D 글 층 |
| 부품 | png 타일 | Kenney CC0 glTF 25개(`assets/kenney/`, GLTFLoader) + 코드로 짓는 도형(한옥·남산타워·다리·분수·회사 안) |
| 카메라 | 스크롤 | `OrthographicCamera` 35°/30°(city.json `camera`) + `MapControls` 끌기·휠·핀치(결정 13 의 줌은 여기서). 회전 없음 |
| 이름표·말풍선·방 이름·띠 | 지도 px 좌표에 절대 배치 | `CSS2DObject` — 사람 머리 위 기둥(`.wv-tag`)에 이름표 + 말풍선이 쌓임. 멀리서는(칸 < 10px) 이름표 숨김 |
| 빛 | 밤·저녁은 캔버스 위 반투명 덮개 | `HemisphereLight` + 그림자 있는 `DirectionalLight`(PCFSoft 2048). 밤·저녁은 빛·배경 값만 바뀜(parts.json `light`) |
| 클릭 | 캔버스 px 맞춤 | 발·머리를 화면에 비춰 그 사이(드래그 6px 넘으면 클릭 아님) |
| 길찾기 | `bfs()` | EasyStar.js 0.4.4(jsDelivr, 전역) — 같은 격자·4방향, 출발·목표가 막힌 칸이어도 bfs 와 같은 규칙. CDN 이 안 오면 bfs 그대로(`snapshot().pathfinder`) |
| 팀 색 옷 | 시트를 팀 색으로 물들임 | colormap 한 장을 사람마다 복사해 **몸통 높이(35~62%)의 삼각형이 가리키는 색 띠 하나**(윗옷)만 팀 색으로 — 살·머리는 그대로. 디자인 colormap 이 오면 그것이 이김. `shirts:15` |
| 컷어웨이 | 없음 | 지붕 층 있는 건물(집 14·찻집·가게 3)은 칸 ≥ 22px 로 확대하면 **위(y 1.7)와 앞반**이 잘려 안이 보임 — 바닥·침대(팀 색 이불)·책상·의자·등. `cutaway:true` |

**그대로인 것 (결정 16)** — 서버 계약(`/api/*`, ws `world`·`events`·`summaries`) · 걷기(bfs·tick·detour·gather·fidget) · 시계 → 자리(applyWorld) · 연출(handle·approvalScene·lamp·setBlocked) · 재생(play·replay·step) · 카드(openCard) · 말 걸기 · `snapshot()`. `world.js` 에서 바뀐 것은 그리기 호출 뿐이고, 좌표계(px = 칸 × 32)도 그대로다.
덤으로 고친 옛 버그 하나: `banner()`·`replay()` 가 `sc.name`(map.json 에 없는 값)을 봐서 방 위 띠가 한 번도 안 떴고 재생 때 장면이 안 바뀌었다 — scenes 의 키로 고침.

## 파일 셋 — 계약 (`out/village-file-contract.md` 2판)

- `server/public/world/city.json` — **무엇이 어디에.** 서울 한 장: 바닥(잔디·광장·길·한강), 집 열넷 + 찻집 + 가게 셋(부품 이름 + 자리 + 팀 + 간판 글자), 랜드마크 다섯(근정전=회사·댄의 집=한옥, 남산타워, 한강 다리, 분수), 소품(나무 27·화분 9·담 4). 다른 도시는 이 파일만 새로 쓴다(결정 57).
- `server/public/world/parts.json` — **부품이 무엇이고 어떻게 고치나.** Kenney 세 세트 경로, 부품 14(`size` 는 `kenney-bbox.json` 원본, 배율 1.39 하나), 수정 표 셋(`roof-tile` 우진각 지붕 층 · `door-team` 팀 색 문 · `sign` 한글 간판), 색 21, 빛(낮·저녁·밤), 인형 열여섯(헨리 `characters.json` 그대로, `colormap` 은 null).
- `bus/round.mjs check` 에 대조 1건 — city 가 부르는 부품·수정 표가 parts 에 있고, parts 가 가리키는 glb 가 디스크에 있고, `map.cast` 의 자리마다 인형이 있는지. 63건 ✓.

## 실측 (하네스, 진짜 브라우저 콘솔, 새로 고침 뒤)

마을 `W.snapshot().draw` → `{engine:"three", scene:"village", glbLoaded:25, glbFailed:0, placeholders:0, shirts:15, cutaway:true}` · `pathfinder:"easystar"`
회사 → `{scene:"castle", glbLoaded:12, glbFailed:0, placeholders:0, shirts:15, cutaway:true}` · `pathfinder:"easystar"`. 부품 전부 진짜 모델, 상자 0. 부품 241개는 저장소 안(6bfa1f6).
GPU 없는 헤드리스에서 열면 조용히 빈 화면이 아니라 `마을을 못 불러왔습니다 — Error creating WebGL context.` 가 뜬다(`load()` 의 import 실패 경로). CDN 이 죽어도 `app.js` 는 산다 — `draw3d.js` 는 `import()` 로 늦게 부른다.

## 서울다움 다섯 (결정 57 ②) — 들어간 것

기와 우진각 지붕 층(청회색 `#7a8797`, 집 열넷 + 찻집 + 가게) · 한글 간판(`sign` 수정 표, 집마다 팀 이름 또는 사람 이름) · 좁은 골목(집 셋 사이 0.5 칸, 화분·계단 자리) · 남산(언덕 + 기둥 + 전망대 + 안테나) · 한강(z 26~30) + 다리(아치 둘).

## 아직 아닌 것 — 정직하게 (통과 조건 밖)

1. **집 열넷의 벽·창은 Kenney 원색 그대로** — 회색·파랑 유리창이라 지붕 빼면 서양 아파트로 읽힌다(하네스도 같은 말). 색은 세트 전체가 `colormap.png` 한 장이라 **디자인 M3(건물 키트 실물)가 우리 색 colormap 을 주면 갈아 끼운다**. 계획대로 "디자인 파일이 오기 전엔 Kenney 원본" 이다.
2. **인형의 살·머리·아래옷은 Kenney 원색** — 윗옷만 팀 색이다(위 표). 부착물(안경·선글라스·갓·리본)은 아직 안 붙였다. 열다섯 장 colormap(헨리 계획 4절)이 오면 사람마다 통째로 갈아 끼운다.
3. **인형이 보는 방향** — 모델이 +z 를 본다고 가정(`FACE`). 틀리면 상수 하나.
4. **카메라 각 둘**(35°·30°)은 참고 그림 눈대중 — 헨리와 정한다.
5. **잘린 집 안이 어둡다** — 남은 벽이 그림자를 던져서. 가구는 있지만 폰 폭 그림에선 작다. 빛 하나 더 두는 건 헨리 색이 온 뒤.
6. 폰 폭에서 대표 차례 카드가 화면 반을 먹어 무대가 280px 였다 → 마을 탭·폰 폭에서만 카드 높이 132px 로 잡았다(카드는 그대로 뜬다, 결정 20). 다른 탭은 안 건드렸다.

## 8줄 채점표 앞에서 (결정 56 — 전체 인상이 먼저)

낮 전체 그림(`r26-village-day-wide-412.png`)은 둥근 받침 위 장난감 마을 — 한옥 큰 채, 기와 지붕 집 줄, 강과 다리, 언덕 위 탑, 부드러운 그림자. **"서울로 읽히는 한 장"** 은 남산·한강·한옥으로 서고, 골목 집들은 아직 서양 아파트다 — 그건 부품 색이고 디자인 M3 의 일이다. 채점은 레오.

## 다음 (M5 안이 아님)

디자인 M3 colormap 꽂기 · 인형 colormap 열다섯 · 부착물 · 잘린 집 안 빛 · 헨리와 카메라 각 · 남산타워 도형이 마음에 안 들면 그때 생성 서비스(결정 55, C).
