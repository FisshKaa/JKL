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

  // Движение в стиле Jedi Academy
  RADIUS: 0.32, STEP: 0.45, AIR_ACC: 7,
  GRAVITY: 16, JUMP_V: 5.6,
  FORCE_TIME: 0.45, FORCE_GRAV: 0.22, FORCE_COST: 8,   // удержание прыжка = силовой прыжок
  FLIP_V: 6.2, FLIP_PUSH: 3.2, FLIP_DUR: 0.6, FLIP_COST: 12, FLIP_IFRAMES: [0.05, 0.35],
  WALLJUMP_V: 6.6, WALLJUMP_PUSH: 5, WALLJUMP_MAX: 2,
  MANTLE_REACH: 1.45, MANTLE_TIME: 0.42,
  HEIGHT_REACH: 1.3,   // разница высот, при которой удар ещё достаёт

  STAM_MAX: 100, STAM_REGEN: 24, STAM_DELAY: 0.7,
  ATTACK_COST: 12, BLOCK_COST: 14, BLOCK_COST_RIPOSTE: 24,

  HP_MAX: 100, DMG: 16,
  DIR_MUL: [1.15, 1, 0.95, 0.95, 1],  // верх, право, низ-право, низ-лево, лево
  RIPOSTE_MUL: 1.6, COMBO_MUL: 1.12,
  STAGGER_HIT: 0.42, STAGGER_PERFECT: 0.75, STAGGER_BREAK: 0.9, STAGGER_BIND: 1.0,

  // Клинч: стрелка бежит по кругу, три зоны, ЛКМ когда стрелка в зоне
  BIND_DIST: 1.15, BIND_ON_BLOCK: 0.4,
  BIND_ZONE: 0.045, BIND_PERFECT: 0.015,       // полуширина зоны и её центра, в долях круга
  BIND_REV_MIN: 1.4, BIND_REV_MAX: 2.3,        // время оборота: меньше выносливости — быстрее
  CLINCH_DIST: 1.9, CLINCH_COST: 10, BIND_ESCAPE_COST: 15,

  ROUNDS_TO_WIN: 2,
  BLADE_LEN: 1.05,
  BLADE_COLORS: ['#3fb8ff', '#46ff7a', '#b45cff', '#ffd23f', '#ff4058', '#f2f2ff'],
};

// Пять сторон креста с точки зрения самого бойца
const DIR = { UP: 0, RIGHT: 1, DOWN_RIGHT: 2, DOWN_LEFT: 3, LEFT: 4 };
const NDIR = 5;
// Удар справа прилетает защитнику слева: верх не меняется, лево и право меняются местами
const mirrorDir = d => [0, 4, 3, 2, 1][d];
const isRightSide = d => d === DIR.RIGHT || d === DIR.DOWN_RIGHT;
const isLeftSide = d => d === DIR.LEFT || d === DIR.DOWN_LEFT;
const isLow = d => d === DIR.DOWN_RIGHT || d === DIR.DOWN_LEFT;
