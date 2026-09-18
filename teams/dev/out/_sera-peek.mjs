// 비서실 화면 상태 실측 — 대표 지적(09-18 오후): 비서실 무한 대기 · 진행 중 안 보임 · 나리 부름 무응답. 인자: [port]
const port = process.argv[2] ?? '4321';
const j = async (p) => fetch(`http://127.0.0.1:${port}${p}`).then((x) => x.json()).catch((e) => ({ error: String(e) }));
const boot = await j('/api/boot?team=sera');
const s = boot.summaries?.sera ?? boot.summary ?? {};
console.log('sera phase:', s.phase, '| state:', s.state ?? '-', '| round:', s.round ?? '-');
console.log('sera progress:', JSON.stringify(s.progress ?? null).slice(0, 300));
console.log('sera people:', JSON.stringify(s.people ?? null).slice(0, 400));
console.log('sera sessions:', JSON.stringify(s.sessions ?? null).slice(0, 300));
const hq = boot.summaries?.hq ?? {};
console.log('hq sessions.system:', JSON.stringify(hq.sessions?.system ?? null).slice(0, 200));
console.log('hq people.system:', JSON.stringify(hq.people?.system ?? null).slice(0, 300));
const card = await j('/api/card/sera');
console.log('card/sera:', JSON.stringify(card).slice(0, 400));
