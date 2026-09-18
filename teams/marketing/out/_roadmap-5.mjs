// 계획표 5판 제안 — 7단계 제목·안젤 줄의 "붙는 대로"(붙다 비유, 결정 216)를 "새로 될 때마다" 로. 다른 글자는 그대로.
import fs from 'node:fs';
const rm = JSON.parse(fs.readFileSync('teams/marketing/roadmap.json', 'utf8'));
const m = rm.milestones.find((x) => x.n === 7);
if (!m) { console.error('7단계 없음'); process.exit(1); }
const before = JSON.stringify(m);
m.title = m.title.replace('탭 다섯 붙는 대로 글자 대조·30초', '탭 다섯 새로 될 때마다 글자 대조·30초');
if (m.owner && m.owner['안젤']) m.owner['안젤'] = m.owner['안젤'].replace('탭 붙는 대로', '탭이 새로 될 때마다');
if (m.owner && m.owner['하영']) m.owner['하영'] = m.owner['하영'].replace('탭이 붙을 때마다', '탭이 새로 될 때마다');
if (m.deliverable) m.deliverable = m.deliverable.replace(/탭이 붙을 때마다/g, '탭이 새로 될 때마다').replace(/붙은 탭마다/g, '새로 된 탭마다').replace(/안 붙은 탭은 "안 붙음"/g, '아직 안 된 탭은 "아직"').replace(/붙이는 건 개발 순서다/g, '넣는 건 개발 순서다').replace(/붙인다 — 줄을 더하지 않고 그 줄에 잇는다/g, '잇는다 — 줄을 더하지 않고 그 줄에');
rm._proposal_7b = '2026-09-18 하영 — 7단계 제목·조건 글자만: 붙다 비유(결정 216 스물여섯)를 보통 말로. 뜻·순서 그대로. 타임라인 화면 마케팅 줄에 이 제목이 그대로 떠서(30초 시험 2판-1 r40 사진) 사전 밖 말 0 이 되려면 제목부터.';
fs.writeFileSync('teams/marketing/out/roadmap-5.proposed.json', JSON.stringify(rm, null, 2) + '\n');
console.log(before === JSON.stringify(m) ? '바뀐 것 없음' : '7단계 글자 바뀜 · 제목: ' + m.title);
