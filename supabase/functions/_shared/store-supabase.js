// server-core storage interface on top of Supabase tables (service-role client).
export function createSupabaseStore(sb, { clock = () => Date.now() } = {}) {
  const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
  const P = 'arena_profiles', S = 'arena_strongholds', R = 'arena_raids', SE = 'arena_seasons';
  const rows = q => (must(q) || []).map(r => r.data);
  async function pagedProfiles(filter = q => q) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const page = rows(await filter(sb.from(P).select('data')).order('rating', { ascending: false }).range(from, from + 999));
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }
  return {
    now: clock,
    newId: () => crypto.randomUUID(),
    async getProfile(id) {
      const row = must(await sb.from(P).select('data, updated_at').eq('id', id).maybeSingle());
      if (!row) return null;
      Object.defineProperty(row.data, '_v', { value: row.updated_at, enumerable: false }); // read version for putProfileIf
      return row.data;
    },
    /** Optimistic write: only if the row is unchanged since getProfile (two parallel requests cannot both win). */
    async putProfileIf(p) {
      const got = must(await sb.from(P).update({ name: p.name, rating: p.rating, is_bot: !!p.isBot, data: p, updated_at: new Date(Math.max(clock(), Date.parse(p._v || 0) + 1)).toISOString() })
        .eq('id', p.id).eq('updated_at', p._v).select('id'));
      return (got || []).length === 1;
    },
    async putProfile(p) { must(await sb.from(P).upsert({ id: p.id, name: p.name, rating: p.rating, is_bot: !!p.isBot, data: p, updated_at: new Date(clock()).toISOString() })); },
    allProfiles: () => pagedProfiles(),
    bots: () => pagedProfiles(q => q.eq('is_bot', true)),
    async nearby(rating, limit) {
      const up = rows(await sb.from(P).select('data').gte('rating', rating).order('rating', { ascending: true }).limit(limit));
      const down = rows(await sb.from(P).select('data').lt('rating', rating).order('rating', { ascending: false }).limit(limit));
      return [...up, ...down].sort((a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating)).slice(0, limit);
    },
    async top(limit) { return rows(await sb.from(P).select('data').order('rating', { ascending: false }).limit(limit)); },
    async rankOf(rating) { const r = await sb.from(P).select('id', { count: 'exact', head: true }).gt('rating', rating); must(r); return r.count || 0; },
    async getStronghold(owner) { return must(await sb.from(S).select('data').eq('owner', owner).maybeSingle())?.data ?? null; },
    async putStronghold(s) { must(await sb.from(S).upsert({ owner: s.owner, version: s.version, data: s, updated_at: new Date(clock()).toISOString() })); },
    async getRaid(id) { return must(await sb.from(R).select('data').eq('id', id).maybeSingle())?.data ?? null; },
    async putRaid(r) { must(await sb.from(R).upsert({ id: r.id, attacker: r.attacker, defender: r.defender, status: r.status, created_at: r.createdAt, finished_at: r.finishedAt ?? null, data: r })); },
    /** Atomically move a raid from open to settling: only one request can settle it. */
    async claimRaid(id) { return (must(await sb.from(R).update({ status: 'settling' }).eq('id', id).eq('status', 'open').select('id')) || []).length === 1; },
    async releaseRaid(id) { must(await sb.from(R).update({ status: 'open' }).eq('id', id).eq('status', 'settling')); },
    async openRaidOf(attacker) { return rows(await sb.from(R).select('data').eq('attacker', attacker).eq('status', 'open').limit(1))[0] ?? null; },
    async raidsAgainst(defender, limit) { return rows(await sb.from(R).select('data').eq('defender', defender).eq('status', 'done').order('finished_at', { ascending: false }).limit(limit)); },
    async recentTargets(attacker, since) { return (must(await sb.from(R).select('defender').eq('attacker', attacker).gte('created_at', since)) || []).map(r => r.defender); },
    async getSeason() { return rows(await sb.from(SE).select('data').order('id', { ascending: false }).limit(1))[0] ?? null; },
    async putSeason(s) { must(await sb.from(SE).upsert({ id: s.id, data: s })); },
  };
}
