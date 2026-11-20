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
  // The count is the part that matters, so a failure there is a real error
  const total = await call('count', projectId, since, until);
  const out = { visitors: total.visitors, pageViews: total.pageviews, topPages: [], referrers: [], blocks: null };

  // Visitors in four 14-day blocks, oldest first, ending on `until`. Blocks 2 and 3 are the current 28 days,
  // blocks 0 and 1 the 28 days before, so the meter can compare traffic over time (momentum).
  const day = 864e5;
  const end = new Date(until + 'T00:00:00Z');
  const blockRange = (k) => {
    const to = new Date(end.getTime() - (3 - k) * 14 * day);
    const from = new Date(to.getTime() - 13 * day);
    return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)];
  };
  const blocks = await Promise.allSettled([0, 1, 2, 3].map((k) => call('count', projectId, ...blockRange(k)).then((d) => d.visitors)));
  if (blocks.every((b) => b.status === 'fulfilled')) out.blocks = blocks.map((b) => b.value);

  // Visitors in the last 24 hours (Vercel has no true "right now" figure, so this is the freshest number available)
  out.last24h = null;
  try {
    const nowMs = Date.now();
    const d = await call('count', projectId, String(nowMs - day), String(nowMs));
    out.last24h = d.visitors;
  } catch (e) {
    out.last24h = null;
  }

  // Top pages and referrers are a bonus: if Vercel refuses them, keep the counts and say so
  const [pages, refs] = await Promise.allSettled([
    call('aggregate', projectId, since, until, { by: 'requestPath', limit: '5' }),
    call('aggregate', projectId, since, until, { by: 'referrerHostname', limit: '5' }),
  ]);
  if (pages.status === 'fulfilled') out.topPages = (pages.value || []).map((r) => ({ path: r.requestPath, views: r.pageviews }));
  if (refs.status === 'fulfilled') out.referrers = (refs.value || []).map((r) => ({ host: r.referrerHostname || 'Direct', visitors: r.visitors }));
  const failed = [pages, refs].find((r) => r.status === 'rejected');
  if (failed) out.note = `Top pages and referrers unavailable (${failed.reason.message})`;
  return out;
}
