import { google } from 'googleapis';

// ga4 = GA4 property ID (the number, not the G- code)
// ga4Events = event names to count; ga4Path = page path prefix to count visits to
export const SITES = [
  { key: 'rb', name: 'Ripping Bombs', short: 'RB', color: '#FF2BA6', gsc: process.env.GSC_RB, ga4: process.env.GA4_RB, ga4Events: [], ga4Path: null },
  { key: 'ez', name: 'eazie', short: 'EZ', color: '#2EE6C5', gsc: process.env.GSC_EAZIE, ga4: process.env.GA4_EAZIE, ga4Events: ['add_item'], ga4Path: '/app/' },
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
  const [byDate, byQuery] = await Promise.all([run(['date'], 100), run(['query'], 250)]);
  const pick = (r) => ({ impressions: r.impressions || 0, clicks: r.clicks || 0 });
  const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
  const dateRows = byDate.data.rows || [];
  const queryRows = byQuery.data.rows || [];

  // Average position over the window, weighted by impressions (Search Console reports position per row)
  const impTotal = dateRows.reduce((t, r) => t + (r.impressions || 0), 0);
  const position = impTotal > 0 ? dateRows.reduce((t, r) => t + (r.position || 0) * (r.impressions || 0), 0) / impTotal : null;
  // Queries ranking just off page one (positions 8 to 20) are the closest to turning into clicks
  const striking = queryRows.filter((r) => r.position >= 8 && r.position <= 20);

  return {
    series: dateRows.map((r) => ({ date: r.keys[0], ...pick(r) })),
    queries: queryRows
      .map((r) => ({ query: r.keys[0], ...pick(r), position: round1(r.position) }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5),
    // Breadth and rank. Google hides rare queries and this reads at most 250, so queryCount is a floor
    stats: {
      position: round1(position),
      queryCount: queryRows.length,
      striking: striking.length,
      strikingImpressions: striking.reduce((t, r) => t + (r.impressions || 0), 0),
    },
  };
}

// Impressions for the latest `days` days and for the `days` before that (for the Visibility trend).
export async function searchTrend(auth, site, days = 28) {
  const end = new Date(Date.now() - 2 * 864e5);
  const midStart = new Date(end.getTime() - (days - 1) * 864e5);
  const start = new Date(midStart.getTime() - days * 864e5);
  const sc = google.searchconsole({ version: 'v1', auth });
  const res = await sc.searchanalytics.query({
    siteUrl: site.gsc,
    requestBody: { startDate: iso(start), endDate: iso(end), dimensions: ['date'], rowLimit: 100 },
  });
  const cut = iso(midStart);
  let current = 0;
  let previous = 0;
  for (const r of res.data.rows || []) {
    if (r.keys[0] >= cut) current += r.impressions || 0;
    else previous += r.impressions || 0;
  }
  return { current, previous };
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
      requestBody: { dateRanges, metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }, { name: 'newUsers' }, { name: 'engagementRate' }, { name: 'userEngagementDuration' }] },
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

  // Where sessions come from. A failure here must not take down the rest of the GA4 data
  jobs.push(
    ad.properties
      .runReport({
        property,
        requestBody: { dateRanges, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }] },
      })
      .catch(() => null)
  );

  const results = await Promise.all(jobs);
  let i = 0;

  const t = (results[i++].data.rows || [])[0];
  const out = {
    users: t ? num(t.metricValues[0].value) : 0,
    sessions: t ? num(t.metricValues[1].value) : 0,
    pageViews: t ? num(t.metricValues[2].value) : 0,
    newUsers: t ? num(t.metricValues[3].value) : 0,
    engagementRate: t ? num(t.metricValues[4].value) : 0, // 0 to 1
    engagedSeconds: t ? num(t.metricValues[5].value) : 0, // total across all users
    events: {},
    path: null,
    channels: null,
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

  const ch = results[results.length - 1];
  if (ch) {
    const c = { organic: 0, direct: 0, referral: 0, other: 0 };
    for (const r of ch.data.rows || []) {
      const name = String(r.dimensionValues[0].value || '').toLowerCase();
      const n = num(r.metricValues[0].value);
      if (name === 'organic search') c.organic += n;
      else if (name === 'direct') c.direct += n;
      else if (name === 'referral') c.referral += n;
      else c.other += n;
    }
    out.channels = c;
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
