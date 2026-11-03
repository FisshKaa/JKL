'use strict';
// Арена: большая парящая платформа и два уступа. Все платформы проходимы снизу.
class Arena {
  constructor() {
    this.platforms = [
      { x1: 250, x2: 1350, y: 640, main: true },
      { x1: 420, x2: 610, y: 470 },
      { x1: 990, x2: 1180, y: 470 },
    ];
    this.main = this.platforms[0];
    this.spawns = [{ x: 640, y: 640 }, { x: 960, y: 640 }];
  }
  isOverPlatform(x) {
    return this.platforms.some(p => x >= p.x1 && x <= p.x2);
  }
}
