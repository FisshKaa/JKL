'use strict';
// Rollback-неткод для дуэли 1 на 1.
// Оба браузера считают бой сами и каждый кадр обмениваются только вводом.
// Если ввод соперника пришёл позже, чем мы его «угадали», откатываемся к сохранённому
// кадру и пересчитываем. Хост регулярно сверяет контрольную сумму и при расхождении
// (разные браузеры чуть по-разному считают тригонометрию) присылает точное состояние.
const NET = {
  DELAY: 2,          // задержка своего ввода в кадрах: меньше откатов, почти незаметно (33 мс)
  MAX_ROLLBACK: 18,  // дальше этого не предсказываем — ждём соперника
  REDUNDANCY: 12,    // каждый пакет повторяет последние кадры ввода: потеря пакета не страшна
  SYNC_EVERY: 60,    // сверка раз в секунду
  KEEP: 240,
  TIMEOUT: 6000,
};

const IN_FLAGS = ['attack', 'block', 'feint', 'dodge', 'jump', 'jumpHeld', 'clinch', 'mash', 'lock', 'thrust', 'attackHeld', 'push'];
const EDGE_MASK = 1 | 4 | 8 | 16 | 64 | 128 | 512 | 2048;   // разовые нажатия: при предсказании считаем, что их не было
const NO_YAW = 99999;

function packInput(inp) {
  let flags = 0;
  IN_FLAGS.forEach((k, i) => { if (inp[k]) flags |= 1 << i; });
  const yaw = inp.yaw == null ? NO_YAW : Math.round(wrapAngle(inp.yaw) * 10000);
  return [Math.round(clamp(inp.mx || 0, -1, 1)), Math.round(clamp(inp.mz || 0, -1, 1)), inp.stance == null ? 1 : inp.stance, flags, yaw];
}
function unpackInput(a) {
  if (!a) return {};
  const o = { mx: a[0], mz: a[1], stance: a[2], yaw: a[4] === NO_YAW ? null : a[4] / 10000 };
  IN_FLAGS.forEach((k, i) => { o[k] = !!(a[3] & (1 << i)); });
  return o;
}
const EMPTY_IN = packInput({});
const predictFrom = a => (a ? [a[0], a[1], a[2], a[3] & ~EDGE_MASK, a[4]] : EMPTY_IN);
const sameInput = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4];

class NetSession {
  // role: 'host' | 'guest'; send(msg); sampleLocal() → input; now() → мс
  constructor(game, { role, send, sampleLocal, sid, now }) {
    this.game = game; this.role = role; this.sid = sid;
    this.sendRaw = send; this.sampleLocal = sampleLocal;
    this.now = now || (() => performance.now());
    this.me = role === 'host' ? 0 : 1; this.them = 1 - this.me;
    this.frame = 0; this.acc = 0;
    this.local = new Map(); this.remote = new Map(); this.used = new Map(); this.snaps = new Map();
    this.remoteContig = -1; this.remoteMax = -1; this.theirAdv = 0;
    this.rollbackTo = null;
    this.stats = { rollbacks: 0, maxRollback: 0, stalls: 0, resyncs: 0 };
    this.pendingSyncs = []; this.lastStateReq = -1e9;
    this.ping = 0; this.lastPing = -1e9; this.lastRecv = this.now(); this.ticksSinceRecv = 0;
    this.cur = [{}, {}];
    this.closed = false;
    game.controllers = [0, 1].map(i => ({ getInput: () => this.cur[i] }));
    for (let f = 0; f < NET.DELAY; f++) this.local.set(f, EMPTY_IN);
  }

  send(m) { m.sid = this.sid; this.sendRaw(m); }

  onMessage(m) {
    if (m.sid !== this.sid) return;
    this.lastRecv = this.now(); this.ticksSinceRecv = 0;
    switch (m.t) {
      case 'in': {
        const start = m.f - m.d.length + 1;
        for (let k = 0; k < m.d.length; k++) {
          const fr = start + k;
          if (fr < 0 || this.remote.has(fr)) continue;
          const inp = m.d[k];
          this.remote.set(fr, inp);
          // Уже посчитали этот кадр с догадкой — и не угадали: откат
          if (fr < this.frame && !sameInput(this.used.get(fr), inp)) this.rollbackTo = this.rollbackTo === null ? fr : Math.min(this.rollbackTo, fr);
        }
        while (this.remote.has(this.remoteContig + 1)) this.remoteContig++;
        this.remoteMax = Math.max(this.remoteMax, m.f);
        if (typeof m.adv === 'number') this.theirAdv = m.adv;
        break;
      }
      case 'sync': if (this.role === 'guest') this.pendingSyncs.push(m); break;
      case 'need': if (this.role === 'host') this.sendState(); break;
      case 'state': if (this.role === 'guest') this.applyState(m); break;
      case 'ping': this.send({ t: 'pong', s: m.s }); break;
      case 'pong': this.ping = this.now() - m.s; break;
    }
  }

  // Вызывается каждый кадр отрисовки
  tick(realDt) {
    if (this.closed) return;
    this.ticksSinceRecv++;
    this.acc += realDt;
    // Синхронизация времени: каждый сообщает, насколько он «видит» себя впереди.
    // Пинг одинаково завышает оба числа, поэтому сравниваем их разницу.
    if (this.remoteMax >= 0) {
      const lead = (this.myAdv() - this.theirAdv) / 2;
      if (lead > 1) this.acc -= realDt * Math.min(0.25, lead * 0.04);
    }
    let n = 0;
    while (this.acc >= CFG.DT && n < 6) {
      if (!this.step()) { this.acc = Math.min(this.acc, CFG.DT); break; }
      this.acc -= CFG.DT; n++;
    }
    if (n >= 6) this.acc = 0;
    const t = this.now();
    if (t - this.lastPing > 1000) { this.lastPing = t; this.send({ t: 'ping', s: t }); }
  }

  myAdv() { return this.remoteMax < 0 ? 0 : this.frame - (this.remoteMax - NET.DELAY); }

  // Обрыв — только если мы сами всё это время работали (много тактов), а от соперника тишина.
  // Иначе собственное подвисание (сборка персонажа, свёрнутая вкладка) приняли бы за его уход.
  get timedOut() { return this.now() - this.lastRecv > NET.TIMEOUT && this.ticksSinceRecv > 240; }

  step() {
    const f = this.frame;
    if (f - this.remoteContig > NET.MAX_ROLLBACK) { this.stats.stalls++; return false; }

    // Свой ввод — на DELAY кадров вперёд, отправляем с повтором предыдущих
    this.local.set(f + NET.DELAY, packInput(this.sampleLocal()));
    const from = Math.max(0, f + NET.DELAY - NET.REDUNDANCY + 1), d = [];
    for (let k = from; k <= f + NET.DELAY; k++) d.push(this.local.get(k) || EMPTY_IN);
    this.send({ t: 'in', f: f + NET.DELAY, d, adv: this.myAdv() });

    if (this.rollbackTo !== null) this.resimFrom(this.rollbackTo);
    this.simFrame(f);
    this.frame++;

    if (this.role === 'host' && this.frame % NET.SYNC_EVERY === 0) {
      const c = this.confirmedSnap();
      if (c !== null) this.send({ t: 'sync', f: c, h: this.game.hash(this.snaps.get(c)) });
    }
    if (this.role === 'guest') this.checkSyncs();
    this.cleanup();
    return true;
  }

  // Последний кадр, состояние перед которым посчитано только по настоящему вводу
  confirmedSnap() {
    const c = Math.min(this.frame - 1, this.remoteContig + 1);
    return this.snaps.has(c) ? c : null;
  }

  inputsFor(fr) {
    const mine = this.local.get(fr) || EMPTY_IN;
    let theirs = this.remote.get(fr);
    if (!theirs) {
      let k = Math.min(fr, this.remoteMax);
      while (k >= 0 && !this.remote.has(k) && fr - k < NET.KEEP) k--;
      theirs = predictFrom(this.remote.get(k));
    }
    this.used.set(fr, theirs);
    return [mine, theirs];
  }

  simFrame(fr) {
    this.snaps.set(fr, this.game.saveState());
    const [mine, theirs] = this.inputsFor(fr);
    this.cur[this.me] = unpackInput(mine);
    this.cur[this.them] = unpackInput(theirs);
    this.game.step(CFG.DT);
  }

  resimFrom(fr) {
    const snap = this.snaps.get(fr);
    this.rollbackTo = null;
    if (!snap) return;
    const g = this.game, fx = g.fx, au = g.audio;
    g.fx = NOOP; g.audio = NOOP; g.silent = true;
    g.loadState(snap);
    for (let k = fr; k < this.frame; k++) this.simFrame(k);
    g.fx = fx; g.audio = au; g.silent = false;
    this.stats.rollbacks++;
    this.stats.maxRollback = Math.max(this.stats.maxRollback, this.frame - fr);
  }

  checkSyncs() {
    const c = this.confirmedSnap();
    this.pendingSyncs = this.pendingSyncs.filter(m => {
      if (c === null || m.f > c) return m.f > this.frame - NET.KEEP;   // ещё не можем проверить
      const snap = this.snaps.get(m.f);
      if (snap && this.game.hash(snap) !== m.h && this.now() - this.lastStateReq > 500) {
        this.lastStateReq = this.now();
        this.send({ t: 'need' });
      }
      return false;
    });
  }

  sendState() {
    const c = this.confirmedSnap();
    if (c !== null) this.send({ t: 'state', f: c, s: Game.packState(this.snaps.get(c)) });
  }

  applyState(m) {
    if (m.f >= this.frame || !this.snaps.has(m.f)) return;
    this.snaps.set(m.f, Game.unpackState(m.s));
    this.rollbackTo = this.rollbackTo === null ? m.f : Math.min(this.rollbackTo, m.f);
    this.stats.resyncs++;
  }

  cleanup() {
    const old = this.frame - NET.KEEP;
    for (const M of [this.local, this.remote, this.used, this.snaps]) {
      for (const k of M.keys()) if (k < old) M.delete(k);
    }
  }
}
