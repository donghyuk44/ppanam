// 밤 시계 — 방이 조용하면 이름을 불러 깨운다. **틱마다 무조건 기록한다** (안 돌고 있는 걸 모르면 시계가 아니다).
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const W = '/Users/donghyukham/Documents/ppanam/.claude/worktrees/ppanam-review-issues-4058bc';
const LOG = process.env.NW_LOG;
const STALL_MIN = 5, EVERY_MS = 2 * 60 * 1000, COOLDOWN_MS = 8 * 60 * 1000;
const WORKERS = { marketing: '하영', dev: '테라, 솔라', design: '헨리, 클레멘타인', hq: '톰' };
const woke = {};
let n = 0;
const say = (s) => { try { fs.appendFileSync(LOG, `${new Date().toLocaleTimeString("sv-SE",{timeZone:"Asia/Seoul"})} ${s}\n`); } catch {} };

async function tick() {
  n += 1;
  const marks = [];
  try {
    const boot = await (await fetch('http://localhost:4321/api/boot', { signal: AbortSignal.timeout(8000) })).json();
    const now = Date.now();
    for (const t of boot.teams.map((x) => x.id)) {
      const s = boot.summaries[t] ?? {};
      // 라운드가 안 열렸다고 건너뛰지 않는다. 그게 09-14 의 버그였다 —
      // 총괄실은 원래 라운드를 안 열고, 마케팅은 단계를 통과시키고 라운드를 닫는 순간 감시에서 빠졌다.
      // 둘 다 여섯 시간을 서 있었고 로그에는 `-` 한 글자만 찍혀 대표가 먼저 찾아냈다.
      const idle = s.phase !== 'running';
      // 레오(codex)가 도는 동안은 방이 조용해 보인다 — 그때 깨우면 토큰만 쓰고 일하는 사람을 방해한다.
      const busy = Object.values(s.sessions ?? {}).some((x) => x.busy || x.queued) || s.conductor?.outsideBusy === true;
      let log = [];
      try { log = fs.readFileSync(`${W}/teams/${t}/log.jsonl`, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
      const last = log[log.length - 1];
      const age = last?.ts ? Math.round((now - Date.parse(last.ts)) / 60000) : -1;
      if (busy) { marks.push(`${t}:일함`); continue; }
      if (age < 0) { marks.push(`${t}:기록없음`); continue; }
      if (age < STALL_MIN) { marks.push(`${t}:${idle ? '쉼' : ''}${age}분`); continue; }
      if (woke[t] && now - woke[t] < COOLDOWN_MS) { marks.push(`${t}:${age}분(방금깨움)`); continue; }
      const who = WORKERS[t] ?? '실무';
      const msg = idle
        ? `${who}, ${age}분째 조용합니다 — 라운드가 닫혀 있습니다. 스스로 열 수 없습니다 — 다음 단계 착수는 B 승인이라 start 가 거부합니다(09-14 확인). 그러니 라운드를 열려고 하지 마시고, 다음 단계 착수 승인을 올리세요: node bus/approve.mjs --request B --next "다음 마일스톤 착수". 그것도 막혀 있으면 무엇에 막혔는지 방에 한 줄 남겨 주세요 — 기다리는 것도 조용하면 멈춘 것과 구별이 안 됩니다.`
        : `${who}, ${age}분째 조용합니다 — 밤 시계가 깨웁니다. 이어가세요. 막히면 방에 남기고, 대표님 판단이 필요하면 톰·제리에게 대리 결정을 요청하세요(결정 85 — 10분 답 없으면 둘 합의. 단 돈 나가는 것과 바깥 발송은 대표님만). 세션 권한 밖이지만 하네스가 대신 할 수 있는 일(파일 옮기기·도구 돌리기·화면 찍기)은 방에 적어 주세요 — 대표님께 권한 부탁하지 마세요. 그리고 상황판을 갱신해 주세요: node bus/progress.mjs --team ${t} --doing "..." --next "..."`;
      try {
        await run('node', [`${W}/bus/say.mjs`, '--team', t, '--as', 'system', msg], { cwd: W, timeout: 20000, maxBuffer: 1 << 20 });
        woke[t] = now; marks.push(`${t}:깨움(${age}분)`);
      } catch (e) { marks.push(`${t}:깨우기실패(${String(e.message).slice(0, 40)})`); }
    }
  } catch (e) { marks.push('서버못읽음:' + String(e.message).slice(0, 60)); }
  say(`#${n} ${marks.join(' ')}`);
}
say('밤 시계 다시 시작 — 3분마다, 8분 이상 조용하면 깨움, 틱마다 기록');
await tick();
setInterval(() => { tick().catch((e) => say('틱 터짐 — ' + String(e.message).slice(0, 80))); }, EVERY_MS);
