import { google } from 'googleapis';

export const SITES = [
  { key: 'rb', name: 'Ripping Bombs', short: 'RB', color: '#FF2BA6', gsc: process.env.GSC_RB },
  { key: 'ez', name: 'eazie', short: 'EZ', color: '#2EE6C5', gsc: process.env.GSC_EAZIE },
  { key: 'ttc', name: 'TrueTravelCost', short: 'TTC', color: '#FFB020', gsc: process.env.GSC_TTC },
];

export function getAuth() {
  const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64 || '', 'base64').toString('utf8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
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
