// 산출물 경로 → 링크. 발언·승인 카드에 적힌 "out/kit/concept.png"·"teams/design/out/direction.md" 를 찾아
// /out/<팀>/<경로> 로 잇는다 (대표 결정 36 — "디자인 그림이 없는데 내가 어떻게 승인해").
// "in/…" 도 같은 자리 — 대표가 방에 올린 그림(결정 130 ②, teams/<팀>/in/). 폴더만 다르고 나머지는 같다.
// DOM 없이 문자열만 다룬다. 화면(app.js)·서버(bus.mjs 승인 카드)·자가 시험(round.mjs check)이 같은 것을 쓴다.

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const TEXT = new Set(['txt', 'json', 'jsonl', 'csv']);

// 앞이 글자·숫자·'/' 가 아니어야 한다 — 내가 만든 "/out/<팀>/…" 링크와 "layout/x" 를 다시 잡지 않는다.
// 마지막 조각에 ASCII 확장자가 있어야 파일이다 — "out/kit/" 같은 폴더와 "concept.png을" 의 조사는 안 들어온다.
// 뒤에 붙은 마침표·쉼표·가운뎃점은 문장 부호라 경로가 아니다.
const SEG = '[\\p{L}\\p{N}_-][\\p{L}\\p{N}_.-]*';
const RE = new RegExp(`(?<![\\p{L}\\p{N}_/])(?:teams/([A-Za-z0-9_-]+)/)?(out|in)/((?:${SEG}/)*${SEG}\\.[A-Za-z0-9]+)`, 'gu');

export function kindOf(rel) {
  const ext = String(rel).split('.').pop().toLowerCase();
  return IMAGE.has(ext) ? 'image' : ext === 'md' ? 'md' : TEXT.has(ext) ? 'text' : 'file';
}

export const outUrl = (team, rel, root = 'out') => `/${root}/${encodeURIComponent(team)}/${String(rel).split('/').map(encodeURIComponent).join('/')}`;

/** 경로 하나를 카드가 쓰는 모양으로. root 는 'out'|'in' — 기본은 out(예전 그대로). */
export const outItem = (team, rel, raw = `out/${rel}`, root = 'out') => ({ raw, team, rel, root, url: outUrl(team, rel, root), kind: kindOf(rel) });

/**
 * 글에서 산출물 경로를 찾는다. 같은 파일은 한 번, 적힌 순서대로.
 * @param team "out/…"·"in/…" 처럼 팀이 안 적힌 경로가 속한 방. 없으면 그런 경로는 건너뛴다.
 */
export function findOutPaths(text, team) {
  const seen = new Map();
  for (const m of String(text ?? '').matchAll(RE)) {
    const t = m[1] ?? team;
    if (!t) continue;
    const key = `${m[2]}/${t}/${m[3]}`;
    if (!seen.has(key)) seen.set(key, outItem(t, m[3], m[0], m[2]));
  }
  return [...seen.values()];
}

/** 글 안의 경로를 wrap(item) 이 돌려주는 문자열로 바꾼다. 화면이 이미 HTML 로 이스케이프한 본문에 쓴다 — 경로엔 &<>" 가 없다. */
export function linkOutPaths(text, team, wrap) {
  return String(text ?? '').replace(RE, (raw, t, root, rel) => {
    const item = outItem(t ?? team, rel, raw, root);
    return item.team ? wrap(item) : raw;
  });
}
