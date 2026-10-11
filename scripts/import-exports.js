// Turns Search Console "Export > Download CSV" zips into data/manual.json.
// Usage: put the zips in an "exports" folder, then run: node scripts/import-exports.js
// Backlinks, experimentsRunning and scores already in manual.json are kept as they are.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'exports');
const file = path.join(root, 'data', 'manual.json');
const KEYS = [['rippingbombs', 'rb'], ['eazie', 'ez'], ['truetravelcost', 'ttc']];
const ORDER = ['rb', 'ez', 'ttc'];

function parseLine(l) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const rows = (t) => t.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).slice(1).map(parseLine);
const iso = (d) => d.toISOString().slice(0, 10);

if (!fs.existsSync(dir)) { console.log('Create a folder called "exports" in the project root and put the zip files in it.'); process.exit(1); }

const found = {};
for (const f of fs.readdirSync(dir).filter((n) => /\.zip$/i.test(n)).sort()) {
  const hit = KEYS.find(([n]) => f.toLowerCase().includes(n));
  if (!hit) { console.log('Skipped (site not recognised):', f); continue; }
  const zip = new AdmZip(path.join(dir, f));
  const chart = zip.readAsText('Chart.csv'), queries = zip.readAsText('Queries.csv');
  if (!chart) { console.log('Skipped (no Chart.csv inside):', f); continue; }
  found[hit[1]] = {
    chart: new Map(rows(chart).map((r) => [r[0], [Number(r[2]) || 0, Number(r[1]) || 0]])),
    queries: rows(queries || '').map((r) => [r[0], Number(r[2]) || 0, Number(r[1]) || 0]).sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}
if (!Object.keys(found).length) { console.log('No usable zip files found in exports.'); process.exit(1); }

const last = Object.values(found).flatMap((s) => [...s.chart.keys()]).sort().pop();
const end = new Date(last + 'T00:00:00Z');
const days = [];
for (let i = 27; i >= 0; i--) days.push(iso(new Date(end.getTime() - i * 864e5)));

const m = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { sites: {}, backlinks: [], experimentsRunning: null };
m.updated = iso(new Date());
for (const k of Object.keys(found)) {
  const daily = days.filter((d) => found[k].chart.has(d)).map((d) => [d, ...found[k].chart.get(d)]);
  m.sites[k] = { daily, queries: found[k].queries, score: (m.sites[k] || {}).score ?? null };
  console.log(k, '| 28 days to', last, '| impressions', daily.reduce((a, r) => a + r[1], 0), '| clicks', daily.reduce((a, r) => a + r[2], 0));
}

const L = ['{', `  "updated": ${JSON.stringify(m.updated)},`, '  "sites": {'];
ORDER.filter((k) => m.sites[k]).forEach((k, i, a) => {
  const s = m.sites[k];
  L.push(`    "${k}": {`, '      "daily": [', s.daily.map((r) => '        ' + JSON.stringify(r)).join(',\n'), '      ],');
  L.push('      "queries": [', s.queries.map((r) => '        ' + JSON.stringify(r)).join(',\n'), '      ],');
  L.push(`      "score": ${JSON.stringify(s.score ?? null)}`, '    }' + (i < a.length - 1 ? ',' : ''));
});
L.push('  },', '  "backlinks": [', (m.backlinks || []).map((r) => '    ' + JSON.stringify(r)).join(',\n'), '  ],');
L.push(`  "experimentsRunning": ${JSON.stringify(m.experimentsRunning ?? null)}`, '}');
fs.writeFileSync(file, L.join('\n').replace('[\n\n  ]', '[]') + '\n');
console.log('Wrote data/manual.json');
