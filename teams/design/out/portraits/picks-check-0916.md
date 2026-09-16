# 칩 = 대표가 고른 얼굴인가 (헨리, 09-16 저녁, req_0b6441a8 · 결정 197)

`_check-picks.mjs` — picks-0916.json 의 fe/<자리>-<n>.png 를 chip-crop.md 값(x 59~453 · y 20~414, 394)으로 잘라 chip/<자리>.png 와 픽셀로 대봄(두 칸 걸러, 채널 합 차 24 넘으면 다른 픽셀). 열여섯 다 0.00% — 칩은 대표가 고른 판 그대로다. 대표는 생성 안 함, boss.png = 페이스북 사진(picks notes, 열어 봄). chip128 은 chip 을 sips 로 줄인 것이라 같은 얼굴.

실물에 도트가 뜬 건 얼굴 파일이 아니라 폴더(app.js 66행 `out/faces`)였다 — 테라 한 줄 뒤 412 사진에서 자리마다 chip128 과 눈으로 대본다.

**같다 (헨리, 테라 bfb9f7e 뒤)** — 멤버 탭 카드 열일곱의 `<img src>` 를 화면에서 읽어(`screen-shot.mjs` js 인자, `out/shots/r23-portraits-dom-412.png`) 이름 ↔ 파일을 대봤다: 함동혁(댄)=boss · 톰=hq-chief · 제리=hq-outside · 하영=marketing-guide · 안젤=marketing-review · 다니엘=marketing-outside · 테라=dev-guide · 솔라=dev-ops · 레오=dev-outside · 헨리=design-guide · 클레멘타인=design-ops · 마크=design-outside · 유진=finance-guide · 노라=finance-review · 빅터=finance-outside · 세라=hq-secretary · 나리=hq-system — 열일곱 다 `/out/design/portraits/chip128/<자리>.png`, 자리 어긋남 0. chip128 = chip 축소 = 위 표의 고른 판이니 **화면 얼굴 열일곱 = 대표가 고른 얼굴**. 눈으로도 톰(hq-chief-1 금발)·하영·대표 사진이 `r34-portraits-people-412.png` 에 그대로. 원·띠 크기는 클레멘타인 CSS(폰 150 띠 지름 110, 이름표 50%, 카드 40/48)대로 서 있다.

```
hq-system        fe/hq-system-4.png        ↔ chip/hq-system.png        0.00%  같다
hq-chief         fe/hq-chief-1.png         ↔ chip/hq-chief.png         0.00%  같다
hq-outside       fe/hq-outside-4.png       ↔ chip/hq-outside.png       0.00%  같다
hq-secretary     fe/hq-secretary-2.png     ↔ chip/hq-secretary.png     0.00%  같다
dev-guide        fe/dev-guide-4.png        ↔ chip/dev-guide.png        0.00%  같다
dev-ops          fe/dev-ops-4.png          ↔ chip/dev-ops.png          0.00%  같다
dev-outside      fe/dev-outside-1.png      ↔ chip/dev-outside.png      0.00%  같다
design-guide     fe/design-guide-2.png     ↔ chip/design-guide.png     0.00%  같다
design-ops       fe/design-ops-3.png       ↔ chip/design-ops.png       0.00%  같다
design-outside   fe/design-outside-1.png   ↔ chip/design-outside.png   0.00%  같다
marketing-guide  fe/marketing-guide-1.png  ↔ chip/marketing-guide.png  0.00%  같다
marketing-review fe/marketing-review-3.png ↔ chip/marketing-review.png 0.00%  같다
marketing-outside fe/marketing-outside-2.png ↔ chip/marketing-outside.png 0.00%  같다
finance-guide    fe/finance-guide-3.png    ↔ chip/finance-guide.png    0.00%  같다
finance-review   fe/finance-review-4.png   ↔ chip/finance-review.png   0.00%  같다
finance-outside  fe/finance-outside-1.png  ↔ chip/finance-outside.png  0.00%  같다
```
