# 정면 열다섯 장 — 최하단 줄 · torsoX 실측

`tools/pixel/portrait-measure.mjs` 를 대표가 돌린 결과(`out/feet-measure-2026-09-13.txt`)를 표로 옮긴 것. R12 끝에 마크가 남긴 것 — "발 밑선은 열다섯 장 각각 재서 확정, 가정하지 않는다."

| 파일 | 크기 | 최하단 | height−1 | torsoX | centerX | shift |
| --- | --- | --- | --- | --- | --- | --- |
| boss | 38×62 | 61 | ✓ | 19 | 19 | 0 |
| design-guide | 24×60 | 59 | ✓ | 11 | 12 | 1 |
| design-ops | 30×57 | 56 | ✓ | 13 | 15 | 2 |
| design-outside | 29×55 | 54 | ✓ | 17 | 14.5 | −2 |
| dev-guide | 33×55 | 54 | ✓ | 20 | 16.5 | −3 |
| dev-ops | 30×57 | 56 | ✓ | 14 | 15 | 1 |
| dev-outside | 28×57 | 56 | ✓ | 15 | 14 | −1 |
| finance-guide | 23×52 | 51 | ✓ | 11 | 11.5 | 1 |
| finance-outside | 33×57 | 56 | ✓ | 21 | 16.5 | **−4** |
| finance-review | 30×62 | 61 | ✓ | 15 | 15 | 0 |
| hq-chief | 30×59 | 58 | ✓ | 14 | 15 | 1 |
| hq-outside | 30×58 | 57 | ✓ | 15 | 15 | 0 |
| marketing-guide | 30×57 | 56 | ✓ | 15 | 15 | 0 |
| marketing-outside | 28×57 | 56 | ✓ | 13 | 14 | 1 |
| marketing-review | 26×60 | 59 | ✓ | 13 | 13 | 0 |

**최하단은 열다섯 장 전부 height−1** — 여백을 자른 뒤 남은 그림 자체가 화면 가장자리까지 채워졌다는 뜻, 마크의 가정이 맞았다.
**shift(torsoX − centerX)** 는 대부분 0~±1. 벗어난 셋: **finance-outside −4**(가장 큼), dev-guide −3, design-ops·design-outside ±2. 도포 자락이 한쪽으로 쏠렸거나 팔·소품이 삐져나온 그림들 — 헨리가 원본 볼 때 이 넷부터 보면 된다.
