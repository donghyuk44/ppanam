// 훅 영어 속말 거름줄 — 표본 (작은 B apr_df4bc5b8, 나리 조건 ②). 돌리기: node --test teams/dev/out/_hook-filter-check.mjs
// 훅(.claude/hooks/to-bus.mjs)은 stdin 으로 도는 스크립트라 import 가 안 된다 — 여기서는 patch-hook-filter-0916.mjs 가 넣는 것과 **같은 식**을 두고 잰다.
// 2판: 솔라 비율 규칙(0ce069e — 영어 글자 ≥ 40 이고 한글 글자의 6배 넘으면 덩이) 위에, 영어 글자를 **문장**에서만 센다.
// 패치가 들어갔으면 훅 파일에서 그 줄을 읽어 여기 식과 글자가 같은지도 잰다(둘이 갈리면 실패).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// patch-hook-filter-0916.mjs 의 to[1] 과 같은 식 — 백틱 안 · 첫 토큰이 해시·경로인 목록 줄 · 경로·명령 토큰을 뺀 문장
const proseText = (t) => String(t).replace(/`[^`]*`/g, ' ').split('\n').filter((l) => !/^\s*\S*[\/\\.:\d]\S*(\s|$)/.test(l)).join(' ').split(/\s+/).filter((w) => w && !/[\/.:_\-\d@#=\\]/.test(w)).join(' ');
const bails = (text) => {
  const koreanChars = (text.match(/[가-힣]/g) || []).length;
  const latinChars = (proseText(text).match(/[A-Za-z]/g) || []).length;
  return latinChars >= 40 && latinChars > koreanChars * 6;
};

test('git log --oneline 열 줄(한글 없음)은 기록된다 — 해시·경로·명령 토큰은 문장이 아니다', () => {
  const log = [
    'a1b2c3d Add usage ledger module and tools permission note',
    'b2c3d4e Fix build:public path in shelf.md',
    'c3d4e5f Wire /api/card/<team> to card.js shape',
    'd4e5f6a Move castRow to settings tab',
    'e5f6a7b Hide village tab; open via #team/world',
    'f6a7b8c Add work-board block on dashboard',
    'a7b8c9d Plain-language doneOf texts',
    'b8c9d0e Rename tabs to standard product words',
    'c9d0e1f Mention chips and @ autocomplete',
    'd0e1f2a Slash commands /start /end /review',
  ].join('\n');
  // 커밋 제목이 영어 문장이라도 줄 첫 토큰이 해시라 목록 줄로 통째로 빠진다 — 그대로 붙여도, 코드블록 안이어도, 백틱 줄이어도 기록된다.
  assert.equal(bails(log), false, '맨 git log 는 기록돼야 한다');
  assert.equal(bails('```\n' + log + '\n```'), false, '코드블록 안 git log 는 기록돼야 한다');
  assert.equal(bails('git log --oneline -10\n' + log.split('\n').map((l) => '`' + l + '`').join('\n')), false, '백틱 줄 git log 는 기록돼야 한다');
});

test('파일 목록·명령 답(한글 없음)은 기록된다', () => {
  const list = 'server/src/app.js\nserver/public/style.css\ndocs/event-schema.md\ntools/screen-shot.mjs\nnode tools/build-public.mjs\nnode bus/round.mjs check --all\nteams/dev/out/r32-check.md';
  assert.equal(bails(list), false);
});

test('영어 문장(한글 없음)은 여전히 bail', () => {
  const prose = 'I think the best approach here is to refactor the whole module before adding the new feature.';
  assert.equal(bails(prose), true);
  assert.equal(bails('Let me look at this more carefully and then decide what to do next.'), true);
});

test('영어 덩이에 한글 낱말 둘이 섞여도 bail — 백틱 안이든 밖이든(솔라 0ce069e 실측)', () => {
  const chunk = 'The session summarized the pending work: the reconnect banner, the verdict card, the usage ledger, and the mention chips. It then listed the reasons in `사유` and the time in `시각` and continued with a long explanation of what should happen next in the room.';
  assert.equal(bails(chunk), true, '백틱 안 한글 둘은 방패가 아니다');
  assert.equal(bails(chunk.replace(/`/g, '')), true, '맨 한글 둘도 방패가 아니다');
});

test('한글 문장 속 영어 낱말 몇 개(함수명·파일명)는 안 거른다', () => {
  assert.equal(bails('테라, app.js 의 renderTowerAll 을 고치면 bossLine 도 같이 봐야 해요 — verdictCard 는 그대로예요.'), false);
  assert.equal(bails('솔라, /api/card/dev 가 usage 를 안 실어서 SHOW_USAGE 는 아직 꺼 뒀어요.'), false);
});

test('훅 파일(또는 사본)에 패치가 들어갔으면 식이 여기와 같다(들어가기 전이면 건너뜀)', (t) => {
  // 진짜 훅은 관리 창 손 — 테라는 사본(teams/dev/out/_hook-copy.mjs)에 먼저 돌려 같은 식이 들어가는지 잰다
  let src = null;
  for (const p of ['.claude/hooks/to-bus.mjs', 'teams/dev/out/_hook-copy.mjs']) { try { const s = fs.readFileSync(p, 'utf8'); if (s.includes('const proseText')) { src = s; break; } } catch { /* 없음 */ } }
  if (!src) return t.skip('아직 패치 전 — node tools/patch-hook-filter-0916.mjs 는 관리 창 손');
  const line = src.split('\n').find((l) => l.includes('const proseText'));
  const want = "const proseText = String(text).replace(/`[^`]*`/g, ' ').split('\\n').filter((l) => !/^\\s*\\S*[\\/\\\\.:\\d]\\S*(\\s|$)/.test(l)).join(' ').split(/\\s+/).filter((w) => w && !/[\\/.:_\\-\\d@#=\\\\]/.test(w)).join(' ');";
  assert.equal(line.trim(), want, '훅의 식과 이 시험의 식이 다르다 — 둘 중 하나를 맞춘다');
  assert.ok(src.includes('latinChars > koreanChars * 6'), '솔라 비율 규칙이 그대로 남아 있어야 한다');
});
