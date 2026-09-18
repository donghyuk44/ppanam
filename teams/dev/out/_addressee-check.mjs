// 솔라 3fcb74b·7423a3f 부름 규칙 실측(테라가 솔라 것 판정, 나리 09-18) — 비서실 cast 로 addressee/addressees 를 대 본다.
import { addressee, addressees, readCast } from '../../../bus/bus.mjs';
const cast = readCast('sera').agents ?? {};
const cases = ['나리야 대답해봐', '나리야, 대답해봐', '나리, 봐줘', '세라야, 나리 — 둘 다', '세라, 나리 둘 다 요약해', '나리야말로 잘했다', '테라 고마워', '나리 잘했다', '세라야!', '나리?',
  '세라야 나리야, 아까 내가 말한거 지시 너네가 이해했는지 각자 요약해서', '나리야 세라야 둘 다', '세라, 나리, 둘 다'];
for (const s of cases) {
  let one = null, many = null;
  try { one = addressee(s, cast); } catch (e) { one = 'ERR ' + e.message; }
  try { many = typeof addressees === 'function' ? addressees(s, cast) : '(없음)'; } catch (e) { many = 'ERR ' + e.message; }
  console.log(JSON.stringify(s).padEnd(28), '→', one, '|', JSON.stringify(many));
}
