// 세라 창의 머리는 없다 — 총괄실 세션이 머리다. 이 파일은 이미 있는 서버 문 셋만 쓴다(결정 88·89).
//   상태: GET /api/boot · 말 걸기: POST /api/say { text, team } · 실시간: ws://localhost:4321/ws
// 서버 코드·계약은 여기서 하나도 안 바꾼다. localhost 고정 — 같은 맥 안에서만 돈다.

const SERVER = 'http://localhost:4321';
const TEAM = 'hq'; // 세라의 자리는 총괄실 여섯째(결정 86)

const $badge = document.getElementById('badge-count');
const $chat = document.getElementById('chat');
const $chatLog = document.getElementById('chat-log');
const $chatInput = document.getElementById('chat-input');
const $sera = document.getElementById('sera');

let pollTimer = null;

async function pollBoot() {
  try {
    const res = await fetch(`${SERVER}/api/boot`);
    if (!res.ok) throw new Error(`boot ${res.status}`);
    const boot = await res.json();
    // ④ 알린다 — 대표 차례가 있으면 배지, 없으면 조용히.
    const n = Array.isArray(boot.approvals) ? boot.approvals.length : 0;
    $badge.hidden = n === 0;
    $badge.textContent = String(n);
  } catch (e) {
    // 서버가 안 뜬 것도 "조용한 실패" 로 두지 않는다 — 눈에 보이게.
    $sera.title = `세라 — 서버에 못 닿습니다 (${e.message})`;
  }
}

function connectWs() {
  const ws = new WebSocket(`${SERVER.replace('http', 'ws')}/ws`);
  ws.addEventListener('message', (ev) => {
    // ⑤ 방에서 온 말 중 세라에게 오는 것만 채팅창에 옮긴다. 화면 계약(event-schema.md)은 안 바꾼다 — 그대로 읽는다.
    let evt;
    try { evt = JSON.parse(ev.data); } catch { return; }
    if (evt.team === TEAM && evt.actor === 'secretary') logLine(evt.text ?? '');
  });
  ws.addEventListener('close', () => setTimeout(connectWs, 3000));
}

function logLine(text) {
  const line = document.createElement('div');
  line.textContent = text;
  $chatLog.appendChild(line);
  $chatLog.scrollTop = $chatLog.scrollHeight;
}

async function sendToSera(text) {
  if (!text.trim()) return;
  logLine(`나: ${text}`);
  try {
    const res = await fetch(`${SERVER}/api/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, team: TEAM }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); logLine(`(안 감 — ${e.error ?? res.status})`); }
  } catch (e) {
    logLine(`(안 감 — ${e.message})`);
  }
}

$sera.addEventListener('click', () => { $chat.hidden = !$chat.hidden; if (!$chat.hidden) $chatInput.focus(); });
$chatInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const text = $chatInput.value;
  $chatInput.value = '';
  sendToSera(text);
});

pollBoot();
pollTimer = setInterval(pollBoot, 5000);
connectWs();
