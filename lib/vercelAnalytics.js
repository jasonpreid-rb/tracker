// Reads Vercel Web Analytics for one project over a date range.
// Needs VERCEL_TOKEN (and VERCEL_TEAM_ID if the projects belong to a team) in the Tracker's env vars.
const BASE = 'https://api.vercel.com/v1/query/web-analytics/visits';

async function call(kind, projectId, since, until, extra = {}) {
  const p = new URLSearchParams({ projectId, since, until, ...extra });
  if (process.env.VERCEL_TEAM_ID) p.set('teamId', process.env.VERCEL_TEAM_ID);
  const r = await fetch(`${BASE}/${kind}?${p}`, {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
  });
  if (!r.ok) throw new Error(`Vercel returned ${r.status}`);
  const j = await r.json();
  return j.data;
}

// since / until are 'YYYY-MM-DD' strings, the same range the dashboard already uses.
export async function getVercelStats(projectId, since, until) {
  const [total, pages, refs] = await Promise.all([
    call('count', projectId, since, until),
    call('aggregate', projectId, since, until, { by: 'requestPath', limit: '5' }),
    call('aggregate', projectId, since, until, { by: 'referrerHostname', limit: '5' }),
  ]);
  return {
    visitors: total.visitors,
    pageViews: total.pageviews,
    topPages: (pages || []).map((r) => ({ path: r.requestPath, views: r.pageviews })),
    referrers: (refs || []).map((r) => ({ host: r.referrerHostname || 'Direct', visitors: r.visitors })),
  };
}
