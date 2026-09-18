// 대표 화면 글이 사람 말인가 — 자 하나(결정 140, 대표 09-16 "가시성 가독성 사용성 0점").
// 화면(app.js)·자(tools/boss-words-check.mjs)·버스가 같은 것을 본다 — when.js·notify.js 와 같은 자리, 순수 함수뿐이라 어디서든 import.
// 하네스 말 = 카드 번호·파일 경로·결정 번호·회차/단계·판정 낱말·커밋 해시. 한 낱말이라도 있으면 그 줄은 대표가 못 읽는 줄이다.
// 나리 사용성-0916 2절 원칙 ①: 대표님이 보는 자리는 사람 말 한 줄, 60자 안. 안 맞으면 화면에 안 낸다 — 글 대신 NOT_YET, 원문은 펼침.

export const MAX_LEN = 60;
export const NOT_YET = '요약 없음';
// 파일은 **경로**(슬래시가 앞에 있는 것)만 하네스 말이다 — 슬래시 없는 이름 하나("app.js 고치는 중")는 하영 사전 215줄이 이미 사람 말로 적었고 나리가 대리로 봐줬다(R32).
// 손(담당·차례 뜻)·결(모양 뜻)·폴백 — 하영 사전 1절 149행(req_d82aaf90 ④), 꼴은 하영이 좁힌 것 그대로. 몸의 손("손으로 확인"·"손대다")은 안 걸린다.
// "결" 은 결정·결재·결과 안에 있으니 "새 결·옛 결·결로·결 " 꼴만. 한글엔 \b 가 없어 "문제 손"·"경제 손" 같은 오인식은 앞 글자 없음(?<![가-힣])으로 막는다.
export const JARGON = /apr_|evt_|req_|\/\S*\.(md|mjs|json|svg|png|css|js)\b|결정 ?\d|\d+회차|\d+단계|\bM\d\b|\bR\d+\b|\bPASS\b|\bREVISE\b|\bFAIL\b|\b[0-9a-f]{7}\b|\bstatus\b|roadmap|progress|commit|\/out\/|--\w|settings|\.gitignore|build:public|재시작 카드|손 뒤에|손이 둘|손이 비|(?<![가-힣])남은 손|(?<![가-힣])제 손(?!으로|대|을|에|\s*뗐)|관리 창 손|서버 손|손 하나|손이 없|손이 남|(?<![가-힣])새 결|(?<![가-힣])옛 결|(?<![가-힣])결로|(?<![가-힣])결 |폴백/;

/** 하네스 낱말이 없는가 (길이는 안 본다 — 자 --all 이 낱말과 길이를 따로 찍는다). */
export const isBossWord = (s) => !JARGON.test(String(s ?? ''));

/** 대표 화면에 낼 수 있는 줄인가 — 비어 있지 않고, 하네스 낱말 없고, 60자 안. */
export const bossOk = (s) => { const t = String(s ?? '').trim(); return !!t && t.length <= MAX_LEN && isBossWord(t); };

/* 화면이 조립하는 두 줄 — 자(tools/boss-words-check.mjs)가 원문이 아니라 **화면에 서는 글**을 재게 같은 함수를 여기 둔다(나리 R32 ①⑤: 자는 굵은 글만 재서 못 잡았다). */

/** 멤버 카드 "지금 하는 일" — 파일 도구(Read·Edit·Write)만 "app.js 고치는 중", Bash 같은 명령 글자는 "작업 중", 말이면 첫 문장. 60자 넘거나 하네스 말이면 부르는 쪽이 NOT_YET 로 가린다. */
export const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
export function doingWord(doing, { live = true, toolPhrase = null, firstLine = (s) => String(s ?? '').split(/\n/)[0] } = {}) {
  if (!doing) return '완료 없음';
  if (doing.tool) return FILE_TOOLS.has(doing.tool) && toolPhrase ? toolPhrase(doing, live) : '작업 중';
  // 말의 첫 문장 — 60자를 넘으면 잘라 "…"(마지막 말 여덟 중 대부분이 긴 문장이라 전부 "요약 없음" 으로 가려졌다, 솔라 실측 bed1224). 자른 것도 사람 말이다.
  const s = String(firstLine(doing.text) ?? '').trim() || '작업 중';
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN - 1).trimEnd() + '…' : s;
}
/** 작업 보드 병목 줄 — work.json 의 "server(솔라)"·"app.js(테라)" 는 괄호 안 사람의 차례, "나리 판정"·"재시작" 은 그대로. "솔라 차례 뒤에 7건 — 유진·노라 기다림"("손" 은 지은 말 — 적대검수 opus ⑤). */
export function gateLine(bottleneck, count, who = '') {
  const m = /^(.*?)\s*\((.+?)\)\s*$/.exec(String(bottleneck ?? ''));
  const gate = m ? `${m[2]} 차례` : String(bottleneck ?? '');
  return `${gate} 뒤에 ${count}건${who ? ` — ${who} 기다림` : ''}`;
}
