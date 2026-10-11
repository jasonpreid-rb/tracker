import { google } from 'googleapis';

// ga4 = GA4 property ID (the number, not the G- code)
// ga4Events = event names to count; ga4Path = page path prefix to count visits to
export const SITES = [
  { key: 'rb', name: 'Ripping Bombs', short: 'RB', color: '#FF2BA6', gsc: process.env.GSC_RB, ga4: process.env.GA4_RB, ga4Events: [], ga4Path: null },
  { key: 'ez', name: 'eazie', short: 'EZ', color: '#2EE6C5', gsc: process.env.GSC_EAZIE, ga4: process.env.GA4_EAZIE, ga4Events: [], ga4Path: '/app/' },
  { key: 'ttc', name: 'TrueTravelCost', short: 'TTC', color: '#FFB020', gsc: process.env.GSC_TTC, ga4: process.env.GA4_TTC, ga4Events: ['calculator_started', 'calculation_completed'], ga4Path: null },
];

export function getAuth() {
  const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64 || '', 'base64').toString('utf8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/analytics.readonly',
    ],
  });
}

const iso = (d) => d.toISOString().slice(0, 10);

// Search Console data lags about two days, so the window ends two days ago.
export function dateRange(days = 28) {
  const end = new Date(Date.now() - 2 * 864e5);
  const start = new Date(end.getTime() - (days - 1) * 864e5);
  const list = [];
  for (let i = 0; i < days; i++) list.push(iso(new Date(start.getTime() + i * 864e5)));
  return { startDate: iso(start), endDate: iso(end), days: list };
}

export async function searchData(auth, site, { startDate, endDate }) {
  const sc = google.searchconsole({ version: 'v1', auth });
  const run = (dimensions, rowLimit) =>
    sc.searchanalytics.query({ siteUrl: site.gsc, requestBody: { startDate, endDate, dimensions, rowLimit } });
  const [byDate, byQuery] = await Promise.all([run(['date'], 100), run(['query'], 25)]);
  const pick = (r) => ({ impressions: r.impressions || 0, clicks: r.clicks || 0 });
  return {
    series: (byDate.data.rows || []).map((r) => ({ date: r.keys[0], ...pick(r) })),
    queries: (byQuery.data.rows || [])
      .map((r) => ({ query: r.keys[0], ...pick(r) }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5),
  };
}

// GA4: overall users and sessions, plus the "real use" signals for each site.
export async function ga4Data(auth, site, { startDate, endDate }) {
  if (!site.ga4) return null;
  const ad = google.analyticsdata({ version: 'v1beta', auth });
  const property = `properties/${site.ga4}`;
  const dateRanges = [{ startDate, endDate }];
  const num = (v) => Number(v) || 0;

  const jobs = [
    ad.properties.runReport({
      property,
      requestBody: { dateRanges, metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }] },
    }),
  ];

  if (site.ga4Events && site.ga4Events.length) {
    jobs.push(
      ad.properties.runReport({
        property,
        requestBody: {
          dateRanges,
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
          dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: site.ga4Events } } },
        },
      })
    );
  }

  if (site.ga4Path) {
    jobs.push(
      ad.properties.runReport({
        property,
        requestBody: {
          dateRanges,
          metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
          dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: site.ga4Path } } },
        },
      })
    );
  }

  const results = await Promise.all(jobs);
  let i = 0;

  const t = (results[i++].data.rows || [])[0];
  const out = {
    users: t ? num(t.metricValues[0].value) : 0,
    sessions: t ? num(t.metricValues[1].value) : 0,
    pageViews: t ? num(t.metricValues[2].value) : 0,
    events: {},
    path: null,
  };

  if (site.ga4Events && site.ga4Events.length) {
    for (const name of site.ga4Events) out.events[name] = { count: 0, users: 0 };
    for (const r of results[i++].data.rows || []) {
      out.events[r.dimensionValues[0].value] = { count: num(r.metricValues[0].value), users: num(r.metricValues[1].value) };
    }
  }

  if (site.ga4Path) {
    const p = (results[i++].data.rows || [])[0];
    out.path = { prefix: site.ga4Path, users: p ? num(p.metricValues[0].value) : 0, views: p ? num(p.metricValues[1].value) : 0 };
  }

  return out;
}

export async function sheetData(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: process.env.SHEET_ID,
    ranges: ['Experiments!A2:J', 'Backlinks!A2:E', 'Sites!A2:G'],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const [experiments, backlinks, sites] = res.data.valueRanges.map((v) => v.values || []);
  return { experiments, backlinks, sites };
}

// Accepts Sheets date serials, YYYY-MM-DD, or DD.MM.YYYY.
export function parseDate(v) {
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 864e5);
  if (typeof v !== 'string') return null;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}