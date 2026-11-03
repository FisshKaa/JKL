'use strict';
// Семь форм боя на световых мечах.
// Названия форм — элементы вселенной Lucasfilm. Для игры с друзьями это нормально; если сайт
// станет публичным или коммерческим, переименуйте их здесь (поля num, name, desc) — больше они нигде не заданы.
//
// sim — множители игровых параметров (1 = как у базовой формы), анимация — pose:
//   home — куда форма «тянет» клинок в стойке, pull — насколько сильно; windScale — размах замаха и проводки;
//   crouch/lean — посадка и наклон корпуса; stance — постановка стоп [пр. x, пр. z, лев. x, лев. z];
//   sway — покачивание клинка в стойке; oneHand — свободная рука за спиной; bounce — пружинит на месте.
const STYLE_SIM_BASE = {
  windup: 1, combo: 1, thrust: 1, stam: 1, dmg: 1, thrustDmg: 1, heavy: 1, riposte: 1, riposteWin: 1, dive: 1,
  block: 1, perfect: 0, blockRegen: 1, speed: 1, jump: 1, flip: 1, push: 1, pushCd: 1, pushForce: 1, kick: 1, feint: 1,
  reach: 0, arc: 0,
};

const STYLES = {
  shii: {
    num: 'I', name: 'Шии-Чо',
    desc: 'Первая и самая простая форма: широкие размашистые удары и крепкая базовая защита. Достаёт дальше и шире остальных, явных слабостей нет.',
    sim: { reach: 0.2, arc: 0.25, dmg: 1.1, windup: 0.95, block: 0.85 },
    pose: { home: P(0.32, -0.25, -0.45, 0.5, 0.55, -0.6), pull: 0.3, windScale: 1.15, crouch: 0.1, lean: 0, stance: [0.15, -0.06, -0.14, 0.1], sway: 0.15 },
    bot: { aggression: 1.05 },
  },
  makashi: {
    num: 'II', name: 'Макаши',
    desc: 'Изящная дуэльная форма: клинок в одной руке, точные быстрые выпады, экономные движения. Сильные уколы и окно мастерского блока шире, но тяжёлые удары слабее.',
    sim: { windup: 0.88, combo: 0.92, thrust: 0.75, thrustDmg: 1.25, dmg: 0.88, heavy: 0.85, perfect: 0.03, stam: 0.9, speed: 1.03 },
    pose: { home: P(0.2, -0.15, -0.52, 0.08, 0.3, -1), pull: 0.45, windScale: 0.7, crouch: 0, lean: 0.06, stance: [0.06, -0.28, -0.06, 0.2], sway: 0.05, oneHand: true },
    bot: { thrust: 2.5, perfect: 1.2 },
  },
  soresu: {
    num: 'III', name: 'Соресу',
    desc: 'Глухая оборона: клинок у самого тела, блок почти ничего не стоит, выносливость восстанавливается даже в защите. Удары медленнее и слабее.',
    sim: { windup: 1.05, dmg: 0.92, block: 0.55, perfect: 0.05, blockRegen: 2, speed: 0.95 },
    pose: { home: P(0.12, -0.2, -0.38, -0.12, 1, -0.12), pull: 0.45, windScale: 0.75, crouch: 0.12, lean: -0.04, stance: [0.14, -0.05, -0.14, 0.12], sway: 0.05 },
    bot: { aggression: 0.75, block: 1.1, perfect: 1.3 },
  },
  ataru: {
    num: 'IV', name: 'Атару',
    desc: 'Акробатика и натиск: прыжки выше, сальто дешевле, удар в прыжке страшнее, связки быстрее. Зато выносливость тает на глазах.',
    sim: { windup: 0.92, combo: 0.85, dmg: 0.96, stam: 1.22, jump: 1.12, flip: 0.6, dive: 1.5, speed: 1.08 },
    pose: { home: P(0.16, -0.02, -0.4, -0.3, 0.9, 0.3), pull: 0.3, windScale: 1.15, crouch: 0.15, lean: -0.06, stance: [0.14, -0.1, -0.14, 0.1], sway: 0.25, bounce: true },
    bot: { aggression: 1.15, flip: 2, combo: 1.2 },
  },
  djemso: {
    num: 'V', name: 'Шиен / Джем-Со',
    desc: 'Сила и ответный удар: тяжёлые мощные удары, после удачной защиты контрудар сильнее и окно для него дольше. Замах чуть медленнее.',
    sim: { windup: 1.1, dmg: 1.06, heavy: 1.12, riposte: 1.15, riposteWin: 1.3, block: 0.95, stam: 1.12, speed: 0.97 },
    pose: { home: P(0.24, 0.06, -0.34, -0.25, 0.8, 0.55), pull: 0.4, windScale: 1.25, crouch: 0.08, lean: 0.02, stance: [0.16, -0.12, -0.14, 0.14], sway: 0.08 },
    bot: { heavy: 1.6 },
  },
  niman: {
    num: 'VI', name: 'Ниман',
    desc: 'Равновесие клинка и Силы: всё понемногу, а толчок и пинок дешевле, толчок сильнее и перезаряжается быстрее.',
    sim: { push: 0.7, pushCd: 0.7, pushForce: 1.15, kick: 0.8, stam: 0.9, dmg: 1.03 },
    pose: { home: null, pull: 0, windScale: 1, crouch: 0.05, lean: 0, stance: [0.13, -0.08, -0.12, 0.1], sway: 0.1 },
    bot: { push: 1.6 },
  },
  juyo: {
    num: 'VII', name: 'Джуйо / Ваапад',
    desc: 'Ярость и непредсказуемость: быстрые связки, сильные удары, дешёвые финты. Защита у этой формы худшая из всех, а выносливость уходит быстро.',
    sim: { windup: 0.88, combo: 0.75, dmg: 1.1, stam: 1.2, block: 1.2, feint: 0.5, speed: 1.05 },
    pose: { home: P(0.3, -0.36, -0.3, 0.6, -0.3, 0.7), pull: 0.4, windScale: 1.3, crouch: 0.25, lean: -0.12, stance: [0.17, -0.14, -0.16, 0.14], sway: 0.2 },
    bot: { aggression: 1.3, feint: 1.8, block: 0.85 },
  },
};
const STYLE_IDS = Object.keys(STYLES);
for (const id of STYLE_IDS) STYLES[id].simAll = Object.assign({}, STYLE_SIM_BASE, STYLES[id].sim);

const styleOf = f => STYLES[f && f.style] || STYLES.niman;
const styleSim = f => styleOf(f).simAll;
const styleTitle = id => { const s = STYLES[id] || STYLES.niman; return `Форма ${s.num} — ${s.name}`; };
