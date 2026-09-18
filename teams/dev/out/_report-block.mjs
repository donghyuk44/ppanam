  // ③ 막힌 것 N — 목록 카드(헨리 1판-d ①, fig-0918-report-412 · 결정 188: 옛 시간 띠(저녁 → 아침 축 위 점·빨간 띠)는 시각 축이라 뺐다). 줄 = 팀 색 점 · 일 이름 한 줄 · 담당자(누가 풀 수 있나),
  // 머리 오른쪽 "누가 풀어야 넘어가는 일 — 점 = 팀". 재료는 대시보드 띠 '막힌 것' 과 같은 것(팀 카드 blocked, 자 통과분 — dashStats stuck 과 같은 셈) — 두 탭이 다른 수를 내지 않게. 0 이면 한 줄만(정본 다툼은 보여주는 쪽, 11절).
  const stuckRows = [];
  for (const t of teams.filter((x) => x.id !== 'sera')) {
    const d = cards.byTeam[t.id];
    const list = d ? (d.blocked ?? []) : (summaries[t.id]?.progress?.blocked ?? []).map((text) => ({ text, who: null }));
    for (const b of list) if (bossOk(String(b.text ?? '').trim())) stuckRows.push({ team: t.id, name: roomWord(t), text: String(b.text).trim(), who: b.who ?? null });
  }
  const sec3 = el('section', 'dash__card rep__sec'); sec3.dataset.block = 'stuck';
  const h3 = el('div', 'dash__k rep__k'); h3.appendChild(el('span', null, `막힌 것 ${stuckRows.length}`)); h3.appendChild(el('span', 'rep__kr', '누가 풀어야 넘어가는 일 — 점 = 팀')); sec3.appendChild(h3);
  if (!stuckRows.length) sec3.appendChild(el('div', 'dash__empty', '오늘은 없어요'));
  for (const s of stuckRows) {
    const row = el('button', 'dash__row rep__stuck'); row.type = 'button';
    const d = el('i', 'dot'); d.style.background = colorOf(s.team); row.appendChild(d);
    row.appendChild(el('span', 'rep__stuckT', `${s.name} · ${s.text}`));
    if (s.who) row.appendChild(el('span', 'rep__who', s.who));
    row.addEventListener('click', () => jumpTo(s.team, null));
    sec3.appendChild(row);
  }
  body.appendChild(sec3);

  // ④ 된 것 — 팀당 한 줄 `{사람} · {무엇}`, 없으면 "{팀} · 어제는 낸 게 없어요"(11절 표 · daily-template 2절). 옛 줄의 N단계·N회차·진행 막대·그림 네모는 뺐다(헨리 "안 옮긴 것" · 결정 207 회차 번호).
  // 누르면 그 팀의 한 것 전부 · 검토 결과.
  const sec4 = el('section', 'dash__card rep__sec'); sec4.dataset.block = 'teams';
  sec4.appendChild(el('div', 'dash__k', '된 것'));
  for (const t of (r.teams ?? [])) {
    const items = (r.done ?? []).find((x) => x.team === t.id)?.items ?? [];
    const made = items.filter((it) => it.kind !== 'verdict' && it.kind !== 'decision');
    const verdicts = items.filter((it) => it.kind === 'verdict');
    const row = el('button', 'dash__row rep__team'); row.type = 'button';
    const head = el('span', 'dash__head');
    const d = el('span', 'dot'); d.style.background = colorOf(t.id); head.appendChild(d);
    const first = made[0];
    head.appendChild(el('b', null, first ? `${first.name ?? roomWord(t)} · ${first.text.replace(/^(커밋|산출물) — /, '')}` : `${roomWord(t)} · 어제는 낸 게 없어요`));   // 팀 이름 하나(req_d82aaf90 ①)
    row.appendChild(head);
    if (made.length > 1) row.appendChild(el('span', 'dash__sub', `그 밖에 ${made.length - 1}`));
    row.addEventListener('click', () => { if (openReport.has(t.id)) openReport.delete(t.id); else openReport.add(t.id); renderReport(r); });
    sec4.appendChild(row);
    if (openReport.has(t.id)) {
      const box = el('div', 'dash__open');
      const two = [
        ['한 것', made.length ? made.map((it) => `${it.name ? it.name + ' · ' : ''}${it.text}`).join(' · ') : '없어요'],
        ['검토 결과', verdicts.length ? verdicts.map((it) => `${it.text.split(' — ')[0]}(${it.name ?? it.by})`).join(' · ') : '없어요'],
      ];
      for (const [k, v] of two) { const kv = el('div', 'dash__kv'); kv.appendChild(el('b', null, `${k} —`)); kv.appendChild(el('span', null, v)); box.appendChild(kv); }
      sec4.appendChild(box);
    }
  }
  body.appendChild(sec4);

  // ⑤ 옛 '오늘 할 일'(각 방이 먼저 할 일)은 뺐다 — 타임라인 탭 자리별 보기가 이미 한다(헨리 11절 "안 옮긴 것" ④).
