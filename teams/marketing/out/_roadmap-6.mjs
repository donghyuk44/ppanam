// 계획표 6판 제안 — 지난 단계 제목 둘의 금지 낱말(결정 216): 4단계 "글의 틀"(틀) → "글의 양식", 5단계 "붙은 화면"(붙다) → "실제 화면". 제목만 — 대시보드 팀 탭 단계 목록에 그대로 뜬다(r37-words-teams-412-c.png). 다른 글자는 그대로.
import fs from 'node:fs';
const rm = JSON.parse(fs.readFileSync('teams/marketing/roadmap.json', 'utf8'));
const m4 = rm.milestones.find((x) => x.n === 4);
const m5 = rm.milestones.find((x) => x.n === 5);
if (!m4 || !m5) { console.error('4·5단계 없음'); process.exit(1); }
const b4 = m4.title, b5 = m5.title;
m4.title = m4.title.replace('대시보드·분석 글의 틀', '대시보드·분석 글의 양식');
m5.title = m5.title.replace('붙은 화면 30초 시험', '실제 화면 30초 시험');
delete rm._proposal_7b;
rm._proposal_6 = '2026-09-18 하영 — 4·5단계 제목 낱말만: 틀 → 양식, 붙은 화면 → 실제 화면(결정 216 스물여섯). 뜻·순서 그대로. 대시보드 팀 탭 단계 목록에 제목이 그대로 떠서(30초 시험 2판 r37-words-teams-412-c) 사전 밖 말 0 이 되려면 제목부터.';
fs.writeFileSync('teams/marketing/out/roadmap-6.proposed.json', JSON.stringify(rm, null, 2) + '\n');
console.log(b4 === m4.title && b5 === m5.title ? '바뀐 것 없음' : '4: ' + m4.title + '\n5: ' + m5.title);
