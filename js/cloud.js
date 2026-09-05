/* Supabase Auth REST + optimistic document sync. Account caches are isolated. */
(() => {
  'use strict';
  const D = FarmData, SESSION = 'incomefarm:session:v2';
  let config, session, cache, key, seen, busy = false, ready = false, generation = 0, conflict = false;
  let status = { text: '이 기기에 저장', kind: 'local' };
  const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const announce = (text, kind = 'local') => {
    status = { text, kind, email: session?.user?.email || '', ready, configured: !!config?.configured };
    window.dispatchEvent(new CustomEvent('farm:cloud-status', { detail: status }));
  };
  const deliver = () => window.dispatchEvent(new CustomEvent('farm:cloud-data', { detail: structuredClone(cache.data) }));
  function persist() {
    localStorage.setItem(key, JSON.stringify(cache));
    seen = structuredClone(cache.data);
  }
  async function request(path, body, auth = true) {
    const response = await fetch(config.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: config.key, 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000), cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error('로그인이 만료됐어요. 다시 로그인해 주세요');
      throw new Error(response.status === 429 ? '요청이 많아요. 잠시 후 다시 시도해 주세요' : '서버에 연결하지 못했어요. 연결과 계정 설정을 확인해 주세요');
    }
    return data;
  }
  async function refresh() {
    if (session.expires_at * 1000 > Date.now() + 60000) return;
    const renewed = await request('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token }, false);
    session = { ...renewed, expires_at: Math.floor(Date.now() / 1000) + renewed.expires_in };
    localStorage.setItem(SESSION, JSON.stringify(session));
  }
  async function sync() {
    if (!session || !config?.configured || busy || conflict) return;
    if (!navigator.onLine) { announce('오프라인 · 연결되면 동기화', 'pending'); return; }
    busy = true;
    const turn = generation;
    announce('동기화 중…', 'pending');
    try {
      const run = async () => {
        const stored = read(SESSION);
        if (stored?.user?.id !== session.user.id) throw new Error('계정이 변경됐어요. 새로고침해 주세요');
        session = stored;
        await refresh();
        for (let attempt = 0; attempt < 4; attempt++) {
          const rows = await request('/rest/v1/farms?select=data,revision&user_id=eq.' + encodeURIComponent(session.user.id));
          if (turn !== generation) return;
          const remote = D.clean(rows[0]?.data || D.blank()), revision = rows[0]?.revision || 0;
          const merged = D.merge(cache.base, cache.data, remote);
          if (merged.conflicts.length) {
            conflict = true; announce('수정 충돌 · 계정 메뉴에서 확인', 'error'); return;
          }
          const changed = !D.equal(cache.data, merged.data);
          cache.data = merged.data; cache.base = remote;
          ready = true; persist(); if (changed) deliver();
          if (D.equal(cache.data, remote)) { announce('클라우드 동기화 완료', 'synced'); return; }
          const sent = structuredClone(cache.data);
          const saved = await request('/rest/v1/rpc/save_farm', { expected_revision: revision, next_data: sent });
          if (turn !== generation) return;
          if (!saved.length) continue;
          cache.base = sent; persist();
          if (D.equal(cache.data, sent)) { announce('클라우드 동기화 완료', 'synced'); return; }
        }
        announce('변경사항 저장 대기 · 자동 재시도', 'pending');
      };
      if (navigator.locks) await navigator.locks.request('income-farm-cloud', run); else await run();
    } catch (error) {
      if (turn === generation) announce(error.message || '연결 대기 · 기록은 이 기기에 보관 중', 'error');
    } finally { busy = false; }
  }
  function activate() {
    generation++; conflict = false;
    key = 'incomefarm:account:' + session.user.id;
    const stored = read(key);
    cache = stored ? { data: D.clean(stored.data), base: D.clean(stored.base) } : { data: D.blank(), base: D.blank() };
    seen = structuredClone(cache.data); ready = !!stored;
    deliver(); announce('계정 기록 불러오는 중…', 'pending');
    sync();
  }
  window.FarmCloud = {
    get status() { return status; },
    get signedIn() { return !!session; },
    get canEdit() { return !session || (ready && !conflict); },
    async init() {
      // A cached public config allows an installed app to reopen offline.
      config = read('incomefarm:cloud-config');
      try {
        const response = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(6000) });
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          config = await response.json(); localStorage.setItem('incomefarm:cloud-config', JSON.stringify(config));
        }
      } catch { /* Keep offline config; never claim sync succeeded. */ }
      session = read(SESSION);
      if (session?.user?.id && config?.configured) activate();
      else { session = null; announce('이 기기에 저장 · 로그인으로 연결'); }
      setInterval(() => { if (!document.hidden) sync(); }, 15000);
    },
    save(data) {
      if (!session) return;
      if (!ready || conflict) throw new Error('계정 메뉴에서 동기화 상태를 확인해 주세요');
      const disk = read(key);
      const merged = D.merge(seen, D.clean(data), disk?.data || seen);
      if (merged.conflicts.length) {
        // Preserve this tab's edits separately instead of overwriting another tab.
        sessionStorage.setItem('incomefarm:conflict-backup', JSON.stringify(data));
        conflict = true; announce('다른 창의 수정과 충돌 · JSON 백업 후 새로고침', 'error');
        throw new Error('다른 창에서 같은 기록을 수정했어요. JSON으로 백업해 주세요');
      }
      cache.data = merged.data; persist();
      announce(navigator.onLine ? '변경사항 저장 대기' : '오프라인 · 연결되면 동기화', 'pending');
      setTimeout(sync, 200);
    },
    async sendCode(email) {
      if (!config?.configured) throw new Error('클라우드 연결 준비 중입니다. 운영자의 서버 설정이 필요해요');
      await request('/auth/v1/otp', { email, create_user: true }, false);
    },
    async verify(email, token) {
      session = await request('/auth/v1/verify', { email, token, type: 'email' }, false);
      session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in;
      localStorage.setItem(SESSION, JSON.stringify(session)); activate();
    },
    async useCloud() {
      if (!session) return;
      await refresh();
      const rows = await request('/rest/v1/farms?select=data&user_id=eq.' + encodeURIComponent(session.user.id));
      const remote = D.clean(rows[0]?.data || D.blank());
      cache = { data: remote, base: remote }; conflict = false; ready = true; persist(); deliver();
      announce('클라우드 기록을 불러왔어요', 'synced');
    },
    async signOut() {
      if (busy) throw new Error('동기화가 끝난 후 다시 시도해 주세요');
      generation++;
      // Local pending edits remain in the account cache for the next login.
      session = null; ready = false; conflict = false; localStorage.removeItem(SESSION);
      announce('이 기기에 저장 · 로그인으로 연결');
      window.dispatchEvent(new Event('farm:signed-out'));
    },
    sync,
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', () => { if (session) announce('오프라인 · 연결되면 동기화', 'pending'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('storage', event => {
    if (event.key === SESSION && session?.user?.id !== read(SESSION)?.user?.id) {
      generation++; ready = false; announce('다른 창에서 계정 변경 · 새로고침해 주세요', 'error');
    }
    if (session && event.key === key && !conflict) {
      const disk = read(key);
      if (!disk) return;
      const merged = D.merge(seen, cache.data, disk.data);
      if (merged.conflicts.length) { conflict = true; announce('다른 창의 수정과 충돌 · 계정 메뉴에서 확인', 'error'); return; }
      cache.data = merged.data; cache.base = disk.base; seen = structuredClone(disk.data); deliver(); sync();
    }
  });
})();
