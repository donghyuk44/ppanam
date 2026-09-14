// 말 → 말풍선 조각 (마을, 대표 원문 R25 "줄바꿈, 한 박스에 표현할 내용이 너무 많으면 박스를 여러개로 노출").
// 순수 함수 — world.js 가 쓰고 bus/round.mjs check 가 같은 것을 돌린다. DOM 없음.
//
//   PIECE  조각 하나의 글자 수 상한(안팎 — 문장 끝에서 자르므로 조금 넘을 수 있는 게 아니라, 넘으면 띄어쓰기에서 강제로 자른다)
//   PIECES 한 말에서 띄우는 조각 수 상한 — 넘치면 마지막 조각 끝에 ' …' 을 붙이고 나머지는 작전실(↗)에서 읽는다

export const PIECE = 60;
export const PIECES = 6;
const END = /[.!?…。]$/;

/**
 * 줄바꿈·문장 끝(. ! ? … 。 + 공백)에서 자르고, 문장이 끝난 짧은 조각엔 다음 문장을 PIECE 안에서 붙인다.
 * 한 문장이 PIECE 를 넘으면 마지막 띄어쓰기에서(그게 절반보다 앞이면 그냥 PIECE 에서) 강제로 자른다 — 강제로 잘린 조각엔 안 붙인다.
 */
export function splitSpeech(text) {
  const full = String(text ?? '').trim();
  if (!full) return [];
  const out = [];
  for (const line of full.split(/\n+/)) {                       // 줄바꿈은 늘 경계 — 줄 너머로는 안 붙인다
    const sentences = line.replace(/([.!?…。])\s+/g, '$1\n').split('\n').map((s) => s.trim()).filter(Boolean);
    let first = out.length;
    for (const s of sentences) {
      let rest = s;
      while (rest.length > PIECE) {
        const sp = rest.lastIndexOf(' ', PIECE);
        const at = sp > PIECE / 2 ? sp : PIECE;
        out.push(rest.slice(0, at).trim()); rest = rest.slice(at).trim();
      }
      if (!rest) continue;
      const prev = out.length > first ? out[out.length - 1] : null;
      if (prev && END.test(prev) && prev.length + 1 + rest.length <= PIECE) out[out.length - 1] = prev + ' ' + rest;
      else out.push(rest);
    }
  }
  if (out.length > PIECES) { const kept = out.slice(0, PIECES); kept[PIECES - 1] += ' …'; return kept; }
  return out;
}
