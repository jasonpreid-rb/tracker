// Reads Vercel Web Analytics for one project over a date range.
// Needs VERCEL_TOKEN (and VERCEL_TEAM_ID if the projects belong to a team) in the Tracker's env vars.
const BASE = 'https://api.vercel.com/v1/query/web-analytics/visits';

async function call(kind, projectId, since, until, extra = {}) {
  const p = new URLSearchParams({ projectId, since, until, ...extra });
  // VERCEL_TEAM_ID can be the team's ID (team_...) or its URL name (for example ripping-bombs-project)
  const team = (process.env.VERCEL_TEAM_ID || '').trim();
  if (team) p.set(team.startsWith('team_') ? 'teamId' : 'slug', team);
  const r = await fetch(`${BASE}/${kind}?${p}`, {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const why = (j.error && j.error.message) || '';
    throw new Error(`${kind} ${r.status}${why ? ': ' + why : ''}`);
  }
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
