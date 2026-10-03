// In-memory store implementing the server-core storage interface. With `persist` it backs the
// browser's offline "local cloud" (localStorage); without it, it is used by the Node tests.
export function createMemoryStore({ persist = null, clock = () => Date.now() } = {}) {
  const db = persist?.load() || { profiles: {}, strongholds: {}, raids: {}, season: null };
  const save = () => persist?.save(db);
  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const profiles = () => Object.values(db.profiles);
  return {
    db,
    now: clock,
    newId: () => (globalThis.crypto?.randomUUID?.() || `id-${Math.random().toString(36).slice(2)}-${Date.now()}`),
    async getProfile(id) { return clone(db.profiles[id]); },
    async putProfile(p) { db.profiles[p.id] = { ...clone(p), _ver: (db.profiles[p.id]?._ver || 0) + 1 }; save(); },
    async allProfiles() { return clone(profiles()); },
    async bots() { return clone(profiles().filter(p => p.isBot)); },
    async nearby(rating, limit) { return clone(profiles().sort((a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating)).slice(0, limit)); },
    async top(limit) { return clone(profiles().sort((a, b) => b.rating - a.rating).slice(0, limit)); },
    async rankOf(rating) { return profiles().filter(p => p.rating > rating).length; },
    async getStronghold(owner) { return clone(db.strongholds[owner]); },
    async putStronghold(s) { db.strongholds[s.owner] = clone(s); save(); },
    async getRaid(id) { return clone(db.raids[id]); },
    async putRaid(r) { db.raids[r.id] = clone(r); save(); },
    /** Atomically take an open raid for settling: false if another request already did. */
    async claimRaid(id) { const r = db.raids[id]; if (!r || r.status !== 'open') return false; r.status = 'settling'; save(); return true; },
    async releaseRaid(id) { const r = db.raids[id]; if (r?.status === 'settling') { r.status = 'open'; save(); } },
    /** Write a profile only if nobody wrote it since it was read (requests interleave at every await). */
    async putProfileIf(p) {
      const cur = db.profiles[p.id];
      if (cur && (cur._ver || 0) !== (p._ver || 0)) return false;
      db.profiles[p.id] = { ...clone(p), _ver: (cur?._ver || 0) + 1 }; save(); return true;
    },
    async openRaidOf(attacker) { return clone(Object.values(db.raids).find(r => r.attacker === attacker && r.status === 'open')); },
    async raidsAgainst(defender, limit) { return clone(Object.values(db.raids).filter(r => r.defender === defender && r.status === 'done').sort((a, b) => b.finishedAt - a.finishedAt).slice(0, limit)); },
    async recentTargets(attacker, since) { return Object.values(db.raids).filter(r => r.attacker === attacker && r.createdAt >= since).map(r => r.defender); },
    async getSeason() { return clone(db.season); },
    async putSeason(s) { db.season = clone(s); save(); },
  };
}
