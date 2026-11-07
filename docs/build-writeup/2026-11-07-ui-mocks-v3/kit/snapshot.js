// Copies the canvas sources into the write-up folder and builds a static snapshot.html.
// Month uses <sc-for>, which only the canvas runtime expands, so the snapshot gets a pre-rendered copy.
const fs = require('fs');
const path = require('path');
const proj = path.join(__dirname, '..', 'project');
const dest = process.argv[2];
const src = path.join(dest, 'source');
const stat = path.join(dest, 'static');
fs.mkdirSync(src, { recursive: true });
fs.mkdirSync(stat, { recursive: true });

const ids = ['Push', 'Main', 'Replan', 'Week', 'Month'];
const files = ids.flatMap(id => [id + '.dc.html', id + 'Light.dc.html']).concat('canvas.json');
for (const f of files) fs.copyFileSync(path.join(proj, f), path.join(src, f));

global.DCLogic = class {};
eval(fs.readFileSync(path.join(__dirname, 'Month.js'), 'utf8') + '; global.MonthComponent = Component;');
const { weeks } = new global.MonthComponent().renderVals();
const grid = weeks.map(wk => {
  const days = wk.days.map(d => {
    const bar = d.done
      ? `<div style="display: flex; flex-direction: column; gap: 1px; width: 100%; height: ${d.h}"><div style="flex: 1; background: var(--z4); border-radius: 2px 2px 0 0"></div><div style="flex: 1; background: var(--z3)"></div><div style="flex: 5; background: var(--z2); border-radius: 0 0 2px 2px"></div></div>`
      : d.planned ? `<div style="width: 100%; height: ${d.h}; box-sizing: border-box; border: 1px dashed var(--plan); border-radius: 3px"></div>` : '';
    return `<div style="${d.cell}"><span style="${d.num}">${d.n}</span>${bar}</div>`;
  }).join('');
  return `<div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)) 40px; gap: 4px">${days}<span style="${wk.totStyle}">${wk.tot}</span></div>`;
}).join('\n');

for (const id of ids) for (const sfx of ['', 'Light']) {
  let html = fs.readFileSync(path.join(proj, id + sfx + '.dc.html'), 'utf8');
  if (id === 'Month') html = html.replace(/<sc-for list="\{\{weeks\}\}"[\s\S]*<\/sc-for>/, () => grid);
  fs.writeFileSync(path.join(stat, id + sfx + '.html'), html);
}

const titles = ['1 · 6:05 am push', '2 · Home', '3 · Change the plan', '4 · Calendar: week', '5 · Calendar: month'];
const row = sfx => ids.map((id, i) => `<div class="b"><span>${titles[i]}</span><iframe src="static/${id}${sfx}.html"></iframe></div>`).join('\n');
fs.writeFileSync(path.join(dest, 'snapshot.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#e9e8e4;font:600 14px Inter,system-ui,sans-serif;color:#333}
h1{margin:32px 40px 8px;font-size:28px}h2{margin:16px 40px 0;font-size:16px;color:#666}.row{display:flex;gap:40px;padding:12px 40px 32px}
.b{display:flex;flex-direction:column;gap:8px}iframe{width:390px;height:844px;border:0;box-shadow:0 6px 24px rgba(0,0,0,.18);background:#fff}
</style></head><body><h1>Sweetspot · the 6 am loop (v3 mocks, 2026-11-07)</h1>
<h2>Dark (chosen for now)</h2><div class="row">${row('')}</div>
<h2>Light (comparison)</h2><div class="row">${row('Light')}</div>
</body></html>`);
console.log('ok', files.length, 'sources');
