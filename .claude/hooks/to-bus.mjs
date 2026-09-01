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

/* 어느 작전실인가.
 *
 * 방을 명시하지 않은 세션은 아무 방에도 기록하지 않는다. 기본값으로 떨어뜨리면
 * 이 저장소에서 도는 모든 세션이 남의 방에 남는다 — 하네스를 고치는 세션의
 * 발언이 실무의 말로 둔갑한다. 실제로 그렇게 오염됐다.
 *
 *   PPANAM_TEAM        서버가 방마다 세션을 띄우며 넣는다 (정상 경로)
 *   state/active-team  터미널에서 직접 한 방에 들어갈 때만 만든다 (opt-in)
 */
const teamFile = path.join(ROOT, 'state', 'active-team');
let team = process.env.PPANAM_TEAM;
if (!team) { try { team = fs.readFileSync(teamFile, 'utf8').trim(); } catch { /* 안 들어간 것이다 */ } }
if (!team) bail('방이 지정되지 않은 세션');
if (!bus.teamExists(team)) bail('없는 방: ' + team);

/* 작전실은 라운드가 돌고 있을 때만 기록한다.
   그러지 않으면 이 저장소에서 하는 모든 잡담이 작전실에 흘러든다.
   총괄실은 방 자체가 대표와의 1:1 이라 라운드가 없다. 늘 기록한다. */
const office = bus.isOffice(team);
const state = bus.readState(team);
if (!office && state.phase !== 'running' && process.env.PPANAM_ALWAYS !== '1') bail('라운드 대기 중');

/* 화자 결정.
   메인 세션이 실무다 (대표가 말을 거는 상대). 서브에이전트는 자기 name 이 곧 화자다. */
/* 화면에 나타나는 화자는 이 셋뿐이다 (docs/event-schema.md 1절).
   서브에이전트 이름은 팀별로 갈라지므로(marketing-review 등) 접미사로 되돌린다.
   이걸 안 하면 팀별 감사역이 전부 실무로 찍힌다. */
const CAST = new Set(['guide', 'review', 'outside', 'chief']);

/** 메인 세션은 그 방의 주인이다 — 작전실이면 실무, 총괄실이면 총괄. */
const OWNER = office ? 'chief' : 'guide';

const actorOf = (t) => {
  if (!t) return OWNER;
  if (CAST.has(t)) return t;
  const m = /-(review|outside)$/.exec(t);
  return m ? m[1] : OWNER;
};

const trim = (s, n = 4000) => {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

const ev = hook.hook_event_name;
let out = null;

switch (ev) {
  case 'UserPromptSubmit': {
    const text = hook.prompt;
    if (!text) break;

    // 이미 대화록에 있는 말을 귀에 넣어준 것이다. 말한 사람이 이미 남겼다.
    if (bus.isQuietRelay(text)) bail('들려주기 — 기록 안 함');

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
    const cast = bus.readCast(team);
    const name = cast.agents?.[a]?.name ?? a;
    out = { actor: 'system', type: 'enter', text: `${name} 님이 들어왔습니다` };
    break;
  }

  case 'Stop':
  case 'SubagentStop': {
    // 문서가 transcript 파싱 대신 이 필드를 쓰라고 명시한다.
    const text = hook.last_assistant_message;
    if (text) {
      out = {
        actor: ev === 'Stop' ? OWNER : actorOf(hook.agent_type),
        type: 'message',
        text: trim(text),
      };
    }
    break;
  }

  case 'PostToolUse':
  case 'PreToolUse': {
    if (ev === 'PreToolUse') bail('PostToolUse 만 기록');
    const tool = hook.tool_name;
    if (!tool) break;
    const i = hook.tool_input ?? {};
    const what = i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.command ?? i.prompt ?? '';
    out = {
      actor: actorOf(hook.agent_type),
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
