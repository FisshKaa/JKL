'use strict';
// Все числа баланса в одном месте — крути их, чтобы менять ощущение боя.
const CFG = {
  WORLD_W: 1600, WORLD_H: 900,
  DT: 1 / 120,          // фиксированный шаг симуляции (важно для будущего онлайна)
  SUBSTEPS: 3,          // подшаги для клинков, чтобы лезвия не проскакивали друг сквозь друга

  GRAVITY: 2600, MAX_FALL: 1800,
  RUN_SPEED: 380, GROUND_ACC: 3400, AIR_ACC: 1500, FRICTION: 3000,
  JUMP_V: 1000, AIR_JUMP_V: 880,

  DASH_V: 980, DASH_TIME: 0.17, DASH_COST: 22, DASH_CD: 0.45,
  PUSH_COST: 40, PUSH_CD: 1.2, PUSH_RANGE: 300, PUSH_WINDUP: 0.16, PUSH_FORCE: 1150,

  FOCUS_MAX: 100, FOCUS_REGEN: 18, FOCUS_DELAY: 0.6, POWER_DRAIN: 26,
  HP_MAX: 100,

  ARM_LEN: 22, HILT_LEN: 14, BLADE_LEN: 112, BLADE_R: 3.5,
  // ПД-регулятор клинка: kp — «жёсткость» следования за мышью, kd — демпфирование
  SABER:       { kp: 150, kd: 19, maxAcc: 320, maxVel: 15 },
  SABER_POWER: { kp: 280, kd: 27, maxAcc: 560, maxVel: 23 },

  BIND_SPEED: 280,       // ниже этой скорости клинки «сцепляются», а не отскакивают
  HIT_MIN_SPEED: 320,    // ниже — не удар, а прожигание при касании
  DMG_K: 0.03, DMG_MIN: 4, DMG_MAX: 55, BURN_DPS: 16,
  HEAD_MUL: 1.5, LEG_MUL: 0.7, POWER_DMG_MUL: 1.3,

  ROUNDS_TO_WIN: 3,
  FALL_Y: 1300,

  BLADE_COLORS: ['#3fb8ff', '#46ff7a', '#b45cff', '#ffd23f', '#ff4058', '#f2f2ff'],
};
