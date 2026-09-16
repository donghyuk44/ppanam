// 방 말 검사 — 우리끼리만 아는 낱말이 방에 오르면 그 말풍선 밑에 "쉬운 말로 다시" 표시 (대표 결정, 18:29 장부 198 ②).
// 대표 화면 자(bossOk, bosswords.js)와 같은 원칙 — **막지 않는다, 표시만 붙인다**. 낱말표는 하영이 쓴다
// (teams/marketing/out/plain-words.md, req_fbfb6da7 — 파일이 없으면 아무것도 안 걸린다, 지어내지 않는다).
// 순수 함수뿐 — 파일 읽기는 bus.mjs 몫.
// 의존성 없음. 브라우저·node 둘 다.

/** 낱말표 글 → 낱말 배열. 한 줄에 하나, "- " 머리·"#" 주석·빈 줄은 버림, 줄에 "·"·"," 로 설명이 붙어 있으면 앞말만. */
export function parseInsiderWords(text) {
  return String(text ?? '').split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/^[-*]\s*/, '').split(/[·,]/)[0].trim())
    .filter(Boolean);
}

/** 말에 낱말표의 낱말이 있으면 그 낱말, 없으면 null. 긴 낱말부터 봐서 짧은 낱말이 긴 낱말 안에 먼저 걸리지 않게. */
export function insiderWordHit(text, words) {
  const s = String(text ?? '');
  if (!s || !words?.length) return null;
  const sorted = [...words].sort((a, b) => b.length - a.length);
  return sorted.find((w) => w && s.includes(w)) ?? null;
}
