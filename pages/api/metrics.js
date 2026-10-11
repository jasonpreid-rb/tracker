import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SITES, getAuth, dateRange, searchData, sheetData, parseDate } from '../../lib/google';

const clamp = (n) => Math.min(20, Math.max(0, Number(n) || 0));
const iso = (d) => d.toISOString().slice(0, 10);

function authorized(req) {
  const want = process.env.DASHBOARD_KEY || '';
  const got = String(req.headers['x-dashboard-key'] || '');
  return want.length > 0 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// 28 day window ending on the latest date in the manual data (or two days ago if there is none)
function manualRange(m) {
  const all = Object.values(m.sites || {}).flatMap((s) => (s.daily || []).map((r) => r[0])).sort();
  const end = all.length ? new Date(all[all.length - 1] + 'T00:00:00Z') : new Date(Date.now() - 2 * 864e5);
  const days = [];
  for (let i = 27; i >= 0; i--) days.push(iso(new Date(end.getTime() - i * 864e5)));
  return { startDate: days[0], endDate: days[27], days };
}

function manualMetrics() {
  const m = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'manual.json'), 'utf8'));
  const range = manualRange(m);
  const sites = SITES.map((s) => {
    const d = (m.sites || {})[s.key] || {};
    const byDate = new Map((d.daily || []).map((r) => [r[0], { date: r[0], impressions: Number(r[1]) || 0, clicks: Number(r[2]) || 0 }]));
    const score = Array.isArray(d.score) && d.score.length === 5 ? d.score.reduce((a, n) => a + clamp(n), 0) : null;
    return {
      key: s.key, name: s.name, short: s.short, color: s.color,
      series: range.days.map((dt) => byDate.get(dt) || { date: dt, impressions: 0, clicks: 0 }),
      queries: (d.queries || []).slice(0, 5).map((q) => ({ query: q[0], impressions: Number(q[1]) || 0, clicks: Number(q[2]) || 0 })),
      vitality: score == null ? null : { score },
    };
  });
  const cutoff = Date.now() - 28 * 864e5;
  const links = (m.backlinks || [])
    .map((r) => ({ t: (parseDate(r[0]) || new Date(0)).getTime(), site: r[1], url: r[2] }))
    .filter((l) => l.url)
    .sort((a, b) => b.t - a.t);
  return {
    range: { startDate: range.startDate, endDate: range.endDate },
    sites,
    experiments: { running: m.experimentsRunning ?? null },
    backlinks: { count: links.filter((l) => l.t >= cutoff).length, latest: links.slice(0, 5) },
    sheetError: null,
    manual: m.updated || true,
  };
}

async function liveMetrics() {
  const auth = getAuth();
  const range = dateRange(28);
  const zero = (date) => ({ date, impressions: 0, clicks: 0 });

  const sites = await Promise.all(
    SITES.map(async (s) => {
      const meta = { key: s.key, name: s.name, short: s.short, color: s.color };
      try {
        const d = await searchData(auth, s, range);
        const byDate = new Map(d.series.map((p) => [p.date, p]));
        return { ...meta, series: range.days.map((dt) => byDate.get(dt) || zero(dt)), queries: d.queries };
      } catch (e) {
        return { ...meta, series: range.days.map(zero), queries: [], error: String(e.message).slice(0, 200) };
      }
    })
  );

  let sheet = { experiments: { running: null }, backlinks: { count: null, latest: [] }, sheetError: null };
  try {
    const raw = await sheetData(auth);
    const latest = {};
    for (const r of raw.sites) {
      const name = String(r[0] || '').trim().toLowerCase();
      const t = (parseDate(r[1]) || new Date(0)).getTime();
      if (!latest[name] || t >= latest[name].t) {
        latest[name] = { t, score: [2, 3, 4, 5, 6].reduce((a, i) => a + clamp(r[i]), 0) };
      }
    }
    for (const s of sites) {
      const v = latest[s.name.toLowerCase()];
      s.vitality = v ? { score: v.score } : null;
    }
    const cutoff = Date.now() - 28 * 864e5;
    const links = raw.backlinks
      .filter((r) => r[2] && String(r[4] || 'yes').toLowerCase() !== 'no')
      .map((r) => ({ t: (parseDate(r[0]) || new Date(0)).getTime(), site: r[1], url: r[2] }))
      .sort((a, b) => b.t - a.t);
    sheet = {
      experiments: { running: raw.experiments.filter((r) => r[0] && !r[8]).length },
      backlinks: { count: links.filter((l) => l.t >= cutoff).length, latest: links.slice(0, 5) },
      sheetError: null,
    };
  } catch (e) {
    sheet.sheetError = String(e.message).slice(0, 200);
  }
  return { range: { startDate: range.startDate, endDate: range.endDate }, sites, ...sheet };
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Wrong key' });
  try {
    // No Google key set yet: read the numbers from data/manual.json instead
    const body = process.env.GOOGLE_SERVICE_ACCOUNT_B64 ? await liveMetrics() : manualMetrics();
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json(body);
  } catch (e) {
    return res.status(500).json({ error: String(e.message).slice(0, 200) });
  }
}
