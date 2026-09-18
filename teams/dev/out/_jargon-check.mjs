// 자 낱말 셋(손·결·폴백, 하영 req_d82aaf90 ④) 실측 — 걸릴 꼴은 걸리고 남길 꼴은 남는가. node teams/dev/out/_jargon-check.mjs
import { isBossWord } from '../../../server/public/bosswords.js';
const hit = ['솔라 손 뒤에 7건', '손이 둘이에요', '손이 비었어요', '남은 손 하나', '제 손으로는 안 돼요 — 아니 제 손이 비어요', '관리 창 손', '서버 손이 해요', '손 하나 더', '손이 없어요', '손이 남아요', '새 결로 바꿈', '옛 결 그대로', '결로 보면', '이 결 고운 종이', '폴백 없음'];
const keep = ['손으로 확인했어요', '손대지 않았어요', '손 안 대요', '손을 대면', '손에 든 것', '손 뗐어요', '제 손으로 확인했어요', '문제 손질', '결정 났어요', '결재 대기', '결과 넷', '결론은 하나', '경제 손실'];
let bad = 0;
for (const s of hit) if (isBossWord(s)) { bad++; console.log('✗ 안 걸림:', s); }
for (const s of keep) if (!isBossWord(s)) { bad++; console.log('✗ 잘못 걸림:', s); }
console.log(bad ? `✗ ${bad}` : `✓ 걸릴 꼴 ${hit.length} · 남길 꼴 ${keep.length} 다 맞음`);
