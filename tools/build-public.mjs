// server/src/app.js 를 server/public/app.js 로 옮긴다.
//
// 화면이 보는 건 server/public/app.js 다. 거기를 여러 Edit 호출로 직접 고치면,
// 호출 사이의 깨진 중간 상태를 서버가 그대로 내준다 — 오늘 두 번 그렇게 깨졌다(345c56b).
// 그래서 편집은 server/src/app.js 에서 하고, 이 스크립트가 문법을 확인한 뒤
// 임시 파일에 써서 fs.renameSync 로 한 번에 바꿔 낀다 — 그 순간 전엔 옛 파일이,
// 그 순간 뒤엔 새 파일이 있을 뿐 반쪽짜리가 없다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'server', 'src', 'app.js');
const DEST = path.join(ROOT, 'server', 'public', 'app.js');

execFileSync(process.execPath, ['--check', SRC], { stdio: 'inherit' });

const tmp = `${DEST}.tmp-${process.pid}`;
fs.copyFileSync(SRC, tmp);
fs.renameSync(tmp, DEST);
console.log(`build:public — ${path.relative(ROOT, SRC)} → ${path.relative(ROOT, DEST)}`);
