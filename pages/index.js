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

function Chart({ sites }) {
  const W = 900, H = 210, n = sites[0].series.length;
  const max = Math.max(1, ...sites.flatMap((s) => s.series.map((p) => p.impressions)));
  const pts = (s) => s.series.map((p, i) => `${(i / (n - 1)) * W},${H - 10 - (p.impressions / max) * (H - 30)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 210, marginTop: 12 }} role="img" aria-label="Impressions per day for each site">
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

const fmt = (n) => (n == null ? '–' : n.toLocaleString('en'));

// Small lines under each site's meter score
function vitalityLabel(v) {
  if (!v) return 'No score yet';
  const move = v.change == null ? '' : ` (${v.change > 0 ? '+' : v.change < 0 ? '−' : '±'}${Math.abs(v.change)}${v.prevDate ? ` since ${v.prevDate}` : ' vs last month'})`;
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
  return notes;
}

// Rows for the "Real use" card, built from the GA4 data for one site
function useRows(g) {
  const rows = [['Users', fmt(g.users)], ['Sessions', fmt(g.sessions)], ['Page views', fmt(g.pageViews)]];
  for (const [name, v] of Object.entries(g.events || {})) {
    rows.push([name.replace(/_/g, ' '), `${fmt(v.count)} times, ${fmt(v.users)} users`]);
  }
  if (g.path) rows.push([`Visits to ${g.path.prefix}`, `${fmt(g.path.views)} views, ${fmt(g.path.users)} users`]);
  return rows;
}

export default function Dashboard() {
  const [key, setKey] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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

  const sum = (f) => data.sites.reduce((a, s) => a + s.series.reduce((b, p) => b + p[f], 0), 0);

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
          <div className="lbl">{data ? `Last 28 days, ${data.range.startDate} to ${data.range.endDate}` : 'Ripping Bombs, eazie and TrueTravelCost in one view'}</div>
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
          <div className="grid4 cards">
            <div className="card"><div className="lbl">Total impressions</div><div className="big">{fmt(sum('impressions'))}</div><div className="lbl">Search Console, all 3 sites</div></div>
            <div className="card"><div className="lbl">Total clicks</div><div className="big">{fmt(sum('clicks'))}</div><div className="lbl">Search Console, all 3 sites</div></div>
            <div className="card"><div className="lbl">Backlinks added</div><div className="big">{fmt(data.backlinks.count)}</div><div className="lbl">Last 28 days, Backlinks tab</div></div>
            <div className="card"><div className="lbl">Experiments running</div><div className="big">{fmt(data.experiments.running)}</div><div className="lbl">No decision yet, Experiments tab</div></div>
          </div>
          {data.sheetError && <div className="bad">Google Sheet problem: {data.sheetError}</div>}

          <div className="card">
            <div className="between">
              <h2>Impressions per day, by site</h2>
              <div className="legend">
                {data.sites.map((s) => (
                  <span key={s.key}><i style={{ borderTop: `3px ${DASH[s.key] ? (s.key === 'ttc' ? 'dotted' : 'dashed') : 'solid'} ${s.color}` }} />{s.name}</span>
                ))}
              </div>
            </div>
            <Chart sites={data.sites} />
            {sum('impressions') === 0 && <div className="lbl">No impressions in this window yet, so every line sits at zero.</div>}
          </div>

          <div className="card meters">
            <div>
              <h2>Is each site worth pursuing?</h2>
              <div className="lbl">One marker per site, scored monthly (five answers, 0 to 20 each). Visibility is calculated from the impressions trend once there is enough data.</div>
            </div>
            {data.sites.map((s) => (
              <div className="mrow" key={s.key}>
                <div className="mname">
                  <span className="dot" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />
                  <div>
                    <div>{s.name}</div>
                    <div className="lbl">{vitalityLabel(s.vitality)}</div>
                    {vitalityNotes(s.vitality, data.baselineDays).map((t) => <div className="lbl" key={t}>{t}</div>)}
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
            ))}
            <div className="zones"><span>Pause</span><span>Keep testing</span><span>Double down</span></div>
            {data.sites.some((s) => s.vitality && s.vitality.baseline) && (
              <div className="lbl">A dashed marker means a baseline site, under {Math.round((data.baselineDays || 90) / 30)} months old. Read its movement rather than its zone.</div>
            )}
          </div>

          <div className="grid3">
            {data.sites.map((s) => (
              <div className="card" key={s.key}>
                <h2 className="sitehead"><span className="dot" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />{s.name}: top queries</h2>
                <div className="row th"><span>Query</span><span>Impressions</span></div>
                {s.queries.length === 0 && !s.error && <div className="row">No queries yet</div>}
                {s.queries.map((q) => <div className="row" key={q.query}><span>{q.query}</span><span>{fmt(q.impressions)}</span></div>)}
                {s.error && <div className="bad">Search Console: {s.error}</div>}
              </div>
            ))}
          </div>

          <div className="grid3">
            {data.sites.map((s) => (
              <div className="card" key={s.key}>
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
            ))}
          </div>

          <div className="card">
            <h2>Latest backlinks</h2>
            <div className="row th"><span>Source</span><span>Site</span></div>
            {data.backlinks.latest.length === 0 && <div className="row">None logged yet</div>}
            {data.backlinks.latest.map((l, i) => <div className="row" key={i}><span>{l.url}</span><span>{l.site}</span></div>)}
          </div>
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
        .gate{max-width:420px;display:flex;flex-direction:column;gap:12px}
        .gate input{background:#0B0D14;color:#F2F4FA;border:1px solid #2A3250;border-radius:8px;padding:10px 12px;font:inherit}
        .btn{background:linear-gradient(90deg,#FF2BA6,#FF7A3D);color:#0B0D14;font:inherit;font-weight:600;border:0;border-radius:999px;padding:10px 18px;cursor:pointer}
        .btn:disabled{opacity:.6;cursor:default}
        .btn:focus-visible,.gate input:focus-visible{outline:2px solid #2EE6C5;outline-offset:2px}
        .bad{color:#FF8FA3;font-size:13px}
        @media (max-width:700px){.page{padding:20px 16px 40px}.mrow{flex-wrap:wrap;row-gap:6px}.mname{width:100%}.zones{padding:0 40px 0 36px;font-size:11px;gap:6px}}
        @media (prefers-reduced-motion:reduce){.mark{transition:none}}
      `}</style>
    </div>
  );
}
