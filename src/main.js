'use strict';
(() => {
  const canvas = document.getElementById('game');
  const hudCanvas = document.getElementById('hud');
  const $ = s => document.querySelector(s);

  const store = {
    get(k, d) { try { const v = localStorage.getItem('lumen3d:' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('lumen3d:' + k, v); } catch (e) { /* без сохранения */ } },
  };

  let playerLook;
  try { playerLook = JSON.parse(store.get('look', 'null')); } catch (e) { playerLook = null; }
  if (!playerLook || !playerLook.colors) playerLook = cloneLook(LOOK_PRESETS.keeper);
  let botLook = randomLook();
  let playerColor = store.get('color', CFG.BLADE_COLORS[0]);
  if (!/^#[0-9a-f]{6}$/i.test(playerColor)) playerColor = CFG.BLADE_COLORS[0];
  let lastLevel = 'normal';
  let arenaId = ARENAS[store.get('arena', 'circle')] ? store.get('arena', 'circle') : 'circle';

  const audio = new AudioFX();
  const music = new Music(audio);
  try { Object.assign(audio.vol, JSON.parse(store.get('vol', '{}'))); } catch (e) { /* по умолчанию */ }
  document.querySelectorAll('[data-vol]').forEach(r => {
    r.value = audio.vol[r.dataset.vol];
    r.addEventListener('input', () => { audio.setVolumes({ [r.dataset.vol]: +r.value }); store.set('vol', JSON.stringify(audio.vol)); });
  });
  const game = new Game(null, audio);
  const player = new PlayerController(canvas);
  player.flickPx = +store.get('flick', 8);
  let view = null, hud = null;

  const open = id => $(id).classList.add('visible');
  const close = id => $(id).classList.remove('visible');
  const playing = () => game.isPlay && !game.paused && game.state !== 'matchEnd';
  const rivalColor = c => (c === '#ff4058' ? '#3fb8ff' : '#ff4058');

  // Сборка персонажей занимает около секунды: показываем экран и даём ему отрисоваться
  function withLoading(text, fn) {
    $('#loading-text').textContent = text;
    open('#loading');
    // Ждём отрисовки экрана загрузки; в свёрнутой вкладке кадров нет — тогда по таймеру
    let done = false;
    const go = () => { if (done) return; done = true; try { fn(); } finally { close('#loading'); } };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 150);
  }

  function lockPointer() {
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* не критично */ }
  }

  function applyArenaButtons() {
    document.querySelectorAll('[data-arena]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.arena === arenaId)));
  }
  document.querySelectorAll('[data-arena]').forEach(b => b.addEventListener('click', () => {
    arenaId = b.dataset.arena; store.set('arena', arenaId); applyArenaButtons();
    if (view && game.mode === 'demo') { view.world.setArena(arenaId); startDemo(); }
  }));

  function applyColors() {
    document.documentElement.style.setProperty('--accent', playerColor);
    if (view) view.setColors();
  }

  function startDemo() {
    game.localIdx = 0;
    if (ARENA.id !== arenaId) view.world.setArena(arenaId);
    view.setLooks([playerLook, botLook]);
    const [a, b] = game.fighters;
    a.name = 'Демо'; a.color = playerColor; a.style = playerLook.style || 'niman'; a.weapon = playerLook.weapon || 'single';
    b.name = 'Демо'; b.color = rivalColor(playerColor); b.style = botLook.style || 'niman'; b.weapon = botLook.weapon || 'single';
    view.setColors();
    game.startMatch('demo', [new BotController('hard'), new BotController('normal')]);
    view.chars.forEach(c => c.resetCloth());
    document.body.classList.remove('playing');
  }

  function startVsBot(level) {
    lastLevel = level;
    botLook = randomLook();
    withLoading('Готовим соперника…', () => {
      const [a, b] = game.fighters;
      a.name = 'Ты'; a.color = playerColor; a.style = playerLook.style || 'niman'; a.weapon = playerLook.weapon || 'single';
      b.name = BOT_LEVELS[level].title; b.color = rivalColor(playerColor); b.style = botLook.style || 'niman'; b.weapon = botLook.weapon || 'single';
      game.localIdx = 0;
      view.world.setArena(arenaId);
      view.setLooks([playerLook, botLook]);
      view.setColors();
      player.reset(); player.lockOn = false; player.yaw = ARENA.spawns[0].yaw; player.pitch = 0;
      game.startMatch('bot', [player, new BotController(level)]);
      view.chars.forEach(c => c.resetCloth());
      ['#menu', '#pause', '#result', '#controls', '#custom'].forEach(close);
      document.body.classList.add('playing');
      if (document.activeElement) document.activeElement.blur();
      lockPointer();
      const t = $('#toast');
      t.classList.add('show');
      clearTimeout(startVsBot.tt);
      startVsBot.tt = setTimeout(() => t.classList.remove('show'), 7000);
    });
  }

  function setPaused(p) {
    if (!game.isPlay || game.state === 'matchEnd') return;
    game.paused = p;   // в онлайне бой не останавливается: просто перестаём передавать ввод
    $('#pause-title').textContent = game.mode === 'online' ? 'Меню (бой идёт)' : 'Пауза';
    $('[data-action=restart]').classList.toggle('hidden', game.mode === 'online');
    if (p) { open('#pause'); document.body.classList.remove('playing'); if (document.pointerLockElement) document.exitPointerLock(); }
    else { close('#pause'); document.body.classList.add('playing'); player.reset(); lockPointer(); }
  }

  function toMenu() {
    leaveOnline();
    ['#pause', '#result', '#custom', '#online'].forEach(close);
    $('#difficulty').classList.add('hidden');
    $('#main-actions').classList.remove('hidden');
    open('#menu');
    if (document.pointerLockElement) document.exitPointerLock();
    startDemo();
  }

  game.onMatchEnd = w => {
    if (game.mode === 'demo') { startDemo(); return; }
    if (game.mode === 'online') return;   // в онлайне итог проверяется в цикле (из-за перемотки)
    $('#result-title').textContent = w === 0 ? 'Победа' : 'Поражение';
    $('#result-score').textContent = `${game.scores[0]} : ${game.scores[1]}`;
    document.body.classList.remove('playing');
    if (document.pointerLockElement) document.exitPointerLock();
    open('#result');
  };

  // ---------- Кастомизация ----------
  function openCustom() {
    close('#menu');
    game.localIdx = 0;
    game.mode = 'preview'; game.state = 'idle'; game.controllers = [null, null];
    const f = game.fighters[0];
    f.reset(0, 0, 0); f.ignite = 1; f.stance = DIR.RIGHT; f.color = playerColor; f.style = playerLook.style || 'niman'; f.weapon = playerLook.weapon || 'single';
    view.setColors();
    view.chars[0].resetCloth();
    renderCustom();
    open('#custom');
  }

  let rebuildT = 0;
  function changeLook(mut, geometry = true) {
    mut(playerLook);
    store.set('look', JSON.stringify(playerLook));
    renderCustom();
    if (!geometry) { view.setLook(0, playerLook); return; }
    clearTimeout(rebuildT);
    rebuildT = setTimeout(() => withLoading('Обновляем персонажа…', () => { view.setLook(0, playerLook); view.chars[0].resetCloth(); }), 250);
  }

  const seg = (label, opts, value, onPick) => {
    const w = document.createElement('div'); w.className = 'field';
    w.innerHTML = `<span class="field-label">${label}</span>`;
    const row = document.createElement('div'); row.className = 'seg';
    for (const [v, t] of opts) {
      const b = document.createElement('button');
      b.className = 'seg-btn'; b.textContent = t; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === value));
      b.addEventListener('click', () => onPick(v));
      row.appendChild(b);
    }
    w.appendChild(row);
    return w;
  };
  const swatches = (label, colors, value, onPick) => {
    const w = document.createElement('div'); w.className = 'field';
    w.innerHTML = `<span class="field-label">${label}</span>`;
    const row = document.createElement('div'); row.className = 'swatches';
    for (const c of colors) {
      const b = document.createElement('button');
      b.className = 'swatch'; b.style.background = c; b.style.color = c;
      b.setAttribute('aria-label', c); b.setAttribute('aria-checked', String(c === value));
      b.addEventListener('click', () => onPick(c));
      row.appendChild(b);
    }
    w.appendChild(row);
    return w;
  };
  const range = (label, value, onSet) => {
    const w = document.createElement('label'); w.className = 'field';
    w.innerHTML = `<span class="field-label">${label}</span>`;
    const r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.05; r.value = value;
    r.addEventListener('change', () => onSet(+r.value));
    w.appendChild(r);
    return w;
  };
  const colorInput = (label, value, onSet) => {
    const w = document.createElement('label'); w.className = 'color-field';
    const i = document.createElement('input'); i.type = 'color'; i.value = value;
    i.addEventListener('input', () => onSet(i.value));
    w.appendChild(i);
    w.appendChild(Object.assign(document.createElement('span'), { textContent: label }));
    return w;
  };

  let customTab = 'body';
  function renderCustom() {
    const L = playerLook, P = $('#custom-fields');
    P.innerHTML = '';
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === customTab)));
    const presets = document.createElement('div'); presets.className = 'presets';
    for (const [k, p] of Object.entries(LOOK_PRESETS)) {
      const b = document.createElement('button'); b.className = 'preset'; b.textContent = p.name;
      b.addEventListener('click', () => changeLook(l => Object.assign(l, cloneLook(p))));
      presets.appendChild(b);
    }
    if (customTab === 'body') {
      P.append(
        presets,
        seg('Телосложение', [['m', 'Мужское'], ['f', 'Женское']], L.sex, v => changeLook(l => { l.sex = v; if (v === 'f') l.beard = 'none'; })),
        range('Рост', L.height, v => changeLook(l => { l.height = v; })),
        range('Комплекция', L.build, v => changeLook(l => { l.build = v; })),
        swatches('Кожа', SKIN_TONES, L.skin, c => changeLook(l => { l.skin = c; })),
      );
    } else if (customTab === 'head') {
      P.append(
        seg('Лицо', [[0, 'Первое'], [1, 'Второе'], [2, 'Третье']], L.face, v => changeLook(l => { l.face = v; })),
        swatches('Глаза', EYE_COLORS, L.eyes, c => changeLook(l => { l.eyes = c; })),
        seg('Причёска', [['short', 'Короткая'], ['slick', 'Зачёс'], ['pony', 'Хвост'], ['long', 'Длинные'], ['bald', 'Без волос']], L.hair, v => changeLook(l => { l.hair = v; })),
        swatches('Цвет волос', HAIR_COLORS, L.hairColor, c => changeLook(l => { l.hairColor = c; })),
      );
      if (L.sex === 'm') P.append(seg('Борода', [['none', 'Нет'], ['stubble', 'Щетина'], ['full', 'Борода']], L.beard, v => changeLook(l => { l.beard = v; })));
    } else if (customTab === 'style') {
      const list = document.createElement('div'); list.className = 'style-list';
      for (const id of STYLE_IDS) {
        const S = STYLES[id], b = document.createElement('button');
        b.className = 'style-card'; b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String((L.style || 'niman') === id));
        b.innerHTML = `<b>${styleTitle(id)}</b><span>${S.desc}</span>`;
        b.addEventListener('click', () => changeLook(l => { l.style = id; game.fighters[0].style = id; }, false));
        list.appendChild(b);
      }
      P.append(list);
    } else if (customTab === 'blade') {
      const pick = c => {
        playerColor = c; store.set('color', c);
        game.fighters[0].color = c; game.fighters[1].color = rivalColor(c);
        applyColors(); renderCustom();
      };
      P.append(seg('Оружие', WEAPON_IDS.map(id => [id, WEAPONS[id].name]), L.weapon || 'single', v => changeLook(l => { l.weapon = v; game.fighters[0].weapon = v; }, false)));
      const wd = document.createElement('p'); wd.className = 'hint-text small';
      const W0 = WEAPONS[L.weapon || 'single'];
      wd.textContent = W0.desc + (W0.best.includes(L.style || 'niman') ? ' Для твоей формы это оружие родное: выносливость тратится меньше, урон выше.' : '');
      P.append(wd);
      P.append(swatches('Цвет клинка', CFG.BLADE_COLORS, playerColor, pick));
      const own = colorInput('Свой цвет', playerColor, c => { playerColor = c; store.set('color', c); game.fighters[0].color = c; applyColors(); });
      const w = document.createElement('div'); w.className = 'field'; w.appendChild(own);
      P.append(w);
    } else {
      P.append(
        seg('Верх', [['tunic', 'Туника'], ['vest', 'Безрукавка']], L.top, v => changeLook(l => { l.top = v; })),
        seg('Верхняя одежда', [['none', 'Нет'], ['robe', 'Мантия'], ['cape', 'Плащ']], L.outer, v => changeLook(l => { l.outer = v; })),
        seg('Полы туники', [[true, 'Есть'], [false, 'Нет']], L.tails, v => changeLook(l => { l.tails = v; })),
        seg('Кушак', [[true, 'Есть'], [false, 'Нет']], L.sash, v => changeLook(l => { l.sash = v; })),
        seg('Обмотки', [[true, 'Есть'], [false, 'Нет']], L.wraps, v => changeLook(l => { l.wraps = v; })),
        seg('Броня', [['none', 'Нет'], ['light', 'Лёгкая']], L.armor, v => changeLook(l => { l.armor = v; })),
      );
      const cw = document.createElement('div'); cw.className = 'field';
      cw.innerHTML = '<span class="field-label">Цвета</span>';
      const grid = document.createElement('div'); grid.className = 'color-grid';
      for (const [k, t] of [['tunic', 'Туника'], ['under', 'Рубаха'], ['sash', 'Кушак'], ['belt', 'Ремень'], ['trousers', 'Штаны'], ['boots', 'Сапоги'], ['outer', 'Мантия, плащ'], ['armor', 'Броня']]) {
        grid.appendChild(colorInput(t, L.colors[k], v => changeLook(l => { l.colors[k] = v; }, false)));
      }
      cw.appendChild(grid);
      P.append(cw);
    }
  }
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { customTab = b.dataset.tab; renderCustom(); }));

  // Вращение превью мышью
  let dragX = null;
  canvas.addEventListener('pointerdown', e => { if (game.mode === 'preview') dragX = e.clientX; });
  addEventListener('pointerup', () => { dragX = null; });
  addEventListener('pointermove', e => { if (dragX !== null && view) { view.previewAng -= (e.clientX - dragX) * 0.01; dragX = e.clientX; } });
  canvas.addEventListener('wheel', e => { if (game.mode === 'preview' && view) view.previewZoom = clamp(view.previewZoom + e.deltaY * 0.001, 0.45, 1.6); }, { passive: true });


  // ---------- Онлайн ----------
  const net = { link: null, role: null, session: null, remote: null, meReady: false, themReady: false, meRematch: false, themRematch: false, resultShown: false, inMatch: false };
  const netStatus = t => { $('#net-status').textContent = t; };
  const netName = () => ($('#net-name').value.trim() || 'Игрок').slice(0, 16);
  $('#net-name').value = store.get('name', '');
  $('#net-name').addEventListener('change', () => store.set('name', netName()));

  function openOnline(code) {
    close('#menu');
    const turn = loadCustomTurn();
    $('#turn-urls').value = turn ? turn.urls : ''; $('#turn-user').value = turn ? turn.username || '' : ''; $('#turn-pass').value = turn ? turn.credential || '' : '';
    $('#net-choose').classList.remove('hidden');
    $('#net-room').classList.add('hidden');
    netStatus(location.protocol === 'file:' ? 'Совет: для игры с другом открой сайт с Vercel — ссылка на файл с твоего диска у друга не откроется.' : '');
    if (code) $('#net-code').value = code;
    open('#online');
  }

  function newLink() {
    leaveOnline();
    if (typeof Peer === 'undefined') { netStatus('Не загрузилась библиотека соединения (lib/peerjs.min.js).'); return null; }
    net.link = new OnlineLink({
      onOpen: () => { netStatus('Соединено. Обмениваемся персонажами…'); net.link.send({ t: 'hello', look: playerLook, color: playerColor, name: netName(), v: 1 }); },
      onMessage: m => onNetMessage(m),
      onClose: () => disconnected('Соперник отключился.'),
      onStatus: netStatus,
      onError: text => { netStatus(text); if (net.inMatch) disconnected(text); },
    });
    return net.link;
  }

  function netHost() {
    const link = newLink(); if (!link) return;
    net.role = 'host';
    const code = makeRoomCode();
    link.host(code);
    $('#net-choose').classList.add('hidden');
    $('#net-room').classList.remove('hidden');
    $('#net-code-big').textContent = code;
    $('#net-link').value = location.origin + location.pathname + '#room=' + code;
    netStatus('Создаём комнату…');
  }

  function netJoin(code) {
    code = (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { netStatus('Код комнаты — пять символов.'); return; }
    const link = newLink(); if (!link) return;
    net.role = 'guest';
    link.join(code);
    netStatus('Подключаемся…');
  }

  function copyLink() {
    const i = $('#net-link');
    i.select();
    (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(() => netStatus('Ссылка скопирована. Ждём соперника…'), () => { document.execCommand('copy'); netStatus('Ссылка скопирована. Ждём соперника…'); });
  }

  function onNetMessage(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'hello': {
        net.remote = { look: m.look, color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#ff4058', name: String(m.name || 'Соперник').slice(0, 16) };
        withLoading('Готовим бой…', () => {
          prepareOnlineFighters();
          net.meReady = true;
          net.link.send({ t: 'ready' });
          if (net.role === 'host' && net.themReady) startOnline();
          else netStatus('Ждём, пока соперник загрузит персонажей…');
        });
        break;
      }
      case 'ready': net.themReady = true; if (net.role === 'host' && net.meReady) startOnline(); break;
      case 'start': if (net.role === 'guest') beginSession(m.sid, m.seed, m.arena); break;
      case 'rematch': net.themRematch = true; $('#rematch-note').textContent = 'Соперник хочет реванш'; if (net.role === 'host' && net.meRematch) startOnline(); break;
      case 'bye': disconnected('Соперник вышел из боя.'); break;
      default: if (net.session) net.session.onMessage(m);
    }
  }

  function prepareOnlineFighters() {
    const li = net.role === 'host' ? 0 : 1;
    game.localIdx = li;
    const looks = [], me = game.fighters[li], them = game.fighters[1 - li];
    looks[li] = playerLook; looks[1 - li] = net.remote.look && net.remote.look.colors ? net.remote.look : randomLook();
    me.name = netName(); me.color = playerColor; me.style = playerLook.style || 'niman'; me.weapon = playerLook.weapon || 'single';
    them.name = net.remote.name; them.color = net.remote.color;
    them.style = net.remote.look && STYLES[net.remote.look.style] ? net.remote.look.style : 'niman';
    them.weapon = net.remote.look && WEAPONS[net.remote.look.weapon] ? net.remote.look.weapon : 'single';
    view.setLooks(looks);
    view.setColors();
  }

  function startOnline() {
    const sid = (Math.random() * 1e9) | 0, seed = (Math.random() * 1e9) | 0;
    net.link.send({ t: 'start', sid, seed, arena: arenaId });
    beginSession(sid, seed, arenaId);
  }

  function beginSession(sid, seed, arena) {
    const li = game.localIdx;
    view.world.setArena(ARENAS[arena] ? arena : 'circle');
    net.meRematch = net.themRematch = false; net.resultShown = false; net.inMatch = true;
    game.startMatch('online', [null, null]);
    game.rngS = seed;
    net.session = new NetSession(game, {
      role: net.role, sid, send: m => net.link.send(m),
      sampleLocal: () => (game.paused ? {} : player.getInput(game.fighters[li], game.fighters[1 - li], game, CFG.DT)),
    });
    player.reset(); player.lockOn = false; player.yaw = ARENA.spawns[li].yaw; player.pitch = 0;
    view.chars.forEach(c => c.resetCloth());
    ['#menu', '#pause', '#result', '#controls', '#custom', '#online'].forEach(close);
    document.body.classList.add('playing');
    if (document.activeElement) document.activeElement.blur();
    lockPointer();
    $('#toast').classList.add('show');
    setTimeout(() => $('#toast').classList.remove('show'), 6000);
  }

  function requestRematch() {
    net.meRematch = true;
    net.link.send({ t: 'rematch' });
    $('#rematch-note').textContent = net.themRematch ? 'Начинаем…' : 'Ждём ответа соперника…';
    if (net.role === 'host' && net.themRematch) startOnline();
  }

  function onlineFrame() {
    const S = net.session;
    if (!S) return;
    if (S.timedOut) { disconnected('Связь с соперником потеряна.'); return; }
    hud.netInfo = { ping: S.ping };
    if (game.state === 'matchEnd' && !net.resultShown) {
      net.resultShown = true;
      const li = game.localIdx, won = game.scores[li] > game.scores[1 - li];
      $('#result-title').textContent = won ? 'Победа' : 'Поражение';
      $('#result-score').textContent = `${game.scores[li]} : ${game.scores[1 - li]}`;
      $('#rematch-note').textContent = '';
      document.body.classList.remove('playing');
      if (document.pointerLockElement) document.exitPointerLock();
      open('#result');
    }
  }

  function disconnected(text) {
    const wasInMatch = net.inMatch;
    leaveOnline(true);
    if (wasInMatch) {
      $('#result-title').textContent = 'Бой прерван';
      $('#result-score').textContent = '';
      $('#rematch-note').textContent = text;
      $('[data-action=rematch]').classList.add('hidden');
      document.body.classList.remove('playing');
      if (document.pointerLockElement) document.exitPointerLock();
      close('#pause');
      open('#result');
      game.mode = 'none';
    } else netStatus(text);
  }

  function leaveOnline(silent) {
    if (net.link) { if (!silent) net.link.send({ t: 'bye' }); net.link.close(); }
    Object.assign(net, { link: null, session: null, remote: null, meReady: false, themReady: false, meRematch: false, themRematch: false, inMatch: false });
    $('[data-action=rematch]').classList.remove('hidden');
    if (hud) hud.netInfo = null;
  }
  addEventListener('beforeunload', () => leaveOnline());

  // В свёрнутой вкладке браузер перестаёт присылать кадры отрисовки. Чтобы соперник не ждал,
  // онлайн-бой продолжает считаться по таймеру из Web Worker (его браузер почти не замедляет).
  let bgLast = performance.now();
  try {
    const src = 'setInterval(() => postMessage(0), 16);';
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = () => {
      const now = performance.now(), dt = Math.min(0.1, (now - bgLast) / 1000);
      bgLast = now;
      if (document.hidden && game.mode === 'online' && net.session) { net.session.tick(dt); game.visualTick(dt); onlineFrame(); }
    };
  } catch (e) { /* без воркера: в фоне бой встанет, но соединение не порвётся сразу */ }
  document.addEventListener('visibilitychange', () => { bgLast = performance.now(); if (document.hidden && playing()) setPaused(true); });

  // ---------- Меню ----------
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && playing()) setPaused(true); });
  canvas.addEventListener('click', () => { if (playing() && !document.pointerLockElement) lockPointer(); });

  const flick = $('#flick');
  flick.value = player.flickPx;
  $('#flick-value').textContent = `${player.flickPx} пикс.`;
  flick.addEventListener('input', () => {
    player.flickPx = +flick.value; store.set('flick', flick.value);
    $('#flick-value').textContent = `${flick.value} пикс.`;
  });

  document.addEventListener('click', e => {
    const lvl = e.target.closest('[data-level]');
    if (lvl) { audio.ui(); startVsBot(lvl.dataset.level); return; }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    audio.ui();
    switch (a.dataset.action) {
      case 'vsbot': $('#main-actions').classList.add('hidden'); $('#difficulty').classList.remove('hidden'); break;
      case 'back': $('#difficulty').classList.add('hidden'); $('#main-actions').classList.remove('hidden'); break;
      case 'custom': openCustom(); break;
      case 'custom-done': toMenu(); break;
      case 'controls': open('#controls'); break;
      case 'close': close('#controls'); break;
      case 'resume': setPaused(false); break;
      case 'restart': game.paused = false; startVsBot(lastLevel); break;
      case 'rematch': if (game.mode === 'online') requestRematch(); else startVsBot(lastLevel); break;
      case 'online': openOnline(); break;
      case 'net-host': netHost(); break;
      case 'net-join': netJoin($('#net-code').value); break;
      case 'net-copy': copyLink(); break;
      case 'binds-reset': player.binds = Object.assign({}, DEFAULT_BINDS); store.set('binds', JSON.stringify(player.binds)); renderBinds(); break;
      case 'net-cancel': leaveOnline(); close('#online'); open('#menu'); break;
      case 'turn-save': {
        const urls = $('#turn-urls').value.trim();
        saveCustomTurn(urls ? { urls, username: $('#turn-user').value.trim(), credential: $('#turn-pass').value } : null);
        netStatus(urls ? 'TURN сохранён. Создайте комнату заново.' : 'Свой TURN убран.');
        break;
      }
      case 'tomenu': game.paused = false; toMenu(); break;
    }
  });

  addEventListener('keydown', e => {
    if (e.code === 'Escape') {
      if ($('#controls').classList.contains('visible')) { close('#controls'); return; }
      if (game.paused) setPaused(false);
    }
    if (e.code === 'KeyM') audio.setMuted(!audio.muted);
  });
  addEventListener('pointerdown', () => { audio.init(); music.start(); });
  addEventListener('keydown', () => { audio.init(); music.start(); });
  addEventListener('blur', () => { if (playing()) setPaused(true); });

  // ---------- Настройки ----------
  let quality = ['low', 'medium', 'high'].includes(store.get('quality', 'high')) ? store.get('quality', 'high') : 'high';
  CharGen.detail = { low: 1.6, medium: 1.25, high: 1 }[quality];
  try { Object.assign(player.binds, JSON.parse(store.get('binds', '{}'))); } catch (e) { /* по умолчанию */ }
  const sens = +store.get('sens', 1);
  player.sensLook = 0.0024 * sens;
  $('#sens').value = sens; $('#sens-value').textContent = sens.toFixed(1);
  $('#sens').addEventListener('input', () => { const v = +$('#sens').value; player.sensLook = 0.0024 * v; $('#sens-value').textContent = v.toFixed(1); store.set('sens', v); });
  $('#show-fps').checked = store.get('fps', '0') === '1';
  $('#show-fps').addEventListener('change', () => { store.set('fps', $('#show-fps').checked ? '1' : '0'); if (hud) hud.showFps = $('#show-fps').checked; });

  function applyQualityButtons() { document.querySelectorAll('[data-quality]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.quality === quality))); }
  document.querySelectorAll('[data-quality]').forEach(b => b.addEventListener('click', () => {
    quality = b.dataset.quality; store.set('quality', quality); applyQualityButtons();
    if (view && view.setQuality(quality)) withLoading('Перестраиваем персонажей…', () => { view.setLooks(view.chars.map(c => c.look)); view.setColors(); view.chars.forEach(c => c.resetCloth()); });
  }));
  applyQualityButtons();

  let capturing = null;
  function renderBinds() {
    const box = $('#binds'); box.innerHTML = '';
    for (const a of Object.keys(DEFAULT_BINDS)) {
      box.appendChild(Object.assign(document.createElement('span'), { textContent: BIND_LABELS[a] }));
      const b = document.createElement('button');
      b.className = 'bind-btn' + (capturing === a ? ' waiting' : '');
      b.textContent = capturing === a ? 'Нажми клавишу…' : keyLabel(player.binds[a]);
      b.addEventListener('click', () => { capturing = capturing === a ? null : a; renderBinds(); });
      box.appendChild(b);
    }
  }
  addEventListener('keydown', e => {
    if (!capturing) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.code !== 'Escape') { player.setBind(capturing, e.code); store.set('binds', JSON.stringify(player.binds)); }
    capturing = null; renderBinds();
  }, true);
  renderBinds();

  // ---------- Запуск ----------
  withLoading('Собираем бойцов…', () => {
    view = new View(canvas, game, [playerLook, botLook]);
    view.setQuality(quality);
    game.fx = view.fx;
    view.world.onThunder = () => { if (audio.ctx) audio.thunder(); };
    hud = new HUD(hudCanvas);
    hud.showFps = $('#show-fps').checked;
    player.onStance = () => audio.tick();
    player.onToggle = text => hud.note(text);
    applyColors();
    applyArenaButtons();
    startDemo();
    const m = /room=([A-Za-z0-9]{5})/.exec(location.hash);
    if (m) { openOnline(m[1].toUpperCase()); netJoin(m[1]); history.replaceState(null, '', location.pathname); }
    window.LUMEN = { game, view, player, net };
    let last = performance.now(), prevState = '';
    const frame = now => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      const rawDt = (now - last) / 1000;
      last = now;
      if (rawDt > 0) hud.fps = hud.fps ? lerp(hud.fps, 1 / rawDt, 0.05) : 1 / rawDt;
      if (game.mode === 'online' && net.session) { net.session.tick(dt); game.visualTick(dt); onlineFrame(); }
      else game.advance(dt);
      view.render(dt, player);
      hud.draw(game, view, player, dt);
      if (audio.ctx) {
        const P = game.fighters[game.localIdx], E = game.fighters[1 - game.localIdx], sp = view.bladeSpeeds();
        const vol = game.paused && game.mode !== 'online' ? 0 : game.isPlay ? 1 : 0.3;
        const r = rightOf(P.yaw), dx = E.x - P.x, dz = E.z - P.z, l = Math.hypot(dx, dz) || 1;
        audio.setHum(0, sp[0], P.ignite, 0, vol * 0.8);
        audio.setRain(ARENA.weather === 'rain' ? 0.13 * Math.max(vol, 0.5) : 0);
        // Музыка: накал от ударов и столкновений, тревога при низком здоровье, затишье в клинче
        audio.excite *= Math.exp(-dt / 2.5);
        let target = 0.12, tension = 0;
        if (game.isPlay && game.state === 'fight') {
          target = game.bind ? 0.1 : 0.3 + 0.7 * audio.excite;
          tension = game.fighters.some(f => f.hp < 35 && !f.dead) ? 1 : 0;
        } else if (game.isPlay) target = 0.15;
        if (game.paused && game.mode !== 'online') target *= 0.5;
        music.update(dt, target, tension);
        if (game.isPlay && game.state === 'roundEnd' && prevState === 'fight') {
          const li = game.localIdx; music.stinger(!game.fighters[li].dead);
        }
        prevState = game.state;
        audio.setHum(1, sp[1], game.mode === 'preview' ? 0 : E.ignite, game.isPlay ? (dx * r.x + dz * r.z) / l : 0.3, vol * clamp(3 / l, 0.3, 1));
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
})();
