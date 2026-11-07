const fs = require('fs');
const path = require('path');
const here = __dirname;
const out = path.join(here, '..', 'project');
const read = f => fs.readFileSync(path.join(here, f), 'utf8');
const theme = read('theme.css');
const status = read('status.html');
const nav = read('nav.html');

const screens = [
  { id: 'Push', title: 'Morning push', time: '', nav: null },
  { id: 'Main', title: 'Home', time: '6:12', nav: { home: true, cal: 'Week' } },
  { id: 'Replan', title: 'Change the plan', time: '6:13', nav: null },
  { id: 'Week', title: 'Calendar, week', time: '6:14', nav: { home: false, cal: 'Week' } },
  { id: 'Month', title: 'Calendar, month', time: '6:14', nav: { home: false, cal: 'Month' } },
];

for (const mode of ['dark', 'light']) {
  for (const s of screens) {
    let body = read(s.id + '.tpl');
    if (s.nav) {
      const n = nav
        .replace('NAVHOME', s.nav.home ? 'var(--text)' : 'var(--muted)')
        .replace('NAVCALC', s.nav.home ? 'var(--muted)' : 'var(--text)')
        .replace('NAVCAL', s.nav.cal + '.dc.html');
      body = body.replace('<!--NAV-->', n);
    }
    const js = fs.existsSync(path.join(here, s.id + '.js')) ? read(s.id + '.js') : 'class Component extends DCLogic {\nrenderVals() { return {}; }\n}\n';
    let html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${s.title}${mode === 'light' ? ' (light)' : ''}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>
${theme}</style>
</helmet>
<div class="${mode} frame"><div class="screen">
${status.replace('STATUSTIME', s.time)}${body}<div class="homebar"></div>
</div></div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":390,"height":844}}'>
${js}</script>
</body>
</html>
`;
    let name = s.id + '.dc.html';
    if (mode === 'light') {
      html = html.replace(/href="(Push|Main|Replan|Week|Month)\.dc\.html"/g, 'href="$1Light.dc.html"');
      name = s.id + 'Light.dc.html';
    }
    fs.writeFileSync(path.join(out, name), html);
    console.log('wrote', name, html.length);
  }
}
