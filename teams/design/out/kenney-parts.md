# Kenney 세 세트 — 부품 목록 · 실측 · 색 띠

2026-09-13 · 클레멘타인. `teams/design/ref/kenney/` 에 대표가 풀어 준 세 세트를 열어 본 것.
바운딩 박스는 `.obj` 의 `v x y z` 줄을 grep·cut·sort 로 직접 재서 얻었다(이 세션엔 스크립트를 못 돌려서 손으로).
전부 밑에서 하나씩 다 재진 못했다 — 대표 지시가 온 건 셋(부품 목록·바운딩 박스·색 띠 실험)이라 목록은 전부, 실측은 대표 셋 모델만.

## 1. 세 세트 요약

| 세트 | 폴더 크기 | 모델 수 | 형식 | 라이선스 |
| --- | --- | --- | --- | --- |
| city-kit-suburban | 8.2M | 40 | fbx·glb·obj+mtl 각 40, 텍스처 png 6 | CC0 1.0 (License.txt) |
| city-kit-commercial | 11M | 41 | 위와 같음 | CC0 1.0 |
| mini-characters | 14M | 26 | 위와 같음 | CC0 1.0 |

세 세트 다 색은 파일마다 안 만들고 **`colormap.png` 한 장**을 모든 모델이 공유한다(헨리가 먼저 봄) — UV 가 그 한 장의 어느 네모를 가리키냐로 색이 정해진다. 재질(`.mtl`)도 세 세트 다 `usemtl colormap` 하나뿐이라, 우리 색으로 바꾸려면 모델을 안 만지고 **이 텍스처 한 장을 갈아치우면 된다** — 헨리 말대로다.

## 2. 부품 목록

### city-kit-suburban (40)
건물 21(`building-type-a`~`u`), 진입로 2(`driveway-long/short`), 담장 8(`fence`·`fence-low`·`fence-1x2/1x3/1x4`·`fence-2x2/2x3`·`fence-3x2/3x3`), 보도 5(`path-long/short`·`path-stones-long/messy/short`), 화단 1(`planter`), 나무 2(`tree-large/small`).
**가구·가로등·인형 소품 없음** — 헨리가 이미 확인한 대로, 상자로 지어야 한다.

### city-kit-commercial (41)
건물 14(`building-a`~`n`), 고층 5(`building-skyscraper-a`~`e`), 저해상 건물 14(`low-detail-building-a`~`n`) + 와이드 2(`low-detail-building-wide-a/b`), 디테일 6(차양 `detail-awning`·`detail-awning-wide`, 처마 `detail-overhang`·`detail-overhang-wide`, 파라솔 `detail-parasol-a/b`).
**여기도 가구·소품 없음.**

### mini-characters (26)
사람 12(`character-female-a`~`f`, `character-male-a`~`f`), 보조기구 10(`aid-cane`·`aid-cane-blind`·`aid-cane-low-vision`·`aid-crutch`·`aid-defibrillator-green/red`·`aid-glasses`·`aid-mask`·`aid-sunglasses`·`aid_hearing`), 휠체어 4(`wheelchair`·`wheelchair-deluxe`·`wheelchair-power`·`wheelchair-power-deluxe`).
**여기도 소품(가방·모자 낱개 등) 없음** — 헨리 "인형 소품은 상자로" 판단과 맞는다.

## 3. 바운딩 박스 — 전체 107개 (`tools/pixel/obj-bbox.mjs`, 대표가 돌림, `out/kenney-bbox.json`)

**사람 열둘(키, 높은 순)** — `character-male-a` 는 손으로 잰 처음 값(0.652)이 틀렸다. 그때 발밑 E-표기 줄("1.043081E-07")을 잡음이라 보고 뺐는데, 그게 진짜 발밑(y≈0)이었다 — 스크립트는 그 줄까지 정확히 읽어서 **0.6713** 이 맞다. 아래는 스크립트 값으로 다시 잡음.

| 모델 | 키(h) | 폭(w) | 깊이(d) |
| --- | --- | --- | --- |
| male-c | 0.7928 | 0.767 | 0.461 |
| female-a | 0.7755 | **1.099** | 0.500 |
| female-c | 0.7755 | 0.767 | 0.500 |
| female-d | 0.7755 | 0.767 | 0.500 |
| female-b | 0.7234 | 0.767 | 0.419 |
| male-d | 0.7218 | 0.767 | 0.340 |
| female-e | 0.7165 | 0.767 | 0.527 |
| male-a | 0.6713 | 0.767 | 0.340 |
| male-f | 0.6713 | 0.767 | 0.340 |
| male-e | 0.6760 | 0.767 | 0.342 |
| male-b | 0.6613 | 0.767 | 0.390 |
| female-f | 0.6713 | 0.767 | 0.441 |

키는 0.66~0.79 사이(1.2배 차, 사람마다 자세·모자 차이 정도), 폭은 거의 다 0.767 인데 **female-a 만 1.099 로 43% 넓다** — 렌더에서 봤던 청진기 든 인물이라 팔이 벌어진 자세일 수 있다, 배치할 때 옆 사람과 부딪히지 않게 이 하나는 따로 챙겨야 한다.

**suburban 건물 21(교외 주택, 높이순)** — 0.7375(h·m) ~ 1.238(d) 사이. 사람 평균 키(≈0.72)의 **1.0~1.7배뿐** — 결정 56 채점표(집:사람 ≥3.2)에 전부 못 미친다. 이 세트는 스케일 자체를 높여야 쓴다는 뜻.

**commercial 건물(도심, 높이순, 저해상 14+와이드 2 는 범위만)**

| 모델 | 키(h) | 사람 대비(÷0.72) |
| --- | --- | --- |
| low-detail-building-n | 0.70 | 1.0× |
| building-c | 0.893 | 1.2× |
| building-e | 0.893 | 1.2× |
| building-a | 1.293 | 1.8× |
| building-d | 1.293 | 1.8× |
| building-h | 1.293 | 1.8× |
| building-b | 1.293 | 1.8× |
| low-detail 나머지 12개 | 0.7~2.25 | 1.0~3.1× |
| building-i | 1.68 | 2.3× |
| building-g | 1.693 | 2.4× |
| building-f | 1.693 | 2.4× |
| building-k | 1.47 | 2.0× |
| building-j | 1.693 | 2.4× |
| building-l | 2.27 | **3.2×** |
| building-n | 2.48 | 3.4× |
| **building-m** | **3.15** | **4.4×** |
| skyscraper-a | 2.88 | 4.0× |
| skyscraper-c | 4.08 | 5.7× |
| skyscraper-e | 4.08 | 5.7× |
| skyscraper-b | 4.48 | 6.2× |
| skyscraper-d | 5.47 | 7.6× |

**골목 빌라(3~4층, 집:사람 3~5배)로 쓸 후보 — `building-l`·`building-n`·`building-m`·`skyscraper-a` 넷.** 나머지 building-a~k 는 채점표에 못 미쳐 스케일을 올려 쓰거나 저층(단층 상가)으로만 쓰는 게 맞다. skyscraper-b/c/d/e 는 너무 높아 배경용.

전체 숫자(x/y/z 최소·최대 포함)는 `out/kenney-bbox.json` 그대로 — 위 표는 그중 h(키)만 추려 순서를 매긴 것이다.

## 4. 색 띠 — `colormap.png` (세 세트 다 같은 배치로 보임)

이미지를 열어서 눈으로 나눈 것 — UV 좌표를 직접 뽑진 못했다(스크립트 없이는 어느 면이 어느 띠를 쓰는지 정확히 못 짚는다). 대신 `mini-characters/Preview.png`(캐릭터 열넷 나란히 선 렌더)와 색을 맞대 봤다.

- **아래 줄(그림 맨 밑, 넓은 띠 일곱)** — 어두운 회색 두 톤 · 회청색 · 흐린 하늘색 · 흰색 · **주황빛 살구색 · 갈색 · 살구색**. 렌더의 피부색(밝은 살구·중간 갈색·짙은 갈색)과 흰머리·회색 수염이 여기서 나온다 — **피부·회색 머리 줄**로 본다.
- **가운데 줄(일곱 쌍, 두 톤씩)** — 살구빛 베이지 · 초록 · 노랑 · 주황 · 빨강 · 파랑 · 하늘색 · 보라. 렌더의 재킷·조끼·스카프 색(주황 재킷, 파란 재킷, 초록 조끼, 보라 옷)이 여기서 나온다 — **옷 줄**로 본다.
- **위 줄(분홍·보라 두 칸만, 나머지 칸은 검정=비어 있음)** — 렌더에서 이 톤을 뚜렷이 못 찾았다. 볼터치나 입술처럼 작은 면적에 쓰는 강조색일 가능성이 있는데, 확실친 않다 — 헨리가 실제 UV(블렌더나 미리보기 도구)로 확인하는 게 낫겠다.
- `character-male-a` 자체(학사모 쓴 인물)는 미리보기가 64px 라 작아 구별이 어려웠다 — 살구색 피부, 초록 옷은 보였고 모자는 검정인데 그건 colormap 이 아니라 별도 검정 재질일 수 있다(칸이 전부 비어 있는 위 줄과 안 맞아서).

## 5. 모양 — 각지다 vs 둥글다

`city-kit-suburban/Preview.png` 를 보면 건물은 **각진 상자**(직각 벽, 삼각 맞배지붕)다. `mini-characters/Preview.png` 의 사람은 **둥글둥글한 인형**(머리·몸 모서리가 죽어 있음)이다. 두 세트가 같은 만듦새가 아니다 — 대표가 원하는 "인형 마을" 부드러움은 사람 쪽엔 이미 있고, 건물 쪽은 헨리가 모서리를 깎거나 재질로 부드럽게 만들어야 참고 그림(Airbnb 미니어처)과 맞을 것 같다.

## 남은 것

- 바운딩 박스는 107개 다 됐다(3절). 아직 안 된 건 `colormap.png` **UV 좌표**로 색 띠를 정확히 짚는 것뿐 — obj 의 `vt` 줄과 페이스별 대응까지 읽어야 해서 지금 스크립트(`obj-bbox.mjs`, `v` 줄만 봄)로는 안 된다. 필요하면 그건 따로 짠다.
