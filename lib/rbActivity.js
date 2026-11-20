// Reads Ripping Bombs activity (drives submitted, new players) from Supabase through one read-only function, tracker_stats().
// Needs RB_SUPABASE_URL and RB_SUPABASE_ANON_KEY (the same public values the Ripping Bombs site uses).
export async function getRbActivity() {
  const r = await fetch(`${process.env.RB_SUPABASE_URL}/rest/v1/rpc/tracker_stats`, {
    method: 'POST',
    headers: { apikey: process.env.RB_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.RB_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Supabase ${r.status}${j.message ? ': ' + j.message : ''}`);
  return j; // { drives: [b0,b1,b2,b3], players: [b0,b1,b2,b3] }, 14-day blocks, oldest first
}
