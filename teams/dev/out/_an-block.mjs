function renderAnalysis(r) {
  const body = $('anBody');
  body.replaceChildren();
  const now = Date.parse(r.now ?? '') || Date.now();
  const teamOf = (id) => teams.find((t) => t.id === id);
  const nameOf = (id) => { const t = teamOf(id); return t ? roomWord(t) : id; };

  // ① 어디서 자꾸 막히나 — 돌려보낸 결재: {팀} a건 중 b(다섯 팀 다, 같은 순서). 팀마다 같은 자(1건 = 같은 길이) — 옅은 띠 = 올린 결재, 짙은 띠 = 돌려보낸 것, 튀는 팀만 빨강(numbers ⑥)
  const c1 = anCard('어디서 자꾸 막히나');
  const stuck = r.stuck ?? [];
  const maxTotal = Math.max(1, ...stuck.map((s) => s.total));
  const sent = el('div', 'an__sentence');
  sent.append('돌려보낸 결재 — ');
  stuck.forEach((s, i) => { const t = el('span', null, `${nameOf(s.team)} ${s.total}건 중 ${s.count}`); if (s.worst) t.dataset.k = 'bad'; sent.appendChild(t); if (i < stuck.length - 1) sent.append(' · '); });
  c1.appendChild(sent);
  for (const s of stuck) {
    const line = el('span', 'an__bandrow');
    const nm = el('span', 'an__team', nameOf(s.team)); if (s.worst) nm.dataset.k = 'bad'; line.appendChild(nm);
    const band = el('span', 'an__band');
    const all = el('i', 'an__band--all'); all.style.width = `${Math.round((s.total / maxTotal) * 100)}%`; all.style.background = teamColor(s.team); band.appendChild(all);
    const cnt = el('i', 'an__band--sent'); cnt.style.width = `${Math.round((s.count / maxTotal) * 100)}%`; cnt.style.background = s.worst ? 'var(--bad)' : teamColor(s.team); band.appendChild(cnt);
    line.appendChild(band);
    const m = el('span', 'an__m', `${s.total}건 중 ${s.count}`); if (s.worst) m.dataset.k = 'bad'; line.appendChild(m);
    c1.appendChild(anRow(`stuck:${s.team}`, line, s.ids.map((c) => cardLine(s.team, c.id, c.what, c.ts))));
  }
  body.appendChild(c1);

  // ② 무엇이 느려졌나 — 회차 길이: 지난 회차 → 이번 회차. 제일 나빠진 팀(빨강)과 제일 좋아진 팀(초록) — 시안은 둘. 지난 = 회색, 이번 = 위·아래 색, 같은 자
  const c2 = anCard('무엇이 느려졌나');
  const slowed = r.slowed ?? [];
  const picks = [];
  const worse = slowed.find((s) => s.dir === 'bad'), better = [...slowed].reverse().find((s) => s.dir === 'good');
  if (worse) picks.push(worse); if (better && better !== worse) picks.push(better);
  if (!picks.length && slowed[0]) picks.push(slowed[0]);
  if (!picks.length) c2.appendChild(el('div', 'panel__note', '견줄 회차가 아직 없어요 — 회차 둘이 끝나면 떠요'));
  const maxMs = Math.max(1, ...picks.flatMap((s) => [s.prev, s.cur]));
  for (const s of picks) {
    const box = el('span', 'an__pair');
    const text = el('span', 'an__sentence', `${nameOf(s.team)} 회차 길이 — 지난 회차 ${spanWord(s.prev)} → 이번 회차 ${spanWord(s.cur)}`); text.dataset.k = s.dir; box.appendChild(text);
    for (const [label, ms, k] of [['지난', s.prev, 'same'], ['이번', s.cur, s.dir]]) {
      const l = el('span', 'an__bar'); l.appendChild(el('span', 'an__m', label));
      const bar = el('i'); bar.style.width = `${Math.max(2, Math.round((ms / maxMs) * 100))}%`; bar.dataset.k = k; l.appendChild(bar); box.appendChild(l);
    }
    if (s.pausedMs > 0) box.appendChild(el('span', 'an__note', `멈춘 ${spanWord(s.pausedMs)}은 뺐어요`));
    const why = [el('span', 'an__line', `${s.prevRound}회차 → ${s.curRound}회차 · 이번 회차 ${timeWord(s.curStartedAt, now)} 시작`)];
    c2.appendChild(anRow(`slowed:${s.team}`, box, why));
  }
  body.appendChild(c2);

  // ③ 같은 일이 몇 번째인가 — 같은 카드를 다시 올린 것 · 같은 단계를 여러 회차 돈 것. 회차 네모를 같은 자리에 겹침 — 세 번째부터 빨강(반박 세 번 = FAIL 과 같은 자). 많은 것 둘
  const c3 = anCard('같은 일이 몇 번째인가');
  const repeats = (r.repeats ?? []).slice(0, 3);
  if (!repeats.length) c3.appendChild(el('div', 'panel__note', '같은 자리를 두 번 간 일이 없어요'));
  for (const p of repeats) {
    const box = el('span', 'an__rep');
    box.appendChild(stackBoxes(p.nth));
    const where = p.kind === 'card' ? p.at.map((ts) => clockWord(ts)).join(' · ') : `${p.at[0]}회차부터 ${p.at[p.at.length - 1]}회차`;
    const text = el('span', 'an__sentence', `${nameOf(p.team)} ${p.what} — ${where}, 같은 자리에서 ${nthWord(p.nth)}${p.passed ? '에 통과' : ''}`);
    if (p.nth >= 3) text.dataset.k = 'bad';
    box.appendChild(text);
    const why = p.kind === 'card' ? p.ids.map((id, i) => cardLine(p.team, id, p.what, p.at[i])) : [el('span', 'an__line', `${p.at.map((n) => `${n}회차`).join(' · ')}`)];
    c3.appendChild(anRow(`rep:${p.team}:${p.what}`, box, why));
  }
  body.appendChild(c3);
}
