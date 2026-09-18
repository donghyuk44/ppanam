// 그림·문서 첨부 (결정 130 ② · C17 · 결정 226, 대표 09-18 11:23 "파일을 넣자마자 바로 전송되니까 지시처럼 가고 … 질문도 없이 수용") — 버튼 · 끌어다 놓기 · 붙여넣기 셋이 같은 길.
// 넣으면 바로 안 보낸다: 입력창 위 첨부 줄에 미리보기(그림은 썸네일, 문서는 이름)로 두었다가 **보내기를 눌러야** 올라간다. 여러 개 된다. × 로 뺀다.
// 보낼 때 첨부부터 차례로 올리고(서버가 "파일을 올렸습니다: in/…" 로 말한다 — /api/upload, 솔라) 글은 맨 뒤에 — 팀이 글을 읽을 때 파일이 이미 방에 있게.
// 문서도 된다(대표 09-16 11:10) — pdf·md·txt·csv·docx·xlsx·pptx. 서버 쪽 형식 허용은 솔라(/api/upload UPLOAD_MIME).
const UPLOAD_OK = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/(plain|markdown|csv)|application\/(vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)))$/;
const EXT_MIME = { md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const uploadKind = (mime) => (/^image\//.test(mime) ? '그림' : '파일');
const attachments = [];   // [{ file, mime, key, url }] — 보내기 전까지 여기 머문다
const attachBar = el('div', 'composer__att'); attachBar.hidden = true; $('composer').prepend(attachBar);
function renderAttachments() {
  attachBar.replaceChildren();
  attachBar.hidden = !attachments.length;
  for (const a of attachments) {
    const item = el('div', 'composer__attItem');
    if (uploadKind(a.mime) === '그림') { const img = el('img'); img.alt = a.file.name || '그림'; img.src = a.url; item.appendChild(img); }
    else item.appendChild(el('span', 'composer__attDoc', a.file.name || '문서'));
    const x = el('button', 'composer__attX', '×'); x.type = 'button'; x.title = '빼기';
    x.addEventListener('click', () => { attachments.splice(attachments.indexOf(a), 1); if (a.url) URL.revokeObjectURL(a.url); renderAttachments(); });
    item.appendChild(x);
    attachBar.appendChild(item);
  }
}
/** 파일 하나를 첨부 줄에 둔다 — 형식 검사만, 올리지는 않는다. 같은 이름·크기·형식이 이미 있으면 한 번만. */
function stageFile(f) {
  if (!f || !active) return;
  // 브라우저가 type 을 비워 주는 것(md·txt·csv·docx·xlsx·pptx 가 OS 에 따라 그렇다)은 확장자로 채운다
  const mime = f.type || EXT_MIME[(f.name ?? '').split('.').pop()?.toLowerCase()] || '';
  if (!UPLOAD_OK.test(mime)) return say('그림(png·jpg·gif·webp)이나 문서(pdf·md·txt·csv·docx·xlsx·pptx)만');
  const key = `${f.name ?? ''}|${f.size ?? 0}|${mime}`;
  if (attachments.some((a) => a.key === key)) return say('이미 첨부한 파일이에요');
  attachments.push({ file: f, mime, key, url: uploadKind(mime) === '그림' ? URL.createObjectURL(f) : null });
  renderAttachments(); say(null); input.focus();
}
/** 첨부 하나를 올린다 — silent 로 부른다: 서버가 지원하면(응답 silent:true) 파일만 두고 말풍선은 안 띄운다(글과 한 말풍선, C17 · 나리 대리). 옛 서버면 제 말풍선을 띄운다.
 *  돌려주는 것: { name, silent } — 실패하면 null(그 파일은 첨부 줄에 남는다). */
async function uploadOne(a) {
  const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(a.file); }).catch(() => null);
  if (!data) { say(`${uploadKind(a.mime)} 로딩 실패 — ${a.file.name ?? ''}`); return null; }
  const r = await post('/api/upload', { team: active, mime: a.mime, name: a.file.name || null, data, silent: true }).catch(() => null);
  if (!r?.ok) { say(r?.data?.error ?? `${uploadKind(a.mime)} 업로드 실패 — ${a.file.name ?? ''}`); return null; }
  return { name: r.data?.name ?? null, silent: r.data?.silent === true, kind: uploadKind(a.mime) };
}
/** 첨부 전부 차례로 올린다 — 올라간 것은 첨부 줄에서 빠지고, 실패한 것은 남는다. 전부 올라갔으면 { lines } — 서버가 말풍선을 안 띄운(silent) 파일의 "그림을 올렸습니다: in/…" 줄들, 글 뒤에 붙여 한 말풍선으로. 하나라도 실패면 null. */
let uploading = false;
async function flushAttachments() {
  if (!attachments.length) return { lines: [] };
  if (uploading) { say('올리는 중이에요 — 잠시만요', 0); return null; }
  uploading = true; attachBar.dataset.busy = '1';
  const lines = [];
  try {
    for (const a of [...attachments]) {
      const up = await uploadOne(a);
      if (!up) continue;
      if (up.silent && up.name) lines.push(`${up.kind}을 올렸습니다: in/${up.name}`);   // 서버 upload 줄과 같은 글 — 말풍선이 in/ 경로를 파일 카드로 그린다(findOutPaths)
      attachments.splice(attachments.indexOf(a), 1); if (a.url) URL.revokeObjectURL(a.url);
      renderAttachments();
    }
  } finally { uploading = false; delete attachBar.dataset.busy; }
  return attachments.length ? null : { lines };
}
$('uploadBtn').addEventListener('click', () => $('uploadFile').click());
$('uploadFile').addEventListener('change', () => { for (const f of [...($('uploadFile').files ?? [])]) stageFile(f); $('uploadFile').value = ''; });   // 같은 파일 다시 골라도 change 가 나게
// 끌어다 놓기 — 대화 창·입력창 어디든, 여러 개. 붙여넣기 — 클립보드의 그림(스크린샷 Cmd+V).
for (const zone of [$('feed'), $('composer')]) {
  zone.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { e.preventDefault(); app.dataset.drop = '1'; } });
  zone.addEventListener('dragleave', () => { app.dataset.drop = '0'; });
  zone.addEventListener('drop', (e) => { const fs = [...(e.dataTransfer?.files ?? [])]; if (!fs.length) return; e.preventDefault(); app.dataset.drop = '0'; for (const f of fs) stageFile(f); });
}
input.addEventListener('paste', (e) => {
  const items = [...(e.clipboardData?.items ?? [])].filter((it) => it.kind === 'file');   // 그림이든 문서든 — 형식은 stageFile 이 가른다
  if (!items.length) return;
  e.preventDefault(); for (const it of items) stageFile(it.getAsFile());
});

