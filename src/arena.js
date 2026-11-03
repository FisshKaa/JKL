'use strict';
// Арены. Коробки: x1..x2, z1..z2, верх top, низ bottom (по умолчанию 0). Они общие для физики и графики.
// walls — невидимая стена по радиусу (круг); без стен можно сорваться вниз (ниже fallY — поражение).
const ARENAS = {
  circle: {
    name: 'Круг', walls: true, radius: 11.2, floor: 'disk', fallY: -50,
    boxes: [
      // Северный помост со ступенями
      { x1: -3.5, x2: 3.5, z1: -10.4, z2: -8.2, top: 1.2, mat: 'stone' },
      { x1: -2.5, x2: 2.5, z1: -8.2, z2: -7.6, top: 0.8, mat: 'stone' },
      { x1: -2.5, x2: 2.5, z1: -7.6, z2: -7.0, top: 0.4, mat: 'stone' },
      // Восточные ящики: лесенка 0.5 → 1.0 → 2.0
      { x1: 5.4, x2: 6.4, z1: -1.0, z2: 0.0, top: 1.0, mat: 'crate' },
      { x1: 6.4, x2: 7.6, z1: -1.3, z2: 0.1, top: 2.0, mat: 'crate' },
      { x1: 5.6, x2: 6.4, z1: 0.4, z2: 1.2, top: 0.5, mat: 'crate' },
      // Западная разрушенная стена и обломок колонны
      { x1: -7.6, x2: -7.0, z1: -3.2, z2: 1.2, top: 2.2, mat: 'stone' },
      { x1: -6.0, x2: -5.2, z1: 2.4, z2: 3.2, top: 1.5, mat: 'stone' },
      // Южный балкон и ящик-ступенька к нему
      { x1: 3.2, x2: 6.2, z1: 6.0, z2: 8.6, top: 2.6, mat: 'stone' },
      { x1: 1.9, x2: 3.1, z1: 6.6, z2: 7.7, top: 1.3, mat: 'crate' },
      // Высокая колонна: только силовой прыжок
      { x1: -6.3, x2: -5.5, z1: -6.8, z2: -6.0, top: 3.6, mat: 'stone' },
    ],
    spawns: [{ x: 0, z: 3, yaw: 0 }, { x: 0, z: -3, yaw: Math.PI }],
  },

  bridge: {
    name: 'Мост', walls: false, radius: 40, floor: null, fallY: -6,
    boxes: [
      // Пролёт моста и площадки на концах
      { x1: -1.6, x2: 1.6, z1: -11, z2: 11, top: 0, bottom: -0.7, mat: 'deck' },
      { x1: -4.5, x2: 4.5, z1: 11, z2: 16, top: 0, bottom: -1.2, mat: 'deck' },
      { x1: -4.5, x2: 4.5, z1: -16, z2: -11, top: 0, bottom: -1.2, mat: 'deck' },
      // Обломки перил: прикрывают от падения, через них можно перемахнуть
      { x1: 1.35, x2: 1.6, z1: -8, z2: -5, top: 0.9, mat: 'stone' },
      { x1: -1.6, x2: -1.35, z1: 2, z2: 6, top: 0.9, mat: 'stone' },
      { x1: 1.35, x2: 1.6, z1: 6.5, z2: 8, top: 0.9, mat: 'stone' },
      { x1: -1.6, x2: -1.35, z1: -3, z2: -1.5, top: 0.9, mat: 'stone' },
      // Площадки: колонны и ящики для паркура
      { x1: -3.8, x2: -3.0, z1: 13, z2: 13.8, top: 3.0, mat: 'stone' },
      { x1: 3.0, x2: 3.8, z1: -13.8, z2: -13, top: 3.0, mat: 'stone' },
      { x1: 2.6, x2: 3.6, z1: 12, z2: 13, top: 1.0, mat: 'crate' },
      { x1: -3.6, x2: -2.6, z1: -13, z2: -12, top: 1.0, mat: 'crate' },
      { x1: -1.2, x2: 1.2, z1: 14.4, z2: 15.6, top: 1.6, mat: 'stone' },
      { x1: -1.2, x2: 1.2, z1: -15.6, z2: -14.4, top: 1.6, mat: 'stone' },
    ],
    // Только для красоты: опоры уходят в бездну
    decor: [
      { x1: -1.1, x2: 1.1, z1: -6.6, z2: -5.4, top: -0.7, bottom: -60, mat: 'stone' },
      { x1: -1.1, x2: 1.1, z1: 5.4, z2: 6.6, top: -0.7, bottom: -60, mat: 'stone' },
      { x1: -4, x2: 4, z1: 12, z2: 15, top: -1.2, bottom: -60, mat: 'stone' },
      { x1: -4, x2: 4, z1: -15, z2: -12, top: -1.2, bottom: -60, mat: 'stone' },
    ],
    spawns: [{ x: 0, z: 4, yaw: 0 }, { x: 0, z: -4, yaw: Math.PI }],
  },
};

const ARENA = {
  id: 'circle',
  set(id) {
    const A = ARENAS[id] || ARENAS.circle;
    this.id = ARENAS[id] ? id : 'circle';
    Object.assign(this, { name: A.name, walls: A.walls, radius: A.radius, floor: A.floor, fallY: A.fallY, boxes: A.boxes, decor: A.decor || [], spawns: A.spawns });
  },
  // Высота опоры под точкой (с учётом радиуса ступни), не выше maxTop. Нет опоры — очень низко.
  groundAt(x, z, maxTop) {
    let gy = this.floor === 'disk' ? 0 : -1e9, box = null;
    const r = CFG.RADIUS;
    for (const b of this.boxes) {
      if (x < b.x1 - r || x > b.x2 + r || z < b.z1 - r || z > b.z2 + r) continue;
      if (b.top <= maxTop && b.top > gy) { gy = b.top; box = b; }
    }
    return { y: gy, box };
  },
};
ARENA.set('circle');
