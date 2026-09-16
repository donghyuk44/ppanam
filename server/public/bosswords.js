// 대표 화면 글이 사람 말인가 — 자 하나(결정 140, 대표 09-16 "가시성 가독성 사용성 0점").
// 화면(app.js)·자(tools/boss-words-check.mjs)·버스가 같은 것을 본다 — when.js·notify.js 와 같은 자리, 순수 함수뿐이라 어디서든 import.
// 하네스 말 = 카드 번호·파일 경로·결정 번호·회차/단계·판정 낱말·커밋 해시. 한 낱말이라도 있으면 그 줄은 대표가 못 읽는 줄이다.
// 나리 사용성-0916 2절 원칙 ①: 대표님이 보는 자리는 사람 말 한 줄, 60자 안. 안 맞으면 화면에 안 낸다 — 글 대신 NOT_YET, 원문은 펼침.

export const MAX_LEN = 60;
export const NOT_YET = '요약 없음';
export const JARGON = /apr_|evt_|req_|\.(md|mjs|json|svg|png|css|js)\b|결정 ?\d|\d+회차|\d+단계|\bM\d\b|\bR\d+\b|\bPASS\b|\bREVISE\b|\bFAIL\b|\b[0-9a-f]{7}\b|\bstatus\b|roadmap|progress|commit|\/out\/|--\w|settings|\.gitignore|build:public|재시작 카드/;

/** 하네스 낱말이 없는가 (길이는 안 본다 — 자 --all 이 낱말과 길이를 따로 찍는다). */
export const isBossWord = (s) => !JARGON.test(String(s ?? ''));

/** 대표 화면에 낼 수 있는 줄인가 — 비어 있지 않고, 하네스 낱말 없고, 60자 안. */
export const bossOk = (s) => { const t = String(s ?? '').trim(); return !!t && t.length <= MAX_LEN && isBossWord(t); };
