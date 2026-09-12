#!/usr/bin/env node
// 인격 스모크 테스트 — 인격이 실제로 발현되는지 본다. 기록하지 않는다.
//
//   node bus/cast.mjs check marketing review
//   node bus/cast.mjs prompt marketing review     조립된 시스템 프롬프트를 그대로 찍는다
//
// 페르소나 연구(arXiv 2609.05514)가 "절반은 처음부터 발현되지 않는다" 고 했다 (docs/cases.md 24).
// 인격 파일을 고쳤으면 돌린다. 09-01 아이스브레이킹의 다섯 문항 — 나이·성격·스타일·좋아하는 것·싫어하는 것 —
// 을 던지고 답을 사람이 읽는다. 세션은 방 밖에서 뜬다(PPANAM_TEAM 없음) — 훅이 아무 방에도 기록하지 않는다.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT, readCast, teamExists, listTeams } from './bus.mjs';
import { assemblePrompt } from '../server/session.mjs';

const [cmd, team, actor] = process.argv.slice(2);
if (!cmd || !team || !actor || !teamExists(team)) {
  console.error('사용법: node bus/cast.mjs <check|prompt> <팀> <자리>   팀: ' + listTeams().map((t) => t.id).join(' | '));
  process.exit(2);
}
const a = readCast(team).agents?.[actor];
if (!a) { console.error(`${team} 방에 '${actor}' 자리가 없습니다.`); process.exit(1); }
if (a.model !== 'claude') { console.error(`'${actor}' 는 claude 자리가 아닙니다 (${a.model}). codex 는 outside.mjs --check 로.`); process.exit(1); }

const prompt = assemblePrompt(team, actor);
if (cmd === 'prompt') { console.log(prompt); process.exit(0); }
if (cmd !== 'check') { console.error('check 또는 prompt'); process.exit(2); }

const QUESTIONS = `대표가 묻는다. 아래 다섯 항목으로 자기소개를 해라. 항목당 한 줄, 전체 다섯 줄. 인격 파일에 없는 것은 네가 채우되 파일과 어긋나게 짓지 마라.
- 나이
- 성격
- 스타일 (일하는 방식)
- 좋아하는 것
- 싫어하는 것`;

const model = a.llm ?? listTeams().find((t) => t.id === team)?.model;
// --disallowedTools 는 뒤따르는 인자를 전부 먹으므로(공백 구분) 질문은 stdin 으로 넣고 도구 목록은 한 인자로 준다 (2026-09-13 발견).
const args = ['-p', '--output-format', 'text', '--append-system-prompt', prompt, ...(model ? ['--model', model] : []), '--disallowedTools', 'Write,Edit,Bash,NotebookEdit'];
console.error(`[${team}/${actor}] ${a.name} — ${model ?? '기본 모델'}, 프롬프트 ${prompt.length}자. 기록하지 않습니다.`);
const env = { ...process.env };
delete env.PPANAM_TEAM; delete env.PPANAM_ACTOR;
const child = spawn('claude', args, { cwd: ROOT, stdio: ['pipe', 'inherit', 'inherit'], env });
child.stdin.end(QUESTIONS);
child.on('close', (code) => process.exit(code ?? 1));
