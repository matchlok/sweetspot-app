class Component extends DCLogic {
renderVals() {
  // Sample data. Mon-start weeks; Nov 1 2026 is a Sunday. Minutes per day.
  const rides = { '2026-10-27': 60, '2026-10-29': 45, '2026-10-31': 90, '2026-11-03': 60, '2026-11-05': 50 };
  const planned = { '2026-11-07': 120, '2026-11-10': 60, '2026-11-12': 45, '2026-11-14': 120, '2026-11-17': 60, '2026-11-19': 45, '2026-11-21': 120, '2026-11-24': 60, '2026-11-28': 90, '2026-12-01': 60 };
  const weeks = [];
  let d = new Date(Date.UTC(2026, 9, 26));
  for (let w = 0; w < 6; w++) {
    const days = [];
    let mins = 0, plan = 0;
    for (let i = 0; i < 7; i++) {
      const key = d.toISOString().slice(0, 10);
      const inMonth = d.getUTCMonth() === 10;
      const today = key === '2026-11-07';
      const done = rides[key] || 0;
      const p = planned[key] || 0;
      mins += done; plan += p;
      days.push({
        n: d.getUTCDate(),
        done: done > 0,
        planned: p > 0,
        h: Math.round(((done || p) / 120) * 26) + 'px',
        cell: 'height: 52px; box-sizing: border-box; padding: 4px; border-radius: 8px; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-start; background: ' + (today ? 'var(--today)' : 'var(--card2)') + '; border: 1px solid ' + (today ? 'var(--accent)' : 'var(--card2-bd)'),
        num: 'font-size: 11px; font-weight: ' + (today ? '700' : '500') + '; color: ' + (inMonth ? 'var(--text)' : 'var(--dim)')
      });
      d = new Date(d.getTime() + 86400000);
    }
    const hrs = mins / 60;
    const tot = mins ? (Math.round(hrs * 10) / 10) + 'h' : (plan ? (Math.round(plan / 6) / 10) + '' : '');
    weeks.push({ days, tot, totStyle: 'align-self: center; text-align: right; font-size: 12px; font-weight: ' + (mins ? '600' : '400') + '; color: ' + (mins ? 'var(--text)' : 'var(--muted)') });
  }
  return { weeks };
}
}
