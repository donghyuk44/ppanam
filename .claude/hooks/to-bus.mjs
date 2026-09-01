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

/* 어느 작전실인가 */
const teamFile = path.join(ROOT, 'state', 'active-team');
let team = process.env.PPANAM_TEAM;
if (!team) { try { team = fs.readFileSync(teamFile, 'utf8').trim(); } catch { /* 없으면 기본값 */ } }
if (!team || !bus.teamExists(team)) team = bus.defaultTeam();

/* 라운드가 돌고 있을 때만 기록한다.
   그러지 않으면 이 저장소에서 하는 모든 잡담이 작전실에 흘러든다. */
const state = bus.readState(team);
if (state.phase !== 'running' && process.env.PPANAM_ALWAYS !== '1') bail('라운드 대기 중');

/* 화자 결정.
   메인 세션이 길잡이다 (대표가 말을 거는 상대). 서브에이전트는 자기 name 이 곧 화자다. */
const CAST = new Set(['guide', 'review', 'outside']);
const actorOf = (t) => (t && CAST.has(t) ? t : 'guide');

const trim = (s, n = 4000) => {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

const ev = hook.hook_event_name;
let out = null;

switch (ev) {
  case 'UserPromptSubmit': {
    // 문서에서 필드명을 확정하지 못했다. 있을 법한 것을 순서대로 본다.
    const text = hook.prompt ?? hook.user_prompt ?? hook.message ?? hook.text;
    if (text) out = { actor: 'boss', type: 'message', text: trim(text) };
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
        actor: ev === 'Stop' ? 'guide' : actorOf(hook.agent_type),
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

if (!out) bail('내용 없음');

try {
  bus.emit(team, out);
} catch (e) {
  bail('emit 실패 ' + e.message);
}

// stdout 에는 아무것도 쓰지 않는다.
process.exit(0);
