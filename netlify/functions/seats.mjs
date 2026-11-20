// GET /.netlify/functions/seats — which seats are sold or being paid for right now.
import { json, fail } from '../lib/http.mjs';
import { rpc } from '../lib/supabase.mjs';
export default async () => {
  try { return json({ taken: await rpc('wv_taken_seats') }); }
  catch (e) { return fail('DB', e.message, e.status || 500); }
};
