// 호명 판별 — 말 첫머리 "@이름" 또는 "이름," (결정 128). 낱말 규칙은 하영 몫이라 이 둘로 임시.
// 화면(app.js bubble — 굵게)과 서버(bus.mjs peopleOf — 관제탑 카드 표시)가 같은 것을 본다. DOM 없이 문자열만 다룬다.

export const MENTION_RE = /^(@?)([가-힣]{1,6})(,|\s|$)/;

/** 첫머리가 호명이면 { full, marker, name, sep }, 아니면 null. name 이 실제 사람인지는 부르는 쪽이 cast 로 확인한다. */
export function parseMention(text) {
  const m = MENTION_RE.exec(String(text ?? ''));
  return m ? { full: m[0], marker: m[1], name: m[2], sep: m[3] } : null;
}
