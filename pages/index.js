import Head from 'next/head';
import { useCallback, useEffect, useState } from 'react';

const DASH = { rb: undefined, ez: '10 6', ttc: '2 6' };

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
function Spark({ series, color, dash }) {
  const W = 300, H = 56, n = Math.max(2, series.length);
  const max = Math.max(1, ...series.map((p) => p.impressions || 0));
  const pts = series.map((p, i) => `${(i / (n - 1)) * W},${H - 4 - ((p.impressions || 0) / max) * (H - 10)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 56, marginTop: 8 }} role="img" aria-label="Impressions per day, last 28 days">
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

const LABEL = { impressions: 'Impressions', clicks: 'Clicks' };

// Rows for the Vercel Web Analytics section of the "Real use" card.
// Vercel counts visitors on every page load, so it is a useful cross-check on Google Analytics.
function vercelRows(v, ga) {
  const rows = [['Visitors', fmt(v.visitors)], ['Page views', fmt(v.pageViews)]];
  if (v.visitors > 0) rows.push(['Pages per visitor', (v.pageViews / v.visitors).toFixed(1)]);
  if (ga && ga.users != null && v.visitors > 0) rows.push(['Google Analytics counts', `${Math.round((ga.users / v.visitors) * 100)}% as many people`]);
  return rows;
}

// Counts a number up from 0 when it first shows or changes. Skipped for reduced motion and for non-numbers.
function Num({ v }) {
  const [n, setN] = useState(typeof v === 'number' ? 0 : v);
  useEffect(() => {
    if (typeof v !== 'number' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(v); return undefined; }
    let raf;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      setN(v * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  return <>{fmt(typeof n === 'number' ? Math.round(n) : n)}</>;
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
      setData({ ...j, sites: (j.sites || []).filter((s) => s.type !== 'social' && s.key !== 'ig') });
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
  const chartSites = shown;
  const scope = single ? single.name : `all ${chartSites.length} sites`;
  const chartMetrics = ['impressions', 'clicks'];
  const metricNow = chartMetrics.includes(metric) ? metric : chartMetrics[0];

  const sum = (f) => chartSites.reduce((a, s) => a + (s.series || []).reduce((b, p) => b + (p[f] || 0), 0), 0);
  const vercelSites = chartSites.filter((s) => s.vercel);
  const vercelVisitors = vercelSites.length ? vercelSites.reduce((a, s) => a + (s.vercel.visitors || 0), 0) : null;

  const backlinks = data
    ? single
      ? data.backlinks.latest.filter((l) => matchesSite(l, single))
      : data.backlinks.latest
    : [];

  const progressCard = (s) => {
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

  const queriesCard = (s) => (
    <div className="card" key={`q-${s.key}`}>
      <h2 className="sitehead"><span className="dot" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />{s.name}: top queries</h2>
      <div className="row th"><span>Query</span><span>Impressions</span></div>
      {s.queries.length === 0 && !s.error && <div className="row">No queries yet</div>}
      {s.queries.map((q) => <div className="row" key={q.query}><span>{q.query}</span><span>{fmt(q.impressions)}{q.position != null ? `, pos ${q.position}` : ''}</span></div>)}
      {s.error && <div className="bad">Search Console: {s.error}</div>}
    </div>
  );

  const useCard = (s) => (
    <div className="card" key={`u-${s.key}`}>
      <h2 className="sitehead"><span className="dot" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />{s.name}: real use</h2>
      <div className="lbl" style={{ marginTop: 6 }}>Google Analytics and Vercel, same 28 days</div>
      {s.ga4 && (
        <>
          <div className="row th"><span>Measure</span><span>Last 28 days</span></div>
          {useRows(s.ga4).map(([label, value]) => <div className="row" key={label}><span>{label}</span><span>{value}</span></div>)}
        </>
      )}
      {!s.ga4 && !s.ga4Error && <div className="row">Not connected yet</div>}
      {s.ga4Error && <div className="bad">Google Analytics: {s.ga4Error}</div>}
      {s.vercel && (
        <>
          <div className="row th"><span>Vercel Web Analytics</span><span>Last 28 days</span></div>
          {vercelRows(s.vercel, s.ga4).map(([label, value]) => <div className="row" key={label}><span>{label}</span><span>{value}</span></div>)}
          {(s.vercel.topPages || []).length > 0 && <div className="row th"><span>Top pages</span><span>Views</span></div>}
          {(s.vercel.topPages || []).map((p) => <div className="row" key={`pg-${p.path}`}><span>{p.path}</span><span>{fmt(p.views)}</span></div>)}
          {(s.vercel.referrers || []).length > 0 && <div className="row th"><span>Top referrers</span><span>Visitors</span></div>}
          {(s.vercel.referrers || []).map((r) => <div className="row" key={`rf-${r.host}`}><span>{r.host}</span><span>{fmt(r.visitors)}</span></div>)}
          {s.vercel.note && <div className="row"><span>{s.vercel.note}</span></div>}
        </>
      )}
      {s.activity && (
        <>
          <div className="row th"><span>Ripping Bombs activity</span><span>Last 28 days</span></div>
          <div className="row"><span>Drives submitted</span><span>{fmt(s.activity.drives)}</span></div>
          <div className="row"><span>New players</span><span>{fmt(s.activity.players)}</span></div>
        </>
      )}
      {s.activityError && <div className="bad">Activity: {s.activityError}</div>}
      {!s.vercel && !s.vercelError && <div className="row">Vercel Web Analytics: not connected yet</div>}
      {s.vercelError && <div className="bad">Vercel: {s.vercelError}</div>}
      {s.key === 'rb' && <div className="lbl">Registrations and submissions are in Supabase, not shown here.</div>}
    </div>
  );

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
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <div className="head">
        <div>
          <h1>Traffic overview</h1>
          <div className="lbl">{data ? `Last 28 days, ${data.range.startDate} to ${data.range.endDate}` : 'Ripping Bombs, eazie and TrueTravelCost in one view'}</div>
        </div>
        {data && (
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
        )}
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
          <div className="grid4 cards">
            <>
                <div className="card"><div className="lbl">Total impressions</div><div className="big"><Num v={sum('impressions')} /></div><div className="lbl">Search Console, {scope}</div></div>
                <div className="card"><div className="lbl">Total clicks</div><div className="big"><Num v={sum('clicks')} /></div><div className="lbl">Search Console, {scope}</div></div>
                <div className="card">
                  <div className="lbl">Backlinks added</div>
                  <div className="big"><Num v={single ? backlinks.length : data.backlinks.count} /></div>
                  <div className="lbl">{single ? 'In the latest list, this site' : 'Last 28 days, Backlinks tab'}</div>
                </div>
                <div className="card"><div className="lbl">Experiments running</div><div className="big"><Num v={data.experiments.running} /></div><div className="lbl">{single ? 'All sites, not split by site' : 'No decision yet, Experiments tab'}</div></div>
                <div className="card"><div className="lbl">Visitors</div><div className="big"><Num v={vercelVisitors} /></div><div className="lbl">Vercel Web Analytics, {scope}</div></div>
              </>
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
              <div className="lbl">{single ? 'Five measures, 0 to 20 each, built automatically from Search Console and Google Analytics.' : 'One marker per site, built automatically from Search Console and Google Analytics. Five measures, 0 to 20 each, nothing typed in by hand.'}</div>
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

          <div className="card">
            <h2>Latest backlinks{single ? `, ${single.name}` : ''}</h2>
            <div className="row th"><span>Source</span><span>Site</span></div>
            {backlinks.length === 0 && <div className="row">{single ? 'None logged yet for this site' : 'None logged yet'}</div>}
            {backlinks.map((l, i) => <div className="row" key={i}><span>{l.url}</span><span>{l.site}</span></div>)}
          </div>
        </>
      )}

      <style jsx global>{`
        body{margin:0;background:radial-gradient(900px 420px at 8% -8%,rgba(255,43,166,.2),transparent 60%),radial-gradient(800px 420px at 98% -4%,rgba(46,230,197,.14),transparent 60%),#0B0D14 fixed}
        .page{font-family:'Manrope',sans-serif;color:#F2F4FA;min-height:100vh;box-sizing:border-box;max-width:1480px;margin:0 auto;padding:14px 20px 40px;display:flex;flex-direction:column;gap:12px;font-variant-numeric:tabular-nums}
        h1{margin:0;font-size:22px;font-weight:700;letter-spacing:-.3px;background:linear-gradient(90deg,#FF2BA6,#FFB020);-webkit-background-clip:text;background-clip:text;color:transparent;display:inline-block}
        h2{margin:0;font-size:15px;font-weight:600}
        .head{position:sticky;top:8px;z-index:5;display:flex;align-items:center;gap:10px 24px;flex-wrap:wrap;padding:10px 16px;border-radius:16px;background:rgba(16,20,36,.72);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.08)}
        .head .tabs{margin-left:auto}
        .between{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
        .card{background:rgba(23,28,46,.62);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:14px 16px}
        .grid4{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
        .grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;align-items:start}
        .lbl{font-size:12px;color:#9AA4BE}
        .big{font-size:30px;font-weight:700;letter-spacing:-.5px;margin:2px 0;display:inline-block;-webkit-background-clip:text;background-clip:text;color:transparent}
        .cards .card{padding:12px 14px}
        .cards .card:nth-child(1) .big{background-image:linear-gradient(90deg,#FF2BA6,#FF7A3D)}
        .cards .card:nth-child(2) .big{background-image:linear-gradient(90deg,#2EE6C5,#6C8CFF)}
        .cards .card:nth-child(3) .big{background-image:linear-gradient(90deg,#FFB020,#FF5C7A)}
        .cards .card:nth-child(4) .big{background-image:linear-gradient(90deg,#6C8CFF,#C77DFF)}
        .cards .card:nth-child(5) .big{background-image:linear-gradient(90deg,#2EE6C5,#FFB020)}
        .legend{display:flex;gap:16px;font-size:12px;flex-wrap:wrap}
        .legend span{display:flex;align-items:center;gap:6px}
        .legend i{display:inline-block;width:22px;height:0}
        .row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:12.5px;color:#9AA4BE;word-break:break-all}
        .th{border-bottom:1px solid rgba(255,255,255,.08);font-size:11.5px;padding:10px 0 6px}
        .dot{width:9px;height:9px;border-radius:50%;flex:none;display:inline-block}
        .sitehead{display:flex;align-items:center;gap:8px}
        .meters{display:flex;flex-direction:column;gap:10px;padding:16px 18px}
        .mrow{display:flex;align-items:center;gap:12px}
        .mname{width:170px;flex:none;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
        .track{flex:1;min-width:0;position:relative;height:32px}
        .bar{position:absolute;left:0;right:0;top:12px;height:8px;border-radius:4px;background:linear-gradient(90deg,#FF5C7A,#FFB020 50%,#2EE6C5)}
        .mark{position:absolute;top:1px;width:30px;height:30px;margin-left:-15px;border-radius:50%;background:#0B0D14;border:3px solid;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;box-sizing:border-box;transition:left .9s cubic-bezier(.2,.8,.2,1)}
        .zones{display:flex;justify-content:space-between;font-size:11.5px;color:#9AA4BE;padding:0 40px 0 194px}
        .parts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 18px;margin:10px 0 0 182px;padding-right:40px}
        .part{font-size:12.5px;color:#F2F4FA;display:flex;flex-direction:column;gap:5px}
        .part .between{gap:8px;flex-wrap:nowrap}
        .part .between span:last-child{color:#9AA4BE}
        .ptrack{height:6px;border-radius:3px;background:rgba(255,255,255,.09);overflow:hidden}
        .pfill{height:100%;border-radius:3px;transform-origin:left;animation:grow 1s cubic-bezier(.2,.8,.2,1) both}
        @keyframes grow{from{transform:scaleX(0)}}
        .tabs{display:flex;gap:8px;flex-wrap:wrap}
        .tab{display:flex;align-items:center;gap:8px;background:transparent;color:#9AA4BE;font:inherit;font-size:13px;font-weight:600;border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:6px 14px;cursor:pointer;transition:color .15s,border-color .15s,background .15s}
        .tab.on{color:#F2F4FA;background:rgba(108,140,255,.16);border-color:#6C8CFF}
        .tab:hover{color:#F2F4FA}
        .seg{display:flex;border:1px solid rgba(255,255,255,.1);border-radius:999px;overflow:hidden}
        .seg button{background:transparent;color:#9AA4BE;font:inherit;font-size:12px;border:0;padding:5px 12px;cursor:pointer}
        .seg button.on{background:rgba(255,255,255,.1);color:#F2F4FA}
        .gate{max-width:420px;display:flex;flex-direction:column;gap:12px}
        .gate input{background:#0B0D14;color:#F2F4FA;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;font:inherit}
        .btn{background:linear-gradient(90deg,#FF2BA6,#FF7A3D);color:#0B0D14;font:inherit;font-size:13px;font-weight:700;border:0;border-radius:999px;padding:8px 16px;cursor:pointer}
        .btn:disabled{opacity:.6;cursor:default}
        .btn:focus-visible,.gate input:focus-visible,.tab:focus-visible,.seg button:focus-visible{outline:2px solid #2EE6C5;outline-offset:2px}
        .bad{color:#FF8FA3;font-size:13px}
        @media (max-width:700px){.page{padding:10px 12px 32px}.head .tabs{margin-left:0}.mrow{flex-wrap:wrap;row-gap:4px}.mname{width:100%}.zones{padding:0 40px 0 36px;font-size:11px;gap:6px}.parts{margin:10px 0 0 0;padding-right:0}}
        @media (prefers-reduced-motion:reduce){.mark{transition:none}.pfill{animation:none}}
      `}</style>
    </div>
  );
}
