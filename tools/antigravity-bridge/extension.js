// ppanam — Antigravity 다리 (가설, 09-14). 대표: "gemini 로 교체하는 것이랑 조사하는 것 왜 팀한테 안 맡기고" — 개발 몫으로 받음.
//
// 가설: Antigravity 는 VS Code 계열이라 확장이 `vscode.lm`(Language Model API) 로 에디터 안의 모델을 부를 수 있다. 되면 이 확장이
// 127.0.0.1 에 작은 HTTP 문을 열고, bus/outside.mjs runGemini 가 파일 주고받기 대신 여기 묻는다 — 하네스가 창을 몰 일이 없어진다.
// **확인 안 됨** — Antigravity 가 vscode.lm 에 Gemini 를 내주는지(selectChatModels 가 빈 배열이면 이 길은 없다). 첫 실측이 그것이다:
//   명령 팔레트 → "ppanam: 다리가 보는 모델 목록"   또는   curl -s http://127.0.0.1:47831/models
//
// 문: POST /ask { prompt, model?(family 부분 문자열), sessionId? } → { answer, sessionId, model }  · GET /models → [{ vendor, family, name, id }]
// 세션: sessionId 마다 앞 대화를 기억한다(메모리, 마지막 40턴) — outside.mjs 의 resume 이 이걸 넘긴다.
// 안전: 127.0.0.1 만 듣는다. 파일을 쓰지 않는다. 포트는 PPANAM_BRIDGE_PORT 또는 47831.

const vscode = require('vscode');
const http = require('node:http');

const PORT = Number(process.env.PPANAM_BRIDGE_PORT || 47831);
const sessions = new Map();   // sessionId → [{ role, text }]
let server = null;

async function models() {
  const list = await vscode.lm.selectChatModels({});
  return list.map((m) => ({ vendor: m.vendor, family: m.family, name: m.name, id: m.id, maxInput: m.maxInputTokens }));
}

async function ask({ prompt, model = 'gemini', sessionId = null }) {
  const all = await vscode.lm.selectChatModels({});
  const pick = all.find((m) => `${m.vendor} ${m.family} ${m.name} ${m.id}`.toLowerCase().includes(String(model).toLowerCase())) ?? all[0];
  if (!pick) throw new Error('vscode.lm 에 모델이 없다 — 이 에디터는 확장에 모델을 안 내준다(가설 기각)');
  const sid = sessionId || `br_${Math.random().toString(16).slice(2, 10)}`;
  const hist = sessions.get(sid) ?? [];
  const msgs = [...hist.map((h) => (h.role === 'user' ? vscode.LanguageModelChatMessage.User(h.text) : vscode.LanguageModelChatMessage.Assistant(h.text))), vscode.LanguageModelChatMessage.User(prompt)];
  const res = await pick.sendRequest(msgs, {}, new vscode.CancellationTokenSource().token);
  let answer = '';
  for await (const chunk of res.text) answer += chunk;
  sessions.set(sid, [...hist, { role: 'user', text: prompt }, { role: 'assistant', text: answer }].slice(-40));
  return { answer, sessionId: sid, model: `${pick.vendor}/${pick.family}` };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''; req.on('data', (d) => { s += d; if (s.length > 4_000_000) reject(new Error('too big')); }); req.on('end', () => resolve(s)); req.on('error', reject);
  });
}

function activate(context) {
  server = http.createServer(async (req, res) => {
    const send = (code, body) => { const buf = Buffer.from(JSON.stringify(body)); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length }); res.end(buf); };
    try {
      if (req.method === 'GET' && req.url === '/models') return send(200, await models());
      if (req.method === 'POST' && req.url === '/ask') return send(200, await ask(JSON.parse(await readBody(req) || '{}')));
      send(404, { error: 'GET /models · POST /ask' });
    } catch (e) { send(500, { error: String(e?.message ?? e) }); }
  });
  server.listen(PORT, '127.0.0.1');
  context.subscriptions.push({ dispose: () => server?.close() });
  context.subscriptions.push(vscode.commands.registerCommand('ppanam.bridge.models', async () => {
    const list = await models();
    vscode.window.showInformationMessage(list.length ? list.map((m) => `${m.vendor}/${m.family}`).join(' · ') : 'vscode.lm 에 모델 없음 — 가설 기각');
  }));
}
function deactivate() { server?.close(); }
module.exports = { activate, deactivate };
