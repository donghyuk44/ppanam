// agy(Antigravity CLI) 권한 — 외부 감사가 **읽기만** 하게 ~/.gemini/antigravity-cli/settings.json 의 permissions 를 채운다.
//
// 왜: 헤드리스(agy -p)는 승인이 필요한 도구를 그냥 거부한다. 실측(09-14): "jetski: no output produced — a tool required the 'command' permission that headless
// mode cannot prompt for, so it was auto-denied" → 레오가 파일을 읽으려다 막혀 "(빈 답)" 을 냈다. --dangerously-skip-permissions 는 쓰기까지 열려 감사역에 못 쓴다.
// 규칙 문법(antigravity.google/docs/cli/permissions): action(target) — read_file(*) · command(prefix) · write_file(*) · Deny > Ask > Allow.
//
//   node tools/antigravity/agy-permissions.mjs            적용 (있던 규칙은 남기고 우리 것을 합친다, 원본은 settings.json.bak-<시각>)
//   node tools/antigravity/agy-permissions.mjs --show     지금 파일만 보여 준다
//
// 이 파일은 워크트리 밖(~/.gemini)을 쓰므로 실무 세션이 못 돌린다 — 하네스나 대표 손. 한 번이면 된다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const FILE = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
export const ALLOW = [
  'read_file(*)',
  'command(cat)', 'command(head)', 'command(tail)', 'command(sed -n)', 'command(grep)', 'command(rg)', 'command(ls)', 'command(wc)', 'command(find)', 'command(stat)', 'command(file)', 'command(jq)',
  'command(git diff)', 'command(git diff --stat)', 'command(git log)', 'command(git show)', 'command(git status)', 'command(git rev-parse)', 'command(git ls-files)',
  'command(node --check)', 'command(node --test)', 'command(node bus/round.mjs check)', 'command(node bus/round.mjs status)',
  // 감사가 물건을 연다(점검-0916 3-9) — 화면 사진과 책장 조회. 둘 다 읽기(사진은 out/shots/ 에 쓰지만 저장소 코드는 안 건드린다).
  'command(node tools/screen-shot.mjs)', 'command(node tools/library.mjs)',
  // 작업 보드가 "확인: node tools/work-board.mjs" 로 시키는 것과 대표 화면 자 — 둘 다 읽기만. 09-16 16:5x 실측: 레오가 33회차 판정에서 이걸 돌리다
  // "a tool required the 'command' permission … auto-denied" 로 빈 답을 내고 방엔 아무것도 안 떴다(대표 "레오 안켜진다"). 상주 gemini stderrTail 에만 남아 있었다.
  'command(node tools/work-board.mjs)', 'command(node tools/boss-words-check.mjs)',
];
export const DENY = [
  'write_file(*)',
  'command(rm)', 'command(mv)', 'command(cp)', 'command(git push)', 'command(git commit)', 'command(git add)', 'command(git reset)', 'command(git checkout)', 'command(git rebase)',
  'command(npm)', 'command(npx)', 'command(curl)', 'command(pkill)', 'command(kill)',
];
/**
 * 있던 설정에서 빼는 규칙. `unsandboxed(*)` 는 09-14 에 넣었는데 Deny > Allow 라 **모든 명령**이 "Matches user-configured deny rule" 로 거부됐다 —
 * 외부감사 넷의 도구 이벤트가 0 이던 진짜 원인(나리 실측 09-16: 그림은 읽고 명령은 전부 거부). 나리가 ~/.gemini 에서 손으로 뺐고, 다시 돌려도 안 들어가게 여기서도 뺀다.
 */
export const DROP = ['unsandboxed(*)'];

/** 순수 — 있던 설정에 우리 규칙을 합친다. 중복은 하나, 있던 것은 남긴다(DROP 만 뺀다). round.mjs check 가 돌린다. */
export function mergePermissions(settings) {
  const s = settings && typeof settings === 'object' ? { ...settings } : {};
  const p = { ...(s.permissions ?? {}) };
  const uniq = (a) => [...new Set(a.filter(Boolean))].filter((x) => !DROP.includes(x));
  p.allow = uniq([...(p.allow ?? []), ...ALLOW]);
  p.deny = uniq([...(p.deny ?? []), ...DENY]);
  s.permissions = p;
  return s;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (fs.existsSync(FILE)) { console.error(`${FILE} 을 못 읽음 — ${e.message}`); process.exit(1); } }
  if (process.argv.includes('--show')) { console.log(JSON.stringify(cur, null, 2)); process.exit(0); }
  const next = mergePermissions(cur);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, `${FILE}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
  console.log(`${FILE} — allow ${next.permissions.allow.length} · deny ${next.permissions.deny.length}. 시험: node bus/outside.mjs --check --engine agy --debug "teams/dev/out/m6-screen-inventory.md 2절 제목을 인용해라"`);
}
