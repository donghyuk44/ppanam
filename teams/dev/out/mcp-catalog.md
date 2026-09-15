# MCP 카탈로그 — 내부회의용 (선정 안건)

작성: 개발팀 조사 세션 · 2026-09-13 · 대표 결정 64 ("MCP 는 일단 전부 다, 그리고 더 찾아서 추가할 만한 거 골라서 내부회의 통해서 선정해서 깔아")

> **이 문서는 회의·선정용이다. 설치 명령은 대표 몫이다.**
> 작전실 세션(`claude -p`)이 쓰는 MCP 는 `~/.claude` 설정에서 온다. 추가는 `claude mcp add …` 또는 설정 파일 편집인데, **AI self-config 는 분류기가 막는다**(MEMORY: settings-permissions-boss-only). 그래서 아래 "설치법" 은 대표가 실행할 명령이고, 세션은 새 bus/CLI 마다 allow 한 줄만 요청할 수 있다.

팀 약칭: **총괄**(hq·톰/제리) · **마케팅**(하영/안젤/다니엘) · **개발**(테라/솔라/레오) · **디자인** · **재무**(경영재무)

추천 등급: **넣자** = 작전실 에이전트가 실제로 쓴다 · **보류** = 쓸 수 있으나 지금 아님/대표 결정 필요 · **안 씀** = ppanam 과 무관.

---

## 1. 지금 붙어 있는 것 (인벤토리)

### 1-1. 마케팅·검색 (에이전트가 실제로 씀)

| MCP | 무엇 | 어느 팀 | 비용 | 위험 | 설치법 | 추천 |
|---|---|---|---|---|---|---|
| NaverSearch | 네이버 뉴스·블로그·카페·**이미지**·지식iN·웹·지역·백과 검색 + 데이터랩(검색어/쇼핑 트렌드) | 마케팅·재무 | 무료(키 하네스에 내장) | 국내 위주 | 붙어있음 | **넣자(유지)** |
| KeywordTool (0b87…) | 구글·빙 키워드 제안·월검색량·CPC·경쟁도(192개국) | 마케팅 | 게스트 쿼터 제한 | 쿼터 | 붙어있음 | **넣자(유지)** |
| TubeAlfred / YouTube (7337…) | 유튜브 채널·영상·검색·트렌드·자막·댓글 조회(읽기전용) | 마케팅 | 무료 | 없음 | 붙어있음 | **넣자(유지)** |
| Pablooo (f3be…) | 앱 UI 스크린샷 벤치마크 검색(디자인 레퍼런스) | 디자인·마케팅 | 무료(출처표기 의무) | 없음 | 붙어있음 | **넣자(유지)** |

### 1-2. 지도·메신저·공시 (카카오 공식 번들 9873…)

| MCP | 무엇 | 어느 팀 | 비용 | 위험 | 설치법 | 추천 |
|---|---|---|---|---|---|---|
| KakaoMap | 장소검색·도보/자전거/대중교통 길찾기 | — | 무료 | 없음 | 붙어있음 | 안 씀 |
| KakaoTalk MemoChat | "나에게 메모 보내기" 전송 | 총괄 | 무료 | 대외 발신(자기 채팅) | 붙어있음 | 보류 |
| OpenDART | 한국 전자공시: 회사·재무제표·배당·지분·임원·공시검색 | 재무 | 무료(공공) | 없음 | 붙어있음 | 보류(경쟁사 공시 조사 시) |

### 1-3. 디자인·제작

| MCP | 무엇 | 어느 팀 | 비용 | 위험 | 설치법 | 추천 |
|---|---|---|---|---|---|---|
| Figma (a721…, 공식) | 디자인 생성/읽기, FigJam, 다이어그램, Code Connect, 셰이더 | 디자인·개발 | Figma 계정 | 파일 쓰기 권한 | 붙어있음 | **넣자(유지)** |
| SpriteCook (plugin) | 스프라이트·타일셋·UI킷 **생성**, Godot 연동 | 디자인 | 크레딧(무료분 있음) | 생성 과금 | 플러그인·**OAuth 대기** | **넣자(OAuth 마무리)** |
| MindMap AI (325b…) | 마인드맵 생성·편집, 영구 저장 | 총괄·기획 | 무료(계정) | 없음 | 붙어있음 | 보류 |
| visualize (6f61…) | 인라인 SVG/HTML 위젯 렌더 | 전팀 | 무료 | 없음 | 하네스 내장 | 보류(내장) |

### 1-4. 문서·협업

| MCP | 무엇 | 어느 팀 | 비용 | 위험 | 설치법 | 추천 |
|---|---|---|---|---|---|---|
| DocStash (5c2e…) | 앱·문서·PDF·시트·코드 저장 + 공유 링크 | 전팀 | 무료(계정) | 공개 링크 발행 | 붙어있음 | 보류(산출물은 out/ 파일이 원칙) |
| Notion (910e…, plugin) | 검색·페이지·DB·댓글·세션 | 전팀 | 무료/유료 | 대외 데이터 | **OAuth 대기** | 보류 |
| Google Drive (af71…) | 파일 검색·읽기·생성·공유·휴지통 | 전팀 | 무료 | 파일 공유·삭제 | 붙어있음 | 보류 |
| Gmail (9f37…) | 메일 검색·읽기·초안·**발송**·라벨 | 총괄·마케팅 | 무료 | **대외 발송** | 붙어있음 | 보류(발송은 승인 필요) |
| Google Calendar (8997…) | 일정 조회·생성·수정·참석응답·시간제안 | 총괄 | 무료 | 일정 변경 | 붙어있음 | 보류 |

### 1-5. 개발·인프라·자동화

| MCP | 무엇 | 어느 팀 | 비용 | 위험 | 설치법 | 추천 |
|---|---|---|---|---|---|---|
| Supabase (plugin) | DB·마이그레이션·엣지함수·로그·어드바이저 | 개발 | 무료/유료 | 원격 DB 변경 | 플러그인 | 보류(**로드맵 컷 리스트: 배포·Supabase**) |
| Desktop Commander | 로컬 파일 R/W·프로세스·터미널·검색 | 개발 | 무료 | **로컬 전권**(파일·프로세스) | 붙어있음 | 보류(내장 도구와 중복) |
| iOS Simulator | iOS 앱 빌드·시뮬레이터 조작 | — | 무료(맥) | 없음 | 붙어있음 | 안 씀(ppanam 은 웹) |
| scheduled-tasks | 예약 실행 작업 생성·조회 | 총괄 | 무료 | 자동 실행 | 붙어있음 | 보류(라운드 스케줄) |
| mcp-registry | 커넥터 검색·설치 제안 | — | 무료 | 없음 | 하네스 내장 | 보류(내장) |

### 1-6. 브라우저·데스크톱 자동화

| MCP | 무엇 | 어느 팀 | 비용 | 위험 | 설치법 | 추천 |
|---|---|---|---|---|---|---|
| claude-in-chrome | 크롬 탭 제어·페이지 읽기·폼입력 | 개발·마케팅 | 무료 | 브라우저 세션 접근 | 붙어있음 | 보류(작전실 확인용) |
| Control_Chrome | 크롬 탭 열기·JS 실행·탭 관리(별도 서버) | 개발 | 무료 | JS 실행 | 붙어있음 | 보류(claude-in-chrome 와 중복) |
| computer-use | macOS 화면 스크린샷·클릭·키입력 | 개발 | 무료 | **화면 전권** | 붙어있음 | 보류(특정 작업만) |

### 1-7. 여행·부동산 (ppanam 무관 → 전부 안 씀)

| MCP | 무엇 | 추천 |
|---|---|---|
| Otto (bbf1…) | 항공·호텔·렌터카 **실제 예약**/변경/취소 | 안 씀 |
| 호텔검색(2487…) · 항공+호텔 게이트웨이(9bb1…) · 여기어때(9873…) | 숙박·항공 검색 | 안 씀 |
| 여행 목적지 추천(cf10…) · 렌터카·eSIM·투어·수하물·환승·항공보상(db91…) | 여행 부가 | 안 씀 |
| jjmz(9873…) | 지역·장소 비교(부동산/입지) | 안 씀 |

### 1-8. 하네스 내장 (논외)

`ccd_*`(커넥터·디렉터리·PR·세션관리·사이드바·뷰·윈도우), `terminal`(read_terminal) — Claude Code 자체 기능. 카탈로그 대상 아님.

### 1-9. Plugin 커넥터 — OAuth 대기(미연결)

이 세션에 **등록은 됐으나 인증 안 됨**. 대부분 외부 SaaS 라 ppanam 과 무관.

| 계열 | 항목 | 판단 |
|---|---|---|
| data | bigquery · definite · hex | 안 씀(데이터웨어하우스, 규모 과함) |
| engineering | datadog · pagerduty | 보류(배포 후 모니터링) / **github** | github 은 보류(내장 `gh` 로 충분) |
| product-management | amplitude(+eu) · fireflies · intercom · pendo | 안 씀(외부 제품분석 SaaS) |
| product-management | figma | 안 씀(공식 Figma MCP 와 중복) · **similarweb** 는 보류(경쟁분석) |
| productivity | asana · atlassian · clickup · linear · monday | 안 씀(외부 PM 툴, ppanam 은 자체 bus/) |
| productivity | notion · slack | 보류(Slack 은 알림 검토 가능) |
| spritecook | spritecook | **넣자**(1-3 참조, OAuth 마무리) |

---

## 2. 추가 후보 (웹서치로 찾음)

갈래별. 링크 확인 상태는 표 아래 각주.

### 2-1. 이미지 생성 — 지금 사람이 ChatGPT 로 수동. 최우선 공백.

| MCP | 무엇 | 어느 팀 | 비용 | 위험 | 설치법 | 추천 |
|---|---|---|---|---|---|---|
| imagegen-mcp [¹] | 멀티 프로바이더 텍스트→이미지: OpenAI GPT-Image-1·DALL·E, Google Imagen4·Nano Banana, Replicate Flux·Qwen·SeedDream | 디자인·마케팅 | **유료 API키**(장당 OpenAI $0.02~0.08, Replicate $0.003~0.01, Google 무료티어) | API키·**종량 과금** | `npx imagegen-mcp-server` (커뮤니티/MIT) | **넣자(1순위)** |
| fal-mcp [²] | fal.ai: FLUX 생성 + 편집/인페인트/업스케일 + nano-banana | 디자인 | 유료(fal 크레딧) | API키·과금 | `npx fal-mcp` (커뮤니티) | **넣자(생성 후처리 보완)** |
| nanobanana-mcp-server [²] | Google Gemini 이미지, 4K 출력 | 디자인 | Google API(무료티어) | API키 | 커뮤니티 | 보류(대안) |

### 2-2. 3D 에셋 (한국 전통 판타지 마을 3D 장면)

| MCP | 무엇 | 어느 팀 | 비용 | 위험 | 설치법 | 추천 |
|---|---|---|---|---|---|---|
| threenative-asset-mcp ("Fab MCP") [¹] | 3D 에셋+게임오디오 검색·다운로드: Fab · **Poly Haven** · ambientCG · Smithsonian · Sketchfab (오디오는 Kenney·Sonniss 등) | 디자인·개발 | **무료 위주(CC0)**, 일부 Fab 유료 | 다운로드 파일 검증 필요 | `npx -y threenative-asset-mcp` (API키 불필요, Sketchfab만 선택) | **넣자** |
| blender-mcp [¹] | Blender 원격제어(오브젝트·머티리얼·파이썬) + Poly Haven·Sketchfab·Poly Pizza·AI 3D생성(Rodin/Hunyuan) | 디자인 | 무료(외부 서비스 별도) | **Blender 실행 필요·Python 실행** | `uvx blender-mcp` (Blender 3.0+·uv) | 보류(3D 본격화 시·데스크톱 세션 한정) |
| sketchfab-mcp-server [²] | Sketchfab 3D 검색·상세·다운로드 | 디자인 | 무료(API키 선택) | 다운로드 검증 | 커뮤니티(npx) | 보류(threenative 로 커버) |

### 2-3. 이미지·자료 웹서치 (마케팅 레퍼런스)

| MCP | 무엇 | 어느 팀 | 비용 | 위험 | 설치법 | 추천 |
|---|---|---|---|---|---|---|
| Brave Search MCP [¹] | 웹+**이미지**+뉴스+동영상+지역 검색 + AI 요약(독립 인덱스) | 마케팅·디자인 | **유료 API키(무료티어)** | API키·과금 | `npx -y @brave/brave-search-mcp-server --transport stdio` (Brave **공식**) | **넣자(글로벌 보완, Naver 는 국내 위주)** |
| Tavily MCP [²] | 에이전트용 웹검색·멀티스텝 리서치 | 마케팅 | 무료티어+유료 | API키 | `npx`(공식) | 보류(Brave/Naver 로 커버) |
| Exa MCP [²] | 시맨틱(신경망) 웹검색, 본문 반환 | 마케팅 | 무료티어 | API키 | `npx`(공식) | 보류 |

### 2-4. 파일·저장소·배포

| MCP | 무엇 | 어느 팀 | 비용 | 위험 | 설치법 | 추천 |
|---|---|---|---|---|---|---|
| Netlify MCP [¹] | 사이트 생성·**배포**·환경변수·폼 관리 | 개발 | Netlify 계정 | **배포·토큰** | `npx -y @netlify/mcp` (Node22+, **공식**) | 보류(**로드맵 컷: 배포·Tailscale 유지**) |
| Cloudflare MCP [²] | Cloudflare API 전반(설정·배포) | 개발 | 계정 | 배포·토큰 | 공식(remote/npx) | 보류(컷: 배포) |
| GitHub MCP [²] | 저장소·PR·이슈·액션 | 개발 | 무료(PAT) | 토큰·쓰기 | `npx`/도커(공식) | 보류(내장 `gh` + plugin:engineering:github 로 커버) |
| Filesystem MCP [²] | 로컬 파일 R/W(경로 화이트리스트) | 전팀 | 무료 | 경로 권한 | `npx @modelcontextprotocol/server-filesystem` (공식) | 안 씀(내장·Desktop Commander 중복) |

### 2-5. 팀 협업 (요청 블록·알림)

| MCP | 무엇 | 어느 팀 | 비용 | 위험 | 설치법 | 추천 |
|---|---|---|---|---|---|---|
| Slack MCP [²] | 채널 메시지·알림·리액션·유저 | 총괄·마케팅 | 무료(봇토큰) | **대외 발신** | `npx @modelcontextprotocol/server-slack` (공식) | 보류(자체 bus/ 있음 + plugin:productivity:slack 중복) |
| Discord MCP [²] | 봇으로 메시지·채널·웹훅 관리 | 총괄 | 무료 | 대외 발신 | 커뮤니티(도커) | 보류 |

**링크 확인 상태**
- [¹] **열어서 확인함**(WebFetch): imagegen-mcp(github.com/writingmate/imagegen-mcp) · threenative-asset-mcp(github.com/jonit-dev/threenative-asset-mcp) · blender-mcp(github.com/ahujasid/blender-mcp) · Brave(github.com/brave/brave-search-mcp-server) · Netlify(github.com/netlify/netlify-mcp)
- [²] **검색 결과로만 확인, 페이지 미개봉**: fal-mcp · nanobanana-mcp-server · sketchfab-mcp-server · Tavily · Exa · Cloudflare · GitHub MCP · Filesystem MCP · Slack MCP(@modelcontextprotocol/server-slack) · Discord MCP. 설치 전 대표가 링크 1회 열람 권장.

---

## 3. 먼저 깔 것 5 — 각각 왜

작전실 에이전트가 **실제로** 쓸 것, 그리고 **로드맵 컷 리스트를 안 건드리는** 것 기준.
(컷 리스트: 디자인/경영/CS 신설·오케스트레이션 프레임워크·**배포/Supabase**·웹 페르소나 편집·마케팅 라운드 — 그래서 Netlify/Cloudflare/Supabase 는 여기서 뺀다.)

1. **imagegen-mcp** — 지금 시안·도트를 사람이 ChatGPT 로 손으로 뽑는다. 이걸 붙이면 디자인 세션이 프롬프트로 직접 콘셉트아트·스프라이트 초안을 낸다. 멀티 프로바이더라 모델 갈아끼우기 쉬움. **가장 큰 공백을 메움.**
2. **SpriteCook (OAuth 마무리)** — 이미 플러그인 등록됨, 인증만 남음. 픽셀/게임에셋 특화라 imagegen(범용 시안)과 역할이 갈린다. 마을 스프라이트·타일셋·UI킷의 본진. **반쯤 설치된 걸 완성.**
3. **threenative-asset-mcp (Fab MCP)** — 한국 전통 판타지 마을의 3D 장면에 넣을 CC0 에셋(Poly Haven·Fab·Sketchfab)을 에이전트가 직접 검색·다운로드. **API키 불필요·무료 위주라 위험·비용 최저.**
4. **Brave Search MCP** — 마케팅 레퍼런스가 글로벌이면 Naver(국내 위주)로 부족. 웹+이미지+뉴스를 한 서버로. 무료티어 키. **마케팅 리서치의 사각 보완.**
5. **fal-mcp** — imagegen 이 "생성" 이라면 fal 은 "편집/인페인트/업스케일/변형". 뽑은 스프라이트를 다듬는 후처리 담당. imagegen 과 모델이 겹치면 **택1 가능**하니 5순위. (3D 를 본격 조립하게 되면 이 자리에 **blender-mcp** 를 올린다 — 단 Blender 실행이 필요해 데스크톱 세션 한정.)

**공통 주의(대표 판단용)**: 1·4·5 는 외부 유료 API키 + 종량 과금이다 → `state/budget.json` 일일 상한(마일스톤 6)과 함께 봐야 한다. 새 서버마다 세션은 bus/CLI allow 한 줄을 요청하게 되고, 실제 `claude mcp add …` 는 대표가 친다.

---

## 4. WebMCP (대표가 준 영상 주제)

**표준 초안, 관망.** — 웹사이트가 자기 기능을 에이전트용 "도구" 로 노출하는 W3C 초안(구글·MS, 2026-02 발표, Chrome 149 오리진 트라이얼). 설치할 서버가 아니라 브라우저 표준이라, ppanam 은 채택 대상이 아니라 관망 대상이다. 안정화되면 작전실을 WebMCP 로 노출할지 그때 검토.

---

### 부록: 근거
- 붙어 있는 것은 이 세션의 시스템 안내(MCP 서버 instructions)와 노출된 `mcp__…`·`plugin:…` 도구 이름에서 확인.
- 추가 후보는 WebSearch + WebFetch(§2 각주 [¹])로 확인. 미개봉 항목은 [²].
- 로드맵 컷 리스트: `teams/dev/roadmap.json` 의 `cutList`.
