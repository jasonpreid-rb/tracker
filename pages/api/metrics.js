import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SITES, getAuth, dateRange, searchData, searchTrend, ga4Data, sheetData, parseDate } from '../../lib/google';
import { buildInstagramSite } from '../../lib/instagram';

// The websites tracked in Search Console. Instagram is not a website and cannot be verified there, so any Instagram entry in SITES is skipped.
// It is read from the Instagram API instead (see lib/instagram.js).
const WEB = SITES.filter((s) => !/instagram|^ig$/i.test(String(s.key)) && !/instagram/i.test(JSON.stringify(s)));

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

// The five measures behind each meter, all calculated from live data. Each is 0 to 20 and the meter is their sum.
const PARTS = ['Visibility', 'Momentum', 'Clicks and rank', 'Real use', 'Return use'];
// What counts as full marks. Scales are square-root, so small numbers earn little until volume builds.
const TARGET = { impressions: 1000, clicks: 100, users: 200, actions: 50 }; // per 28 days
const GOOD = { returning: 0.25, engagedSecs: 60 }; // full marks for Return use: share of users who came back, seconds engaged per user
// Launch dates for the baseline flag. Add one for a new site; data/history.json can still override.
const LAUNCHED = { ez: '2026-09-24', ttc: '2026-09-24' };

// Square-root scale: tiny numbers earn little, and the score climbs as real volume builds up
const lg = (n, full) => Math.min(1, Math.sqrt(Math.max(0, n) / full));
const sumOf = (a, f) => a.reduce((t, p) => t + (Number(p[f]) || 0), 0);

const num = (v) => Number(v) || 0;
const fmtN = (n) => Math.round(n).toLocaleString('en');

// The raw numbers behind the five measures, so the scores, their notes and the confidence flag all read the same data
function autoStats(site) {
  const series = site.series || [];
  const half = Math.floor(series.length / 2);
  const g = site.ga4 || null;
  const evs = g ? Object.values(g.events || {}) : [];
  return {
    days: series.length,
    half,
    impr: sumOf(series, 'impressions'),
    clicks: sumOf(series, 'clicks'),
    early: sumOf(series.slice(0, half), 'impressions'),
    late: sumOf(series.slice(half), 'impressions'),
    active: series.filter((p) => num(p.impressions) > 0).length, // days with any search impressions
    hasGa4: !!g,
    position: site.search ? site.search.position : null, // average Search Console position
    queryCount: site.search ? site.search.queryCount : null,
    striking: site.search ? site.search.striking : null,
    newUsers: g && g.newUsers != null ? num(g.newUsers) : null,
    engagedSecs: g && g.engagedSeconds != null ? num(g.engagedSeconds) : null,
    users: g ? num(g.users) : 0,
    sessions: g ? num(g.sessions) : 0,
    // Tracked actions only: events set up in lib/google.js, plus visits to a site's app path. Page views are not counted.
    actions: !g ? 0 : evs.reduce((t, v) => t + num((v || {}).count), 0) + (g.path ? num(g.path.views) : 0),
  };
}

// Rank credit: 1 at position 10 or better, falling to 0 at position 50. Counts in full from 100 impressions
function rankCredit(st) {
  if (st.position == null || st.position <= 0) return 0;
  return Math.max(0, Math.min(1, (50 - st.position) / 40)) * Math.min(1, st.impr / 100);
}

// Return use, 0 to 20: share of users who came back plus time engaged per user, weighted by how many users there are.
// Falls back to sessions per user if Analytics did not return new-user figures.
function returnUse(st) {
  const weight = Math.min(1, st.users / 100);
  if (st.newUsers == null || st.engagedSecs == null) return 10 * Math.max(0, st.sessions / Math.max(st.users, 1) - 1) * weight;
  const returning = Math.max(0, st.users - st.newUsers);
  const share = st.users > 0 ? returning / st.users : 0;
  const secs = st.users > 0 ? st.engagedSecs / st.users : 0;
  return (12 * Math.min(1, share / GOOD.returning) + 8 * Math.min(1, secs / GOOD.engagedSecs)) * weight;
}

function autoParts(site) {
  const st = autoStats(site);
  return [
    // Visibility: impressions in search, last 28 days. Spread over 3 weeks or more earns full credit, a one-day spike earns about half
    20 * lg(st.impr, TARGET.impressions) * (0.5 + 0.5 * Math.min(1, st.active / 21)),
    (10 + 5 * Math.log2((st.late + 5) / (st.early + 5))) * Math.min(1, (st.early + st.late) / 200), // Momentum: latest half against the half before (flat = 10), weighted by volume
    14 * lg(st.clicks, TARGET.clicks) + 6 * rankCredit(st), // Clicks and rank: people who arrived from search, plus how close the site ranks to page one
    10 * lg(st.users, TARGET.users) + 10 * lg(st.actions, TARGET.actions), // Real use: users, plus calculator and other tracked actions
    returnUse(st), // Return use: users who came back and time engaged
  ].map((n) => Math.round(clamp(n)));
}

// One plain line per measure, shown under its bar when a single site is selected
function partNotes(site) {
  const st = autoStats(site);
  const cur = st.days - st.half;
  const breadth = st.queryCount == null ? '' : `, ${fmtN(st.queryCount)} different queries${st.striking ? `, ${fmtN(st.striking)} near page one` : ''}`;
  let ret;
  if (!st.hasGa4) ret = 'No Analytics data for this site';
  else if (st.users === 0) ret = 'No users yet';
  else if (st.newUsers == null || st.engagedSecs == null) ret = `${(st.sessions / st.users).toFixed(1)} sessions per user. 3 is full marks, counts in full from 100 users`;
  else {
    const back = Math.max(0, st.users - st.newUsers);
    ret = `${fmtN(back)} of ${fmtN(st.users)} users came back, ${fmtN(st.engagedSecs / st.users)} seconds engaged per user. Full marks at ${GOOD.returning * 100}% and ${GOOD.engagedSecs} seconds, counts in full from 100 users`;
  }
  return [
    `${fmtN(st.impr)} impressions on ${st.active} of ${st.days} days${breadth}. Full marks at ${fmtN(TARGET.impressions)}, spread over 3 weeks or more`,
    st.early + st.late === 0
      ? 'No impressions yet'
      : `${fmtN(st.late)} in the latest ${cur} days, ${fmtN(st.early)} in the ${st.half} before.${st.early + st.late < 200 ? ' Counts in full from 200 impressions' : ''}`,
    `${fmtN(st.clicks)} clicks (full marks at ${fmtN(TARGET.clicks)})${st.position == null ? ', no ranking data yet' : `, average position ${st.position} (full rank credit at 10 or better, none past 50)`}`,
    st.hasGa4 ? `${fmtN(st.users)} users, ${fmtN(st.actions)} tracked actions. Full marks at ${fmtN(TARGET.users)} and ${fmtN(TARGET.actions)}` : 'No Analytics data for this site',
    ret,
  ];
}

// How far to trust the score. With very little data it moves on noise, so a zone such as "Pause" should not be read literally
function confidence(site) {
  const st = autoStats(site);
  let level = 'high';
  const reasons = [];
  if (st.impr < 100) { level = 'low'; reasons.push('Under 100 impressions in 28 days, so the score moves on noise'); }
  else if (st.impr < 500) { level = 'medium'; reasons.push('Small numbers, read the score as a rough guide'); }
  if (!st.hasGa4) { if (level === 'high') level = 'medium'; reasons.push('No Analytics data, so Real use and Return use score 0'); }
  return { level, note: reasons.length ? reasons.join('. ') : 'Enough data to read the score' };
}

// The 28 days before the current window
function priorRange(range, days = 28) {
  const end = new Date(new Date(range.startDate + 'T00:00:00Z').getTime() - 864e5);
  const start = new Date(end.getTime() - (days - 1) * 864e5);
  const list = [];
  for (let k = 0; k < days; k++) list.push(iso(new Date(start.getTime() + k * 864e5)));
  return { startDate: iso(start), endDate: iso(end), days: list };
}

// Meter reading for one site, built only from its live Search Console and Analytics data
function buildVitality(def, site, hist, now = new Date()) {
  const nums = autoParts(site);
  const notes = partNotes(site);
  const score = nums.reduce((a, n) => a + n, 0);
  const launched = parseDate((hist.launched || {})[def.key] || LAUNCHED[def.key]);
  const ageDays = launched ? Math.max(0, Math.floor((now.getTime() - launched.getTime()) / 864e5)) : null;
  const trend = site.trend;
  // Change against the previous 28 days, only once that period had enough search data to mean something
  let change = null;
  if (site.prior && sumOf(site.prior.series, 'impressions') >= MIN_PREVIOUS) {
    change = score - autoParts(site.prior).reduce((a, n) => a + n, 0);
  }
  return {
    score,
    change,
    baseline: ageDays != null && ageDays < BASELINE_DAYS,
    ageDays,
    auto: true,
    parts: PARTS.map((label, k) => ({ label, score: nums[k], max: 20, note: notes[k] })),
    confidence: confidence(site),
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
  for (const s of WEB) {
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
  const sites = WEB.map((s) => {
    const d = (m.sites || {})[s.key] || {};
    const byDate = new Map((d.daily || []).map((r) => [r[0], { date: r[0], impressions: Number(r[1]) || 0, clicks: Number(r[2]) || 0 }]));
    return {
      key: s.key, name: s.name, short: s.short, color: s.color,
      series: range.days.map((dt) => byDate.get(dt) || { date: dt, impressions: 0, clicks: 0 }),
      queries: (d.queries || []).slice(0, 5).map((q) => ({ query: q[0], impressions: Number(q[1]) || 0, clicks: Number(q[2]) || 0 })),
    };
  });
  sites.forEach((x) => { x.vitality = buildVitality(x, x, hist); });
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
    WEB.map(async (s) => {
      const meta = { key: s.key, name: s.name, short: s.short, color: s.color };
      try {
        const [d, trend] = await Promise.all([searchData(auth, s, range), searchTrend(auth, s, 28).catch(() => null)]);
        const byDate = new Map(d.series.map((p) => [p.date, p]));
        return { ...meta, series: range.days.map((dt) => byDate.get(dt) || zero(dt)), queries: d.queries, search: d.stats, trend };
      } catch (e) {
        return { ...meta, series: range.days.map(zero), queries: [], trend: null, error: String(e.message).slice(0, 200) };
      }
    })
  );

  // Google Analytics 4: real-use signals (skipped for a site with no GA4_* variable set)
  await Promise.all(
    sites.map(async (s) => {
      const def = WEB.find((x) => x.key === s.key);
      if (!def || !def.ga4) return;
      try {
        s.ga4 = await ga4Data(auth, def, range);
      } catch (e) {
        s.ga4 = null;
        s.ga4Error = String(e.message).slice(0, 200);
      }
    })
  );

  // Previous 28 days (Search Console and GA4), so the meter can show its movement
  const prior = priorRange(range);
  await Promise.all(
    sites.map(async (s) => {
      const def = WEB.find((x) => x.key === s.key);
      if (!def || s.error) return;
      try {
        const [d, g] = await Promise.all([searchData(auth, def, prior), def.ga4 ? ga4Data(auth, def, prior) : null]);
        const byDate = new Map(d.series.map((p) => [p.date, p]));
        s.prior = { series: prior.days.map((dt) => byDate.get(dt) || zero(dt)), ga4: g, search: d.stats };
      } catch (e) {
        s.prior = null;
      }
    })
  );

  sites.forEach((x) => { x.vitality = buildVitality(x, x, hist); delete x.prior; });

  // Instagram: read from the Instagram API when IG_ACCESS_TOKEN is set. It has no Search Console data, so it gets its own scoring.
  if (process.env.IG_ACCESS_TOKEN) sites.push(await buildInstagramSite(range, prior, hist));

  let extra = { experiments: { running: null }, backlinks: { count: null, latest: [] }, sheetError: null };

  if (process.env.SHEET_ID) {
    // Full live mode: scores, experiments and backlinks from the Google Sheet
    try {
      const raw = await sheetData(auth);
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
