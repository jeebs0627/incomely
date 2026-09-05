/* Shared validation and conflict-safe, three-way cloud merge. */
(function (root) {
  'use strict';
  const categories = ['freelance', 'lecture', 'sales', 'content', 'invest', 'parttime', 'other'];
  const blank = () => ({ entries: [], goal: 0 });
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function clean(raw) {
    if (!raw || !Array.isArray(raw.entries) || raw.entries.length > 20000) throw new Error('올바른 기록 파일이 아니에요');
    const ids = new Set();
    const entries = raw.entries.map(e => {
      if (!e || typeof e.name !== 'string' || !e.name.trim() || !Number.isSafeInteger(e.amount) || e.amount <= 0 || e.amount > 9999999999 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') || !Number.isFinite(Date.parse(e.date)) || new Date(e.date).toISOString().slice(0, 10) !== e.date) throw new Error('활동 이름·금액·날짜를 확인해 주세요');
      const id = typeof e.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(e.id) ? e.id : crypto.randomUUID();
      if (ids.has(id)) throw new Error('중복된 블록 ID가 있어요');
      ids.add(id);
      return { id, name: e.name.trim().slice(0, 40), amount: e.amount, date: e.date,
        memo: String(e.memo || '').slice(0, 60), cat: categories.includes(e.cat) ? e.cat : 'other',
        createdAt: Number.isFinite(e.createdAt) ? e.createdAt : 0,
        paid: e.paid === true, skin: ['soft', 'pixel', 'stripe', 'gem'].includes(e.skin) ? e.skin : 'soft',
        tint: ['lilac', 'mint', 'sky', 'peach', 'lemon', 'rose'].includes(e.tint) ? e.tint : 'category',
        visualVersion: e.visualVersion === 1 ? 1 : 0 };
    });
    const goal = raw.goal ?? 0;
    if (!Number.isSafeInteger(goal) || goal < 0 || goal > 9999999999) throw new Error('목표 금액을 확인해 주세요');
    return { entries: entries.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), goal };
  }
  function merge(base, local, remote) {
    const maps = [base, local, remote].map(d => new Map(d.entries.map(e => [e.id, e])));
    const conflicts = [], entries = [];
    function choose(b, l, r, label) {
      if (equal(l, b)) return r;
      if (equal(r, b) || equal(l, r)) return l;
      conflicts.push(label); return l;
    }
    for (const id of new Set(maps.flatMap(m => [...m.keys()]))) {
      const e = choose(...maps.map(m => m.get(id)), id);
      if (e) entries.push(e);
    }
    const goal = choose(base.goal, local.goal, remote.goal, 'goal');
    return { data: clean({ entries, goal }), conflicts };
  }
  const api = { blank, equal, clean, merge };
  if (typeof module !== 'undefined') module.exports = api;
  else root.FarmData = api;
})(typeof window !== 'undefined' ? window : globalThis);
