import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SITES, getAuth, dateRange, searchData, searchTrend, ga4Data, sheetData, parseDate } from '../../lib/google';

const clamp = (n) => Math.min(20, Math.max(0, Number(n) || 0));
const iso = (d) => d.toISOString().slice(0, 10);

const BASELINE_DAYS = 90; // a site younger than this is shown as "baseline"
const MIN_PREVIOUS = 30; // impressions needed in the previous 28 days before a trend is trusted

function authorized(req) {
  const want = process.env.DASHBOARD_KEY || '';
  const got = String(req.headers['x-dashboard-key'] || '');
  return want.length > 0 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

function readManual() {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'manual.json'), 'utf8'));
}

// launch dates and past monthly totals live in data/history.json (optional)
function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'history.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

// Visibility from the impressions trend: flat = 10, doubling = 15, quadrupling = 20, halving = 5, quartering = 0
function visibilityFromTrend(t) {
  if (!t || t.previous < MIN_PREVIOUS) return null;
  const ratio = Math.max(t.current, 0.01) / t.previous;
  return Math.round(clamp(10 + 5 * Math.log2(ratio)));
}

// Turns five 0-20 answers into the meter reading, with movement, baseline flag and trend
function buildVitality(def, parts, trend, hist, now = new Date()) {
  if (!Array.isArray(parts) || parts.length !== 5) return null;
  const nums = parts.map(clamp);
  const auto = visibilityFromTrend(trend);
  if (auto != null) nums[0] = auto;
  const score = nums.reduce((a, n) => a + n, 0);

  const monthNow = iso(now).slice(0, 7);
  const past = (hist.scores || {})[def.key] || {};
  const prevMonth = Object.keys(past).filter((m) => m < monthNow).sort().pop();
  const change = prevMonth ? score - Math.round(Number(past[prevMonth]) || 0) : null;

  const launched = parseDate((hist.launched || {})[def.key]);
  const ageDays = launched ? Math.max(0, Math.floor((now.getTime() - launched.getTime()) / 864e5)) : null;

  return {
    score,
    change,
    baseline: ageDays != null && ageDays < BASELINE_DAYS,
    ageDays,
    visibilityAuto: auto != null,
    parts: nums,
    trend: trend
      ? {
          current: trend.current,
          previous: trend.previous,
          enough: trend.previous >= MIN_PREVIOUS,
          pct: trend.previous > 0 ? Math.round((trend.current / trend.previous - 1) * 100) : null,
        }
      : null,
  };
}

// Score parts, experiments and backlinks from data/manual.json (manual and hybrid modes)
function manualExtras(m) {
  const parts = {};
  for (const s of SITES) {
    const d = (m.sites || {})[s.key] || {};
    parts[s.key] = Array.isArray(d.score) && d.score.length === 5 ? d.score : null;
  }
  const cutoff = Date.now() - 28 * 864e5;
  const links = (m.backlinks || [])
    .map((r) => ({ t: (parseDate(r[0]) || new Date(0)).getTime(), site: r[1], url: r[2] }))
    .filter((l) => l.url)
    .sort((a, b) => b.t - a.t);
  return {
    parts,
    experiments: { running: m.experimentsRunning ?? null },
    backlinks: { count: links.filter((l) => l.t >= cutoff).length, latest: links.slice(0, 5) },
  };
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
  const m = readManual();
  const hist = readHistory();
  const range = manualRange(m);
  const extras = manualExtras(m);
  const sites = SITES.map((s) => {
    const d = (m.sites || {})[s.key] || {};
    const byDate = new Map((d.daily || []).map((r) => [r[0], { date: r[0], impressions: Number(r[1]) || 0, clicks: Number(r[2]) || 0 }]));
    return {
      key: s.key, name: s.name, short: s.short, color: s.color,
      series: range.days.map((dt) => byDate.get(dt) || { date: dt, impressions: 0, clicks: 0 }),
      queries: (d.queries || []).slice(0, 5).map((q) => ({ query: q[0], impressions: Number(q[1]) || 0, clicks: Number(q[2]) || 0 })),
      vitality: buildVitality(s, extras.parts[s.key], null, hist),
    };
  });
  return {
    range: { startDate: range.startDate, endDate: range.endDate },
    sites,
    experiments: extras.experiments,
    backlinks: extras.backlinks,
    sheetError: null,
    baselineDays: BASELINE_DAYS,
    manual: m.updated || true,
  };
}

async function liveMetrics() {
  const auth = getAuth();
  const range = dateRange(28);
  const hist = readHistory();
  const zero = (date) => ({ date, impressions: 0, clicks: 0 });

  // Search Console, live (28 days, plus the 28 days before for the trend)
  const sites = await Promise.all(
    SITES.map(async (s) => {
      const meta = { key: s.key, name: s.name, short: s.short, color: s.color };
      try {
        const [d, trend] = await Promise.all([searchData(auth, s, range), searchTrend(auth, s, 28).catch(() => null)]);
        const byDate = new Map(d.series.map((p) => [p.date, p]));
        return { ...meta, series: range.days.map((dt) => byDate.get(dt) || zero(dt)), queries: d.queries, trend };
      } catch (e) {
        return { ...meta, series: range.days.map(zero), queries: [], trend: null, error: String(e.message).slice(0, 200) };
      }
    })
  );

  // Google Analytics 4: real-use signals (skipped for a site with no GA4_* variable set)
  await Promise.all(
    sites.map(async (s) => {
      const def = SITES.find((x) => x.key === s.key);
      if (!def || !def.ga4) return;
      try {
        s.ga4 = await ga4Data(auth, def, range);
      } catch (e) {
        s.ga4 = null;
        s.ga4Error = String(e.message).slice(0, 200);
      }
    })
  );

  let extra = { experiments: { running: null }, backlinks: { count: null, latest: [] }, sheetError: null };

  if (process.env.SHEET_ID) {
    // Full live mode: scores, experiments and backlinks from the Google Sheet
    try {
      const raw = await sheetData(auth);
      const latest = {};
      for (const r of raw.sites) {
        const name = String(r[0] || '').trim().toLowerCase();
        const t = (parseDate(r[1]) || new Date(0)).getTime();
        if (!latest[name] || t >= latest[name].t) {
          latest[name] = { t, parts: [2, 3, 4, 5, 6].map((i) => r[i]) };
        }
      }
      for (const s of sites) {
        const def = SITES.find((x) => x.key === s.key);
        const v = latest[s.name.toLowerCase()];
        s.vitality = v ? buildVitality(def, v.parts, s.trend, hist) : null;
      }
      const cutoff = Date.now() - 28 * 864e5;
      const links = raw.backlinks
        .filter((r) => r[2] && String(r[4] || 'yes').toLowerCase() !== 'no')
        .map((r) => ({ t: (parseDate(r[0]) || new Date(0)).getTime(), site: r[1], url: r[2] }))
        .sort((a, b) => b.t - a.t);
      extra = {
        experiments: { running: raw.experiments.filter((r) => r[0] && !r[8]).length },
        backlinks: { count: links.filter((l) => l.t >= cutoff).length, latest: links.slice(0, 5) },
        sheetError: null,
      };
    } catch (e) {
      extra.sheetError = String(e.message).slice(0, 200);
    }
  } else {
    // Hybrid mode (no SHEET_ID): scores, experiments and backlinks stay in data/manual.json
    try {
      const x = manualExtras(readManual());
      for (const s of sites) {
        const def = SITES.find((d) => d.key === s.key);
        s.vitality = buildVitality(def, x.parts[s.key], s.trend, hist);
      }
      extra = { experiments: x.experiments, backlinks: x.backlinks, sheetError: null };
    } catch (e) {
      extra.sheetError = 'manual.json: ' + String(e.message).slice(0, 180);
    }
  }

  return { range: { startDate: range.startDate, endDate: range.endDate }, sites, baselineDays: BASELINE_DAYS, ...extra };
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Wrong key' });
  try {
    // Google key set: Search Console and GA4 are read live. No key: everything comes from data/manual.json
    const body = process.env.GOOGLE_SERVICE_ACCOUNT_B64 ? await liveMetrics() : manualMetrics();
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json(body);
  } catch (e) {
    return res.status(500).json({ error: String(e.message).slice(0, 200) });
  }
}
