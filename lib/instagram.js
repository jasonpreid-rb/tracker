// lib/instagram.js
// Instagram insights for the traffic dashboard, via the Instagram API with Instagram Login.
// Instagram is not a website, so Search Console cannot track it (it has no way to verify ownership of an Instagram profile).
// Needs one environment variable: IG_ACCESS_TOKEN, a long-lived Instagram User access token for a Business or Creator account.
// Long-lived tokens expire after 60 days unless refreshed, so a dashboard error here usually means the token needs renewing.

const API = 'https://graph.instagram.com/v23.0';
const DAY = 864e5;

// What counts as full marks, per 28 days. Square-root scales, so small numbers earn little until volume builds.
const TARGET = { reach: 2000, follows: 50, linkTaps: 30, posts: 12 };
const GOOD = { engagement: 0.05 }; // interactions per account reached
const BASELINE_DAYS = 90;
const PARTS = ['Reach', 'Follower growth', 'Engagement', 'Link taps', 'Posting'];

const num = (v) => Number(v) || 0;
const clamp = (n) => Math.min(20, Math.max(0, Number(n) || 0));
const lg = (n, full) => Math.min(1, Math.sqrt(Math.max(0, n) / full));
const sumOf = (a, f) => a.reduce((t, p) => t + num(p[f]), 0);
const fmtN = (n) => Math.round(num(n)).toLocaleString('en');
const iso = (d) => d.toISOString().slice(0, 10);
const startOf = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);
const endOf = (d) => Math.floor(Date.parse(`${d}T23:59:59Z`) / 1000);

async function api(path, params = {}) {
  if (!process.env.IG_ACCESS_TOKEN) throw new Error('IG_ACCESS_TOKEN is not set in this deployment');
  const url = new URL(`${API}/${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  url.searchParams.set('access_token', process.env.IG_ACCESS_TOKEN);
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    // Keep Meta's code, subcode and trace id in the message: they say whether it is the token (190), a permission (10/200), the app (200 blocked) or a metric (100)
    const er = j.error || {};
    const tags = [
      er.code != null && `code ${er.code}`,
      er.error_subcode != null && `subcode ${er.error_subcode}`,
      er.type,
      er.fbtrace_id && `trace ${er.fbtrace_id}`,
    ].filter(Boolean);
    throw new Error(`${er.message || `Instagram API ${r.status}`}${tags.length ? ` (${tags.join(', ')})` : ''}`);
  }
  return j;
}

// A single total for a window. Returns null if Instagram has no data for it (it sends an empty set, not 0).
async function total(metric, w) {
  const j = await api('me/insights', { metric, metric_type: 'total_value', period: 'day', since: startOf(w.startDate), until: endOf(w.endDate) });
  const m = (j.data || [])[0];
  return m && m.total_value ? num(m.total_value.value) : null;
}

// One value per day. end_time marks the end of the day measured, so the date is a day earlier.
async function daily(metric, w) {
  const j = await api('me/insights', { metric, metric_type: 'time_series', period: 'day', since: startOf(w.startDate), until: endOf(w.endDate) });
  const m = (j.data || [])[0];
  if (!m) return null;
  return (m.values || []).map((v) => ({ date: iso(new Date(Date.parse(v.end_time) - DAY)), value: num(v.value) }));
}

// Posts in the window, with reach for the best few
async function postData(w) {
  const j = await api('me/media', { fields: 'id,caption,permalink,timestamp,like_count,comments_count', limit: 50 });
  const from = startOf(w.startDate) * 1000;
  const inWindow = (j.data || []).filter((m) => Date.parse(m.timestamp) >= from);
  const weeks = new Set(inWindow.map((m) => Math.min(3, Math.floor((Date.parse(m.timestamp) - from) / (7 * DAY)))));
  const withReach = await Promise.all(
    inWindow.slice(0, 12).map(async (m) => {
      try {
        const r = await api(`${m.id}/insights`, { metric: 'reach' });
        const d = (r.data || [])[0];
        return { ...m, reach: d && d.values && d.values[0] ? num(d.values[0].value) : null };
      } catch (e) {
        return { ...m, reach: null };
      }
    })
  );
  const top = withReach
    .sort((a, b) => num(b.reach) - num(a.reach))
    .slice(0, 5)
    .map((m) => ({ id: m.id, caption: m.caption || '', permalink: m.permalink, reach: m.reach, likes: m.like_count != null ? m.like_count : null }));
  return { count: inWindow.length, weeks: weeks.size, top };
}

const settle = (p) => p.then((v) => v, () => null);

function stats(series, so) {
  const half = Math.floor(series.length / 2);
  return {
    days: series.length,
    half,
    early: sumOf(series.slice(0, half), 'reach'),
    late: sumOf(series.slice(half), 'reach'),
    active: series.filter((p) => num(p.reach) > 0).length,
    reach: so.reach != null ? so.reach : sumOf(series, 'reach'),
    followers: so.followers,
    growth: so.followersChange,
    interactions: so.interactions,
    linkTaps: so.linkTaps,
    posts: so.posts28 || 0,
    weeks: so.weeks || 0,
  };
}

function autoParts(st) {
  const mom = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.log2((st.late + 5) / (st.early + 5))));
  return [
    // Reach: accounts reached in 28 days, plus whether the latest half is growing (flat earns half of the 8 trend points)
    12 * lg(st.reach, TARGET.reach) + 8 * mom * Math.min(1, (st.early + st.late) / 200),
    // Follower growth: net new followers. Instagram only reports this for accounts with 100+ followers, so below that, size scores instead (max 8)
    st.growth != null ? 20 * lg(Math.max(0, st.growth), TARGET.follows) : 8 * lg(st.followers, 100),
    // Engagement: interactions per account reached, weighted by how many were reached
    st.interactions != null && st.reach > 0 ? 20 * Math.min(1, st.interactions / st.reach / GOOD.engagement) * Math.min(1, st.reach / 200) : 0,
    // Link taps: people who tapped the profile link, which is how Instagram sends traffic to the sites
    20 * lg(st.linkTaps, TARGET.linkTaps),
    // Posting: how many posts, and how many of the 4 weeks had one
    10 * Math.min(1, st.posts / TARGET.posts) + 10 * Math.min(1, st.weeks / 4),
  ].map((n) => Math.round(clamp(n)));
}

function partNotes(st) {
  const cur = st.days - st.half;
  return [
    `${fmtN(st.reach)} accounts reached in 28 days (full marks at ${fmtN(TARGET.reach)}), ${fmtN(st.late)} in the latest ${cur} days against ${fmtN(st.early)} in the ${st.half} before`,
    st.growth != null
      ? `${st.growth > 0 ? '+' : st.growth < 0 ? '−' : '±'}${fmtN(Math.abs(st.growth))} net followers in 28 days (full marks at +${TARGET.follows})`
      : `${fmtN(st.followers)} followers. Growth is only reported from 100 followers, so size scores instead, up to 8`,
    st.interactions == null || st.reach === 0
      ? 'No engagement data yet'
      : `${((st.interactions / st.reach) * 100).toFixed(1)}% of accounts reached interacted (full marks at ${GOOD.engagement * 100}%, counts in full from 200 reached)`,
    `${fmtN(st.linkTaps)} taps on the profile link (full marks at ${fmtN(TARGET.linkTaps)})`,
    `${fmtN(st.posts)} posts in 28 days, ${st.weeks} of 4 weeks with a post (full marks at ${TARGET.posts} posts)`,
  ];
}

function confidence(st) {
  let level = 'high';
  const reasons = [];
  if (st.reach < 100) { level = 'low'; reasons.push('Under 100 accounts reached in 28 days, so the score moves on noise'); }
  else if (st.reach < 500) { level = 'medium'; reasons.push('Small numbers, read the score as a rough guide'); }
  if (st.growth == null) { if (level === 'high') level = 'medium'; reasons.push('No follower growth figure yet'); }
  return { level, note: reasons.length ? reasons.join('. ') : 'Enough data to read the score' };
}

// range and prior are { startDate, endDate, days } as built in metrics.js. Never throws: errors come back on the site as socialError.
export async function buildInstagramSite(range, prior, hist = {}) {
  const meta = { key: 'ig', name: 'Instagram', short: 'IG', color: '#C77DFF', type: 'social' };
  const zero = range.days.map((date) => ({ date, reach: 0 }));
  try {
    const me = await api('me', { fields: 'username,followers_count,media_count' });
    const [reachDaily, followDaily, reach, views, viewsPrev, profileViews, interactions, accountsEngaged, linkTaps, posts] = await Promise.all([
      settle(daily('reach', range)),
      settle(daily('follower_count', range)),
      settle(total('reach', range)),
      settle(total('views', range)),
      settle(total('views', prior)),
      settle(total('profile_views', range)),
      settle(total('total_interactions', range)),
      settle(total('accounts_engaged', range)),
      settle(total('profile_links_taps', range)),
      settle(postData(range)),
    ]);

    const byDate = new Map((reachDaily || []).map((p) => [p.date, p.value]));
    const series = range.days.map((date) => ({ date, reach: byDate.get(date) || 0 }));
    const social = {
      followers: me.followers_count != null ? me.followers_count : null,
      followersChange: followDaily ? followDaily.reduce((t, p) => t + p.value, 0) : null,
      mediaCount: me.media_count != null ? me.media_count : null,
      reach, views, viewsPrev, profileViews, interactions, accountsEngaged, linkTaps,
      posts28: posts ? posts.count : null,
      weeks: posts ? posts.weeks : 0,
      topPosts: posts ? posts.top : [],
    };

    const st = stats(series, social);
    const nums = autoParts(st);
    const notes = partNotes(st);
    const launched = hist.launched && hist.launched.ig ? new Date(hist.launched.ig) : null;
    const ageDays = launched && !isNaN(launched) ? Math.max(0, Math.floor((Date.now() - launched.getTime()) / DAY)) : null;

    return {
      ...meta,
      handle: me.username ? `@${me.username}` : null,
      series,
      social,
      vitality: {
        score: nums.reduce((a, n) => a + n, 0),
        change: null,
        baseline: ageDays != null && ageDays < BASELINE_DAYS,
        ageDays,
        auto: true,
        parts: PARTS.map((label, k) => ({ label, score: nums[k], max: 20, note: notes[k] })),
        confidence: confidence(st),
        trend: null,
      },
    };
  } catch (e) {
    return { ...meta, series: zero, social: null, socialError: String(e.message).slice(0, 320), vitality: null };
  }
}
