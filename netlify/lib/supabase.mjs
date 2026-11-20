// Tiny Supabase client: calls the database functions from supabase/schema.sql.
const env = k => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];

export class DbError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}

export async function rpc(name, args = {}) {
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) throw new DbError('NOT_CONFIGURED', 503);
  const headers = { 'Content-Type': 'application/json', apikey: key };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;   // older "service_role" keys
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new DbError(data?.message || `DB_${res.status}`, res.status >= 500 ? 502 : 400);
  return data;
}
