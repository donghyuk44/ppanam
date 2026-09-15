// Kenney .obj 모델의 바운딩 박스를 잰다 — "v x y z ..." 줄만 본다, 재질·UV는 안 본다.
//
//   node tools/pixel/obj-bbox.mjs <obj…>
//
// 출력은 JSON 배열 — 파일마다 { file, x:[min,max], y:[min,max], z:[min,max], w, h, d }.
// w = x 폭, h = y 높이(건물·사람 키 비교용), d = z 깊이.
import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) { console.log('사용법: obj-bbox.mjs <obj…>'); process.exit(2); }

const results = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const line of text.split('\n')) {
    if (line[0] !== 'v' || line[1] !== ' ') continue;   // "v x y z [r g b]" 만, vt·vn 제외
    const [, xs, ys, zs] = line.split(' ');
    const x = parseFloat(xs), y = parseFloat(ys), z = parseFloat(zs);
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  results.push({
    file, x: [x0, x1], y: [y0, y1], z: [z0, z1],
    w: +(x1 - x0).toFixed(4), h: +(y1 - y0).toFixed(4), d: +(z1 - z0).toFixed(4),
  });
}
console.log(JSON.stringify(results, null, 1));
