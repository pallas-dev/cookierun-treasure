/*
 * 보물 랜덤 뽑기 — 동작 코드
 *   화면 이름 · 기본 옵션  → js/config.js
 *   보물 목록 (자동 생성)  → data/treasures.js
 */
(() => {
  'use strict';

  const DATA = window.TREASURE_DATA;
  const CONFIG = window.TREASURE_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  if (!DATA || !Array.isArray(DATA.items) || !DATA.items.length) {
    $('slots').innerHTML = '<p class="load-error">보물 데이터를 불러오지 못했어요. data/treasures.js 파일이 있는지 확인해 주세요.</p>';
    return;
  }

  /* ------------------------------------------------------------------ *
   * 설정 (js/config.js — 값이 이상하면 기본값으로)
   * ------------------------------------------------------------------ */
  const MAX_REROLLS = 99; // '횟수 지정'에서 정할 수 있는 최대 횟수
  const isLimit = (v) => v === null || (Number.isInteger(v) && v >= 0);
  const isCount = (v) => Number.isInteger(v) && v >= 1;

  // 리롤: limit = null(무제한) · 0(리롤 불가) · N(한 판에 N회), count = '횟수 지정'에 넣어 둔 N
  function cleanOpts(o, base) {
    const src = o && typeof o === 'object' ? o : {};
    const bool = (k) => (typeof src[k] === 'boolean' ? src[k] : base[k]);
    const limit = 'limit' in src && isLimit(src.limit) ? src.limit : base.limit;
    const count = isCount(src.count) ? src.count : isCount(limit) ? limit : base.count;
    return {
      limit: limit === null ? null : Math.min(MAX_REROLLS, limit),
      count: Math.min(MAX_REROLLS, count),
      noRepeat: bool('noRepeat'),
      family: bool('family'),
      anim: bool('anim'),
    };
  }

  const SLOT_COUNT = Math.min(9, Math.max(1, Math.floor(Number(CONFIG.slotCount)) || 3));
  const GRADE_ORDER = Array.isArray(CONFIG.grades) ? CONFIG.grades : ['S', 'A', 'B', 'C'];
  const CAT_NAMES = CONFIG.categories && typeof CONFIG.categories === 'object' ? CONFIG.categories : {};
  const DEFAULT_OPTS = cleanOpts(CONFIG.defaults, { limit: null, count: 3, noRepeat: false, family: true, anim: true });
  const STORE_KEY = 'treasure-roll:v2';
  const IMAGE_BASE = DATA.imageBase || 'https://www.cookierunhub.com/';

  const MSG_NO_POOL = '조건에 맞는 보물이 없어요. 필터를 확인해 주세요.';
  const MSG_ALL_SEEN = '남은 보물을 다 뽑았어요. 초기화하면 처음부터 다시 뽑을 수 있어요.';

  /* ------------------------------------------------------------------ *
   * 데이터
   * ------------------------------------------------------------------ */
  const ITEMS = DATA.items;
  const BY_ID = new Map(ITEMS.map((t) => [t.id, t]));
  const isEvolved = (t) => t.evo !== null && t.evo !== undefined;
  const familyKey = (t) => (isEvolved(t) ? t.evo : t.id); // 진화 전·후 보물은 같은 값
  const catLabel = (key) => CAT_NAMES[key] || key || '기타';
  const fmt = (n) => n.toLocaleString('ko-KR');

  // 설정에 적힌 순서대로. 데이터에만 있는 값(새로 생긴 종류 등)은 뒤에 자동으로 붙어요.
  function inOrder(preferred, values) {
    const present = new Set(values);
    return [...preferred.filter((k) => present.has(k)), ...[...present].filter((k) => !preferred.includes(k)).sort()];
  }

  const GROUPS = {
    grades: {
      el: 'gradeChips',
      list: inOrder(GRADE_ORDER, ITEMS.map((t) => t.grade)).map((key) => ({
        key,
        label: `${key}급`,
        icon: `images/ui/grade-${String(key).toLowerCase()}.png`,
      })),
      value: (t) => t.grade,
    },
    evo: {
      el: 'evoChips',
      list: [
        { key: 'evolved', label: '진화' },
        { key: 'normal', label: '미진화' },
      ],
      value: (t) => (isEvolved(t) ? 'evolved' : 'normal'),
    },
    cats: {
      el: 'catChips',
      list: inOrder(Object.keys(CAT_NAMES), ITEMS.map((t) => t.cat)).map((key) => ({ key, label: catLabel(key) })),
      value: (t) => t.cat,
    },
  };
  const GROUP_KEYS = Object.keys(GROUPS);

  /* ------------------------------------------------------------------ *
   * 상태 — 브라우저(localStorage)에 저장돼서 새로고침해도 유지
   * ------------------------------------------------------------------ */
  const state = load();

  function load() {
    const s = {
      off: Object.fromEntries(GROUP_KEYS.map((g) => [g, []])), // 꺼 둔 필터 값 (새로 생긴 값은 기본으로 켜짐)
      opts: { ...DEFAULT_OPTS },
      slots: Array(SLOT_COUNT).fill(null),
      rerolls: 0, // 이번 판 리롤 횟수
      seen: new Set(), // 중복 없이 뽑기: 이미 나온 보물 id
    };
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY));
    } catch {
      saved = null;
    }
    if (!saved || typeof saved !== 'object') return s;

    for (const g of GROUP_KEYS) {
      const arr = saved.off && saved.off[g];
      if (Array.isArray(arr)) s.off[g] = GROUPS[g].list.map((x) => x.key).filter((k) => arr.includes(k));
    }
    s.opts = cleanOpts(saved.opts, DEFAULT_OPTS);
    if (Array.isArray(saved.slots)) {
      s.slots = s.slots.map((_, i) => (BY_ID.has(saved.slots[i]) ? saved.slots[i] : null));
    }
    if (Number.isInteger(saved.rerolls) && saved.rerolls >= 0) s.rerolls = saved.rerolls;
    if (s.opts.noRepeat) {
      if (Array.isArray(saved.seen)) saved.seen.forEach((id) => BY_ID.has(id) && s.seen.add(id));
      s.slots.forEach((id) => id !== null && s.seen.add(id));
    }
    return s;
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, seen: [...state.seen] }));
    } catch {
      /* 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 저장 없이 동작 */
    }
  }

  /* ------------------------------------------------------------------ *
   * 랜덤 / 후보
   * ------------------------------------------------------------------ */
  function randInt(n) {
    if (n <= 1) return 0;
    if (window.crypto && crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / n) * n; // 나머지 편향 제거
      do crypto.getRandomValues(buf); while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }
  const pickOne = (arr) => arr[randInt(arr.length)];

  function matches(t, skipGroup) {
    return GROUP_KEYS.every((g) => g === skipGroup || !state.off[g].includes(GROUPS[g].value(t)));
  }
  const getPool = () => ITEMS.filter((t) => matches(t));

  // 중복 없이 뽑기가 켜져 있으면 이미 나온 보물은 빼고
  const fresh = (pool) => (state.opts.noRepeat ? pool.filter((t) => !state.seen.has(t.id)) : pool);

  // i번 칸에 새로 넣을 수 있는 후보
  //  - 다른 칸과 같은 보물 X, 지금 이 칸에 있는 보물 X
  //  - (중복 없이 뽑기) 이미 나온 보물 X
  //  - (진화 전·후 옵션) 다른 칸과 같은 계열 X
  function candidates(i, slots, pool) {
    const others = slots
      .filter((id, j) => j !== i && id !== null)
      .map((id) => BY_ID.get(id))
      .filter(Boolean);
    const ids = new Set(others.map((t) => t.id));
    const families = new Set(others.map(familyKey));
    return fresh(pool).filter(
      (t) => t.id !== slots[i] && !ids.has(t.id) && !(state.opts.family && families.has(familyKey(t))),
    );
  }

  const limitLeft = () =>
    state.opts.limit === null ? Infinity : Math.max(0, state.opts.limit - state.rerolls);

  function remember(ids) {
    if (state.opts.noRepeat) ids.forEach((id) => id !== null && state.seen.add(id));
  }

  /* ------------------------------------------------------------------ *
   * 동작
   * ------------------------------------------------------------------ */
  const busy = new Set(); // 연출 중인 칸

  function rollAll() {
    if (busy.size) return;
    const pool = getPool();
    if (!pool.length) {
      toast(MSG_NO_POOL);
      return;
    }
    const next = Array(SLOT_COUNT).fill(null);
    for (let i = 0; i < SLOT_COUNT; i++) {
      const c = candidates(i, next, pool);
      if (!c.length) break;
      next[i] = pickOne(c).id;
    }
    const got = next.filter((v) => v !== null).length;
    if (!got) {
      toast(MSG_ALL_SEEN);
      return;
    }
    state.slots = next;
    state.rerolls = 0;
    remember(next);
    save();
    renderPool();
    if (got < SLOT_COUNT) toast(`남은 후보가 부족해서 ${got}개만 뽑았어요.`);
    play([...Array(SLOT_COUNT).keys()]);
  }

  function rerollSlot(i) {
    if (busy.size) return;
    const isReroll = state.slots[i] !== null;
    if (isReroll && limitLeft() === 0) {
      toast(
        state.opts.limit === 0
          ? '리롤 불가로 정해 뒀어요. 옵션에서 바꿀 수 있어요.'
          : '리롤 횟수를 다 썼어요. 옵션에서 횟수를 늘릴 수 있어요.',
      );
      return;
    }
    const pool = getPool();
    const c = candidates(i, state.slots, pool);
    if (!c.length) {
      if (!pool.length) toast(MSG_NO_POOL);
      else if (state.opts.noRepeat && !fresh(pool).length) toast(MSG_ALL_SEEN);
      else toast('조건에 맞는 다른 보물이 없어요. 필터를 넓혀 보세요.');
      return;
    }
    state.slots[i] = pickOne(c).id;
    if (isReroll) state.rerolls += 1;
    remember([state.slots[i]]);
    save();
    renderPool();
    play([i]);
  }

  function clearSlots() {
    if (busy.size) return;
    const hadSeen = state.opts.noRepeat && state.seen.size > 0;
    if (state.slots.every((v) => v === null) && !hadSeen) return;
    state.slots = Array(SLOT_COUNT).fill(null);
    state.rerolls = 0;
    state.seen.clear();
    save();
    renderAll();
    toast(hadSeen ? '초기화했어요. 이미 나온 보물도 다시 나올 수 있어요.' : '칸을 비웠어요.');
  }

  async function copyResult() {
    if (state.slots.every((v) => v === null)) {
      toast('아직 뽑은 보물이 없어요.');
      return;
    }
    const lines = state.slots.map((id, i) => {
      const t = BY_ID.get(id);
      if (!t) return `${i + 1}. -`;
      return `${i + 1}. ${t.name} (${t.grade}등급 · ${catLabel(t.cat)}${isEvolved(t) ? ' · 진화' : ''})`;
    });
    const text = [`🎲 쿠키런 보물 랜덤 뽑기 · 리롤 ${state.rerolls}회`, ...lines].join('\n');
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.append(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
    }
    toast(ok ? '결과를 복사했어요.' : '복사하지 못했어요. 브라우저 권한을 확인해 주세요.');
  }

  /* ------------------------------------------------------------------ *
   * 이미지 / 프레임
   * ------------------------------------------------------------------ */
  const imgSrc = (t) => (t.img ? `images/treasures/${t.img}` : t.src ? IMAGE_BASE + t.src : '');
  const warm = new Set(); // 미리 불러둔 이미지 (연출용)

  function questionMark() {
    const q = document.createElement('span');
    q.className = 'q';
    q.textContent = '?';
    return q;
  }

  function fillFrame(frame, t) {
    frame.replaceChildren();
    frame.classList.toggle('empty', !t);
    if (!t) {
      frame.removeAttribute('data-grade');
      frame.append(questionMark());
      return;
    }
    frame.dataset.grade = t.grade;
    const src = imgSrc(t);
    if (!src) {
      frame.append(questionMark());
      return;
    }
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', function onError() {
      if (t.img && t.src && !img.dataset.fallback) {
        img.dataset.fallback = '1';
        img.src = IMAGE_BASE + t.src; // 로컬 파일이 없으면 쿠키런HUB 이미지로
        return;
      }
      img.removeEventListener('error', onError);
      img.replaceWith(questionMark());
    });
    img.src = src;
    frame.append(img);
  }

  function preload(t) {
    if (!t || warm.has(t.id)) return;
    const src = imgSrc(t);
    if (src) new Image().src = src;
    warm.add(t.id);
  }

  /* ------------------------------------------------------------------ *
   * 슬롯
   * ------------------------------------------------------------------ */
  const ICON_REROLL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 21v-5h-5"/></svg>';
  const ICON_PICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const slotEls = [];

  function buildSlots() {
    const wrap = $('slots');
    wrap.style.setProperty('--slots', String(SLOT_COUNT));
    for (let i = 0; i < SLOT_COUNT; i++) {
      const el = document.createElement('article');
      el.className = 'slot';
      el.innerHTML = `
        <span class="slot-no" aria-hidden="true">${i + 1}</span>
        <div class="art"><span class="tframe"></span></div>
        <h3 class="t-name"></h3>
        <div class="t-meta"></div>
        <p class="t-ability"></p>
        <button type="button" class="btn reroll"></button>`;
      const s = {
        el,
        frame: el.querySelector('.tframe'),
        name: el.querySelector('.t-name'),
        meta: el.querySelector('.t-meta'),
        ability: el.querySelector('.t-ability'),
        btn: el.querySelector('.reroll'),
      };
      s.btn.addEventListener('click', () => rerollSlot(i));
      wrap.append(el);
      slotEls.push(s);
    }
  }

  function renderSlot(i) {
    const s = slotEls[i];
    const t = BY_ID.get(state.slots[i]) || null;
    s.el.dataset.grade = t ? t.grade : '';
    fillFrame(s.frame, t);
    s.name.textContent = t ? t.name : '아직 안 뽑았어요';
    s.name.classList.toggle('placeholder', !t);
    s.meta.replaceChildren(...(t ? metaNodes(t) : []));
    s.ability.textContent = t ? t.ability || '능력 정보가 아직 없어요.' : `${i + 1}번 칸만 따로 뽑을 수도 있어요.`;
    s.ability.classList.toggle('empty', !t || !t.ability);
    s.el.setAttribute('aria-label', t ? `${i + 1}번 보물: ${t.name}` : `${i + 1}번 보물: 비어 있음`);
  }

  function metaNodes(t) {
    const badge = document.createElement('img');
    badge.className = 'grade-badge';
    badge.src = `images/ui/grade-${t.grade.toLowerCase()}.png`;
    badge.alt = `${t.grade}등급`;
    badge.title = `${t.grade}등급`;
    const cat = document.createElement('span');
    cat.className = 'tag';
    cat.textContent = catLabel(t.cat);
    const evo = document.createElement('span');
    evo.className = isEvolved(t) ? 'tag evo' : 'tag';
    evo.textContent = isEvolved(t) ? '진화' : '미진화';
    return [badge, cat, evo];
  }

  // 슬롯머신 연출 → 결과 공개
  function play(indices) {
    const reduce = !state.opts.anim || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const targets = indices.filter((i) => state.slots[i] !== null);
    indices.filter((i) => state.slots[i] === null).forEach(renderSlot);

    if (reduce || !targets.length) {
      targets.forEach(renderSlot);
      afterPlay(targets);
      return;
    }

    const pool = getPool();
    const source = pool.length ? pool : ITEMS;
    const warmPool = source.filter((t) => warm.has(t.id));
    const reel = warmPool.length >= 8 ? warmPool : source;

    targets.forEach((i, k) => {
      preload(BY_ID.get(state.slots[i]));
      busy.add(i);
      const s = slotEls[i];
      s.el.classList.remove('is-revealed');
      s.el.classList.add('is-rolling');
      s.meta.replaceChildren();
      s.ability.textContent = '두근두근…';
      s.ability.classList.add('empty');
      const frames = 9 + k * 4;
      let j = 0;
      const step = () => {
        if (j >= frames) {
          busy.delete(i);
          s.el.classList.remove('is-rolling');
          renderSlot(i);
          reveal(i);
          if (!busy.size) afterPlay(targets);
          else syncControls();
          return;
        }
        const t = pickOne(reel);
        fillFrame(s.frame, t);
        s.el.dataset.grade = t.grade;
        s.name.textContent = t.name;
        j += 1;
        const p = j / frames;
        setTimeout(step, 40 + 170 * p * p * p);
      };
      step();
    });
    syncControls();
  }

  function reveal(i) {
    const el = slotEls[i].el;
    el.classList.remove('is-revealed');
    void el.offsetWidth; // 애니메이션 다시 시작
    el.classList.add('is-revealed');
    clearTimeout(el.revealTimer);
    el.revealTimer = setTimeout(() => el.classList.remove('is-revealed'), 1100);
  }

  function afterPlay(targets) {
    syncControls();
    const names = targets.map((i) => `${i + 1}번 ${BY_ID.get(state.slots[i])?.name ?? ''}`);
    $('announcer').textContent = names.join(', ');
  }

  /* ------------------------------------------------------------------ *
   * 필터 / 후보 수
   * ------------------------------------------------------------------ */
  function buildFilters() {
    for (const g of GROUP_KEYS) {
      const box = $(GROUPS[g].el);
      for (const item of GROUPS[g].list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip-btn';
        b.dataset.group = g;
        b.dataset.key = item.key;
        b.title = '클릭: 켜기/끄기 · 더블클릭: 이것만 선택';
        if (item.icon) {
          const img = document.createElement('img');
          img.src = item.icon;
          img.alt = '';
          b.append(img);
        }
        const label = document.createElement('span');
        label.textContent = item.label;
        const cnt = document.createElement('span');
        cnt.className = 'cnt';
        b.append(label, cnt);
        b.addEventListener('click', () => toggleFilter(g, item.key));
        b.addEventListener('dblclick', () => soloFilter(g, item.key));
        box.append(b);
      }
    }
    document.querySelectorAll('[data-all]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.off[btn.dataset.all] = [];
        filtersChanged();
      });
    });
  }

  function toggleFilter(g, key) {
    const off = state.off[g];
    const idx = off.indexOf(key);
    if (idx >= 0) off.splice(idx, 1);
    else off.push(key);
    filtersChanged();
  }

  function soloFilter(g, key) {
    state.off[g] = GROUPS[g].list.map((x) => x.key).filter((k) => k !== key);
    filtersChanged();
  }

  function filtersChanged() {
    save();
    renderFilters();
    syncControls();
  }

  function renderFilters() {
    for (const g of GROUP_KEYS) {
      const counts = new Map();
      for (const t of ITEMS) {
        if (!matches(t, g)) continue;
        const v = GROUPS[g].value(t);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      $(GROUPS[g].el).querySelectorAll('.chip-btn').forEach((b) => {
        b.setAttribute('aria-pressed', String(!state.off[g].includes(b.dataset.key)));
        b.querySelector('.cnt').textContent = fmt(counts.get(b.dataset.key) || 0);
      });
    }
    renderPool();
  }

  function renderPool() {
    const pool = getPool();
    const n = fresh(pool).length;
    const used = pool.length - n;
    $('poolCount').textContent = fmt(n);
    $('poolCountMini').textContent = fmt(n);
    $('poolCard').classList.toggle('zero', n === 0);

    const note = $('poolNote');
    note.hidden = !state.opts.noRepeat;
    note.textContent = used ? `중복 없이 뽑는 중 · 이미 나온 ${fmt(used)}개 제외` : '중복 없이 뽑는 중';

    let msg = '';
    if (!pool.length) msg = '조건에 맞는 보물이 없어요. 필터를 켜 주세요.';
    else if (!n) msg = MSG_ALL_SEEN;
    else if (n < SLOT_COUNT) {
      msg = used ? `남은 보물이 ${fmt(n)}개뿐이에요.` : `후보가 ${SLOT_COUNT}개보다 적어서 일부 칸은 비어 있게 돼요.`;
    }
    const warn = $('poolWarn');
    warn.hidden = !msg;
    warn.textContent = msg;
  }

  /* ------------------------------------------------------------------ *
   * 버튼 상태 / 리롤 카운터
   * ------------------------------------------------------------------ */
  function syncControls() {
    const pool = getPool();
    const avail = fresh(pool).length;
    const left = limitLeft();
    const anyBusy = busy.size > 0;
    const anyFilled = state.slots.some((v) => v !== null);

    const noReroll = state.opts.limit === 0;
    slotEls.forEach((s, i) => {
      const filled = state.slots[i] !== null;
      const out = filled && left === 0;
      const word = noReroll ? '리롤 불가' : out ? '리롤 끝' : '리롤';
      s.btn.innerHTML = filled ? `${ICON_REROLL}<span>${word}</span>` : `${ICON_PICK}<span>이 칸 뽑기</span>`;
      s.btn.classList.toggle('first', !filled);
      s.btn.disabled = anyBusy || out || avail === 0;
      s.btn.title = !filled
        ? `${i + 1}번 칸 뽑기 (단축키 ${i + 1})`
        : noReroll
          ? '리롤 불가로 정해 뒀어요'
          : out
            ? '리롤 횟수를 다 썼어요'
            : `${i + 1}번 칸 리롤 (단축키 ${i + 1})`;
    });

    $('rollAll').disabled = anyBusy || avail === 0;
    $('rollAllLabel').textContent = !pool.length
      ? '후보가 없어요'
      : !avail
        ? '남은 보물 없음'
        : anyFilled
          ? `새로 ${SLOT_COUNT}개 뽑기`
          : `보물 ${SLOT_COUNT}개 뽑기`;
    $('copyResult').disabled = !anyFilled;
    $('clearSlots').disabled = anyBusy || (!anyFilled && !(state.opts.noRepeat && state.seen.size));

    $('rerollUsed').textContent = String(state.rerolls);
    const leftEl = $('rerollLeft');
    if (state.opts.limit === null) {
      leftEl.textContent = '';
      leftEl.classList.remove('out');
    } else {
      leftEl.innerHTML = noReroll ? '리롤 불가' : left > 0 ? `남은<span class="hide-sm"> 리롤</span> ${left}회` : '리롤 끝';
      leftEl.classList.toggle('out', left === 0);
    }
  }

  /* ------------------------------------------------------------------ *
   * 옵션 · 버튼 · 단축키
   * ------------------------------------------------------------------ */
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function bindSwitch(id, key, onChange) {
    const input = $(id);
    input.checked = state.opts[key];
    input.addEventListener('change', () => {
      state.opts[key] = input.checked;
      if (onChange) onChange(input.checked);
      save();
    });
  }

  // 리롤 횟수: 횟수 지정(직접 입력) · 무제한 · 리롤 불가
  function bindLimit() {
    const radios = [...document.querySelectorAll('input[name="limitMode"]')];
    const row = $('limitCountRow');
    const input = $('limitCount');
    const minus = row.querySelector('[data-step="-1"]');
    const plus = row.querySelector('[data-step="1"]');
    input.max = String(MAX_REROLLS);
    const mode = () => (state.opts.limit === null ? 'unlimited' : state.opts.limit === 0 ? 'none' : 'count');

    const syncSteps = () => {
      minus.disabled = state.opts.count <= 1;
      plus.disabled = state.opts.count >= MAX_REROLLS;
    };
    const show = () => {
      radios.forEach((r) => {
        r.checked = r.value === mode();
      });
      row.hidden = mode() !== 'count';
      input.value = String(state.opts.count);
      syncSteps();
    };
    const apply = () => {
      save();
      show();
      syncControls();
    };
    const setCount = (n) => {
      if (Number.isFinite(n)) state.opts.count = Math.min(MAX_REROLLS, Math.max(1, Math.round(n)));
      state.opts.limit = state.opts.count;
      apply();
    };

    radios.forEach((r) =>
      r.addEventListener('change', () => {
        state.opts.limit = r.value === 'unlimited' ? null : r.value === 'none' ? 0 : state.opts.count;
        apply();
      }),
    );
    // 입력하는 동안에는 1~99 사이 숫자일 때만 바로 반영하고, 칸을 벗어나면 범위에 맞춰 정리해요
    input.addEventListener('input', () => {
      const n = Number(input.value);
      if (!Number.isInteger(n) || n < 1 || n > MAX_REROLLS) return;
      state.opts.count = n;
      state.opts.limit = n;
      save();
      syncSteps();
      syncControls();
    });
    input.addEventListener('change', () => setCount(parseInt(input.value, 10)));
    minus.addEventListener('click', () => setCount(state.opts.count - 1));
    plus.addEventListener('click', () => setCount(state.opts.count + 1));
    show();
  }

  function bindOptions() {
    bindLimit();
    bindSwitch('optNoRepeat', 'noRepeat', (on) => {
      // 켜는 순간 화면에 있는 보물부터 "나온 보물"로 셈
      state.seen = new Set(on ? state.slots.filter((v) => v !== null) : []);
      renderPool();
      syncControls();
      toast(on ? '이제 한 번 나온 보물은 초기화 전까지 다시 안 나와요.' : '이미 나온 보물도 다시 나올 수 있어요.');
    });
    bindSwitch('optFamily', 'family');
    bindSwitch('optAnim', 'anim');
  }

  function bindUI() {
    $('rollAll').addEventListener('click', rollAll);
    $('clearSlots').addEventListener('click', clearSlots);
    $('copyResult').addEventListener('click', copyResult);

    const toggle = $('filterToggle');
    toggle.addEventListener('click', () => {
      const open = $('sidebar').classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      // 글자를 입력하는 칸에서는 단축키 끄기 (스위치·선택 버튼에 포커스가 있을 때는 그대로)
      const el = e.target;
      const typing =
        el &&
        (el.isContentEditable ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(el.type)));
      if (typing) return;
      if (e.code === 'KeyR') {
        e.preventDefault();
        rollAll();
        return;
      }
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m && Number(m[1]) <= SLOT_COUNT) {
        e.preventDefault();
        rerollSlot(Number(m[1]) - 1);
      }
    });
  }

  function renderHintKeys() {
    const box = $('hintKeys');
    if (!box) return;
    box.replaceChildren();
    for (let i = 1; i <= SLOT_COUNT; i++) {
      if (i > 1) box.append(' ');
      const k = document.createElement('kbd');
      k.textContent = String(i);
      box.append(k);
    }
  }

  function renderAll() {
    renderFilters();
    for (let i = 0; i < SLOT_COUNT; i++) renderSlot(i);
    syncControls();
  }

  function warmUp() {
    const pool = getPool();
    const source = pool.length >= 8 ? pool : ITEMS;
    for (let n = 0; n < 32; n++) preload(pickOne(source));
  }

  /* ------------------------------------------------------------------ *
   * 시작
   * ------------------------------------------------------------------ */
  try {
    localStorage.removeItem('treasure-roll:v1'); // 예전 버전(리롤 기록 있던 때) 저장값 정리
  } catch {
    /* 무시 */
  }
  $('totalCount').textContent = fmt(ITEMS.length);
  $('dataDate').textContent = (DATA.updated || '').replace(/-/g, '.');
  renderHintKeys();
  buildSlots();
  buildFilters();
  bindOptions();
  bindUI();
  renderAll();
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 400)))(warmUp);
})();
