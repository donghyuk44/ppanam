// 연속 도구 줄의 한 줄 요약 — "파일 7개 읽고 11개 고치는 중 (app.js, style.css …)".
// DOM 없이 문자열만 만든다. 화면(app.js)과 자가 시험(bus/round.mjs check)이 같은 것을 쓴다 —
// "고치고침" 을 눈으로만 보고 올렸다가 레오가 잡았다 (2026-09-13). 이 파일이 있어야 node 에서 돌려볼 수 있다.

const VERB = { Read: '읽', Edit: '고치', Write: '고치', NotebookEdit: '고치', MultiEdit: '고치', WebFetch: '가져오', WebSearch: '찾' };
const DONE = { 읽: '읽음', 고치: '고침', 가져오: '가져옴', 찾: '찾음', 쓰: '씀' };

export const baseName = (s) => String(s ?? '').replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? '';

/**
 * @param items [{ tool, text }] 도구 이름과 대상(경로)
 * @param live  아직 이어지는 중인가 — "…는 중" / 끝났으면 "…음·…침"
 * @param names 최대 몇 개의 파일 이름을 보여 주나
 */
export function toolLabel(items, live, names = 3) {
  const by = new Map();
  for (const it of items) { const v = VERB[it.tool] ?? '쓰'; by.set(v, (by.get(v) ?? 0) + 1); }
  const parts = [...by];
  // 어간 + 어미: 앞은 "읽고", 마지막은 "읽는 중" 또는 끝난 꼴 "읽음"(어간을 포함한 온전한 말 — 어간을 다시 붙이지 않는다).
  const verbs = parts.map(([v, n], i) => `${n}개 ${i < parts.length - 1 ? v + '고' : live ? v + '는 중' : DONE[v]}`).join(' ');
  const uniq = [...new Set(items.map((it) => baseName(it.text)).filter(Boolean))];
  const shown = names > 0 ? uniq.slice(0, names).join(', ') + (uniq.length > names ? ' …' : '') : '';   // names 0 = 이름 없이 수만(접힌 줄 — 폴드 QA #12, 이름은 펼칠 때)
  return `파일 ${verbs}${shown ? ` (${shown})` : ''}`;
}

/**
 * 주격 조사 — 받침이 있으면 "이", 없으면 "가". "헨리이 불렀습니다" 가 화면에 떴다 (레오 R15 B 감사).
 * 한글 음절이 아닌 끝(영문·숫자)은 "가". 화면과 check 가 같은 것을 쓴다.
 */
export function ga(name) {
  const s = String(name ?? '');
  const c = s.charCodeAt(s.length - 1);
  const hangul = c >= 0xac00 && c <= 0xd7a3;
  return s + (hangul && (c - 0xac00) % 28 !== 0 ? '이' : '가');
}
/** 목적격 조사 — 받침이 있으면 "을", 없으면 "를". "레오을 부르지 못했습니다" 가 R28 실측에 떴다. */
export function eul(name) {
  const s = String(name ?? '');
  const c = s.charCodeAt(s.length - 1);
  const hangul = c >= 0xac00 && c <= 0xd7a3;
  return s + (hangul && (c - 0xac00) % 28 !== 0 ? '을' : '를');
}

/** 도구 줄 하나를 사람 말로 — "app.js 고치는 중". 관제탑 카드의 "지금" 줄과 생존 알림이 쓴다 (결정 31). */
export function toolPhrase(item, live = true) {
  const v = VERB[item?.tool] ?? '쓰';
  const what = baseName(item?.text) || item?.tool || '무언가';
  return `${what} ${live ? v + '는 중' : DONE[v]}`;
}
