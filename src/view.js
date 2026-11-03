'use strict';
// Отрисовка: сцена, камера от первого лица (или облёт в демо), bloom.
class View {
  constructor(canvas, game) {
    this.game = game;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.03, 1200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.world = buildWorld(this.scene);
    this.fx = new Effects3D(this.scene);
    this.bodies = game.fighters.map(f => new BodyModel(f.color, this.scene));
    this.viewmodel = new ViewModel(game.fighters[0].color, this.camera, this.scene);

    this.composer = new THREE.EffectComposer(this.renderer);
    this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
    this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 1.15, 0.55, 0.55);
    this.composer.addPass(this.bloom);

    this.orbit = 0; this.bobT = 0; this.roll = 0; this.deadT = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio ? this.composer.setPixelRatio(pr) : null;
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setColors() {
    this.game.fighters.forEach((f, i) => this.bodies[i].setColor(f.color));
    this.viewmodel.setColor(this.game.fighters[0].color);
  }

  // Мировая точка → координаты экрана в CSS-пикселях
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, visible: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 };
  }

  render(dt, player) {
    const g = this.game, [P, E] = g.fighters, t = g.time;
    const fp = g.mode === 'bot';
    this.bodies[0].setVisible(!fp);
    this.viewmodel.setVisible(fp);

    // Камера
    const shake = g.shakeAmt * g.shakeAmt * 0.08;
    if (fp) {
      this.bobT += P.speed * dt * 2.1;
      const bob = { x: Math.sin(this.bobT) * 0.012 * Math.min(1, P.speed / 3), y: -Math.abs(Math.cos(this.bobT)) * 0.016 * Math.min(1, P.speed / 3) };
      let targetRoll = 0;
      if ((P.state === 'windup' || P.state === 'strike') && P.attack) targetRoll = P.attack.dir === DIR.RIGHT ? -0.05 : P.attack.dir === DIR.LEFT ? 0.05 : 0;
      if (P.state === 'stagger') targetRoll = Math.sin(P.stateT * 20) * 0.04;
      this.roll = lerp(this.roll, targetRoll, 1 - Math.exp(-10 * dt));
      let eyeY = CFG.EYE + bob.y;
      if (P.dead) { this.deadT = Math.min(1, this.deadT + dt * 1.5); eyeY = lerp(CFG.EYE, 0.35, easeOut(this.deadT)); this.roll = lerp(0, 1.1, easeOut(this.deadT)); }
      else this.deadT = 0;
      this.camera.position.set(P.x, eyeY, P.z);
      let pitch;
      if (player && !player.lockOn) pitch = player.pitch;
      else pitch = Math.atan2(1.45 - CFG.EYE, Math.max(1, dist2d(P, E))) * 0.8;
      this.camera.rotation.set(pitch + rand(-shake, shake), P.yaw + rand(-shake, shake), this.roll);
      this.camera.updateMatrixWorld(true);
      this.viewmodel.update(P, t, dt, bob);
    } else {
      // Облёт в демо
      this.orbit += dt * 0.12;
      const cx = (P.x + E.x) / 2, cz = (P.z + E.z) / 2;
      const r = 4.6 + dist2d(P, E) * 0.4;
      this.camera.position.set(cx + Math.cos(this.orbit) * r, 1.9, cz + Math.sin(this.orbit) * r);
      this.camera.lookAt(cx, 1.15, cz);
      this.camera.updateMatrixWorld(true);
    }

    g.fighters.forEach((f, i) => { if (!(fp && i === 0)) this.bodies[i].update(f, t, dt); });
    this.fx.update(dt);
    this.world.update(t);
    this.composer.render();
  }

  bladeSpeeds() {
    const fp = this.game.mode === 'bot';
    return [fp ? this.viewmodel.anim.speed : this.bodies[0].anim.speed, this.bodies[1].anim.speed];
  }
}
