'use strict';
// Геометрия арены для физики и для отрисовки. Коробки стоят на полу (y = 0), top — высота верха.
const ARENA = {
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

  // Высота опоры под точкой (с учётом радиуса ступни), не выше maxTop
  groundAt(x, z, maxTop) {
    let gy = 0, box = null;
    const r = CFG.RADIUS;
    for (const b of this.boxes) {
      if (x < b.x1 - r || x > b.x2 + r || z < b.z1 - r || z > b.z2 + r) continue;
      if (b.top <= maxTop && b.top > gy) { gy = b.top; box = b; }
    }
    return { y: gy, box };
  },
};
