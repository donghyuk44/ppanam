// svg 시안 셈 — 태그 짝·잘못된 & ·글자 줄 폭 어림(한글 1자 ≈ 글꼴 px, 라틴 0.55). 헨리 09-16. 사용: node teams/design/out/_svg-check.mjs <svg…>
import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const s = fs.readFileSync(f, 'utf8');
  const n = (re) => (s.match(re) || []).length;
  const bal = ['g', 'text', 'tspan', 'defs', 'style'].map((t) => `${t} ${n(new RegExp(`<${t}[\\s>]`, 'g'))}/${n(new RegExp(`</${t}>`, 'g'))}`).join(' · ');
  const amp = n(/&(?!(amp|lt|gt|quot|apos|#\d+);)/g);
  const unclosed = n(/<(rect|circle|line)\b[^>]*[^/]>/g);
  // 글 줄 폭 어림 — x 와 font-size 로 오른쪽 끝을 센다(class .t 12.5 · .s 11 · .m 10.5 · .k 10 · .b 12.5 · .code 11 · .none 12 · .h 13)
  const size = { t: 12.5, s: 11, m: 10.5, k: 10, b: 12.5, code: 11, none: 12, h: 13, pill: 9.5 };
  const wide = [];
  let gx = 0;
  for (const m of s.matchAll(/<g transform="translate\((\d+) \d+\)">|<text([^>]*)>([\s\S]*?)<\/text>/g)) {
    if (m[1] != null) { gx = Number(m[1]); continue; }
    const attrs = m[2], txt = m[3].replace(/<[^>]+>/g, '');
    const x = Number((attrs.match(/\bx="(-?[\d.]+)"/) || [0, 0])[1]);
    const cls = (attrs.match(/class="(\w+)"/) || [])[1];
    const fs_ = Number((attrs.match(/font-size="([\d.]+)"/) || [0, size[cls] ?? 12])[1]);
    let w = 0; for (const ch of txt) w += /[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch) ? fs_ : /[·—→▸◂▾▴✕⋮]/.test(ch) ? fs_ * 0.7 : fs_ * 0.55;
    const anchor = (attrs.match(/text-anchor="(\w+)"/) || [])[1];
    const right = anchor === 'end' ? gx + x : anchor === 'middle' ? gx + x + w / 2 : gx + x + w;
    const limit = gx < 400 ? 24 + 388 : 436 + 388;   // 두 열 시안 — 왼쪽 열 오른끝 412, 오른쪽 824
    if (right > limit + 2 && !/시안|1판 ·/.test(txt)) wide.push(`${Math.round(right)}>${limit} "${txt.slice(0, 28)}"`);
  }
  console.log(`${f}\n  ${bal} · 잘못된 & ${amp} · 안 닫힌 도형 ${unclosed}`);
  if (wide.length) console.log('  폭 넘침(어림):\n   ' + wide.join('\n   ')); else console.log('  폭 넘침 없음(어림)');
}
