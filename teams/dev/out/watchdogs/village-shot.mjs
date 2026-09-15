// 마을 탭 한 장 — 폰 폭, 배율 고를 수 있게. 파일로 저장한다.
import { spawn } from 'node:child_process'; import fs from 'node:fs';
const [,, SP, W, H, zoom, name, portStr, clock, scene] = process.argv; const PORT=Number(portStr);
const CH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// 같은 이름의 옛 그림은 시작할 때 지운다 — 실패해도 옛 파일이 남아 "파일 있으니 성공" 으로 읽히지 않게(레오, R25). 끝난 뒤 파일이 있으면 그건 이번 것이다.
try{ fs.rmSync(`${SP}/${name}.png`,{force:true}) }catch{}
// 정리는 한 곳 — 정상 끝·타임아웃·SIGINT·SIGTERM·던져진 오류 전부 여기로 온다. 정상 끝에서만 지우면 중간에 끊긴 촬영이 크롬 프로세스와 프로필을 남긴다(레오, R25).
let ch=null, done=false;
function cleanup(code, why){ if(done) return; done=true; if(why) console.log(why);
  try{ ch?.kill('SIGKILL') }catch{}
  for(const d of [`${SP}/vg${PORT}`,`${SP}/c${PORT}`,`${SP}/rc${PORT}`]){ try{ fs.rmSync(d,{recursive:true,force:true}) }catch{} }
  process.exit(code); }
process.on('SIGINT',()=>cleanup(130,'SIGINT')); process.on('SIGTERM',()=>cleanup(143,'SIGTERM'));
process.on('uncaughtException',e=>cleanup(1,'ERROR '+(e?.message??e))); process.on('unhandledRejection',e=>cleanup(1,'ERROR '+(e?.message??e)));
const to=setTimeout(()=>cleanup(2,'TIMEOUT'),120000);
ch=spawn(CH,['--headless=new','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--hide-scrollbars',`--window-size=${W},${H}`,`--remote-debugging-port=${PORT}`,`--user-data-dir=${SP}/vg${PORT}`,'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let tg; for(let i=0;i<40;i++){try{tg=await fetch(`http://127.0.0.1:${PORT}/json`).then(r=>r.json());if(tg.length)break}catch{}await sleep(500)}
const ws=new WebSocket(tg.find(t=>t.type==='page').webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0;const pend=new Map(); ws.onmessage=m=>{const j=JSON.parse(m.data);if(j.id&&pend.has(j.id)){pend.get(j.id)(j);pend.delete(j.id)}};
const send=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}))});
const ev=async e=>(await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true})).result?.result?.value;
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:Number(W),height:Number(H),deviceScaleFactor:1,mobile:false});
// PPANAM_QUERY=only=castle,namsan,home.design 이면 비교판(결정 123 — 유니티 판과 같은 조각 셋·인형 둘·표찰 없음)으로 연다
const Q = process.env.PPANAM_QUERY ? '?' + process.env.PPANAM_QUERY : '';
await send('Page.navigate',{url:`http://localhost:4321/${Q}#dev/village`});await sleep(6000);
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='마을'&&x.closest('nav')); if(b)b.click()})()`);
await sleep(8000);
// 바깥 마을 쪽으로 — 패널 안의 마을/회사 토글에서 '마을'
const want = (scene === '회사') ? '회사' : '마을';
await ev(`(()=>{const bs=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()===${JSON.stringify(want)}&&!x.closest('nav')); const b=bs[bs.length-1]; if(b)b.click()})()`);
await sleep(6000);
if (clock && clock !== '-') {
  // 시계 고르는 칸만 — 지금 값이 '실제 시각' 인 select. 다시보기 목록의 'R15' 를 잘못 집지 않게.
  await ev(`(()=>{const ss=[...document.querySelectorAll('select')]; const s=ss.find(x=>[...x.options].some(o=>/실제 시각/.test(o.textContent))); if(!s) return 'no clock select'; const o=[...s.options].find(o=>o.textContent.includes(${JSON.stringify(clock)})); if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return o.textContent} return 'no option'})()`);
  await sleep(5000);
}
if (zoom && zoom !== '-') {
  await ev(`(()=>{const s=[...document.querySelectorAll('select')].find(x=>/화면/.test(x.value||'')||[...x.options].some(o=>/화면/.test(o.textContent))); if(s){const o=[...s.options].find(o=>o.textContent.includes(${JSON.stringify(zoom)})); if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}))}}})()`);
  await sleep(5000);
}
const errs = await ev(`(window.__err||[]).slice(-8).join(' | ')`);
console.log(name, 'vw', await ev('innerWidth'), 'canvas', await ev(`!!document.querySelector('canvas')`), 'three', await ev(`!!document.querySelector('canvas')&&document.querySelector('canvas').width`));
const sh=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:Number(W),height:Number(H),scale:1}});
clearTimeout(to);
// 그림이 없으면 실패다 — 전에는 SAVED 없이 exit 0 이라 못 찍은 게 성공으로 끝났다(솔라, R25). 3 = 캡처 실패.
if(!sh.result?.data) cleanup(3,'NO_IMAGE '+JSON.stringify(sh.error??sh).slice(0,200));
fs.writeFileSync(`${SP}/${name}.png`,Buffer.from(sh.result.data,'base64'));console.log('SAVED',`${SP}/${name}.png`);
cleanup(0);
