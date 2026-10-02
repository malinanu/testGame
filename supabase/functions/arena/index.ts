// Wildwood Arena game server. One endpoint, POST { action, ...payload }, called by
// supabase.functions.invoke('arena') with the player's (anonymous) session JWT.
// All rules live in the shared, framework-free modules copied into ../_shared by scripts/sync-shared.mjs.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createCore } from '../_shared/arena/src/server-core.js';
import { createSupabaseStore } from '../_shared/store-supabase.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// New-style projects expose a secret key; legacy projects the service-role JWT. Either bypasses RLS.
const serverKey = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, serverKey, { auth: { persistSession: false } });
const core = createCore(createSupabaseStore(admin));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return json({ error: 'Not signed in.' }, 401);
  let body: { action?: string } & Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const { action, ...payload } = body;
  try {
    return json(await core.handle(data.user.id, String(action), payload));
  } catch (e) {
    console.error(e);
    return json({ error: 'Server error' }, 500);
  }
});
