#!/usr/bin/env node
// 개발용 씨앗 데이터. 팀 레일과 대화록 스크롤을 눈으로 확인할 때 쓴다.
//   node bus/seed.mjs
import { startRound, endRound, emit, recordVerdict } from './bus.mjs';

// 마케팅: 끝난 라운드 두 개 (대화록이 쌓여 있어야 위로 스크롤이 의미가 있다)
startRound('marketing', { topic: '타깃과 약속 확정', milestone: 1 });
emit('marketing', { type: 'message', actor: 'guide', text: '작년 구매 데이터에서 재구매율이 가장 높은 집단을 뽑았습니다. 30대 후반 직장인입니다.' });
emit('marketing', { type: 'message', actor: 'review', text: '재구매율만 보면 편향됩니다. 신규 유입 비중도 같이 보셨습니까?' });
emit('marketing', { type: 'message', actor: 'guide', text: '맞습니다. 신규까지 넣으니 20대 후반이 더 큽니다. 둘로 나누겠습니다.' });
recordVerdict('marketing', { actor: 'outside', verdict: 'PASS', text: '근거가 데이터에 붙어 있습니다. 통과.' });
endRound('marketing', { verdict: 'PASS', summary: '라운드 종료 · 타깃 2개 확정' });

startRound('marketing', { topic: '캠페인 헤드라인', milestone: 2 });
emit('marketing', { type: 'message', actor: 'guide', text: '두 타깃 각각에 헤드라인을 따로 썼습니다.' });
recordVerdict('marketing', { actor: 'review', verdict: 'PASS', text: '통과.' });
endRound('marketing', { verdict: 'PASS', summary: '라운드 종료 · 헤드라인 확정' });

// 개발: 진행 중 + 반박 누적 (레일에 초록 점)
startRound('dev', { topic: '결제 실패 재시도 로직', milestone: 2 });
emit('dev', { type: 'message', actor: 'guide', text: '지수 백오프로 3회 재시도하도록 붙였습니다.' });
emit('dev', { type: 'tool', actor: 'guide', text: 'src/payment/retry.ts', meta: { tool: 'Write' } });
recordVerdict('dev', { actor: 'outside', verdict: 'REVISE', text: '멱등키가 없습니다. 재시도가 중복 결제를 만듭니다.' });

// 경영재무: FAIL 로 대표를 부르는 상태 (레일에 빨간 점 + "대표" 배지)
startRound('finance', { topic: '4분기 예산 재배분', milestone: 1 });
emit('finance', { type: 'message', actor: 'guide', text: '마케팅 예산을 20% 늘리고 외주비를 줄이는 안입니다.' });
recordVerdict('finance', { actor: 'review', verdict: 'REVISE', text: '외주비는 이미 계약된 금액입니다.' });
recordVerdict('finance', { actor: 'outside', verdict: 'REVISE', text: '계약서 확인했습니다. 위약금이 절감액보다 큽니다.' });
recordVerdict('finance', { actor: 'review', verdict: 'REVISE', text: '대안 없이 같은 안을 다시 냈습니다.' });

console.log('씨앗 데이터를 심었습니다. 서버를 띄우고 http://localhost:4321 을 여세요.');
