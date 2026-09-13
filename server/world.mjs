// 세상의 시계와 자리 — 마을의 루틴은 여기서 나온다.
//
// 캐릭터가 어디 있는지는 LLM 이 아니라 시계와 기록이 정한다 (docs/plan.md C-3). 비용 0, 어긋남 0.
// 같은 시계가 사회자의 침묵 차례를 켜고 끈다 — 밤엔 아무도 깨우지 않는다.
//
//   state/world.json  { workStart: 9, lunch: [12, 13], workEnd: 18, night: [23, 7], weekend: 'rest', debugHour: null }
//   mode              work | lunch | evening | night | rest
//   snapshot()        { hour, mode, debug, actors: { '<팀>:<자리>': { place, act } } }   place 는 map.json 의 자리 이름
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, listTeams, readCast, isOffice, isForeign } from '../bus/bus.mjs';
import * as session from './session.mjs';

const FILE = path.join(ROOT, 'state', 'world.json');
const DEFAULT = { workStart: 9, lunch: [12, 13], workEnd: 18, night: [23, 7], weekend: 'rest', debugHour: null };
const CAFE_SEATS = 5;

export function config() {
  try { return { ...DEFAULT, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { ...DEFAULT }; }
}

/** 시험용 시각 고정. null 이면 실제 시각. 대표가 화면에서 돌린다. */
export function setDebugHour(h) {
  const c = config();
  c.debugHour = h == null || h === '' ? null : Number(h);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(c, null, 2) + '\n');
  return c;
}

export function clock(d = new Date()) {
  const c = config();
  const debug = c.debugHour != null;
  const hour = debug ? Number(c.debugHour) : d.getHours() + Math.floor(d.getMinutes()) / 60;
  const weekend = !debug && (d.getDay() === 0 || d.getDay() === 6);
  const [n0, n1] = c.night;
  const inNight = n0 > n1 ? (hour >= n0 || hour < n1) : (hour >= n0 && hour < n1);
  let mode;
  if (inNight) mode = 'night';
  else if (weekend && c.weekend === 'rest') mode = 'rest';
  else if (hour >= c.lunch[0] && hour < c.lunch[1]) mode = 'lunch';
  else if (hour >= c.workStart && hour < c.workEnd) mode = 'work';
  else mode = 'evening';
  return { hour: Math.round(hour * 60) / 60, mode, weekend, debug };
}

/** 지금 모든 자리가 어디에 있어야 하나. 자리 이름은 map.json 의 places 키다 — 화면이 좌표로 푼다. */
export function snapshot() {
  const { hour, mode, debug } = clock();
  const actors = {};
  let i = 0;
  for (const t of listTeams()) {
    const cast = readCast(t.id).agents ?? {};
    const st = session.statusAll(t.id);
    for (const [id, a] of Object.entries(cast)) {
      if (id === 'boss' || id === 'system' || !(a.model === 'claude' || isForeign(a.model))) continue;   // gemini 자리도 마을에 선다
      let place, act = 'idle';
      if (mode === 'night') { place = `home.${t.id}.${id}`; act = 'sleep'; }
      else if (mode === 'rest' || mode === 'evening') { place = `home.${t.id}.${id}`; }
      else if (mode === 'lunch') { place = i < CAFE_SEATS ? `cafe.seat.${i + 1}` : 'plaza'; }
      else { place = `${t.id}.desk.${id}`; if (st[id]?.busy) act = 'typing'; }
      actors[`${t.id}:${id}`] = { place, act };
      i += 1;
    }
  }
  return { hour, mode, debug, actors, office: listTeams().filter((t) => isOffice(t.id)).map((t) => t.id) };
}
