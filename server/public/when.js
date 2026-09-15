// 시각 글자 — 앞으로(대시보드) 칸·펼친 줄·팀별 단계 표가 같이 쓴다. 순수, 브라우저·node 둘 다(bus.mjs 가 들여온다).
// 하영 5판 312행 "시각은 때를 붙여 — 아침 8:41" · 6판 6절 때 경계(새벽 0~5 · 아침 6~9 · 낮 10~16 · 저녁 17~19 · 밤 20~23) · 1-2 {날} = 오늘 / 내일 / 모레 / N일(같은 달) / N월 N일.
// 우리 시각(서울 +09:00 고정) — 서버 TZ 와 무관(결정 101).
const SEOUL = 9 * 3600_000, DAY = 86_400_000;
const ms = (t) => (typeof t === 'number' ? t : Date.parse(t ?? ''));
const seoulDay = (t) => Math.floor((t + SEOUL) / DAY);

/** "아침 8:41" — 때 + h:mm. 셀 수 없으면 ''. */
export function clockWord(t) {
  const x = ms(t); if (!Number.isFinite(x)) return '';
  const d = new Date(x + SEOUL), h = d.getUTCHours();
  const when = h <= 5 ? '새벽' : h <= 9 ? '아침' : h <= 16 ? '낮' : h <= 19 ? '저녁' : '밤';
  return `${when} ${h}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
/** "오늘" · "내일" · "모레" · "20일" · "10월 3일" — 지금(now) 기준 우리 시각 날짜. 지난 날도 "오늘". 셀 수 없으면 ''. */
export function dayWord(t, now = Date.now()) {
  const x = ms(t); if (!Number.isFinite(x)) return '';
  const dd = seoulDay(x) - seoulDay(now);
  if (dd <= 0) return '오늘';
  if (dd === 1) return '내일';
  if (dd === 2) return '모레';
  const d = new Date(x + SEOUL), n = new Date(now + SEOUL);
  return d.getUTCMonth() === n.getUTCMonth() && d.getUTCFullYear() === n.getUTCFullYear() ? `${d.getUTCDate()}일` : `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}
/** "내일 새벽 1:05" · 오늘이면 "아침 8:41"(날 뺌). 펼친 줄·표에 쓴다. */
export function timeWord(t, now = Date.now()) {
  const day = dayWord(t, now), clock = clockWord(t);
  if (!clock) return '';
  return day === '오늘' ? clock : `${day} ${clock}`;
}
/** "1시간 22분" · "40분" · "2일 3시간" — 길이. 0 이면 "0분". */
export function spanWord(msLen) {
  const m = Math.max(0, Math.round((Number(msLen) || 0) / 60_000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d) return `${d}일${h ? ` ${h}시간` : ''}`;
  if (h) return `${h}시간${mm ? ` ${mm}분` : ''}`;
  return `${mm}분`;
}
