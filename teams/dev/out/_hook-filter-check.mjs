// 훅 영어 속말 거름줄 — 표본 (작은 B apr_df4bc5b8, 나리 조건 ②). 돌리기: node --test teams/dev/out/_hook-filter-check.mjs
// 훅(.claude/hooks/to-bus.mjs)은 stdin 으로 도는 스크립트라 import 가 안 된다 — 여기서는 훅에 들어간 것과 **같은 식**을 두고 잰다.
// 3판(a174940, 솔라): 비율 규칙(0ce069e) 위에 영어 글자를 **낱말 단위**로만 거른다 — 백틱 안·경로·명령·해시 낱말(/ . : _ - 숫자 @ # = \ 든 것)은 빼고 센다.
//   줄째 버리던 내 2판은 "O1 is wired: …" 처럼 첫 낱말에 숫자가 든 영어 문장을 통째로 놓쳤다(솔라 실측). 대신 영어 제목 git log 는 걸리는데, 이 저장소 커밋 제목은 한글이라 실제로는 안 걸린다.
// 패치가 들어갔으면 훅 파일에서 그 줄을 읽어 여기 식과 글자가 같은지도 잰다(둘이 갈리면 실패).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PROSE = "const proseText = String(text).replace(/`[^`]*`/g, ' ').split(/\\s+/).filter((w) => w && !/[/.:_\\-\\d@#=\\\\]/.test(w)).join(' ');";
const proseText = (text) => String(text).replace(/`[^`]*`/g, ' ').split(/\s+/).filter((w) => w && !/[/.:_\-\d@#=\\]/.test(w)).join(' ');
const bails = (text) => {
  const koreanChars = (text.match(/[가-힣]/g) || []).length;
  const latinChars = (proseText(text).match(/[A-Za-z]/g) || []).length;
  return latinChars >= 40 && latinChars > koreanChars * 6;
};

test('이 저장소의 git log --oneline(한글 제목)은 기록된다 — 해시는 낱말이 아니고 제목은 한글', () => {
  const log = [
    '93f76da 결정 187·188 — 서버 시간값 목록 (사람 부르는 것 vs 기계 손목시계)',
    'e19fc15 방 머리 — 외부 감사 자리(레오·제리·다니엘·마크)는 안 부른 동안 대기',
    '1dc2cd0 상주 gemini 빈 답 — auto-denied 를 stderr 뿐 아니라 방 note 로',
    'da926b6 결정 188(대표 17:0x 모든 시간 관련된거 다 폐기) — 화면 쪽',
    'c0f1c77 장부 179~190 해석 줄을 200자로(189 톰 규칙, 원문은 그대로)',
    'bd4f7ff 제리(outside) 대조는 총괄실 카드만 — 팀 카드는 결정 185',
  ].join('\n');
  assert.equal(bails(log), false, '맨 git log 는 기록돼야 한다');
  assert.equal(bails('```\n' + log + '\n```'), false, '코드블록 안 git log 는 기록돼야 한다');
});

test('파일 목록·명령 답(한글 없음)은 기록된다', () => {
  const list = 'server/src/app.js\nserver/public/style.css\ndocs/event-schema.md\ntools/screen-shot.mjs\nnode tools/build-public.mjs\nnode bus/round.mjs check --all\nteams/dev/out/r32-check.md';
  assert.equal(bails(list), false);
});

test('영어 문장(한글 없음)은 bail — 첫 낱말에 숫자가 들어도(O1 is wired)', () => {
  assert.equal(bails('I think the best approach here is to refactor the whole module before adding the new feature.'), true);
  assert.equal(bails('O1 is wired: the round wait helper is pure and the stall check skips while the wait is active, so the silence call does not fire.'), true);
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

test('훅 파일에 들어간 식이 여기와 같다(들어가기 전이면 건너뜀)', (t) => {
  let src = null;
  try { const s = fs.readFileSync('.claude/hooks/to-bus.mjs', 'utf8'); if (s.includes('const proseText')) src = s; } catch { /* 없음 */ }
  if (!src) return t.skip('아직 패치 전');
  const line = src.split('\n').find((l) => l.includes('const proseText'));
  assert.equal(line.trim(), PROSE, '훅의 식과 이 시험의 식이 다르다 — 둘 중 하나를 맞춘다');
  assert.ok(src.includes('latinChars > koreanChars * 6'), '비율 규칙이 그대로 남아 있어야 한다');
});
