// 시험 — 최상위 await 뒤에 던져진 오류가 uncaughtException 과 unhandledRejection 중 어디로 오는가 (village-shot cleanup 이 잡는지)
process.on('uncaughtException', (e) => { console.log('UE', e.message); process.exit(7); });
process.on('unhandledRejection', (e) => { console.log('UR', e.message); process.exit(8); });
await new Promise((r) => setTimeout(r, 10));
const tg = undefined;
tg.find((x) => x);
