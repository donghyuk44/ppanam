// teams/*/out/ 산출물을 저장소에 넣되(나리 09-16, 위임 136 — 점검-0916 4절 1단계 '196커밋·60파일 이 PC 에만'), 100KB 넘는 그림은 뺀다.
// .gitignore 는 크기를 모르므로 이 스크립트가 그 목록을 만들어 표시 사이에 끼운다. 산출물을 커밋하기 전에 한 번 돌린다.
//
//   node tools/out-ignore.mjs            .gitignore 의 표시 블록을 다시 쓴다 (없으면 끝에 붙인다)
//   node tools/out-ignore.mjs --list     목록만 찍는다
//
// teams/dev/out/shots/ 는 통째로 뺀다(.gitignore 의 고정 줄) — 여기서는 그 밑을 세지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIMIT = 100 * 1024;
const IMG = /\.(png|jpe?g|gif|webp)$/i;
const SKIP_DIRS = new Set(['teams/dev/out/shots']);
const BEGIN = '# >>> out/ 의 100KB 넘는 그림 — tools/out-ignore.mjs 가 만든다. 손으로 고치지 말 것';
const END = '# <<< out/ 그림 끝';

/** 순수 — teams/<팀>/out 밑 그림 중 LIMIT 을 넘는 것의 저장소 기준 경로(정렬). walk 는 시험이 바꿔 끼운다. */
export function largeImages(root = ROOT, limit = LIMIT, walk = defaultWalk) {
  const out = [];
  for (const [rel, size] of walk(root)) {
    if (!IMG.test(rel) || size <= limit) continue;
    if ([...SKIP_DIRS].some((d) => rel.startsWith(d + '/'))) continue;
    out.push(rel);
  }
  return out.sort();
}
function* defaultWalk(root) {
  const teams = path.join(root, 'teams');
  for (const t of fs.readdirSync(teams, { withFileTypes: true })) {
    if (!t.isDirectory()) continue;
    const outDir = path.join(teams, t.name, 'out');
    if (!fs.existsSync(outDir)) continue;
    const stack = [outDir];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(abs);
        else if (e.isFile()) yield [path.relative(root, abs).split(path.sep).join('/'), fs.statSync(abs).size];
      }
    }
  }
}

/** 순수 — .gitignore 글에서 표시 블록을 목록으로 갈아 끼운다. 블록이 없으면 끝에 붙인다. */
export function spliceBlock(text, list) {
  const block = [BEGIN, ...list, END].join('\n');
  const lines = String(text ?? '').split('\n');
  const a = lines.indexOf(BEGIN), b = lines.indexOf(END);
  if (a >= 0 && b > a) return [...lines.slice(0, a), ...block.split('\n'), ...lines.slice(b + 1)].join('\n');
  const base = String(text ?? '').replace(/\n*$/, '');
  return `${base}\n\n${block}\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const list = largeImages();
  if (process.argv.includes('--list')) { for (const f of list) console.log(f); process.exit(0); }
  const file = path.join(ROOT, '.gitignore');
  const before = fs.readFileSync(file, 'utf8');
  const after = spliceBlock(before, list);
  if (after !== before) fs.writeFileSync(file, after);
  console.log(`.gitignore — out/ 의 100KB 넘는 그림 ${list.length}개${after !== before ? ' (고쳤다)' : ' (그대로)'}`);
}
