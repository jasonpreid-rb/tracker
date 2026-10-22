import Head from 'next/head';
import { useCallback, useEffect, useState } from 'react';

const DASH = { rb: undefined, ez: '10 6', ttc: '2 6', ig: '14 5 2 5' };

const Coffin = ({ w = 24 }) => (
  <svg viewBox="0 0 60 84" style={{ width: w, height: w * 1.4, flex: 'none' }} role="img" aria-label="Coffin, the dead end of the scale">
    <polygon points="30,4 52,26 44,80 16,80 8,26" fill="#1F2640" stroke="#FF5C7A" strokeWidth="4" strokeLinejoin="round" />
  </svg>
);

const Sprout = ({ w = 28 }) => (
  <svg viewBox="0 0 72 84" style={{ width: w, height: w * 1.17, flex: 'none' }} role="img" aria-label="Sprout, the alive end of the scale">
    <ellipse cx="36" cy="78" rx="24" ry="6" fill="#5B3A1E" />
    <path d="M36 76 C36 62 36 52 36 36" fill="none" stroke="#2EE6C5" strokeWidth="4" strokeLinecap="round" />
    <path d="M36 54 C18 54 8 44 8 28 C26 28 36 38 36 54 Z" fill="#1FBFA3" />
    <path d="M36 42 C36 22 48 8 68 8 C68 28 54 42 36 42 Z" fill="#2EE6C5" />
  </svg>
);

// Main chart. metric is 'impressions' or 'clicks'.
function Chart({ sites, metric = 'impressions' }) {
  const W = 900, H = 210;
  const n = Math.max(2, sites[0] ? sites[0].series.length : 2);
  const max = Math.max(1, ...sites.flatMap((s) => s.series.map((p) => p[metric] || 0)));
  const pts = (s) => s.series.map((p, i) => `${(i / (n - 1)) * W},${H - 10 - ((p[metric] || 0) / max) * (H - 30)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 210, marginTop: 12 }} role="img" aria-label={`${metric} per day for each site shown`}>
      <defs>
        <filter id="glow" x="-5%" y="-30%" width="110%" height="160%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g stroke="#2A3250">{[20, 80, 140, 200].map((y) => <line key={y} x1="0" y1={y} x2={W} y2={y} />)}</g>
      {sites.map((s) => (
        <polyline key={s.key} points={pts(s)} fill="none" stroke={s.color} strokeWidth="4" strokeDasharray={DASH[s.key]} strokeLinecap="round" filter="url(#glow)" />
      ))}
    </svg>
  );
}

// Small trend line for the per-site progress cards
function Spark({ series, color, dash, field = 'impressions' }) {
  const W = 300, H = 56, n = Math.max(2, series.length);
  const max = Math.max(1, ...series.map((p) => p[field] || 0));
  const pts = series.map((p, i) => `${(i / (n - 1)) * W},${H - 4 - ((p[field] || 0) / max) * (H - 10)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 56, marginTop: 8 }} role="img" aria-label={`${field} per day, last 28 days`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="3" strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

const fmt = (n) => (n == null ? '–' : n.toLocaleString('en'));

const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const matchesSite = (l, s) => {
  const x = norm(l.site);
  if (!x) return false;
  return [s.key, s.name, s.short].some((v) => {
    const y = norm(v);
    return y && (y === x || (y.length > 2 && x.includes(y)));
  });
};

// Small lines under each site's meter score
function vitalityLabel(v) {
  if (!v) return 'No score yet';
  const move = v.change == null ? '' : ` (${v.change > 0 ? '+' : v.change < 0 ? '−' : '±'}${Math.abs(v.change)} vs previous 28 days)`;
  return `${v.score} / 100${move}`;
}
function vitalityNotes(v, baselineDays = 90) {
  if (!v) return [];
  const notes = [];
  if (v.baseline) notes.push(`Baseline, month ${Math.floor(v.ageDays / 30) + 1} of ${Math.round(baselineDays / 30)}`);
  if (v.trend) {
    if (v.trend.enough && v.trend.pct != null) notes.push(`Impressions ${v.trend.pct > 0 ? '+' : v.trend.pct < 0 ? '−' : ''}${Math.abs(v.trend.pct)}% vs previous 28 days`);
    else notes.push('Too little data for a trend yet');
  }
  if (v.confidence && v.confidence.level !== 'high') notes.push(`Confidence ${v.confidence.level}: ${v.confidence.note}`);
  return notes;
}

// Rows for the "Real use" card, built from the GA4 data for one site
function useRows(g) {
  const rows = [['Users', fmt(g.users)], ['Sessions', fmt(g.sessions)], ['Page views', fmt(g.pageViews)]];
  for (const [name, v] of Object.entries(g.events || {})) {
    rows.push([name.replace(/_/g, ' '), `${fmt(v.count)} times, ${fmt(v.users)} users`]);
  }
  if (g.path) rows.push([`Visits to ${g.path.prefix}`, `${fmt(g.path.views)} views, ${fmt(g.path.users)} users`]);
  if (g.newUsers != null && g.users > 0) {
    const back = Math.max(0, g.users - g.newUsers);
    rows.push(['Returning users', `${fmt(back)} (${Math.round((back / g.users) * 100)}%)`]);
    rows.push(['Engagement rate', `${Math.round((g.engagementRate || 0) * 100)}%`]);
    rows.push(['Time engaged per user', `${fmt(Math.round((g.engagedSeconds || 0) / g.users))} seconds`]);
  }
  if (g.channels) rows.push(['Sessions from', `search ${fmt(g.channels.organic)}, direct ${fmt(g.channels.direct)}, links ${fmt(g.channels.referral)}`]);
  return rows;
}

// Change between two windows, as text
function change(prev, cur) {
  if (prev === 0 && cur === 0) return 'flat at 0';
  if (prev === 0) return 'up from 0';
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)}% vs earlier half`;
}

// Progress for one site, from its daily series: second half of the window against the first half
function progress(s) {
  const ser = s.series || [];
  const half = Math.floor(ser.length / 2);
  const prev = ser.slice(0, half);
  const cur = ser.slice(half);
  const tot = (a, f) => a.reduce((x, p) => x + (p[f] || 0), 0);
  const imp = tot(cur, 'impressions'), impPrev = tot(prev, 'impressions');
  const clk = tot(cur, 'clicks'), clkPrev = tot(prev, 'clicks');
  const allImp = tot(ser, 'impressions'), allClk = tot(ser, 'clicks');
  return {
    days: cur.length,
    imp, impPrev, clk, clkPrev,
    ctr: allImp > 0 ? ((allClk / allImp) * 100).toFixed(1) : null,
    active: ser.filter((p) => (p.impressions || 0) > 0).length,
    total: ser.length,
  };
}

// Social accounts (Instagram) have no Search Console data. The API marks them with type: 'social'.
const isSocial = (s) => s.type === 'social';
const LABEL = { impressions: 'Impressions', clicks: 'Clicks', reach: 'Reach', views: 'Views' };
const signed = (n) => (n == null ? '' : n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(Math.abs(n))}` : '±0');
const pct1 = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '–');

// Second half of the window against the first half, for one field of a daily series
function halves(series, f) {
  const ser = series || [];
  const half = Math.floor(ser.length / 2);
  const tot = (a) => a.reduce((x, p) => x + (p[f] || 0), 0);
  return { cur: tot(ser.slice(half)), prev: tot(ser.slice(0, half)), all: tot(ser), days: ser.length - half, before: half };
}

export default function Dashboard() {
  const [key, setKey] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('all'); // 'all' or a site key
  const [metric, setMetric] = useState('impressions');

  const load = useCallback(async (k) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/metrics', { headers: { 'x-dashboard-key': k } });
      const j = await r.json();
      if (!r.ok) throw new Error(r.status === 401 ? 'That key is not right. Check DASHBOARD_KEY and try again.' : j.error);
      localStorage.setItem('dk', k);
      setData(j);
    } catch (e) {
      localStorage.removeItem('dk'); setData(null); setErr(e.message);
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    const k = localStorage.getItem('dk');
    if (k) { setKey(k); load(k); }
  }, [load]);

  // Sites currently shown. Falls back to all if the chosen key is not in the data.
  const picked = data && view !== 'all' ? data.sites.filter((s) => s.key === view) : [];
  const shown = data ? (picked.length ? picked : data.sites) : [];
  const single = shown.length === 1 ? shown[0] : null;
  const social = !!single && isSocial(single);
  const chartSites = social ? [single] : shown.filter((s) => !isSocial(s));
  const hasSocial = shown.some(isSocial);
  const scope = single ? single.name : hasSocial ? `the ${chartSites.length} websites` : `all ${chartSites.length} sites`;
  const chartMetrics = social ? ['reach'] : ['impressions', 'clicks'];
  const metricNow = chartMetrics.includes(metric) ? metric : chartMetrics[0];

  const sum = (f) => chartSites.reduce((a, s) => a + (s.series || []).reduce((b, p) => b + (p[f] || 0), 0), 0);

  const backlinks = data
    ? single
      ? data.backlinks.latest.filter((l) => matchesSite(l, single))
      : data.backlinks.latest
    : [];

  const searchProgressCard = (s) => {
    const p = progress(s);
    return (
      <div className="card" key={`p-${s.key}`}>
        <h2 className="sitehead"><span className="dot" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />{s.name}: progress</h2>
        <div className="lbl" style={{ marginTop: 6 }}>Last {p.days} days against the {p.total - p.days} before</div>
        <div className="row th"><span>Measure</span><span>Now</span></div>
        <div className="row"><span>Impressions</span><span>{fmt(p.imp)} ({change(p.impPrev, p.imp)})</span></div>
        <div className="row"><span>Clicks</span><span>{fmt(p.clk)} ({change(p.clkPrev, p.clk)})</span></div>
        <div className="row"><span>Click rate, 28 days</span><span>{p.ctr == null ? '–' : `${p.ctr}%`}</span></div>
        <div className="row"><span>Days with impressions</span><span>{p.active} of {p.total}</span></div>
        {s.search && s.search.position != null && <div className="row"><span>Average position</span><span>{s.search.position}</span></div>}
        {s.search && <div className="row"><span>Different queries</span><span>{fmt(s.search.queryCount)}{s.search.striking ? `, ${fmt(s.search.striking)} near page one` : ''}</span></div>}
        <div className="row"><span>Meter score</span><span>{vitalityLabel(s.vitality)}</span></div>
        <Spark series={s.series} color={s.color} dash={DASH[s.key]} />
      </div>
    );
  };

  const searchQueriesCard = (s) => (
    <div className="card" key={`q-${s.key}`}>
      <h2 className="sitehead"><span className="dot" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />{s.name}: top queries</h2>
      <div className="row th"><span>Query</span><span>Impressions</span></div>
      {s.queries.length === 0 && !s.error && <div className="row">No queries yet</div>}
      {s.queries.map((q) => <div className="row" key={q.query}><span>{q.query}</span><span>{fmt(q.impressions)}{q.position != null ? `, pos ${q.position}` : ''}</span></div>)}
      {s.error && <div className="bad">Search Console: {s.error}</div>}
    </div>
  );

  const searchUseCard = (s) => (
    <div className="card" key={`u-${s.key}`}>
      <h2 className="sitehead"><span className="dot" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />{s.name}: real use</h2>
      <div className="lbl" style={{ marginTop: 6 }}>Google Analytics, same 28 days</div>
      {s.ga4 && (
        <>
          <div className="row th"><span>Measure</span><span>Last 28 days</span></div>
          {useRows(s.ga4).map(([label, value]) => <div className="row" key={label}><span>{label}</span><span>{value}</span></div>)}
        </>
      )}
      {!s.ga4 && !s.ga4Error && <div className="row">Not connected yet</div>}
      {s.ga4Error && <div className="bad">Google Analytics: {s.ga4Error}</div>}
      {s.key === 'rb' && <div className="lbl">Registrations and submissions are in Supabase, not shown here.</div>}
    </div>
  );

  const socialProgressCard = (s) => {
    const so = s.social || {};
    const r = halves(s.series, 'reach');
    const active = (s.series || []).filter((p) => (p.reach || 0) > 0).length;
    return (
      <div className="card" key={`p-${s.key}`}>
        <h2 className="sitehead"><span className="dot" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />{s.name}: progress</h2>
        <div className="lbl" style={{ marginTop: 6 }}>Last {r.days} days against the {r.before} before{s.handle ? `, ${s.handle}` : ''}</div>
        <div className="row th"><span>Measure</span><span>Now</span></div>
        <div className="row"><span>Followers</span><span>{fmt(so.followers)}{so.followersChange != null ? ` (${signed(so.followersChange)} in 28 days)` : ''}</span></div>
        <div className="row"><span>Reach</span><span>{fmt(r.cur)} ({change(r.prev, r.cur)})</span></div>
        <div className="row"><span>Views</span><span>{fmt(so.views)}{so.views != null && so.viewsPrev != null ? ` (${change(so.viewsPrev, so.views).replace('vs earlier half', 'vs previous 28 days')})` : ''}</span></div>
        <div className="row"><span>Engagement rate, 28 days</span><span>{so.interactions == null ? '–' : pct1(so.interactions, so.reach != null ? so.reach : r.all)}</span></div>
        <div className="row"><span>Days with reach</span><span>{active} of {(s.series || []).length}</span></div>
        <div className="row"><span>Meter score</span><span>{vitalityLabel(s.vitality)}</span></div>
        <Spark series={s.series || []} color={s.color} dash={DASH[s.key]} field="reach" />
      </div>
    );
  };

  const socialPostsCard = (s) => {
    const posts = (s.social && s.social.topPosts) || [];
    return (
      <div className="card" key={`q-${s.key}`}>
        <h2 className="sitehead"><span className="dot" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />{s.name}: top posts</h2>
        <div className="row th"><span>Post</span><span>Reach</span></div>
        {posts.length === 0 && !s.socialError && <div className="row">No posts in this window yet</div>}
        {posts.map((p, i) => {
          const text = String(p.caption || 'Untitled post').replace(/\s+/g, ' ').slice(0, 48);
          const ok = typeof p.permalink === 'string' && p.permalink.startsWith('https://');
          return (
            <div className="row" key={p.id || i}>
              <span>{ok ? <a href={p.permalink} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{text}</a> : text}</span>
              <span>{fmt(p.reach)}{p.likes != null ? `, ${fmt(p.likes)} likes` : ''}</span>
            </div>
          );
        })}
        {s.socialError && <div className="bad">Instagram: {s.socialError}</div>}
      </div>
    );
  };

  const socialUseCard = (s) => {
    const so = s.social;
    const rows = so ? [
      ['Profile views', so.profileViews],
      ['Taps on the profile link', so.linkTaps],
      ['Accounts engaged', so.accountsEngaged],
      ['Posts published', so.posts28],
    ].filter(([, v]) => v != null) : [];
    return (
      <div className="card" key={`u-${s.key}`}>
        <h2 className="sitehead"><span className="dot" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />{s.name}: real use</h2>
        <div className="lbl" style={{ marginTop: 6 }}>Instagram insights, same 28 days</div>
        {rows.length > 0 && (
          <>
            <div className="row th"><span>Measure</span><span>Last 28 days</span></div>
            {rows.map(([label, value]) => <div className="row" key={label}><span>{label}</span><span>{fmt(value)}</span></div>)}
          </>
        )}
        {!so && !s.socialError && <div className="row">Not connected yet</div>}
        {s.socialError && <div className="bad">Instagram: {s.socialError}</div>}
      </div>
    );
  };

  const progressCard = (s) => (isSocial(s) ? socialProgressCard(s) : searchProgressCard(s));
  const queriesCard = (s) => (isSocial(s) ? socialPostsCard(s) : searchQueriesCard(s));
  const useCard = (s) => (isSocial(s) ? socialUseCard(s) : searchUseCard(s));

  return (
    <div className="page">
      <Head>
        <title>Traffic overview</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div className="head">
        <div>
          <h1>Traffic overview</h1>
          <div className="lbl">{data ? `Last 28 days, ${data.range.startDate} to ${data.range.endDate}` : 'Ripping Bombs, eazie, TrueTravelCost and Instagram in one view'}</div>
        </div>
        {data && <button className="btn" onClick={() => load(key)} disabled={busy}>{busy ? 'Refreshing' : 'Refresh data'}</button>}
      </div>

      {!data && (
        <div className="card gate">
          <h2>Enter your dashboard key</h2>
          <input type="password" value={key} placeholder="Dashboard key" aria-label="Dashboard key" onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(key)} />
          <button className="btn" onClick={() => load(key)} disabled={busy || !key}>{busy ? 'Loading' : 'Open dashboard'}</button>
          {err && <div className="bad">{err}</div>}
        </div>
      )}

      {data && (
        <>
          <div className="tabs" role="group" aria-label="Choose which site to show">
            <button className={`tab${!single ? ' on' : ''}`} aria-pressed={!single} onClick={() => setView('all')}>All sites</button>
            {data.sites.map((s) => {
              const on = !!single && single.key === s.key;
              return (
                <button key={s.key} className={`tab${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setView(s.key)} style={on ? { borderColor: s.color, boxShadow: `0 0 12px ${s.color}55` } : undefined}>
                  <span className="dot" style={{ background: s.color }} />{s.name}
                </button>
              );
            })}
          </div>

          <div className="grid4 cards">
            {social ? (
              <>
                <div className="card"><div className="lbl">Followers</div><div className="big">{fmt(single.social && single.social.followers)}</div><div className="lbl">{single.social && single.social.followersChange != null ? `${signed(single.social.followersChange)} in 28 days` : 'Instagram, now'}</div></div>
                <div className="card"><div className="lbl">Total reach</div><div className="big">{fmt(single.social && single.social.reach != null ? single.social.reach : sum('reach'))}</div><div className="lbl">Instagram, last 28 days</div></div>
                <div className="card"><div className="lbl">Profile link taps</div><div className="big">{fmt(single.social && single.social.linkTaps)}</div><div className="lbl">Instagram, last 28 days</div></div>
                <div className="card"><div className="lbl">Posts published</div><div className="big">{fmt(single.social && single.social.posts28)}</div><div className="lbl">Instagram, last 28 days</div></div>
              </>
            ) : (
              <>
                <div className="card"><div className="lbl">Total impressions</div><div className="big">{fmt(sum('impressions'))}</div><div className="lbl">Search Console, {scope}</div></div>
                <div className="card"><div className="lbl">Total clicks</div><div className="big">{fmt(sum('clicks'))}</div><div className="lbl">Search Console, {scope}</div></div>
                <div className="card">
                  <div className="lbl">Backlinks added</div>
                  <div className="big">{fmt(single ? backlinks.length : data.backlinks.count)}</div>
                  <div className="lbl">{single ? 'In the latest list, this site' : 'Last 28 days, Backlinks tab'}</div>
                </div>
                <div className="card"><div className="lbl">Experiments running</div><div className="big">{fmt(data.experiments.running)}</div><div className="lbl">{single ? 'All sites, not split by site' : 'No decision yet, Experiments tab'}</div></div>
              </>
            )}
          </div>
          {data.sheetError && <div className="bad">Google Sheet problem: {data.sheetError}</div>}

          <div className="card">
            <div className="between">
              <h2>{LABEL[metricNow]} per day{single ? `, ${single.name}` : ', by site'}</h2>
              <div className="between" style={{ gap: 18 }}>
                <div className="legend">
                  {chartSites.map((s) => (
                    <span key={s.key}><i style={{ borderTop: `3px ${DASH[s.key] ? (s.key === 'ttc' ? 'dotted' : 'dashed') : 'solid'} ${s.color}` }} />{s.name}</span>
                  ))}
                </div>
                <div className="seg" role="group" aria-label="Chart measure" style={chartMetrics.length < 2 ? { display: 'none' } : undefined}>
                  {chartMetrics.map((m) => (
                    <button key={m} className={metricNow === m ? 'on' : ''} aria-pressed={metricNow === m} onClick={() => setMetric(m)}>{LABEL[m]}</button>
                  ))}
                </div>
              </div>
            </div>
            <Chart sites={chartSites} metric={metricNow} />
            {sum(metricNow) === 0 && <div className="lbl">No {metricNow} in this window yet, so every line sits at zero.</div>}
          </div>

          <div className="card meters">
            <div>
              <h2>Is {single ? single.name : 'each site'} worth pursuing?</h2>
              <div className="lbl">{single ? (social ? 'Five measures, 0 to 20 each, built automatically from Instagram insights.' : 'Five measures, 0 to 20 each, built automatically from Search Console and Google Analytics.') : 'One marker per site, built automatically from Search Console, Google Analytics and Instagram insights. Five measures, 0 to 20 each, nothing typed in by hand.'}</div>
            </div>
            {shown.map((s) => (
              <div key={s.key}>
                <div className="mrow">
                  <div className="mname">
                    <span className="dot" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />
                    <div>
                      <div>{s.name}</div>
                      <div className="lbl">{vitalityLabel(s.vitality)}</div>
                      {vitalityNotes(s.vitality, data.baselineDays).map((t) => <div className="lbl" key={t}>{t}</div>)}
                      {!single && s.vitality && s.vitality.parts && <div className="lbl">{s.vitality.parts.map((p) => `${p.label} ${p.score}`).join(' · ')}</div>}
                    </div>
                  </div>
                  <Coffin />
                  <div className="track">
                    <div className="bar" />
                    {s.vitality && (
                      <div className="mark" style={{ left: `${s.vitality.score}%`, borderColor: s.color, borderStyle: s.vitality.baseline ? 'dashed' : 'solid', opacity: s.vitality.baseline ? 0.75 : 1, boxShadow: `0 0 14px ${s.color}` }}>{s.short}</div>
                    )}
                  </div>
                  <Sprout />
                </div>
                {single && s.vitality && s.vitality.parts && (
                  <div className="parts">
                    {s.vitality.parts.map((p) => (
                      <div className="part" key={p.label}>
                        <div className="between"><span>{p.label}</span><span>{p.score} / {p.max || 20}</span></div>
                        <div className="ptrack"><div className="pfill" style={{ width: `${Math.max(0, Math.min(100, (p.score / (p.max || 20)) * 100))}%`, background: s.color }} /></div>
                        {p.note && <div className="lbl">{p.note}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="zones"><span>Pause</span><span>Keep testing</span><span>Double down</span></div>
            {shown.some((s) => s.vitality && s.vitality.baseline) && (
              <div className="lbl">A dashed marker means a baseline site, under {Math.round((data.baselineDays || 90) / 30)} months old. Read its movement rather than its zone.</div>
            )}
          </div>

          {single ? (
            <div className="grid3">
              {progressCard(single)}
              {queriesCard(single)}
              {useCard(single)}
            </div>
          ) : (
            <>
              <div className="grid3">{shown.map(progressCard)}</div>
              <div className="grid3">{shown.map(queriesCard)}</div>
              <div className="grid3">{shown.map(useCard)}</div>
            </>
          )}

          {!social && <div className="card">
            <h2>Latest backlinks{single ? `, ${single.name}` : ''}</h2>
            <div className="row th"><span>Source</span><span>Site</span></div>
            {backlinks.length === 0 && <div className="row">{single ? 'None logged yet for this site' : 'None logged yet'}</div>}
            {backlinks.map((l, i) => <div className="row" key={i}><span>{l.url}</span><span>{l.site}</span></div>)}
          </div>}
        </>
      )}

      <style jsx global>{`
        body{margin:0;background:#0B0D14}
        .page{font-family:'IBM Plex Sans',sans-serif;color:#F2F4FA;min-height:100vh;box-sizing:border-box;padding:28px 36px 48px;display:flex;flex-direction:column;gap:20px;background:radial-gradient(900px 420px at 12% -5%,rgba(255,43,166,.22),transparent 60%),radial-gradient(800px 400px at 95% 0%,rgba(46,230,197,.16),transparent 60%),#0B0D14}
        h1{margin:0;font-size:38px;font-weight:600;letter-spacing:-.5px;background:linear-gradient(90deg,#FF2BA6,#FFB020);-webkit-background-clip:text;background-clip:text;color:transparent;display:inline-block}
        h2{margin:0;font-size:16px;font-weight:600}
        .head,.between{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .card{background:linear-gradient(160deg,#171C2E,#101424);border:1px solid #2A3250;box-shadow:0 12px 30px rgba(0,0,0,.35);border-radius:12px;padding:18px}
        .grid4{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
        .grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
        .lbl{font-size:13px;color:#A3ACC2}
        .big{font-size:42px;font-weight:600;margin:6px 0;display:inline-block;-webkit-background-clip:text;background-clip:text;color:transparent}
        .cards .card:nth-child(1) .big{background-image:linear-gradient(90deg,#FF2BA6,#FF7A3D)}
        .cards .card:nth-child(2) .big{background-image:linear-gradient(90deg,#2EE6C5,#6C8CFF)}
        .cards .card:nth-child(3) .big{background-image:linear-gradient(90deg,#FFB020,#FF5C7A)}
        .cards .card:nth-child(4) .big{background-image:linear-gradient(90deg,#6C8CFF,#C77DFF)}
        .legend{display:flex;gap:18px;font-size:13px;flex-wrap:wrap}
        .legend span{display:flex;align-items:center;gap:6px}
        .legend i{display:inline-block;width:22px;height:0}
        .row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;font-size:13px;color:#A3ACC2;word-break:break-all}
        .th{border-bottom:1px solid #2A3250;font-size:12px;padding:12px 0 8px}
        .dot{width:10px;height:10px;border-radius:50%;flex:none;display:inline-block}
        .sitehead{display:flex;align-items:center;gap:8px}
        .meters{display:flex;flex-direction:column;gap:16px;padding:22px}
        .mrow{display:flex;align-items:center;gap:12px}
        .mname{width:190px;flex:none;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
        .track{flex:1;min-width:0;position:relative;height:36px}
        .bar{position:absolute;left:0;right:0;top:14px;height:8px;border-radius:4px;background:linear-gradient(90deg,#FF5C7A,#FFB020 50%,#2EE6C5)}
        .mark{position:absolute;top:3px;width:30px;height:30px;margin-left:-15px;border-radius:50%;background:#0B0D14;border:3px solid;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;box-sizing:border-box;transition:left .6s}
        .zones{display:flex;justify-content:space-between;font-size:12px;color:#A3ACC2;padding:0 40px 0 244px}
        .parts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px 20px;margin:14px 0 0 202px;padding-right:40px}
        .part{font-size:13px;color:#F2F4FA;display:flex;flex-direction:column;gap:6px}
        .part .between{gap:8px;flex-wrap:nowrap}
        .part .between span:last-child{color:#A3ACC2}
        .ptrack{height:6px;border-radius:3px;background:#2A3250;overflow:hidden}
        .pfill{height:100%;border-radius:3px}
        .tabs{display:flex;gap:10px;flex-wrap:wrap}
        .tab{display:flex;align-items:center;gap:8px;background:#101424;color:#A3ACC2;font:inherit;font-size:14px;font-weight:500;border:1px solid #2A3250;border-radius:999px;padding:8px 16px;cursor:pointer}
        .tab.on{color:#F2F4FA;background:#171C2E;border-color:#6C8CFF}
        .tab:hover{color:#F2F4FA}
        .seg{display:flex;border:1px solid #2A3250;border-radius:999px;overflow:hidden}
        .seg button{background:transparent;color:#A3ACC2;font:inherit;font-size:12px;border:0;padding:6px 14px;cursor:pointer}
        .seg button.on{background:#2A3250;color:#F2F4FA}
        .gate{max-width:420px;display:flex;flex-direction:column;gap:12px}
        .gate input{background:#0B0D14;color:#F2F4FA;border:1px solid #2A3250;border-radius:8px;padding:10px 12px;font:inherit}
        .btn{background:linear-gradient(90deg,#FF2BA6,#FF7A3D);color:#0B0D14;font:inherit;font-weight:600;border:0;border-radius:999px;padding:10px 18px;cursor:pointer}
        .btn:disabled{opacity:.6;cursor:default}
        .btn:focus-visible,.gate input:focus-visible,.tab:focus-visible,.seg button:focus-visible{outline:2px solid #2EE6C5;outline-offset:2px}
        .bad{color:#FF8FA3;font-size:13px}
        @media (max-width:700px){.page{padding:20px 16px 40px}.mrow{flex-wrap:wrap;row-gap:6px}.mname{width:100%}.zones{padding:0 40px 0 36px;font-size:11px;gap:6px}.parts{margin:14px 0 0 0;padding-right:0}}
        @media (prefers-reduced-motion:reduce){.mark{transition:none}}
      `}</style>
    </div>
  );
}
