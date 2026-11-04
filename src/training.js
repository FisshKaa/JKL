'use strict';
// Тренировочная комната: манекен с разными поведениями и витрина фигур, показывающих приёмы.

// Приёмы, которые умеет показывать манекен (и витрина). name — подпись на кнопке.
const TRAIN_MOVES = [
  ['atk0', 'Удар сверху'], ['atk1', 'Удар справа'], ['atk4', 'Удар слева'], ['atk2', 'Снизу справа'], ['atk3', 'Снизу слева'],
  ['combo', 'Связка из трёх'], ['heavy', 'Тяжёлый удар'], ['thrust', 'Укол'],
  ['block0', 'Блок сверху'], ['block1', 'Блок справа'], ['block4', 'Блок слева'],
  ['flourish', 'Вращение клинка'], ['dodgeL', 'Уклонение влево'], ['dodgeR', 'Уклонение вправо'], ['dodgeB', 'Уклонение назад'],
  ['flip', 'Сальто'], ['dive', 'Удар в прыжке'], ['kick', 'Пинок'], ['push', 'Толчок'],
];
const TRAIN_CYCLE = TRAIN_MOVES.map(m => m[0]);

// Сценарий приёма как последовательность нажатий: [время от начала, ввод, сколько держать]
function moveScript(id) {
  const atk = d => [[0, { stance: d }], [0.05, { stance: d, attack: true }]];
  if (id.startsWith('atk')) return atk(+id.slice(3));
  if (id.startsWith('block')) { const s = +id.slice(5); return [[0, { stance: s, block: true }, 1.0]]; }
  switch (id) {
    case 'combo': return [[0, { stance: 1 }], [0.05, { stance: 1, attack: true }], [0.75, { stance: 4, attack: true }], [1.45, { stance: 0, attack: true }]];
    case 'heavy': return [[0, { stance: 1 }], [0.05, { stance: 1, attack: true, attackHeld: true }], [0.1, { attackHeld: true }, 0.7]];
    case 'thrust': return [[0, { thrust: true }]];
    case 'flourish': return [[0, { flourish: true }]];
    case 'dodgeL': return [[0, { dodge: true, mx: -1 }]];
    case 'dodgeR': return [[0, { dodge: true, mx: 1 }]];
    case 'dodgeB': return [[0, { dodge: true, mz: -1 }]];
    case 'flip': return [[0, { jump: true, jumpHeld: true }], [0.22, { jump: true, jumpHeld: true, mx: 1 }]];
    case 'dive': return [[0, { jump: true, jumpHeld: true }, 0.25], [0.3, { attack: true }]];
    case 'kick': return [[0, { kick: true }]];
    case 'push': return [[0, { push: true }]];
  }
  return [];
}

// Сколько длится приём (чтобы в режиме «по кругу» не налезать друг на друга)
const MOVE_LEN = { combo: 2.4, heavy: 1.6, flourish: 1.8, flip: 1.6, dive: 1.6, block0: 1.3, block1: 1.3, block4: 1.3 };

class DummyController {
  constructor() {
    this.mode = 'still';      // still | block | counter | show | bot
    this.stance = DIR.RIGHT;  // стойка в режиме «стоит»
    this.perfect = false;     // в режиме «блокирует» — всегда мастерский блок
    this.auto = false;        // в режиме «показывает» — повторять по кругу
    this.level = 'normal';
    this.bot = new BotController('normal');
    this.script = []; this.scriptT = 0; this.cd = 0; this.cycleIdx = 0; this.idleT = 0;
  }

  setLevel(l) { this.level = l; this.bot = new BotController(l); }
  play(id) { this.script = moveScript(id); this.scriptT = 0; this.idleT = -(MOVE_LEN[id] || 1.2); }

  getInput(me, opp, game, dt) {
    if (this.mode === 'bot') return this.bot.getInput(me, opp, game, dt);
    const out = { mx: 0, mz: 0, stance: null, attack: false, block: false, lock: true };
    const d = dist2d(me, opp);
    this.cd -= dt;

    if (this.mode === 'still') out.stance = this.stance;

    if (this.mode === 'block') {
      // Читает удар игрока и закрывает нужную сторону
      if ((opp.state === 'windup' || opp.state === 'strike') && opp.attack) {
        const need = mirrorDir(opp.attack.dir);
        out.stance = need === DIR.THRUST ? me.stance : need;
        const impact = opp.state === 'windup' ? opp.dur - opp.stateT : 0;
        out.block = !this.perfect || impact < CFG.PERFECT * 0.6;
        this.holdT = 0.35;
      } else if ((this.holdT -= dt) > 0) out.block = true;
    }

    if (this.mode === 'counter') {
      // Стоит на месте, но бьёт, если подойти на расстояние удара
      if (d < CFG.REACH - 0.1 && me.state === 'idle' && this.cd <= 0) {
        const dir = randInt(5);
        this.script = [[0, { stance: dir }], [0.05, { stance: dir, attack: true }]];
        this.scriptT = 0; this.cd = 1.3;
      }
    }

    if (this.mode === 'show' && this.auto && !this.script.length) {
      this.idleT += dt;
      if (this.idleT > 0.6) { this.play(TRAIN_CYCLE[this.cycleIdx++ % TRAIN_CYCLE.length]); }
    }

    // Выполняем сценарий приёма
    if (this.script.length) {
      this.scriptT += dt;
      let done = true;
      for (const step of this.script) {
        const [at, inp, hold = 0] = step;
        if (this.scriptT >= at && !step.fired) { Object.assign(out, inp); step.fired = true; }
        else if (step.fired && this.scriptT < at + hold) { for (const k in inp) if (k !== 'attack' && k !== 'jump' && k !== 'thrust' && k !== 'flourish' && k !== 'dodge' && k !== 'kick' && k !== 'push') out[k] = inp[k]; }
        if (!step.fired || this.scriptT < at + hold) done = false;
      }
      if (done) this.script = [];
    }
    return out;
  }
}

// ---------- Витрина: фигуры, без остановки показывающие приёмы (только анимация, без физики) ----------
class ShowcaseFigure {
  constructor(f, label) {
    this.f = f; this.label = label;
    this.seq = ['idle', 'atk1', 'atk4', 'atk0', 'combo', 'block', 'heavy', 'thrust', 'flourish', 'dodgeS', 'dodgeB', 'kick', 'push', 'atk2', 'atk3'];
    this.i = Math.floor(Math.random() * this.seq.length); this.t = 0; this.combo = 0; this.now = 0;
    this.start();
  }

  start() {
    const f = this.f, id = this.seq[this.i];
    this.id = id; this.t = 0;
    f.blocking = false; f.state = 'idle'; f.stateT = 0; f.attack = null; f.vx = f.vz = 0;
    const S = styleSim(f);
    const atk = (dir, heavy, combo) => {
      const W = dir === DIR.THRUST ? CFG.THRUST_WINDUP * S.thrust : CFG.WINDUP * S.windup + (heavy ? CFG.HEAVY_EXTRA : 0);
      f.attack = { dir, windup: W, riposte: false, combo, id: Math.random(), swung: true, blocked: false, heavy };
      f.state = 'windup'; f.dur = W;
      this.len = W + CFG.STRIKE + 0.5;
    };
    this.len = 1;
    if (id.startsWith('atk')) atk(+id.slice(3), false, 0);
    else if (id === 'combo') { this.combo = 0; atk(DIR.RIGHT, false, 0); this.len = 99; }
    else if (id === 'heavy') atk(DIR.UP, true, 0);
    else if (id === 'thrust') atk(DIR.THRUST, false, 0);
    else if (id === 'block') { f.blocking = true; f.stance = randInt(5); this.len = 1.1; }
    else if (id === 'flourish') { f.flourishAt = this.now; this.len = flourishOf(f)[1] + 0.3; }
    else if (id === 'dodgeS' || id === 'dodgeB') {
      const r = rightOf(f.yaw), w = fwdOf(f.yaw), sd = Math.random() < 0.5 ? 1 : -1;
      f.state = 'dodge'; f.dur = CFG.DODGE;
      if (id === 'dodgeS') { f.vx = r.x * 3 * sd; f.vz = r.z * 3 * sd; } else { f.vx = -w.x * 3; f.vz = -w.z * 3; }
      this.len = CFG.DODGE + 0.5;
    }
    else if (id === 'kick') { f.state = 'kick'; f.dur = CFG.KICK_TIME; this.len = CFG.KICK_TIME + 0.4; }
    else if (id === 'push') { f.state = 'push'; f.dur = CFG.PUSH_TIME; this.len = CFG.PUSH_TIME + 0.4; }
    else { f.stance = randInt(5); this.len = 0.9; }
  }

  update(dt, now) {
    const f = this.f;
    this.now = now;
    this.t += dt; f.stateT += dt;
    // Переходы состояний удара: замах → удар → откат
    if (f.state === 'windup' && f.stateT >= f.dur) { f.state = 'strike'; f.stateT = 0; f.dur = CFG.STRIKE; }
    else if (f.state === 'strike' && f.stateT >= f.dur) {
      if (this.id === 'combo' && this.combo < 2) {
        this.combo++;
        const dir = [DIR.RIGHT, DIR.LEFT, DIR.UP][this.combo], W = CFG.WINDUP_COMBO * styleSim(f).combo;
        f.attack = { dir, windup: W, riposte: false, combo: this.combo, id: Math.random(), swung: true, blocked: false, heavy: false };
        f.state = 'windup'; f.stateT = 0; f.dur = W;
      } else { f.state = 'recover'; f.stateT = 0; f.dur = 0.4; if (this.id === 'combo') this.len = this.t + 0.5; }
    }
    else if ((f.state === 'recover' || f.state === 'dodge' || f.state === 'kick' || f.state === 'push') && f.stateT >= f.dur) { f.state = 'idle'; f.stateT = 0; f.vx = f.vz = 0; }
    if (this.id === 'block' && Math.abs(this.t - 0.45) < dt) { f.blockFxT = now; f.blockFxPerfect = Math.random() < 0.4; }
    if (this.t >= this.len) { this.i = (this.i + 1) % this.seq.length; this.start(); }
  }
}

// Подпись над фигурой витрины
function labelSprite(text, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,12,30,0.72)';
  g.beginPath(); if (g.roundRect) g.roundRect(8, 8, 496, 112, 24); else g.rect(8, 8, 496, 112); g.fill();
  g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.font = '700 44px Manrope, sans-serif'; g.fillText(text, 256, 58);
  g.fillStyle = '#ffd36b'; g.font = '600 32px Manrope, sans-serif'; g.fillText(sub, 256, 100);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.5, 0.375, 1);
  return sp;
}
