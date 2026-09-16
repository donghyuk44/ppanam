#!/usr/bin/env node
/**
 * 작업 보드 표 도구 (D3, 솔라) — 대표 승인(teams/hq/out/참고-비교-0916.md 7절 3번): "톰 표는 도구가 뽑고
 * 톰은 의견·결정만" — state/work.json 을 읽어 teams/hq/out/따라가기.md 가 손으로 세던 표를 그대로 뽑는다.
 * 규칙 문서: teams/hq/out/작업보드-0916.md. 정본: state/work.json(필드는 bus.mjs WORK_PATH 주석 참고).
 * 낱말은 teams/marketing/out/opsroom-words.md 를 따른다(작업 보드 · 진행 현황 등 — 지어내지 않는다).
 *
 * 사용법:
 *   node tools/work-board.mjs                 # 마크다운 표를 stdout 에
 *   node tools/work-board.mjs --write <path>   # 그 경로에 씀(기본은 미리보기만, 안 씀)
 *
 * 숫자를 세는 로직은 아래 순수 함수들(readyOf · reviewQueueOf · inProgressOf · waitingOf · overlapOf · redOf)로
 * 분리했다 — work.json 을 직접 안 건드리고 items 배열만 받아 계산한다. bus/round.mjs check 는 다른 사람이
 * 동시에 건드리고 있어(충돌 위험) 이 파일용 시험은 여기 안 더한다 — 시험은 이 파일을 부르는 쪽(또는 임시 스크립트) 몫.
 */
import { readWork, readCast } from '../bus/bus.mjs';

// 통과·안 함은 끝난 일이다 — after 를 막고 있는지 볼 때 "끝났다" 로 친다.
const DONE_LIKE = new Set(['통과', '안 함']);

/**
 * 지금 시작 가능 — status "대기" 이고 after 항목이 전부 "통과"(또는 after 없음)인 것.
 * @param {Array<object>} items
 * @returns {Array<object>}
 */
export function readyOf(items) {
  const passed = new Set(items.filter((it) => it.status === '통과').map((it) => it.id));
  return items.filter((it) => it.status === '대기' && (!Array.isArray(it.after) || it.after.length === 0 || it.after.every((a) => passed.has(a))));
}

/** 감사 대기 — status "감사 대기" 인 것 그대로. */
export function reviewQueueOf(items) {
  return items.filter((it) => it.status === '감사 대기');
}

/** 진행 — status "진행" 인 것 그대로. */
export function inProgressOf(items) {
  return items.filter((it) => it.status === '진행');
}

/**
 * 누가 누구를 기다리나 — after 에 아직 안 끝난(통과·안 함이 아닌) id 가 하나라도 든 항목마다
 * { item, waitingOn: [아직 안 끝난 after id들] } 를 돌려준다.
 * @param {Array<object>} items
 */
export function waitingOf(items) {
  const doneIds = new Set(items.filter((it) => DONE_LIKE.has(it.status)).map((it) => it.id));
  return items
    .filter((it) => Array.isArray(it.after) && it.after.length > 0 && it.after.some((a) => !doneIds.has(a)))
    .map((it) => ({ item: it, waitingOn: it.after.filter((a) => !doneIds.has(a)) }));
}

/**
 * 병목 겹침 주의 — 같은 team+seat 조합에서 status 가 "진행" 또는 "감사 대기" 인 항목이 둘 이상인 자리.
 * 대표 결정(작업보드-0916.md 3절): 서브에이전트는 한 자리 최대 둘 — 자리가 겹치면 순서를 나눠야 한다.
 * @param {Array<object>} items
 * @returns {Array<{team:string, seat:string, items:Array<object>}>}
 */
export function overlapOf(items) {
  const groups = new Map();
  for (const it of items) {
    if (it.status !== '진행' && it.status !== '감사 대기') continue;
    const key = `${it.team}/${it.seat}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return [...groups.values()]
    .filter((list) => list.length >= 2)
    .map((list) => ({ team: list[0].team, seat: list[0].seat, items: list }));
}

/**
 * 빨간 줄 — ① status "막힘" 인 항목 ② bottleneck 이 채워져 있고, 아직 안 끝난(통과·안 함이 아닌) 항목 중
 * 같은 bottleneck 글자를 든 것이 셋 이상인 경우(한 자리가 여러 줄기를 동시에 막고 있는 것).
 * @param {Array<object>} items
 * @returns {{ blocked: Array<object>, congested: Array<{bottleneck:string, items:Array<object>}> }}
 */
export function redOf(items) {
  const blocked = items.filter((it) => it.status === '막힘');
  const active = items.filter((it) => !DONE_LIKE.has(it.status));
  const byBottleneck = new Map();
  for (const it of active) {
    if (!it.bottleneck) continue;
    if (!byBottleneck.has(it.bottleneck)) byBottleneck.set(it.bottleneck, []);
    byBottleneck.get(it.bottleneck).push(it);
  }
  const congested = [...byBottleneck.entries()]
    .filter(([, list]) => list.length >= 3)
    .map(([bottleneck, list]) => ({ bottleneck, items: list }))
    .sort((a, b) => b.items.length - a.items.length);
  return { blocked, congested };
}

/** 자리 이름 — cast.json 에 없으면 "team/seat" 그대로(지어내지 않는다). */
function nameOf(team, seat) {
  try {
    return readCast(team).agents?.[seat]?.name ?? `${team}/${seat}`;
  } catch {
    return `${team}/${seat}`;
  }
}

function line(it) {
  return `[${it.id}] ${nameOf(it.team, it.seat)} — ${it.what}`;
}

/**
 * 마크다운 표 — 순수 함수들의 계산 결과를 이 절 순서대로 그린다(따라가기.md 와 같은 항목, 같은 낱말):
 * 지금 시작 가능 · 감사 대기 · 진행 · 누가 누구를 기다리나 · 병목 겹침 주의 · 빨간 줄.
 * @param {Array<object>} items
 * @returns {string}
 */
export function renderBoard(items) {
  const out = [];
  out.push('# 작업 보드 — 진행 현황');
  out.push('');
  out.push('정본은 `state/work.json`(대표 승인, 참고-비교-0916.md 7절 3번). `node tools/work-board.mjs` 가 뽑는다 — 손으로 안 센다.');
  out.push('');

  out.push('## 지금 시작 가능');
  out.push('');
  const ready = readyOf(items);
  if (ready.length) for (const it of ready) out.push(`- ${line(it)}`);
  else out.push('- 없음');
  out.push('');

  out.push('## 감사 대기');
  out.push('');
  const review = reviewQueueOf(items);
  if (review.length) for (const it of review) out.push(`- ${line(it)}${it.bottleneck ? ` (병목: ${it.bottleneck})` : ''}`);
  else out.push('- 없음');
  out.push('');

  out.push('## 진행');
  out.push('');
  const inProgress = inProgressOf(items);
  if (inProgress.length) for (const it of inProgress) out.push(`- ${line(it)}${it.bottleneck ? ` (병목: ${it.bottleneck})` : ''}`);
  else out.push('- 없음');
  out.push('');

  out.push('## 누가 누구를 기다리나');
  out.push('');
  const waiting = waitingOf(items);
  if (waiting.length) {
    for (const { item: it, waitingOn } of waiting) {
      const byId = new Map(items.map((x) => [x.id, x]));
      const waiters = waitingOn.map((id) => {
        const w = byId.get(id);
        return w ? `${id}(${nameOf(w.team, w.seat)})` : id;
      }).join(' · ');
      out.push(`- [${it.id}](${nameOf(it.team, it.seat)}) ← ${waiters}`);
    }
  } else out.push('- 없음');
  out.push('');

  out.push('## 병목 겹침 주의');
  out.push('');
  const overlap = overlapOf(items);
  if (overlap.length) {
    for (const { team, seat, items: list } of overlap) {
      out.push(`- ${nameOf(team, seat)}(${team}/${seat}) — ${list.length}건: ${list.map((it) => `[${it.id}] ${it.status}`).join(' · ')}`);
    }
  } else out.push('- 없음');
  out.push('');

  out.push('## 빨간 줄');
  out.push('');
  const red = redOf(items);
  const redLines = [];
  for (const it of red.blocked) redLines.push(`- 막힘 — ${line(it)}${it.note ? ` · ${it.note}` : ''}`);
  for (const { bottleneck, items: list } of red.congested) {
    redLines.push(`- 병목 겹침 — ${bottleneck} 뒤에 ${list.length}건: ${list.map((it) => `[${it.id}]`).join(' · ')}`);
  }
  if (redLines.length) out.push(...redLines);
  else out.push('- 없음');
  out.push('');

  return out.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const writeIdx = args.indexOf('--write');
  const writePath = writeIdx !== -1 ? args[writeIdx + 1] : null;

  const items = readWork().items ?? [];
  const md = renderBoard(items);

  if (writePath) {
    const fs = await import('node:fs');
    fs.writeFileSync(writePath, md.endsWith('\n') ? md : md + '\n', 'utf8');
    console.log(`썼다 — ${writePath}`);
  } else {
    console.log(md);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err.stack || String(err));
    process.exit(1);
  });
}
