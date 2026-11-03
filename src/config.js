'use strict';
// Все числа баланса в одном месте. Время в секундах, расстояния в метрах.
const CFG = {
  DT: 1 / 60,
  ARENA_R: 11.2,
  EYE: 1.62,

  WALK: 3.0, STRAFE: 2.6, BACK: 2.2, ACC: 18,
  TURN: 9, TURN_ATTACK: 4.5,

  REACH: 2.7,          // дальность удара
  MIN_DIST: 0.95,      // бойцы не проходят друг сквозь друга
  ARC: 1.05,           // полуугол, в котором удар достаёт цель

  // Фазы удара
  WINDUP: 0.46, WINDUP_COMBO: 0.34, WINDUP_RIPOSTE: 0.26,
  SWEEP_PRE: 0.08,     // за сколько до контакта начинается сам взмах
  STRIKE: 0.14, RECOVER: 0.38, RECOVER_BLOCKED: 0.5, RECOVER_WHIFF: 0.55,
  COMBO_OPEN: 0.12,    // через сколько после удара можно продолжить комбо
  FEINT: 0.2, FEINT_COST: 7,

  // Защита
  PERFECT: 0.2,        // окно мастерского блока: блок поднят не раньше, чем за столько до контакта
  RIPOSTE_WINDOW: 0.9,
  DODGE: 0.34, DODGE_SPEED: 7, DODGE_COST: 18, IFRAMES: [0.04, 0.24],

  STAM_MAX: 100, STAM_REGEN: 24, STAM_DELAY: 0.7,
  ATTACK_COST: 12, BLOCK_COST: 14, BLOCK_COST_RIPOSTE: 24,

  HP_MAX: 100, DMG: 16,
  DIR_MUL: [1.15, 1, 0.9, 1],  // верх, право, низ, лево
  RIPOSTE_MUL: 1.6, COMBO_MUL: 1.12,
  STAGGER_HIT: 0.42, STAGGER_PERFECT: 0.75, STAGGER_BREAK: 0.9, STAGGER_BIND: 1.0,

  // Клинч
  BIND_DIST: 1.15, BIND_MAX: 4, BIND_PRESS: 0.075, BIND_ON_BLOCK: 0.4,
  CLINCH_DIST: 1.9, CLINCH_COST: 10, BIND_ESCAPE_COST: 15,

  ROUNDS_TO_WIN: 2,
  BLADE_LEN: 1.05,
  BLADE_COLORS: ['#3fb8ff', '#46ff7a', '#b45cff', '#ffd23f', '#ff4058', '#f2f2ff'],
};

// Стороны с точки зрения самого бойца
const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
// Удар справа прилетает защитнику слева: верх и низ не меняются, лево и право меняются местами
const mirrorDir = d => [0, 3, 2, 1][d];
