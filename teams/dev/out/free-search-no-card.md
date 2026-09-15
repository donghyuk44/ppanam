# 카드 없이 쓰는 무료 웹검색 — 후보 정리

2026-09-13 · 독립검수 · 대표 지시("카드 없이 되는 것만 다시 조사")
후보 5갈래 수집 → 12건 검증(각 후보를 반증하는 쪽으로 조사) → 카드 불필요 6건 확인

## 결론 세 줄

1. **SearXNG 를 우리 맥에 띄우는 길을 권합니다.** 카드도, 가입도, 횟수 제한도 없습니다.
2. 조사 중에 실제로 띄워 한국어 검색까지 돌려봤습니다. 네이버 결과도 나왔습니다.
3. 백업으로는 **ddgs** 하나면 됩니다. 명령 한 줄이고 띄울 서버가 없습니다.

---

## 권고 1순위

**이름** — SearXNG(검색 서버) + mcp-searxng(연결 다리)

**왜** — 우리 맥에서 도는 검색기라 결제 대상 자체가 없습니다. 구글·빙·브레이브·네이버를 한꺼번에 물어봅니다. 실측: `인공지능`(네이버) 15건, `서울 날씨` 41건. 두 프로그램 모두 이번 주에도 손이 가고 있습니다.

**한 달에 몇 건** — 정해진 한도가 없습니다. 우리 서버라 횟수를 세는 곳이 없습니다. 다만 뒤에 붙은 검색엔진이 조용히 막을 수는 있습니다(실측: 몇 분 만에 덕덕고 하나가 막혔고 구글·빙·브레이브·네이버는 계속 됐습니다).

**붙이는 명령 한 줄** (대표가 직접 실행)

    claude mcp add searxng -s user -e SEARXNG_URL=http://127.0.0.1:8080 -- npx -y mcp-searxng

이 한 줄 전에 검색 서버를 먼저 띄워야 합니다. 두 갈래가 있습니다.
- (A) 도커로: 이 맥은 도커가 아직 준비 안 됐습니다. `colima start` 로 새로 만들어야 하고, 이건 대표 승인이 필요합니다.
- (B) 도커 없이: 조사 중 실제로 돌린 길입니다. 그대로 됩니다. 명령은 아래 부록에 적었습니다.

**한계 세 가지**
- 설정 파일 한 곳을 손봐야 합니다. 기본값이 결과를 화면용으로만 내주게 돼 있어서, 프로그램이 읽을 형식을 켜야 합니다. 안 켜면 아예 안 됩니다.
- 네이버 결과는 공식 통로가 아니라 네이버 화면을 읽어오는 방식입니다. 네이버가 화면을 바꾸면 깨집니다(지금은 멀쩡합니다).
- 남의 공개 서버를 빌려 쓰는 길은 막혔습니다. 다섯 곳을 두드려봤는데 전부 봇 검사나 거절이었습니다.

**주의** — 파이썬 저장소에 있는 `searxng` 라는 이름의 꾸러미는 전혀 다른 물건입니다. 그걸 설치하면 안 됩니다.

---

## 권고 2순위

**이름** — ddgs (예전 이름: duckduckgo-search)

**왜** — 띄울 서버가 없습니다. 명령 한 줄로 끝납니다. 한 엔진이 막히면 다른 엔진으로 알아서 돌려 씁니다. 실측에서 덕덕고가 막힌 동안에도 브레이브·빙·얀덱스로 계속 검색이 됐습니다. 한국어도 잘 나옵니다(위키백과·나무위키 등 확인).

**한 달에 몇 건** — 정해진 한도가 없습니다. 실제로는 우리 IP 가 막히는 시점이 한도입니다.

**붙이는 명령 한 줄** (대표가 직접 실행)

    claude mcp add ddgs -s user -- uvx --from "ddgs[mcp]" ddgs mcp

**한계** — 막혔을 때 "막혔다"가 아니라 "검색 결과 없음"이라고 옵니다. 둘을 구분할 수 없습니다. 그리고 아홉 엔진이 다 도는 게 아닙니다. 우리 집 IP 에서 구글과 모제크는 네 번 다 빈손이었습니다.

---

## 전체 비교표

| 이름 | 카드 | 무료 한도 | 한국어 | 붙이는 법 | 살아있나 |
| --- | --- | --- | --- | --- | --- |
| **SearXNG + mcp-searxng** ¹ | 필요없음 | 한도 없음(내 서버) | 된다(실측, 네이버 포함) | 서버 먼저 띄우고 명령 한 줄 | 이번 주도 손봄 |
| **ddgs** ² | 필요없음 | 정해진 한도 없음 | 된다(실측) | 명령 한 줄, 서버 없음 | 8월 말 갱신 |
| duckduckgo-mcp-server ³ | 필요없음 | 정해진 한도 없음 | 된다(실측) | 명령 한 줄, 서버 없음 | 9일 전 갱신 |
| open-webSearch ⁴ | 필요없음 | 정해진 한도 없음 | 엔진을 덕덕고로 바꿔야 됨 | 명령 한 줄(구버전 받음) | 깃허브만 활발 |
| 네이버 검색 — 지금 붙은 것 ⁵ | 필요없음 | 우리 몫은 불명 | 본업이 한국어 | 이미 붙어 있음 | 됨 |
| 네이버 검색 — 새 키 ⁵ | **필요**(개인은 필수) | 하루 25,000 / 달 775,000 | 본업이 한국어 | 가입 후 명령 한 줄 | 됨 |
| 4get ⁶ | 필요없음 | 자체 운영하면 한도 없음 | 된다(실측) | 우리가 서버를 띄워야 함 | 다리가 1년째 방치 |
| LibreY ⁷ | 필요없음 | 한도 없음 | 글자가 깨져서 옴 | 붙일 수 없음 | 코드는 10개월째 정지 |
| Marginalia ⁸ | 필요없음(메일 신청) | 실측상 거의 0 | **안 됨**(영어만) | 붙일 수 없음(직접 만들어야) | 활발 |
| Mojeek ⁹ | 불명 / 유료는 필요 | 공개된 숫자 없음 | 근거 없음 | 붙일 수 없음(직접 만들어야) | 활발 |
| Whoogle ¹⁰ | 필요없음 | 해당 없음 | 결과가 0건 | 붙일 수 없음 | **끝났음** |

---

## 걸러낸 것

- **Whoogle** — 만든 사람이 직접 "더는 검색 결과가 안 나온다"고 공지하고 문을 닫았습니다. 실제로 영어든 한국어든 결과가 0건입니다.
- **Marginalia** — 운영자가 문서에 영어만 된다고 적어뒀고, 한국어를 넣으면 실제로 0건입니다.
- **Mojeek** — 키를 버튼으로 못 받습니다. 이메일을 보내고 사람 답장을 기다려야 합니다. 한국어가 된다는 증거도 없습니다.
- **LibreY** — 공개 서버 15곳을 전부 두드렸는데 쓸 만한 곳이 0곳이었습니다. 유일하게 되는 곳에서도 한국어 제목이 깨져서 옵니다.
- **4get** — 공식 이용 규정이 "사람이 시작하지 않은 자동 검색"을 오남용으로 못박습니다. 우리처럼 알아서 도는 구조가 정확히 여기 걸립니다. 연결용 다리 프로그램도 작년 9월 이후 사람 손이 안 갔습니다.
- **네이버 검색 새 키** — 카드가 필요합니다. 옛 무료 통로는 7월 31일에 신규 접수가 끊겼습니다.
- **open-webSearch** — 쓸 수는 있지만 권하진 않습니다. 만든 곳이 어디인지 꾸러미 안에 증거가 없고, 기본 설정이 중국 쪽으로 맞춰져 있어 그대로 쓰면 한국어 검색이 망가집니다. 우리 맥에서 도는 코드라 대표 판단이 필요합니다.

---

## 이미 우리가 가진 것

**네이버 검색 도구가 지금 이 세션에 이미 붙어 있습니다.** 카드도 키도 넣지 않았는데 한국어 검색이 실제로 됐습니다(실측: 웹문서 검색, 검색어 트렌드 모두 응답). 카카오가 운영하는 장터를 거쳐 붙은 것입니다.

다만 두 가지를 알고 계셔야 합니다.

- 이건 **남의 키에 얹혀 가는 것**입니다. 우리가 무엇을 검색했는지가 그 제3자 쪽에 남습니다. 민감한 조사에는 쓰지 않는 게 맞습니다.
- 우리에게 하루 몇 건까지 허용되는지는 **적혀 있는 데가 없습니다**. 네이버 자체 한도(하루 25,000)는 공개돼 있지만, 그걸 다른 사람들과 나눠 쓰는 구조로 보입니다.

또 하나, 네이버 이용 약관이 "검색 결과를 그대로 보여줄 것"을 요구하고 앞뒤에 다른 내용을 끼워 넣는 걸 금합니다. 검색 결과를 요약해서 산출물에 섞는 쓰임이라면 한 번 확인하고 가시는 게 안전합니다.

---

## 부록 — 1순위를 도커 없이 띄우는 명령

    git clone --depth 1 https://github.com/searxng/searxng.git
    cd searxng && uv venv --python 3.12 .venv
    VIRTUAL_ENV=.venv uv pip install -r requirements.txt
    SEARXNG_SETTINGS_PATH=~/searxng-settings.yml .venv/bin/python -m searx.webapp

설정 파일(`~/searxng-settings.yml`)에 넣을 내용:

    search:
      formats: [html, json]
    engines:
      - {name: naver, disabled: false}
      - {name: naver news, disabled: false}

서버가 뜬 뒤 위 본문의 `claude mcp add` 한 줄을 실행하시면 됩니다. 권한 한 줄(settings.json)은 대표만 넣을 수 있어 독립검수가 못 합니다.

---

## 근거

1. https://docs.searxng.org/dev/search_api.html · https://github.com/ihor-sokoliuk/mcp-searxng/blob/main/README.md
2. https://github.com/deedy5/ddgs/blob/main/README.md · https://github.com/deedy5/ddgs/issues/478
3. https://github.com/nickclyde/duckduckgo-mcp-server · https://pypi.org/project/duckduckgo-mcp-server/
4. https://github.com/Aas-ee/open-webSearch · https://registry.npmjs.org/open-websearch
5. https://developers.naver.com/notice/article/32530 · https://www.ncloud.com/product/applicationService/naverApiHub · https://developers.naver.com/products/terms · https://github.com/isnow890/naver-search-mcp
6. https://git.lolcat.ca/lolcat/4get/raw/branch/master/api.txt · https://github.com/yshalsager/mcp-4get
7. https://github.com/Ahwxorg/LibreY/issues/214
8. https://about.marginalia-search.com/article/api/
9. https://www.mojeek.com/services/search/web-search-api/
10. https://github.com/benbusby/whoogle-search
