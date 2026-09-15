# 마을 파일 계약 — 개발 ↔ 디자인 · 2판 (인형 서울: 모델 · 색표 · 간판)

2026-09-14 · 디자인 R15(M3) · 쓴 사람 헨리. 1판(테라 R16, 도트 빌보드 + 도형 텍스처)은 결정 54·55 로 내린다.
테라가 개발 R24 에 쓴 2판(`teams/dev/out/village-file-contract.md` — `city.json` + `parts.json`)을 읽고, 그쪽 "헨리에게 — 정할 것" 셋에 답하며 하나로 맞춘 것이다.
**`teams/dev/out/village-file-contract.md` 와 이 파일이 같아야 계약이다** — 테라가 아래 4절 셋에 "맞다" 하면 이 판을 그쪽에 그대로 복사한다(요청 블록으로 묻는다). 다르면 여기서 고친 뒤 복사한다.

## 0. 그대로인 것 (1판에서)

- **세계 단위 = 지도 한 칸.** `server/public/world/map.json` 의 `places`·`zones`·`portals` 좌표를 새로 안 짠다. 지도 (x, y) → 3D (x, 0, y). **칸의 가운데는 (x + 0.5, y + 0.5)** — 사람이 서는 자리·문·통로는 이 가운데에 맞춘다.
- **축.** x 동(+) · z 남(+) · y 위(+). 마을 56 × 30 칸.
- **범위는 전부 `[min, max]`**, `id` 는 `map.json` 의 zone 이름(`home.dev` · `home.boss` · `cafe` · `plaza` · `castle`). zone 이 아닌 것(받침 `base`·틈 `gap.*`·`namsan`·`river`)은 `zone: null`.
- **문은 남쪽, 벽 앞면 +0.02, 바닥 낱장 +0.01.** z-fighting 은 `polygonOffset`.
- 이름은 소문자 영문·하이픈, 점 안 씀(`door-dev`). 키와 파일 이름(확장자 뺀 것)이 같다.

## 1. 파일은 둘 — 디자인이 쓰고 개발이 읽는다

| 파일 | 무엇 | 어디 |
| --- | --- | --- |
| `characters.json` | 인형 열여섯 — 몸(Kenney GLB)·배율·색·부착물·색표 | `teams/design/out/kit/characters.json` (M2, R14 통과) |
| `buildings.json` | 건물·바닥·소품 — **무엇이 어디에**(부품 자리) 와 **부품이 무엇인가**(배율·색·색표·간판) 가 한 파일 | `teams/design/out/kit/buildings.json` (M3, 2판) |

이 둘이 **원본**이다. 개발은 둘 중 하나를 고른다 — ① 그대로 읽는다(유니티 해석기 50c207c 가 이렇게 한다: rounded·column·cylinder·cone·dome·floor·model 을 부품 그대로 세운다) ② 테라 2판의 `city.json` + `parts.json` 으로 **스크립트로** 옮긴다(`server/public/world/`). 손으로 옮기지 않는다 — 손으로 옮기면 두 파일이 어긋난다(결정 57 "손으로 세는 건 썩는다").
테라 2판의 "도시마다 바꾸는 것 / 다시 쓰는 것" 은 동의한다 — 다른 도시가 오면 `buildings.<city>.json` 을 하나 더 내고, 머리(`scale`·`modelDir`·`colormaps`·`colors`·`textures`·`shapes`)는 그대로 복사한다. 첫 화면은 서울 하나라 파일도 하나다.

같이 오는 그림(전부 `teams/design/out/` 기준, 개발이 `server/public/world/assets/` 로 옮기는 건 B):

- `kit/colormaps/people/<팀>-<자리>.png` 열여섯(R14) · `kit/colormaps/commercial.png` · `commercial-cafe.png` · `suburban.png`(R15) — 512×512, Kenney 원본을 복사해 칸만 우리 색. 어느 칸이 뭔지 `kit/colormap-roles.json`(사람) · `kit/colormap-roles-buildings.json`(건물).
- `kit/signs/<이름>.png` 여덟 — 384×128 = 1.2×0.4 단위, 색 둘뿐. 글은 `kit/signs.json`.

## 2. `characters.json` — 사람 (M2 그대로)

`characters.<팀>-<자리>`(`boss` 는 `boss`) = `{ model, scale, sourceHeight, worldHeight, colors{top,bottom,hair,skin[,accent]}, prop, colormap }`.
- `model` 은 Kenney mini-characters GLB 파일 이름. `scale` 은 전부 1.39(`worldHeight` = `sourceHeight` × 1.39 ≈ 1.0).
- `prop` 은 `{ kind: "kenney", file }`(안경·지팡이·선글라스) 또는 `{ kind: "custom", id, note }`(갓·리본 둘 — 치수는 note). 없으면 null.
- `colormap` 은 `kit/colormaps/people/<id>.png`. **열여섯 다 있다**(R14) — 테라 2판 "오기 전엔 Kenney 원색" 은 끝났다. 코드는 colormap 이 null 이 아니면 읽는다.
- 발 앵커 규칙은 없다 — 모델 원점이 발밑(bbox y min ≈ 0, `out/kenney-bbox.json`).
- `pairs` 는 같은 몸 쌍 목록 — 마크가 세는 곳이지 코드가 읽는 건 아니다.

## 3. `buildings.json` — 건물·바닥·소품 (M3 2판)

머리:
- `unit` · `scale { k, note, exceptions[] }` — k = 1.39 하나. **부품의 `scale` 은 코드가 k 를 곱하지 않고 그대로 쓴다.** 예외 둘은 `exceptions` 에 이유와 함께: 차양 2.0(1.6×0.8, 정면 3.2 에 두 장) · 파라솔 2.78(= 2k, 1.25 높이 — 사람 1.0 위).
- `modelDir { commercial, suburban }` — 저장소 뿌리 기준, `server/public/world/assets/kenney/…/GLB format/`. 부품의 `file` 은 `<키>/<파일>`.
- `colormaps { commercial, commercial-cafe, suburban }` · `colors { 이름: hex }` · `textures { sign-*: png }` · `shapes { 이름: 설명 }`.
- `seoul` — 서울다움 넷(기와 지붕 층 · 한글 간판 · 골목 틈 소품 · 타워와 다리)이 어느 부품인지. 마크가 센다.

항목 `buildings[]` 하나 = `{ id, note, zone, range, doors[], parts[] }`:
- `zone` — `map.json` zones 의 `{ x:[min,max], z:[min,max] }`, 없으면 null. `range` — 부품 전부의 실제 발자국 `{ x, y, z }`(처마·나무까지).
- `doors[]` — `{ at:[x, z], w, h, facing, slot?, portal? }`. `slot` 은 그 문 앞에 서는 사람 칸(map.json places). `portal` 은 `map.json` portals 의 `to`(광화문 통로 → `castle.entrance` 하나뿐).
- `parts[]` — shape 여덟:

| shape | 값 | 무엇 |
| --- | --- | --- |
| `model` | `file` · `at [x, y, z]`(바닥 가운데) · `rotY`(도, 시계 반대 +) · `scale` · `colormap`(키) | Kenney GLB. 색표는 `colormaps` 의 그 장으로 갈아 끼운다 |
| `rounded` | `x`·`y`·`z` [min,max] · `radius`(기본 0.05) · `color` | RoundedBoxGeometry. 기단·기와 층·문·벽·벤치·난간 — 1판의 `box`·`gable`·`hip` 은 안 쓴다, 지붕은 rounded 두 단 |
| `column` | `at [x, z]` · `r` · `y` [min,max] · `color` | 세로 기둥 (1판 그대로) |
| `cylinder` | `at [x, z]` · `r` · `y` [min,max] · `color` | 전봇대·가로등·분수·남산 기둥 |
| `cone` | `at [x, z]` · `r` · `y` [min,max] · `color` | 안테나 |
| `dome` | `at [x, z]` · `r` · `y`(바닥) · `color` | 남산 언덕 반구 |
| `plane` | 붙는 축 하나만 값(`z: 21.72`) · 나머지 둘 [min,max] · `facing` · `tex` 또는 `color` | 간판·현판 — `tex` 는 `textures` 키 |
| `floor` | `x`·`z` [min,max] · `y` 하나 · `color` | 바닥 낱장 (길·광장·물·테라스) |

- **색이 텍스처를 대신한다.** `color` 는 `colors` 키. 텍스처는 간판 여덟뿐. Kenney 부품의 색은 `colormap` 한 장이 정한다 — 재질 색을 곱하지 않는다(곱하면 창·화분까지 물든다).
- 팀 색은 문(`door-<팀>`)에만. 재무(경영)·마케팅·댄 문이 같은 남색 — 문고리로 가른다(경영 놋쇠 `brass` · 댄 금 `gold` · 마케팅 없음).
- 여장·기둥·나무 셋 묶음처럼 "N 개" 는 파일에 하나씩 다 적혀 있다 — 개수를 코드가 세지 않는다.
- 테라 2판의 `mods`(roof-tile·door-team·sign)는 **개발 쪽 표**다 — buildings.json 은 그 셋을 부품으로 다 적어 놨으니(기와 층 rounded h 0.8 처마 0.5 반지름 0.08 · 문 rounded 0.8×1.4 기단 위 · 간판 plane 1.2×0.4 y 2.0) 옮길 때 값을 거기서 읽는다. 간판은 `text` 가 아니라 `tex`(PNG) — 글자 모양은 디자인이 정한다. png 가 없을 때 캔버스 글자로 대신 그리는 건 개발 몫(있으면 png 가 이긴다).

## 4. 테라에게 — 답 셋 (테라 2판 "헨리에게 — 정할 것")

1. **카메라** — `elevation` 멀리 35° · 가까이 45°, `azimuth` 남동 45°, fov 25°. 테라 2판의 35°·30° 중 30° 는 45° 로 — `draw3d.js` 73행이 이미 이 값이다(헨리 8줄 3번). `fit` 1·2·3 = 60·30·16 칸은 그대로.
2. **mods 셋** — 위 3절 마지막 줄. 표를 두는 건 좋다, 값은 buildings.json 부품에서 읽는다. 전봇대·계단은 부품(cylinder·rounded)으로 이미 적혀 있다 — `props` 상자로 따로 안 만든다.
3. **colormap 오는 날** — 사람 열여섯은 R14 에 왔고, 건물 세 장은 오늘(R15, 나리 12:34 실행). `characters.<자리>.colormap` 은 이제 null 이 아니다.

셋에 "맞다" 면 이 판을 `teams/dev/out/` 에 복사한다. 하나라도 다르면 요청 블록 안에서 고친다.

## 5. 개발이 맡는 것 (파일에 없음)

- 빛 두 개의 세기 비율, 그림자, `polygonOffset`, 배율 스냅, 앞뒤 정렬 — 전부 코드.
- 반구 위 나무의 y(언덕 표면 높이) · `dome` 이 받침 밖으로 나가는 부분 자르기 · `rounded` 의 `computeVertexNormals` · 컷어웨이(direction 6절).
- 찻집 주인 칸 (16, 16) 을 `map.json` places 에 넣는 것(1판 그대로, A).
- 걷기·자리·재생·말풍선·카드는 1판과 같은 코드(결정 16). 바뀐 것은 그림뿐.

## 6. 1판에서 내린 것 (기록)

`billboards.json`(발 앵커 `torsoX`·`footline`) · `box`·`gable`·`hip` · 텍스처 열여덟(`kit/textures/*.png`) · "1 px = 1/32 단위" · 직교 카메라 40°. 1판 전문은 git 에 있다(`teams/design/out/village-file-contract.md` 09-13 판).
