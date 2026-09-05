/* ============================================================
   Income Farm — app logic
   ============================================================ */
(() => {
  'use strict';

  const APP_VERSION = '2.1.0';
  const STORAGE_KEY = 'incomefarm:v1';
  const HOLD_MS = 3000;
  const TAP_MS = 320;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---------- constants ----------
  const CATEGORIES = [
    { id: 'freelance', name: '프리랜스', emoji: '💼', color: '#c4b5ed' },
    { id: 'lecture',   name: '강의/코칭', emoji: '🎤', color: '#f3d588' },
    { id: 'sales',     name: '판매',     emoji: '🛍️', color: '#91cce0' },
    { id: 'content',   name: '콘텐츠',   emoji: '🎬', color: '#f0b3bd' },
    { id: 'invest',    name: '투자',     emoji: '📈', color: '#b5d996' },
    { id: 'parttime',  name: '알바',     emoji: '⏰', color: '#99bdeb' },
    { id: 'other',     name: '기타',     emoji: '🌟', color: '#c8d6e5' },
  ];
  const LEVELS = [
    { min: 0,         title: '씨앗',        emoji: '🌰' },
    { min: 100000,    title: '새싹',        emoji: '🌱' },
    { min: 300000,    title: '잎사귀',      emoji: '🍃' },
    { min: 700000,    title: '꽃봉오리',    emoji: '🌷' },
    { min: 1500000,   title: '개화',        emoji: '🌸' },
    { min: 3000000,   title: '열매',        emoji: '🍎' },
    { min: 6000000,   title: '수확',        emoji: '🌾' },
    { min: 12000000,  title: '농장주',      emoji: '🚜' },
    { min: 25000000,  title: '대농',        emoji: '🏡' },
    { min: 50000000,  title: '전설의 농부', emoji: '👑' },
  ];
  const PERIOD_LABEL = { all: '전체', today: '오늘', week: '이번 주', month: '이번 달' };
  const TINTS = { lilac: '#c4b5ed', mint: '#9fdcc4', sky: '#91cce0', peach: '#eebc97', lemon: '#f3d588', rose: '#f0b3bd' };
  const SKINS = ['soft', 'pixel', 'stripe', 'gem'];
  function appearance(entry) {
    if (entry.visualVersion === 1) return { skin: entry.skin, tint: entry.tint };
    // Stable pseudo-random appearance for existing records, identical on every device.
    const hash = salt => {
      let h = 2166136261;
      for (const ch of salt + entry.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
      return h >>> 0;
    };
    return { skin: SKINS[hash('skin') % SKINS.length], tint: Object.keys(TINTS)[hash('tint') % Object.keys(TINTS).length] };
  }

  // ---------- state ----------
  const defaults = () => ({ entries: [], goal: 0, sound: true, period: 'all', goalCelebrated: '', lastCat: 'freelance' });
  let state = load();
  let query = '', categoryFilter = 'all', paidFilter = 'all', sortOrder = 'newest';
  let motionOff = localStorage.getItem('incomefarm:motion') === 'off';
  const reducedMotion = () => motionOff || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Array.isArray(s.entries)) return { ...defaults(), ...s, ...FarmData.clean(s) };
    } catch (_) { /* ignore */ }
    return defaults();
  }
  function save() {
    try {
      if (FarmCloud.signedIn) FarmCloud.save(state);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) { toast(error.message || '저장 공간이 부족해요. JSON으로 기록을 백업해 주세요', { duration: 6000 }); }
  }
  function canEdit() {
    if (FarmCloud.canEdit) return true;
    toast('계정 메뉴에서 동기화 상태를 확인해 주세요'); return false;
  }

  // ---------- helpers ----------
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  const pad = n => String(n).padStart(2, '0');
  const localISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => localISO(new Date());
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const catOf = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
  const sum = list => list.reduce((a, e) => a + e.amount, 0);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) { /* ignore */ } };
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const parseAmount = s => Number(String(s).replace(/[^\d]/g, '')) || 0;
  const shortWon = n => {
    if (n >= 100000000) return (n / 100000000).toFixed(n % 100000000 ? 1 : 0) + '억';
    if (n >= 10000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만';
    return fmt(n);
  };

  function inPeriod(e, period) {
    if (period === 'all') return true;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (period === 'today') return e.date === localISO(now);
    if (period === 'month') return e.date.slice(0, 7) === localISO(now).slice(0, 7);
    if (period === 'week') {
      const start = new Date(now);
      start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
      return e.date >= localISO(start) && e.date <= localISO(now);
    }
    return true;
  }
  const matches = e => inPeriod(e, state.period) && (categoryFilter === 'all' || e.cat === categoryFilter) &&
    (paidFilter === 'all' || (paidFilter === 'paid' ? e.paid : !e.paid)) && (!query || `${e.name} ${e.memo || ''}`.toLocaleLowerCase().includes(query));
  const filtered = () => state.entries.filter(matches).sort((a, b) => sortOrder === 'amount' ? b.amount - a.amount : sortOrder === 'oldest' ? a.date.localeCompare(b.date) || a.createdAt - b.createdAt : b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const monthEntries = () => state.entries.filter(e => inPeriod(e, 'month'));
  const levelIndex = total => { let i = 0; LEVELS.forEach((l, k) => { if (total >= l.min) i = k; }); return i; };
  const blockHeight = () => 76;

  function streak() {
    const days = new Set(state.entries.map(e => e.date));
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (!days.has(localISO(d))) { d.setDate(d.getDate() - 1); if (!days.has(localISO(d))) return 0; }
    let n = 0;
    while (days.has(localISO(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  // ---------- elements ----------
  const el = {
    tower: $('#tower'), towerWrap: $('#tower-wrap'), emptyHint: $('#empty-hint'),
    scoreboard: $('#scoreboard'), scoreValue: $('#score-value'), scoreTotal: $('#score-total'),
    scoreCount: $('#score-count'), streak: $('#streak'), periodLabel: $('#period-label'),
    levelEmoji: $('#level-emoji'), levelTitle: $('#level-title'), levelNum: $('#level-num'),
    goalFill: $('#goal-fill'), goalPct: $('#goal-pct'), goalRemain: $('#goal-remain'), goal: $('.goal'),
    tabs: $('#period-tabs'), tabIndicator: $('.tab-indicator'),
    spark: $('#spark'), insight: $('#insight'), catBreakdown: $('#cat-breakdown'), history: $('#history'),
    fab: $('#fab'), scrim: $('#scrim'),
    sheetAdd: $('#sheet-add'), sheetMenu: $('#sheet-menu'), sheetGoal: $('#sheet-goal'), sheetInstall: $('#sheet-install'),
    form: $('#form-add'), sheetTitle: $('#sheet-title'), inName: $('#in-name'), inAmount: $('#in-amount'),
    inDate: $('#in-date'), inMemo: $('#in-memo'), catPicker: $('#cat-picker'),
    btnDelete: $('#btn-delete'), btnSubmit: $('#btn-submit'), btnCancel: $('#btn-cancel'),
    formGoal: $('#form-goal'), inGoal: $('#in-goal'),
    btnSound: $('#btn-sound'), btnInstall: $('#btn-install'), btnMenu: $('#btn-menu'), btnGoal: $('#btn-goal'),
    installGuide: $('#install-guide'), toast: $('#toast'), fx: $('#fx'),
    levelup: $('#levelup'), levelupEmoji: $('#levelup-emoji'), levelupSub: $('#levelup-sub'),
    fileImport: $('#file-import'), appVersion: $('#app-version'),
  };
  el.appVersion.textContent = 'v' + APP_VERSION;

  // ============================================================
  // Sound (Web Audio, synthesized — no assets)
  // ============================================================
  const sfx = (() => {
    let ctx = null;
    const ac = () => {
      if (!state.sound) return null;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      } catch (_) { return null; }
    };
    const tone = (freq, dur, type = 'sine', vol = .2, slideTo = 0, delay = 0) => {
      const c = ac(); if (!c) return;
      const t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + .01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .02);
    };
    const noise = (dur, vol = .3, freq = 800) => {
      const c = ac(); if (!c) return;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
      const g = c.createGain(); g.gain.value = vol;
      src.connect(f).connect(g).connect(c.destination); src.start();
    };
    return {
      unlock() { ac(); },
      pop() { tone(420, .14, 'triangle', .22, 180); tone(900, .1, 'sine', .12, 0, .07); },
      land() { noise(.08, .18, 500); },
      tick(p) { tone(180 + p * 500, .05, 'square', .04 + p * .05); },
      crash() { noise(.45, .5, 1200); tone(140, .35, 'sawtooth', .18, 35); },
      coin() { tone(1100, .08, 'square', .08, 1500); tone(1650, .12, 'square', .08, 0, .08); },
      fanfare() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, .28, 'triangle', .18, 0, i * .11)); },
      whoosh() { tone(300, .2, 'sine', .08, 900); },
    };
  })();

  // ============================================================
  // FX canvas — particles & confetti
  // ============================================================
  const fx = (() => {
    const cvs = el.fx, ctx = cvs.getContext('2d');
    let parts = [], raf = 0, W = 0, H = 0, DPR = 1;
    const resize = () => {
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth; H = window.innerHeight;
      cvs.width = W * DPR; cvs.height = H * DPR; cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    window.addEventListener('resize', resize); resize();
    const loop = () => {
      ctx.clearRect(0, 0, W, H);
      parts = parts.filter(p => p.life > 0);
      for (const p of parts) {
        p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= p.decay;
        ctx.save(); ctx.globalAlpha = clamp(p.life, 0, 1); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (parts.length) raf = requestAnimationFrame(loop); else { raf = 0; ctx.clearRect(0, 0, W, H); }
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    return {
      burst(x, y, color, n = 26) {
        if (reducedMotion()) return;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 7;
          parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3, g: .35, drag: .96, rot: Math.random() * 6, vr: (Math.random() - .5) * .4,
            size: 4 + Math.random() * 7, color: Math.random() < .25 ? '#fff' : color, life: 1, decay: .018 + Math.random() * .015, shape: Math.random() < .5 ? 'circle' : 'rect' });
        }
        kick();
      },
      sparkle(x, y, color, n = 10) {
        if (reducedMotion()) return;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
          parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, g: .08, drag: .97, rot: 0, vr: 0,
            size: 3 + Math.random() * 3, color: Math.random() < .4 ? '#fff' : color, life: 1, decay: .03, shape: 'circle' });
        }
        kick();
      },
      confetti(n = 120) {
        if (reducedMotion()) return;
        const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#1dd1a1', '#54a0ff', '#a8ff78', '#ffd166'];
        for (let i = 0; i < n; i++) {
          parts.push({ x: Math.random() * W, y: -20 - Math.random() * H * .3, vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 4, g: .06, drag: .995,
            rot: Math.random() * 6, vr: (Math.random() - .5) * .3, size: 7 + Math.random() * 7, color: colors[i % colors.length], life: 1.6, decay: .006 + Math.random() * .004, shape: Math.random() < .3 ? 'circle' : 'rect' });
        }
        kick();
      },
    };
  })();

  // ============================================================
  // Toast
  // ============================================================
  let toastTimer = 0, toastAction = null;
  function toast(msg, opts = {}) {
    clearTimeout(toastTimer);
    el.toast.innerHTML = `<span>${msg}</span>`;
    toastAction = null;
    if (opts.action) {
      const b = document.createElement('button'); b.textContent = opts.action;
      b.onclick = () => { hideToast(); opts.onAction && opts.onAction(); };
      el.toast.appendChild(b);
    }
    el.toast.classList.add('show');
    toastTimer = setTimeout(hideToast, opts.duration || (opts.action ? 6000 : 2600));
  }
  function hideToast() { el.toast.classList.remove('show'); }

  // ============================================================
  // Sheets
  // ============================================================
  let openSheetEl = null, previousFocus = null;
  $$('.sheet').forEach(sheet => { sheet.inert = true; });
  function openSheet(sheet) {
    if (!openSheetEl) previousFocus = document.activeElement;
    if (openSheetEl && openSheetEl !== sheet) { openSheetEl.classList.remove('open'); openSheetEl.inert = true; }
    sheet.inert = false;
    openSheetEl = sheet; sheet.classList.add('open'); el.scrim.classList.add('show'); el.fab.classList.add('hide');
    $('.app').inert = true;
    setTimeout(() => { if (openSheetEl === sheet) sheet.querySelector('input,button,select')?.focus({ preventScroll: true }); }, 50);
    sfx.whoosh();
  }
  function closeSheet() {
    if (openSheetEl) { openSheetEl.classList.remove('open'); openSheetEl.inert = true; }
    openSheetEl = null; el.scrim.classList.remove('show'); el.fab.classList.remove('hide');
    $('.app').inert = false;
    previousFocus?.focus({ preventScroll: true });
  }
  el.scrim.addEventListener('click', closeSheet);
  $$('[data-close]').forEach(b => b.addEventListener('click', closeSheet));
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('keydown', e => {
    if (!openSheetEl || e.key !== 'Tab') return;
    const focusable = $$('button,input,select,[tabindex="0"]', openSheetEl).filter(n => !n.disabled && n.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  });

  // ============================================================
  // Score / level / goal rendering
  // ============================================================
  let displayedTotal = 0, tweenRaf = 0;
  function tweenTo(target) {
    cancelAnimationFrame(tweenRaf);
    if (reducedMotion()) { displayedTotal = target; el.scoreTotal.textContent = fmt(target); return; }
    const from = displayedTotal, diff = target - from, t0 = performance.now(), dur = clamp(Math.abs(diff) / 2000, 400, 1100);
    if (!diff) { el.scoreTotal.textContent = fmt(target); return; }
    const step = now => {
      const k = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      displayedTotal = from + diff * e;
      el.scoreTotal.textContent = fmt(displayedTotal);
      if (k < 1) tweenRaf = requestAnimationFrame(step); else displayedTotal = target;
    };
    tweenRaf = requestAnimationFrame(step);
  }

  function renderScore(animate = true, delta = 0) {
    const list = filtered(), total = sum(list);
    if (animate) tweenTo(total); else { displayedTotal = total; el.scoreTotal.textContent = fmt(total); }
    el.scoreCount.textContent = list.length;
    el.streak.textContent = streak();
    el.periodLabel.textContent = PERIOD_LABEL[state.period];

    if (delta) {
      el.scoreValue.classList.remove('bump', 'shrink');
      void el.scoreValue.offsetWidth;
      el.scoreValue.classList.add(delta > 0 ? 'bump' : 'shrink');
      const ft = document.createElement('div');
      ft.className = 'float-text' + (delta < 0 ? ' neg' : '');
      ft.textContent = (delta > 0 ? '+' : '-') + fmt(Math.abs(delta)) + '원';
      el.scoreboard.appendChild(ft); setTimeout(() => ft.remove(), 1400);
    }

    // level (all-time)
    const li = levelIndex(sum(state.entries)), lv = LEVELS[li];
    el.levelEmoji.textContent = lv.emoji; el.levelTitle.textContent = lv.title; el.levelNum.textContent = li + 1;

    // goal (this month)
    const m = sum(monthEntries());
    $('#paid-total').textContent = fmt(sum(monthEntries().filter(e => e.paid))) + '원';
    $('#pending-total').textContent = fmt(sum(monthEntries().filter(e => !e.paid))) + '원';
    const next = LEVELS[li + 1], allTotal = sum(state.entries);
    $('#next-level').textContent = next ? `${next.emoji} 다음 레벨까지 ${shortWon(next.min - allTotal)}원` : '👑 전설의 농부 · 최고 레벨 달성';
    $('#xp-fill').style.width = (next ? clamp((allTotal - lv.min) / (next.min - lv.min) * 100, 0, 100) : 100) + '%';
    if (state.goal > 0) {
      const pct = m / state.goal * 100;
      el.goalFill.style.width = clamp(pct, 0, 100) + '%';
      el.goalPct.textContent = Math.floor(pct) + '%';
      el.goalRemain.textContent = pct >= 100 ? `🎉 목표 달성! (+${shortWon(m - state.goal)}원 초과)` : `${shortWon(state.goal - m)}원 남음 / ${shortWon(state.goal)}원`;
      el.goal.classList.toggle('done', pct >= 100);
    } else {
      el.goalFill.style.width = '0%'; el.goalPct.textContent = '0%';
      el.goalRemain.textContent = '목표를 설정해 보세요'; el.goal.classList.remove('done');
    }
  }

  // ============================================================
  // Tower
  // ============================================================
  function makeBlock(e) {
    const c = catOf(e.cat), h = blockHeight(e.amount);
    const look = appearance(e);
    const b = document.createElement('div');
    b.className = 'block skin-' + (look.skin || 'soft');
    b.tabIndex = 0; b.setAttribute('role', 'button');
    b.setAttribute('aria-label', `${e.name}, ${fmt(e.amount)}원, ${e.paid ? '입금 완료' : '입금 대기'}, 수정`);
    b.dataset.id = e.id;
    b.style.setProperty('--c', TINTS[look.tint] || c.color);
    b.style.height = h + 'px';
    b.title = `${e.name} · ${fmt(e.amount)}원${e.memo ? ' · ' + e.memo : ''}`;
    b.innerHTML = `<span class="b-emoji">${c.emoji}</span><span class="b-name">${esc(e.name)}</span><span class="b-amt">${fmt(e.amount)}<small>원</small></span>${e.paid ? '<span class="paid-mark" aria-hidden="true">✓</span>' : ''}<div class="b-hold"></div>`;
    return b;
  }
  function renderTower({ stagger = false, dropId = null } = {}) {
    const list = filtered();
    el.tower.innerHTML = '';
    for (let i = 0, k = 0; i < list.length; i++, k++) {
      const b = makeBlock(list[i]);
      if (dropId === list[i].id) b.classList.add('drop');
      else if (stagger) { b.classList.add('rise'); b.style.animationDelay = Math.min(k, 14) * 35 + 'ms'; }
      el.tower.appendChild(b);
    }
    el.emptyHint.hidden = list.length > 0;
    $('#result-count').textContent = list.length;
    el.emptyHint.querySelector('p').textContent = state.entries.length ? '조건에 맞는 블록이 없어요' : '첫 블록을 쌓아보세요!';
    el.emptyHint.querySelector('small').innerHTML = state.entries.length ? '검색어나 필터를 바꾸면<br>다른 블록을 볼 수 있어요' : '아래 <b>+</b> 버튼으로 활동을 추가하면<br>나만의 농장이 자라납니다';
    el.towerWrap.classList.toggle('show-hint', list.length > 0 && list.length < 4);
    el.tower.scrollTop = 0;
  }

  function renderSide() {
    // 7-day sparkline
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(localISO(d)); }
    const perDay = days.map(d => sum(state.entries.filter(e => e.date === d)));
    const max = Math.max(1, ...perDay);
    const dow = ['일', '월', '화', '수', '목', '금', '토'];
    el.spark.innerHTML = days.map((d, i) => {
      const h = Math.max(4, perDay[i] / max * 100);
      const isToday = d === todayStr();
      return `<div class="bar${isToday ? ' today' : ''}" title="${d}: ${fmt(perDay[i])}원"><i style="height:${h}%;animation-delay:${i * 40}ms"></i><span>${dow[new Date(d + 'T00:00:00').getDay()]}</span></div>`;
    }).join('');

    // insights
    const now = new Date();
    const thisM = sum(monthEntries());
    const prevKey = localISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
    const prevM = sum(state.entries.filter(e => e.date.slice(0, 7) === prevKey));
    const week = sum(state.entries.filter(e => inPeriod(e, 'week')));
    const top = [...state.entries].sort((a, b) => b.amount - a.amount)[0];
    let cmp = '<b class="muted">-</b>';
    if (prevM > 0) { const r = (thisM - prevM) / prevM * 100; cmp = `<b class="${r >= 0 ? 'up' : 'down'}">${r >= 0 ? '▲' : '▼'} ${Math.abs(r).toFixed(0)}%</b>`; }
    else if (thisM > 0) cmp = '<b class="up">NEW</b>';
    el.insight.innerHTML = `
      <div class="kv"><span>이번 주</span><b>${shortWon(week)}원</b></div>
      <div class="kv"><span>이번 달</span><b>${shortWon(thisM)}원</b></div>
      <div class="kv"><span>지난달 대비</span>${cmp}</div>
      ${top ? `<div class="kv"><span>최고 블록</span><b title="${esc(top.name)}">${esc(top.name.length > 8 ? top.name.slice(0, 8) + '…' : top.name)}</b></div>` : ''}`;

    // categories (current filter)
    const list = filtered(), total = sum(list);
    const rows = CATEGORIES.map(c => ({ c, v: sum(list.filter(e => e.cat === c.id)) })).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
    el.catBreakdown.innerHTML = rows.length ? rows.map(r => `
      <div class="cat-row">
        <span class="cat-e">${r.c.emoji}</span><span class="cat-n">${r.c.name}</span><span class="cat-v">${Math.round(r.v / total * 100)}%</span>
        <div class="cat-bar"><i style="background:${r.c.color};box-shadow:0 0 8px ${r.c.color}" data-w="${r.v / total * 100}"></i></div>
      </div>`).join('') : '<div class="muted">아직 데이터가 없어요</div>';
    requestAnimationFrame(() => $$('.cat-bar i', el.catBreakdown).forEach(i => { i.style.width = i.dataset.w + '%'; }));

    // history
    const hist = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 10);
    el.history.innerHTML = hist.length ? hist.map((e, i) => {
      const c = catOf(e.cat);
      return `<li data-id="${e.id}" style="animation-delay:${i * 30}ms">
        <span class="h-dot" style="background:${c.color};color:${c.color}"></span>
        <div class="h-main"><div class="h-name">${esc(e.name)}</div><div class="h-date">${e.date.slice(5).replace('-', '/')} · ${c.name}</div></div>
        <span class="h-amt">${shortWon(e.amount)}</span></li>`;
    }).join('') : '<li class="muted" style="display:block;background:none">기록이 없어요</li>';
  }

  function renderAll(opts = {}) {
    renderTower(opts); renderSide(); renderScore(false);
    el.btnSound.textContent = state.sound ? '🔊' : '🔇';
    el.btnSound.classList.toggle('muted', !state.sound);
    moveTabIndicator();
  }

  // ============================================================
  // Add / edit / destroy
  // ============================================================
  function addEntry(entry) {
    if (!canEdit()) return;
    const before = levelIndex(sum(state.entries));
    const monthBefore = sum(monthEntries());
    state.entries.push(entry); state.lastCat = entry.cat; save();

    if (matches(entry)) {
      renderTower({ dropId: entry.id });
      const b = el.tower.querySelector(`[data-id="${entry.id}"]`);
      el.emptyHint.hidden = true;
      setTimeout(() => {
        el.towerWrap.classList.remove('thud'); void el.towerWrap.offsetWidth; el.towerWrap.classList.add('thud');
        sfx.land(); vibrate(20);
        const r = b.getBoundingClientRect();
        fx.sparkle(r.left + r.width / 2, r.bottom, catOf(entry.cat).color, 14);
      }, 520);
      setTimeout(() => b.classList.remove('drop'), 800);
      renderScore(true, entry.amount);
    } else {
      renderScore(true);
      toast('저장했어요. 현재 검색·필터 조건 밖의 블록입니다');
    }
    sfx.pop(); setTimeout(() => sfx.coin(), 550);
    el.levelEmoji.classList.remove('bounce'); void el.levelEmoji.offsetWidth; el.levelEmoji.classList.add('bounce');
    el.towerWrap.classList.toggle('show-hint', filtered().length < 4);
    renderSide();

    const after = levelIndex(sum(state.entries));
    if (after > before) setTimeout(() => levelUp(after), 700);
    const monthKey = todayStr().slice(0, 7);
    if (state.goal > 0 && monthBefore < state.goal && sum(monthEntries()) >= state.goal && state.goalCelebrated !== monthKey) {
      state.goalCelebrated = monthKey; save();
      setTimeout(() => { fx.confetti(160); sfx.fanfare(); toast('🎯 이번 달 목표 달성! 대단해요!', { duration: 4000 }); el.scoreboard.classList.add('flash'); setTimeout(() => el.scoreboard.classList.remove('flash'), 600); }, after > before ? 2600 : 800);
    }
  }

  function updateEntry(id, patch) {
    if (!canEdit()) return;
    const e = state.entries.find(x => x.id === id); if (!e) return;
    const delta = (patch.amount ?? e.amount) - e.amount;
    Object.assign(e, patch); save();
    renderTower(); renderSide(); renderScore(true, delta);
    const b = el.tower.querySelector(`[data-id="${id}"]`); if (b) b.classList.add('pulse');
    sfx.coin(); toast('✏️ 블록을 수정했어요');
  }

  function levelUp(idx) {
    const lv = LEVELS[idx];
    el.levelupEmoji.textContent = lv.emoji;
    el.levelupSub.textContent = `Lv.${idx + 1} ${lv.title} 농장이 되었어요!`;
    el.levelup.classList.add('show');
    fx.confetti(140); sfx.fanfare(); vibrate([30, 40, 30, 40, 80]);
    setTimeout(() => el.levelup.classList.remove('show'), 2400);
  }

  function destroyBlock(id, { silent = false } = {}) {
    if (!canEdit()) return;
    const idx = state.entries.findIndex(e => e.id === id); if (idx < 0) return;
    const entry = state.entries[idx];
    state.entries.splice(idx, 1); save();
    const b = el.tower.querySelector(`[data-id="${id}"]`);
    if (b) shatter(b, entry);
    sfx.crash(); vibrate([50, 30, 100]);
    renderScore(true, -entry.amount); renderSide();
    $('#result-count').textContent = filtered().length;
    el.emptyHint.hidden = filtered().length > 0;
    if (!silent) toast(`💥 "${esc(entry.name)}" 파괴 · -${fmt(entry.amount)}원`, {
      action: '되돌리기',
      onAction() { if (!canEdit()) return; if (!state.entries.some(e => e.id === entry.id)) state.entries.splice(Math.min(idx, state.entries.length), 0, entry); save(); renderAll({ dropId: entry.id }); renderScore(true, entry.amount); sfx.pop(); toast('↩️ 블록을 복구했어요'); },
    });
  }

  function shatter(b, entry) {
    if (reducedMotion()) { b.remove(); return; }
    const color = TINTS[appearance(entry).tint] || catOf(entry.cat).color;
    const r = b.getBoundingClientRect(), wr = el.towerWrap.getBoundingClientRect();
    const cols = 4, rows = clamp(Math.round(r.height / 20), 2, 6);
    const w = r.width / cols, h = r.height / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const s = document.createElement('div'); s.className = 'shard';
      s.style.cssText = `left:${r.left - wr.left + x * w}px;top:${r.top - wr.top + y * h}px;width:${w - 2}px;height:${h - 2}px;background:${color};`;
      el.towerWrap.appendChild(s);
      const dx = (x - (cols - 1) / 2) * (40 + Math.random() * 60) + (Math.random() - .5) * 40;
      const dy = -40 - Math.random() * 120;
      const dy2 = 200 + Math.random() * 200;
      s.animate([
        { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${(Math.random() - .5) * 200}deg) scale(1)`, opacity: 1, offset: .35 },
        { transform: `translate(${dx * 1.6}px, ${dy2}px) rotate(${(Math.random() - .5) * 720}deg) scale(.4)`, opacity: 0 },
      ], { duration: 800 + Math.random() * 300, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }).onfinish = () => s.remove();
    }
    fx.burst(r.left + r.width / 2, r.top + r.height / 2, color, 30);
    b.classList.add('exploding');
    el.towerWrap.classList.remove('quake'); void el.towerWrap.offsetWidth; el.towerWrap.classList.add('quake');
    setTimeout(() => { b.classList.remove('exploding'); b.classList.add('collapse'); b.style.animation = 'none'; b.style.opacity = '0'; }, 260);
    setTimeout(() => b.remove(), 700);
  }

  // ---------- long press / tap on blocks ----------
  let hold = null;
  function cancelHold() {
    if (!hold) return;
    cancelAnimationFrame(hold.raf);
    hold.block.classList.remove('holding'); hold.block.style.setProperty('--p', 0);
    hold = null;
  }
  el.tower.addEventListener('pointerdown', ev => {
    const block = ev.target.closest('.block');
    if (!block || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    cancelHold(); sfx.unlock();
    hold = { block, id: block.dataset.id, start: performance.now(), x: ev.clientX, y: ev.clientY, raf: 0, tick: 0, moved: false };
    const step = now => {
      if (!hold) return;
      const p = clamp((now - hold.start) / HOLD_MS, 0, 1);
      if (p > .08 && !hold.block.classList.contains('holding')) hold.block.classList.add('holding');
      hold.block.style.setProperty('--p', p.toFixed(3));
      if (p - hold.tick >= .1) { hold.tick = p; sfx.tick(p); vibrate(p > .7 ? 15 : 6); }
      if (p >= 1) { const id = hold.id; const bl = hold.block; hold = null; bl.classList.remove('holding'); destroyBlock(id); return; }
      hold.raf = requestAnimationFrame(step);
    };
    hold.raf = requestAnimationFrame(step);
  });
  el.tower.addEventListener('pointermove', ev => {
    if (hold && Math.hypot(ev.clientX - hold.x, ev.clientY - hold.y) > 12) { hold.moved = true; cancelHold(); }
  });
  const release = () => {
    if (!hold) return;
    const elapsed = performance.now() - hold.start, id = hold.id;
    cancelHold();
    if (elapsed < TAP_MS) openEdit(id);
    else if (elapsed < HOLD_MS) toast('🧱 3초간 계속 누르면 블록이 파괴돼요', { duration: 1600 });
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', cancelHold);
  el.tower.addEventListener('scroll', cancelHold, { passive: true });
  el.tower.addEventListener('contextmenu', e => e.preventDefault());
  el.tower.addEventListener('keydown', e => {
    const block = e.target.closest('.block');
    if (block && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openEdit(block.dataset.id); }
  });
  window.addEventListener('blur', cancelHold);

  el.history.addEventListener('click', ev => {
    const li = ev.target.closest('li[data-id]'); if (!li) return;
    const b = el.tower.querySelector(`[data-id="${li.dataset.id}"]`);
    if (b) { b.scrollIntoView({ behavior: 'smooth', block: 'center' }); b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); sfx.coin(); }
  });

  // ============================================================
  // Add / edit form
  // ============================================================
  let editingId = null, editingSnapshot = null, selectedCat = state.lastCat || 'freelance';
  el.catPicker.innerHTML = CATEGORIES.map(c => `<button type="button" data-cat="${c.id}" style="--c:${c.color}"><i></i>${c.emoji} ${c.name}</button>`).join('');
  const syncCat = () => $$('button', el.catPicker).forEach(b => b.classList.toggle('active', b.dataset.cat === selectedCat));
  el.catPicker.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-cat]'); if (!b) return;
    selectedCat = b.dataset.cat; syncCat(); sfx.coin(); vibrate(8);
  });
  const formatAmountInput = inp => { const v = parseAmount(inp.value); inp.value = v ? fmt(v) : ''; };
  el.inAmount.addEventListener('input', () => formatAmountInput(el.inAmount));
  el.inGoal.addEventListener('input', () => formatAmountInput(el.inGoal));
  $$('.quick-amts button[data-add]').forEach(b => b.addEventListener('click', () => {
    const add = Number(b.dataset.add);
    el.inAmount.value = add ? fmt(parseAmount(el.inAmount.value) + add) : '';
    sfx.coin(); vibrate(8);
  }));
  $$('.quick-amts button[data-goal]').forEach(b => b.addEventListener('click', () => { el.inGoal.value = fmt(Number(b.dataset.goal)); sfx.coin(); }));

  function openAdd() {
    if (!canEdit()) return;
    editingId = null; selectedCat = state.lastCat || 'freelance'; syncCat();
    el.sheetTitle.textContent = '활동 추가'; el.btnSubmit.textContent = '🧱 블록 쌓기'; el.btnDelete.hidden = true;
    el.form.reset(); el.inDate.value = todayStr();
    const picks = crypto.getRandomValues(new Uint32Array(2));
    $('#in-skin').value = SKINS[picks[0] % SKINS.length];
    $('#in-tint').value = Object.keys(TINTS)[picks[1] % Object.keys(TINTS).length];
    openSheet(el.sheetAdd);
    setTimeout(() => el.inName.focus({ preventScroll: true }), 350);
  }
  function openEdit(id) {
    if (!canEdit()) return;
    const e = state.entries.find(x => x.id === id); if (!e) return;
    editingId = id; selectedCat = e.cat; syncCat();
    editingSnapshot = JSON.stringify(e);
    el.sheetTitle.textContent = '블록 수정'; el.btnSubmit.textContent = '💾 저장'; el.btnDelete.hidden = false;
    el.inName.value = e.name; el.inAmount.value = fmt(e.amount); el.inDate.value = e.date; el.inMemo.value = e.memo || '';
    const look = appearance(e);
    $('#in-skin').value = look.skin || 'soft'; $('#in-paid').value = e.paid ? 'paid' : 'pending';
    $('#in-tint').value = look.tint || 'category';
    openSheet(el.sheetAdd);
  }
  el.form.addEventListener('submit', ev => {
    ev.preventDefault();
    if (!canEdit()) return;
    if (editingId && JSON.stringify(state.entries.find(e => e.id === editingId)) !== editingSnapshot) { toast('다른 기기에서 이 블록이 변경됐어요. 닫고 다시 열어 최신 내용을 확인해 주세요', { duration: 5000 }); return; }
    const name = el.inName.value.trim(), amount = parseAmount(el.inAmount.value);
    if (!name) { el.inName.focus(); return; }
    if (amount <= 0) { el.inAmount.focus(); toast('예상 수입을 입력해 주세요'); return; }
    if (amount > 9999999999) { toast('금액이 너무 커요 (최대 99억)'); return; }
    const date = el.inDate.value || todayStr(), memo = el.inMemo.value.trim();
    const paid = $('#in-paid').value === 'paid', skin = $('#in-skin').value, tint = $('#in-tint').value;
    try { FarmData.clean({ entries: [{ id: editingId || uid(), name, amount, date, memo }], goal: 0 }); } catch (error) { toast(error.message); return; }
    closeSheet();
    if (editingId) updateEntry(editingId, { name, amount, date, memo, paid, skin, tint, visualVersion: 1, cat: selectedCat });
    else addEntry({ id: uid(), name, amount, date, memo, paid, skin, tint, visualVersion: 1, cat: selectedCat, createdAt: Date.now() });
  });
  el.btnCancel.addEventListener('click', closeSheet);
  el.btnDelete.addEventListener('click', () => { const id = editingId; closeSheet(); if (id) setTimeout(() => destroyBlock(id), 200); });
  el.fab.addEventListener('click', () => { sfx.unlock(); openAdd(); });

  // ---------- goal ----------
  const openGoal = () => { el.inGoal.value = state.goal ? fmt(state.goal) : ''; openSheet(el.sheetGoal); };
  el.btnGoal.addEventListener('click', openGoal);
  $('#m-goal').addEventListener('click', openGoal);
  el.formGoal.addEventListener('submit', ev => {
    ev.preventDefault();
    if (!canEdit()) return;
    if (parseAmount(el.inGoal.value) > 9999999999) { toast('목표 금액은 최대 99억까지 설정할 수 있어요'); return; }
    state.goal = parseAmount(el.inGoal.value); save(); closeSheet();
    renderScore(false); sfx.coin();
    toast(state.goal ? `🎯 목표 ${fmt(state.goal)}원 설정!` : '목표를 해제했어요');
  });

  // ---------- period tabs ----------
  function moveTabIndicator() {
    const idx = ['all', 'today', 'week', 'month'].indexOf(state.period);
    el.tabIndicator.style.transform = `translateX(${idx * 100}%)`;
    $$('button', el.tabs).forEach(b => b.classList.toggle('active', b.dataset.period === state.period));
  }
  el.tabs.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-period]'); if (!b || b.dataset.period === state.period) return;
    state.period = b.dataset.period; save();
    moveTabIndicator(); renderTower({ stagger: true }); renderSide(); renderScore(true);
    sfx.coin(); vibrate(8);
  });

  // ---------- sound ----------
  el.btnSound.addEventListener('click', () => {
    state.sound = !state.sound; save();
    el.btnSound.textContent = state.sound ? '🔊' : '🔇'; el.btnSound.classList.toggle('muted', !state.sound);
    if (state.sound) { sfx.unlock(); sfx.coin(); }
    toast(state.sound ? '🔊 사운드 켜짐' : '🔇 사운드 꺼짐');
  });

  // ============================================================
  // Menu: share / export / import / sample / reset
  // ============================================================
  el.btnMenu.addEventListener('click', () => openSheet(el.sheetMenu));

  function summaryText() {
    const total = sum(state.entries), m = sum(monthEntries()), li = levelIndex(total);
    return `🌱 Income Farm\n누적 예상 수입: ${fmt(total)}원\n이번 달: ${fmt(m)}원 (${state.entries.filter(e => inPeriod(e, 'month')).length}개 블록)\n레벨: Lv.${li + 1} ${LEVELS[li].title} ${LEVELS[li].emoji}\n🔥 ${streak()}일 연속 활동`;
  }
  $('#m-share').addEventListener('click', async () => {
    closeSheet(); const text = summaryText();
    try {
      if (navigator.share) await navigator.share({ title: 'Income Farm', text });
      else { await navigator.clipboard.writeText(text); toast('📋 요약을 클립보드에 복사했어요'); }
    } catch (_) { /* cancelled */ }
  });
  $('#m-export').addEventListener('click', async () => {
    closeSheet();
    const data = JSON.stringify({ app: 'income-farm', version: APP_VERSION, exportedAt: new Date().toISOString(), ...state }, null, 2);
    const name = `income-farm-${todayStr()}.json`;
    try {
      const file = new File([data], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Income Farm 데이터' }); return; }
    } catch (_) { /* fall through */ }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('💾 JSON 파일로 내보냈어요');
  });
  $('#m-import').addEventListener('click', () => el.fileImport.click());
  el.fileImport.addEventListener('change', async () => {
    const f = el.fileImport.files[0]; el.fileImport.value = ''; if (!f) return;
    if (!canEdit()) return;
    if (f.size > 10000000) { toast('10MB 이하의 JSON 파일을 선택해 주세요'); return; }
    try {
      const data = FarmData.clean(JSON.parse(await f.text())), clean = data.entries;
      if (!canEdit()) return;
      if (!confirm(`${clean.length}개 블록을 기존 기록에 합칠까요? 같은 ID의 기록은 유지됩니다. 취소하면 변경하지 않습니다.`)) return;
      const wasEmpty = !state.entries.length, ids = new Set(state.entries.map(e => e.id));
      clean.forEach(e => { if (!ids.has(e.id)) { state.entries.push(e); ids.add(e.id); } });
      if (wasEmpty && !state.goal) state.goal = data.goal;
      save(); closeSheet(); renderAll({ stagger: true }); sfx.fanfare();
      toast(`📥 ${clean.length}개 블록을 불러왔어요`);
    } catch (_) { toast('⚠️ 올바른 Income Farm JSON 파일이 아니에요'); }
  });
  $('#m-sample').addEventListener('click', () => {
    if (!canEdit()) return;
    closeSheet();
    const names = [['로고 디자인 외주', 'freelance', 350000], ['온라인 강의 1회', 'lecture', 150000], ['중고 카메라 판매', 'sales', 420000], ['유튜브 광고 수익', 'content', 88000],
      ['배당금', 'invest', 62000], ['주말 카페 알바', 'parttime', 96000], ['블로그 체험단', 'content', 50000], ['웹사이트 유지보수', 'freelance', 200000], ['전자책 판매', 'sales', 34000], ['멘토링 세션', 'lecture', 120000]];
    let i = 0;
    const addNext = () => {
      if (i >= names.length) { toast('✨ 샘플 블록 10개를 쌓았어요'); return; }
      const [name, cat, amount] = names[i]; const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * 12));
      addEntry({ id: uid(), name, amount, date: localISO(d), memo: '샘플', cat, paid: i % 3 === 0, skin: ['soft', 'pixel', 'stripe', 'gem'][i % 4], createdAt: Date.now() - (names.length - i) * 1000 });
      i++; setTimeout(addNext, 380);
    };
    addNext();
  });
  $('#m-reset').addEventListener('click', () => {
    if (!canEdit()) return;
    if (!state.entries.length) { toast('삭제할 데이터가 없어요'); closeSheet(); return; }
    if (!confirm(`정말 모든 블록(${state.entries.length}개)을 삭제할까요?\n이 작업은 되돌릴 수 없어요.`)) return;
    const blocks = $$('.block', el.tower);
    closeSheet();
    blocks.forEach((b, k) => setTimeout(() => { const e = state.entries.find(x => x.id === b.dataset.id); if (e) shatter(b, e); }, k * 60));
    state = { ...defaults(), sound: state.sound, period: state.period }; save();
    setTimeout(() => { renderAll(); sfx.crash(); toast('🧨 초기화 완료'); }, Math.min(blocks.length * 60, 1500) + 300);
  });

  // Search, view preferences and spreadsheet export.
  $('#filter-cat').insertAdjacentHTML('beforeend', CATEGORIES.map(c => `<option value="${c.id}">${c.emoji} ${c.name}</option>`).join(''));
  $('#search').addEventListener('input', e => { query = e.target.value.trim().toLocaleLowerCase(); renderAll(); });
  $('#filter-cat').addEventListener('change', e => { categoryFilter = e.target.value; renderAll(); });
  $('#filter-paid').addEventListener('change', e => { paidFilter = e.target.value; renderAll(); });
  $('#sort').addEventListener('change', e => { sortOrder = e.target.value; renderTower(); });
  $('#density').value = localStorage.getItem('incomefarm:density') === 'comfortable' ? 'comfortable' : 'compact';
  el.tower.dataset.density = $('#density').value;
  $('#density').addEventListener('change', e => { el.tower.dataset.density = e.target.value; localStorage.setItem('incomefarm:density', e.target.value); });
  function updateMotion() {
    document.body.classList.toggle('reduced-motion', motionOff);
    $('#btn-motion').textContent = reducedMotion() ? '효과 줄임' : '효과 켜짐';
    $('#btn-motion').setAttribute('aria-pressed', String(motionOff));
  }
  updateMotion();
  $('#btn-motion').addEventListener('click', () => { motionOff = !motionOff; localStorage.setItem('incomefarm:motion', motionOff ? 'off' : 'on'); updateMotion(); });
  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }
  $('#m-csv').addEventListener('click', () => {
    // Neutralize spreadsheet formula injection, including leading whitespace.
    const cell = value => '"' + String(value).replace(/^(\s*[=+@-])/, "'$1").replace(/"/g, '""') + '"';
    const rows = [['날짜', '활동', '카테고리', '예상 수입(원)', '입금 상태', '메모'], ...filtered().map(e => [e.date, e.name, catOf(e.cat).name, e.amount, e.paid ? '입금 완료' : '입금 대기', e.memo || ''])];
    download('\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n'), `income-farm-${todayStr()}.csv`, 'text/csv;charset=utf-8');
    closeSheet(); toast(`${rows.length - 1}개 검색 결과를 내보냈어요`);
  });

  // Account UI. Guest data stays separate until the user explicitly migrates it.
  const accountStatus = $('#account-status');
  $('#btn-account').addEventListener('click', () => openSheet($('#sheet-account')));
  window.addEventListener('farm:cloud-status', ({ detail: s }) => {
    $('#btn-account').dataset.kind = s.kind;
    $('#btn-account').title = s.text;
    $('#sync-label').textContent = s.email ? (s.kind === 'synced' ? '동기화 완료' : '동기화 상태') : '계정 연결';
    accountStatus.textContent = s.configured ? s.text : '클라우드 연결 준비 중 · 현재 기록은 이 기기에 저장됩니다. 운영자의 서버 연결 후 로그인할 수 있어요.';
    $('#storage-note').textContent = s.email ? s.text : '이 기기에 저장 중 · 계정 연결로 동기화';
    $('#account-email').textContent = s.email;
    $('#account-actions').hidden = !s.email;
    $('#form-login').hidden = !!s.email || !$('#form-verify').hidden;
    if (s.email) $('#form-verify').hidden = true;
    $('#send-code').disabled = !s.configured;
  });
  window.addEventListener('farm:cloud-data', ({ detail }) => {
    cancelHold(); hideToast();
    state = { ...defaults(), sound: state.sound, period: state.period, ...detail }; renderAll();
  });
  window.addEventListener('farm:signed-out', () => {
    cancelHold(); hideToast(); state = load(); renderAll(); closeSheet(); toast('로그아웃했어요. 이 기기의 로컬 기록을 표시합니다');
  });
  let loginEmail = '';
  async function accountAction(button, action) {
    button.disabled = true;
    try { await action(); } catch (error) { accountStatus.textContent = error.message; }
    finally { button.disabled = false; }
  }
  $('#form-login').addEventListener('submit', e => {
    e.preventDefault(); loginEmail = $('#login-email').value.trim();
    accountAction($('#send-code'), async () => {
      await FarmCloud.sendCode(loginEmail); $('#form-login').hidden = true; $('#form-verify').hidden = false;
      accountStatus.textContent = '이메일로 인증 코드를 보냈어요. 받은편지함과 스팸함을 확인해 주세요'; $('#login-code').focus();
    });
  });
  $('#change-email').addEventListener('click', () => { $('#form-verify').hidden = true; $('#form-login').hidden = false; $('#login-email').focus(); });
  $('#form-verify').addEventListener('submit', e => {
    e.preventDefault(); accountAction(e.submitter, async () => { await FarmCloud.verify(loginEmail, $('#login-code').value.trim()); $('#login-code').value = ''; });
  });
  $('#sync-now').addEventListener('click', () => FarmCloud.sync());
  $('#sign-out').addEventListener('click', e => accountAction(e.currentTarget, () => FarmCloud.signOut()));
  $('#m-migrate').addEventListener('click', () => {
    if (!canEdit()) return;
    const guest = load();
    if (!guest.entries.length) { accountStatus.textContent = '이 기기에 이전할 로컬 기록이 없어요'; return; }
    if (!confirm(`이 기기의 ${guest.entries.length}개 기록을 현재 계정에 합칠까요? 원본 로컬 기록은 보관됩니다.`)) return;
    const ids = new Set(state.entries.map(e => e.id));
    guest.entries.forEach(e => { if (!ids.has(e.id)) { state.entries.push(e); ids.add(e.id); } });
    if (!state.goal) state.goal = guest.goal;
    save(); renderAll(); accountStatus.textContent = '기존 기록을 합쳤어요. 서버 저장 상태를 확인해 주세요';
  });
  $('#cloud-reload').addEventListener('click', e => {
    if (!confirm('이 기기의 현재 기록을 JSON 파일로 백업한 뒤 서버 기록을 불러올까요? 아직 서버에 저장되지 않은 수정은 백업 파일에 남습니다.')) return;
    download(JSON.stringify({ app: 'income-farm', ...state }, null, 2), `income-farm-conflict-${todayStr()}.json`, 'application/json');
    accountAction(e.currentTarget, () => FarmCloud.useCloud());
  });
  FarmCloud.init().catch(() => { accountStatus.textContent = '계정 연결에 실패했어요. 새로고침해 주세요'; });

  // ============================================================
  // PWA install
  // ============================================================
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredPrompt = e;
    if (!isStandalone()) el.btnInstall.classList.add('available');
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null; el.btnInstall.classList.remove('available'); el.btnInstall.classList.add('installed');
    fx.confetti(100); sfx.fanfare(); toast('📱 앱이 설치되었어요! 홈 화면에서 실행해 보세요', { duration: 4000 });
  });
  async function install() {
    if (isStandalone()) { toast('✅ 이미 앱으로 실행 중이에요'); return; }
    if (deferredPrompt) {
      try {
        const p = deferredPrompt; deferredPrompt = null;
        await p.prompt();
        const { outcome } = await p.userChoice;
        el.btnInstall.classList.remove('available');
        if (outcome !== 'accepted') toast('나중에 📱 아이콘으로 다시 설치할 수 있어요');
        return;
      } catch (_) { /* prompt unavailable → fall through to manual guide */ }
    }
    const ua = navigator.userAgent;
    let guide;
    if (isIOS()) {
      const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
      guide = `${isSafari ? '' : '<p>⚠️ iPhone에서는 <b>Safari</b>로 열어야 설치할 수 있어요. Safari에서 이 페이지를 다시 열어 주세요.</p>'}
        <ol>
          <li>Safari 하단의 <b>공유</b> 버튼 <span class="kbd">⬆︎</span> 을 누릅니다</li>
          <li>목록에서 <b>"홈 화면에 추가"</b>를 선택합니다</li>
          <li>오른쪽 위 <b>추가</b>를 누르면 완료!</li>
        </ol><p class="ok">홈 화면 아이콘으로 전체 화면 앱처럼 실행됩니다 🎉</p>`;
    } else if (/android/i.test(ua)) {
      guide = `<ol>
          <li>브라우저 오른쪽 위 <b>메뉴</b> <span class="kbd">⋮</span> 를 누릅니다</li>
          <li><b>"앱 설치"</b> 또는 <b>"홈 화면에 추가"</b>를 선택합니다</li>
          <li><b>설치</b>를 누르면 완료!</li>
        </ol><p class="ok">Chrome, Samsung Internet, Edge에서 지원됩니다 🎉</p>`;
    } else {
      guide = `<ol>
          <li>주소창 오른쪽의 <b>설치 아이콘</b> <span class="kbd">⊕</span> 을 클릭합니다</li>
          <li>또는 브라우저 메뉴 <span class="kbd">⋮</span> → <b>"Income Farm 설치"</b></li>
        </ol><p>스마트폰에서 이 주소를 열면 폰 홈 화면에도 설치할 수 있어요 📱</p>`;
    }
    el.installGuide.innerHTML = guide;
    openSheet(el.sheetInstall);
  }
  el.btnInstall.addEventListener('click', install);
  $('#m-install').addEventListener('click', () => { closeSheet(); setTimeout(install, 250); });
  if (isStandalone()) el.btnInstall.classList.add('installed');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing; if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('🆕 새 버전이 있어요', { action: '새로고침', onAction: () => location.reload(), duration: 8000 });
          });
        });
      }).catch(() => { /* offline or unsupported */ });
    });
  }

  // ============================================================
  // Boot
  // ============================================================
  el.inDate.value = todayStr();
  renderAll({ stagger: true });
  window.addEventListener('resize', moveTabIndicator);
  if (new URLSearchParams(location.search).get('action') === 'add') {
    history.replaceState(null, '', location.pathname);
    setTimeout(openAdd, 400);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderSide(); renderScore(false); } });
})();
