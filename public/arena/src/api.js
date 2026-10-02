// Arena backend adapters. Both expose `call(action, payload)` → server-core response.
//  - cloud: Supabase anonymous auth + the `arena` Edge Function (authoritative server)
//  - local: the same server-core running in this browser over localStorage (offline demo / dev)
import { CONFIG } from '../config.js';
import { createCore } from './server-core.js';
import { createMemoryStore } from './store-memory.js';

const LOCAL_DB = 'wildwood-arena-db', LOCAL_UID = 'wildwood-arena-uid';

export async function createApi() {
  const params = new URLSearchParams(location.search);
  if (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && !params.has('offline')) return cloudApi();
  return localApi();
}

async function cloudApi() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
  return {
    mode: 'cloud',
    async call(action, payload = {}) {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        if (action !== 'register') return { profile: null };
        const r = await sb.auth.signInAnonymously(); // the "device token": a session kept in this browser
        if (r.error) return { error: `Sign-in failed: ${r.error.message}. Is anonymous sign-in enabled?` };
      }
      const { data, error } = await sb.functions.invoke('arena', { body: { action, ...payload } });
      if (error) {
        try { const body = await error.context?.json?.(); if (body?.error) return { error: body.error }; } catch {}
        return { error: error.message || 'Network error' };
      }
      return data;
    },
  };
}

function localApi() {
  const persist = {
    load() { try { return JSON.parse(localStorage.getItem(LOCAL_DB)); } catch { return null; } },
    save(db) {
      const raids = Object.values(db.raids).sort((a, b) => b.createdAt - a.createdAt);
      for (const r of raids.slice(150)) delete db.raids[r.id]; // keep the local cloud small
      try { localStorage.setItem(LOCAL_DB, JSON.stringify(db)); } catch {}
    },
  };
  const core = createCore(createMemoryStore({ persist }));
  let uid = null;
  try { uid = localStorage.getItem(LOCAL_UID); } catch {}
  if (!uid) { uid = `local-${crypto.randomUUID()}`; try { localStorage.setItem(LOCAL_UID, uid); } catch {} }
  return { mode: 'local', call: (action, payload = {}) => core.handle(uid, action, structuredClone(payload)) };
}
