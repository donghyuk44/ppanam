  // ④ 된 것 — 팀당 한 줄 `{사람} · {무엇}`, 없으면 "{팀} · 오늘은 낸 게 없어요"(11절 표 · daily-template 2절). 재료는 대시보드 띠 '오늘 끝난 것' 과 **같은 것**(dashStats doneList —
  // 작업 보드에서 오늘 통과로 바뀐 일 + 상황판 done 줄, 자 통과분) — 옛 /api/report 창(어제 저녁 → 오늘 아침, 187·188 로 폐기된 창)으로 세면 낮에 끝난 일이 다 빠져 두 탭 수가 갈렸다.
  // 옛 줄의 N단계·N회차·진행 막대·그림 네모는 뺐다(헨리 "안 옮긴 것" · 결정 207 회차 번호). 누르면 그 팀의 오늘 끝난 것 전부.
  const doneList = dashStats().doneList;
  const sec4 = el('section', 'dash__card rep__sec'); sec4.dataset.block = 'teams';
  sec4.appendChild(el('div', 'dash__k', `된 것 ${doneList.length}`));
  for (const t of teams.filter((x) => x.id !== 'sera')) {
    const made = doneList.filter((it) => it.team === t.id);
    const row = el('button', 'dash__row rep__team'); row.type = 'button';
    const head = el('span', 'dash__head');
    const d = el('span', 'dot'); d.style.background = colorOf(t.id); head.appendChild(d);
    head.appendChild(el('b', null, made[0] ? made[0].line : `${roomWord(t)} · 오늘은 낸 게 없어요`));   // 줄은 이미 "누가 · 무엇"(dashStats) · 팀 이름 하나(req_d82aaf90 ①)
    row.appendChild(head);
    if (made.length > 1) row.appendChild(el('span', 'dash__sub', `그 밖에 ${made.length - 1}`));
    row.addEventListener('click', () => { if (openReport.has(t.id)) openReport.delete(t.id); else openReport.add(t.id); renderReport(r); });
    sec4.appendChild(row);
    if (openReport.has(t.id) && made.length > 1) {
      const box = el('div', 'dash__open');
      for (const it of made.slice(1)) { const kv = el('div', 'dash__kv'); kv.appendChild(el('span', null, it.line)); box.appendChild(kv); }
      sec4.appendChild(box);
    }
  }
  body.appendChild(sec4);

