#!/usr/bin/env node
// 훅 → 버스.
//
// Claude Code 가 훅 이벤트마다 stdin 으로 JSON 을 준다. 그걸 작전실 대화록에 옮긴다.
// 에이전트가 "채팅방에 쓰는 것"을 기억할 필요가 없게 만드는 게 이 파일의 전부다.
// 기억해야 하는 규칙은 반드시 빠뜨려지기 때문이다.
//
// 등록은 .claude/settings.json 에서 한다.
//
// 주의 (공식 문서):
//  - 매칭되는 훅은 전부 병렬로 실행된다 → append 는 한 번의 write 로 (bus.mjs 가 처리)
//  - stdout 이 '{' 로 시작하지 않으면 JSON 제어가 통째로 무시된다 → 아무것도 찍지 않는다
//  - --bare 로 띄운 세션은 훅을 아예 로드하지 않는다

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const AGENTS_DIR = path.join(ROOT, 'state', 'agents');   // 서브에이전트 등장 시각 (gitignore)
const DEBUG = process.env.PPANAM_HOOK_DEBUG === '1';

// 훅이 죽어도 세션은 계속 가야 한다. 무슨 일이 있어도 조용히 0으로 끝낸다.
const bail = (why) => {
  if (DEBUG) fs.appendFileSync(path.join(HERE, 'debug.log'), `skip: ${why}\n`);
  process.exit(0);
};

let bus;
try {
  bus = await import(path.join(ROOT, 'bus', 'bus.mjs'));
} catch (e) {
  bail('bus 로드 실패 ' + e.message);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

let hook;
try {
  hook = JSON.parse((await readStdin()).trim() || '{}');
} catch (e) {
  bail('payload 파싱 실패');
}

// 필드 확인용. 문서에서 확정 못 한 필드가 있어 실물을 남겨둔다 (docs/plan.md 부록 A).
if (DEBUG) {
  fs.writeFileSync(
    path.join(HERE, `payload-${hook.hook_event_name ?? 'unknown'}.json`),
    JSON.stringify(hook, null, 2),
  );
}

/* 서브에이전트 등장 마커는 나갈 때 무조건 거둔다 — 방이 정해졌든, 기록하든 말든. 마커는 방과 무관하게 ROOT 아래에 있고,
 * 아래 어느 bail 보다 먼저 있어야 어떤 경로로도 남지 않는다 (레오 감사, 2026-09-12). */
const ev = hook.hook_event_name;
let enteredAt = null;
if (ev === 'SubagentStop' && hook.agent_id) {
  const marker = path.join(AGENTS_DIR, String(hook.agent_id));
  try { enteredAt = fs.readFileSync(marker, 'utf8').trim(); } catch { /* 들어온 기록이 없다 */ }
  try { fs.unlinkSync(marker); } catch { /* 없으면 그만 */ }
}

/* 어느 작전실인가.
 *
 * 방을 명시하지 않은 세션은 아무 방에도 기록하지 않는다. 기본값으로 떨어뜨리면
 * 이 저장소에서 도는 모든 세션이 남의 방에 남는다 — 하네스를 고치는 세션의
 * 발언이 실무의 말로 둔갑한다. 실제로 그렇게 오염됐다.
 *
 * 방은 서버가 세션을 띄우며 넣는 PPANAM_TEAM 하나로 정해진다. 예전의 state/active-team(터미널 opt-in)은
 * 이 저장소의 모든 세션을 한 방에 기록하는 전역 스위치라 없앴다 (Fable 재점검, 2026-09-12).
 */
const team = process.env.PPANAM_TEAM;
if (!team) bail('방이 지정되지 않은 세션');
if (!bus.teamExists(team)) bail('없는 방: ' + team);

/* 작전실은 라운드가 돌고 있을 때만 기록한다.
   그러지 않으면 이 저장소에서 하는 모든 잡담이 작전실에 흘러든다.
   총괄실은 방 자체가 대표와의 1:1 이라 라운드가 없다. 늘 기록한다. */
const office = bus.isOffice(team);
const state = bus.readState(team);

// 막힌 방(FAIL, 대표 판단 대기)도 열린 라운드다 — FAIL 직후 실무의 "무엇이 막혔는지" 보고가 남아야 한다.
if (!office && state.phase === 'idle' && !bus.idleChatAllowed(team) && process.env.PPANAM_ALWAYS !== '1') bail('라운드 대기 중');

/* 화자 결정.
   자리 = 프로세스. 서버가 세션을 띄우며 PPANAM_ACTOR 를 넣는다 (server/session.mjs) — 이 세션이 곧 그 자리다.
   없으면(예전 방식, 대표의 터미널) 방 주인이다 — 작전실이면 실무, 총괄실이면 총괄. */
const ME = process.env.PPANAM_ACTOR || (office ? 'chief' : 'guide');
const OWNER = ME;

/* 서브에이전트 이벤트는 과도기 것이다. 캐스트 자리 이름(review·ops·outside, 팀 접두 포함)이면 그 자리로,
   그 밖(Explore 등 임시 도구)은 화자가 아니다 — 기록하지 않는다. 전에는 임시 서브에이전트의 마지막 말이
   방 주인의 발언으로 찍혔다. */
const CAST = new Set(['guide', 'review', 'outside', 'chief', 'ops']);
const actorOf = (t) => {
  if (!t) return ME;
  if (CAST.has(t)) return t;
  const m = /-(review|outside|ops)$/.exec(t);
  return m ? m[1] : null;
};

const trim = (s, n = 4000) => {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

let out = null;

switch (ev) {
  case 'UserPromptSubmit': {
    const text = hook.prompt;
    if (!text) break;

    // 이미 대화록에 있는 말을 귀에 넣어준 것이다. 말한 사람이 이미 남겼다.
    // 다만 이번 턴의 종류(판정 요청·일지)는 적어 둔다 — Stop 훅이 답을 어떻게 남길지 여기서 정해진다.
    if (bus.isQuietRelay(text)) {
      const kind = bus.turnKindOf(text);
      if (kind) {
        const target = kind === 'verdict' ? (/⟦판정 요청⟧\s*([^\n]*)/.exec(text)?.[1] ?? '').trim().slice(0, 200) : '';
        try { bus.writeTurn(team, ME, kind, target, hook.session_id); } catch { /* 못 적으면 말로 남는다 */ }
      }
      bail('들려주기 — 기록 안 함');
    }

    // 하네스가 세션에 넣는 알림(백그라운드 작업 완료 등)은 대표가 한 말이 아니다.
    // 그대로 두면 대표 말풍선으로 남고, 감사역이 그걸 대표 지시로 읽는다.
    const human = bus.stripSystemBlocks(text);
    if (!human) bail('하네스 알림 — 대표 발언 아님');

    // 총괄이 배달한 봉투면 원문과 배분을 갈라 두 건으로 남긴다.
    // 한 말풍선에 두 블록으로 두면 언젠가 섞이고, 섞이면 원문이 사라진다.
    const relay = bus.splitRelay(text);
    if (relay) {
      bus.emit(team, {
        actor: 'boss', type: 'message', text: trim(relay.origin),
        meta: { via: 'chief' },   // 대표가 이 방에서 직접 한 말은 아니다
      });
      if (relay.assign) {
        out = { actor: 'chief', type: 'message', text: trim(relay.assign) };
      }
      break;
    }

    out = { actor: 'boss', type: 'message', text: trim(human) };
    break;
  }

  case 'SubagentStart': {
    const a = actorOf(hook.agent_type);
    if (!a) bail('캐스트가 아닌 서브에이전트 — 기록 안 함');
    const cast = bus.readCast(team);
    const name = cast.agents?.[a]?.name ?? a;
    // 언제 들어왔는지 남긴다. 나갈 때 "그동안 방에 말했나" 를 보기 위해서다.
    if (hook.agent_id) {
      try {
        fs.mkdirSync(AGENTS_DIR, { recursive: true });
        fs.writeFileSync(path.join(AGENTS_DIR, String(hook.agent_id)), new Date().toISOString());
      } catch { /* 못 남기면 나갈 때 그냥 기록한다 */ }
    }
    out = { actor: 'system', type: 'enter', text: `${name} 님이 들어왔습니다` };
    break;
  }

  case 'Stop':
  case 'SubagentStop': {
    // 문서가 transcript 파싱 대신 이 필드를 쓰라고 명시한다.
    const text = hook.last_assistant_message;
    if (!text) break;
    if (/^\s*<analysis\b/i.test(text)) bail('압축 속말 — 기록 안 함');
    // 영어 속말 — 통째로 영어면 걸렸는데(가-힣 0개), 코드·명령 예시에 한글 낱말 몇 개만 섞이면 안
    // 걸렸다(백틱 안 한글 둘이 방패가 된 400자 영어 요약, 나리 09-16 실측). 비율로 본다 — 영어 글자가
    // 한글 글자의 6배를 넘고 40자 이상이면 덩이. 정상적인 한글 문장 속 영어 낱말 몇 개는 안 걸린다.
    const koreanChars = (text.match(/[가-힣]/g) || []).length;
    const latinChars = (text.match(/[A-Za-z]/g) || []).length;
    if (latinChars >= 40 && latinChars > koreanChars * 6) bail('영어 속말 — 기록 안 함');
    const actor = ev === 'Stop' ? ME : actorOf(hook.agent_type);
    if (!actor) bail('캐스트가 아닌 서브에이전트 — 기록 안 함');

    // 이번 턴이 무엇이었나. 판정 요청이었으면 첫 줄이 판정이다 — 모든 엔진이 같은 규약. 일지였으면 대화록에 안 남는다.
    let turn = null;
    if (ev === 'Stop') {
      turn = bus.takeTurn(team, actor, hook.session_id);
      if (turn?.kind === 'journal') bail('일지 — 서버가 받는다');
      if (turn?.kind === 'verdict') {
        const v = bus.splitVerdictLine(text);
        if (v) {
          try { bus.recordVerdict(team, { actor, verdict: v.verdict, text: trim(v.body), target: bus.verdictTargetActor(team, turn.extra) }); }
          catch (e) { bus.emit(team, { actor, type: 'message', text: `[${v.verdict} — 판정으로 세지 않음: ${e.message}] ${trim(v.body)}` }); }
          process.exit(0);
        }
        // 판정을 요청받고도 첫 줄에 안 썼다. 말로 남기되 표시해 둔다 — 사회자가 한 번 더 묻는다.
        out = { actor, type: 'message', text: trim(text), meta: { noVerdict: true, ...(actor === 'system' ? { hand: 'server' } : {}) } };
        break;
      }
    }

    // 서브에이전트의 마지막 말은 실무에게 돌려주는 보고다. 그가 그동안 bus/say.mjs 로 방에 이미 말했으면
    // 그 보고는 같은 지적의 재요약이라 두 번 뜬다 (마케팅 R14, 2026-09-01). "(패스) 로 끝내라" 는 인격 문장은
    // 잊힌다 — 훅이 정한다: 들어온 뒤 방에 message/verdict 를 남겼으면 최종 보고는 기록하지 않는다.
    if (ev === 'SubagentStop' && enteredAt) {
      if (bus.readLog(team).some((e) => e.actor === actor && (e.type === 'message' || e.type === 'verdict') && e.ts >= enteredAt)) {
        bail('방에 이미 말함 — 최종 보고는 기록하지 않음');
      }
    }
    // 로밍 자리(나리·세라)가 다른 방에서 불려 집 세션이 답한 것 — turn.extra 에 부른 방이 실려 있다
    // (server/conductor.mjs callHomeElsewhere). 집 대화록의 이 원본 줄에 어느 방 답인지 찍어 둔다.
    out = { actor, type: 'message', text: trim(text), meta: {
      ...(actor === 'system' ? { hand: 'server' } : {}),
      ...(turn?.kind === 'called' && turn.extra ? { roam: turn.extra } : {}),
    } };
    if (!Object.keys(out.meta).length) out.meta = undefined;
    break;
  }

  case 'PostToolUse': {
    const tool = hook.tool_name;
    if (!tool) break;
    const i = hook.tool_input ?? {};
    const what = String(i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.command ?? i.prompt ?? '');
    // 하네스 내부 파일(임시 디렉터리의 작업 출력, 세션 메모리 등)은 이 방의 일이 아니다.
    // 저장소 밖 절대 경로는 남기지 않는다 — 총괄실 대화록이 /private/tmp/... 로 채워졌다.
    if (what.startsWith('/') && !what.startsWith(ROOT + '/') && what !== ROOT) bail('저장소 밖 경로');
    out = {
      actor: actorOf(hook.agent_type) ?? ME,   // 이 자리의 임시 도구가 쓴 도구는 이 자리의 것이다
      type: 'tool',
      text: trim(String(what).split('\n')[0], 160) || tool,
      meta: { tool },
    };
    break;
  }

  default:
    bail('다루지 않는 이벤트 ' + ev);
}

// 방에 남길 말이 없다는 표시. 진행 중계와 이미 한 말의 재요약을 막는다.
// 턴은 반드시 끝나야 하고 끝나면 훅이 기록하므로, 침묵할 방법을 따로 줘야 한다.
if (out && /^\(?패스\)?[.·\s]*$/.test(String(out.text).trim())) bail('패스 — 남길 말 없음');

if (!out) bail('내용 없음');

try {
  bus.emit(team, out);
} catch (e) {
  bail('emit 실패 ' + e.message);
}

// stdout 에는 아무것도 쓰지 않는다.
process.exit(0);
