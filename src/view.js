'use strict';
// Отрисовка: сцена, камера от первого/третьего лица (или облёт в демо), bloom.
class View {
  constructor(canvas, game, looks) {
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
    this.bodies = [];
    this.viewmodel = new ViewModel(looks[0], game.fighters[0].color, this.camera, this.scene);
    this.setLooks(looks);

    this.composer = new THREE.EffectComposer(this.renderer);
    this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
    this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 1.15, 0.55, 0.78);
    this.composer.addPass(this.bloom);

    this.orbit = 0; this.bobT = 0; this.roll = 0; this.deadT = 0;
    this.camPos = new THREE.Vector3(0, 2, 6);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setLooks(looks) {
    for (const b of this.bodies) b.dispose();
    this.bodies = this.game.fighters.map((f, i) => new BodyModel(looks[i], f.color, this.scene));
    this.viewmodel.setLook(looks[0]);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.composer.setPixelRatio) this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setColors() {
    this.game.fighters.forEach((f, i) => this.bodies[i].setColor(f.color));
    this.viewmodel.setColor(this.game.fighters[0].color);
  }

  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const behind = v.z > 1;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, behind, visible: !behind && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 };
  }

  render(dt, player) {
    const g = this.game, [P, E] = g.fighters, t = g.time;
    const play = g.mode === 'bot';
    const fp = play && !player.thirdPerson;
    this.bodies[0].setVisible(!fp);
    this.viewmodel.setVisible(fp);

    const shake = g.shakeAmt * g.shakeAmt * 0.08;
    if (play) {
      // Наклон взгляда: при захвате цели смотрим на противника, иначе — куда ведёт мышь
      let pitch;
      if (player.lockOn) {
        pitch = Math.atan2(E.y + 1.45 - (P.y + CFG.EYE), Math.max(1, dist2d(P, E))) * 0.8;
        player.pitch = pitch;
      } else pitch = player.pitch;

      this.bobT += (P.onGround ? P.speed : 0) * dt * 2.1;
      const bk = Math.min(1, P.speed / 3) * (P.onGround ? 1 : 0);
      const bob = { x: Math.sin(this.bobT) * 0.012 * bk, y: -Math.abs(Math.cos(this.bobT)) * 0.016 * bk };
      let targetRoll = 0;
      if ((P.state === 'windup' || P.state === 'strike') && P.attack) targetRoll = isRightSide(P.attack.dir) ? -0.05 : isLeftSide(P.attack.dir) ? 0.05 : 0;
      if (P.state === 'stagger') targetRoll = Math.sin(P.stateT * 20) * 0.04;
      this.roll = lerp(this.roll, targetRoll, 1 - Math.exp(-10 * dt));
      const landDip = P.landT < 0.25 ? -Math.sin(P.landT / 0.25 * Math.PI) * 0.12 : 0;

      // Сальто от первого лица: камера делает полный оборот
      let fpPitch = 0, fpRoll = 0;
      if (P.flip && fp) {
        const k = easeInOut(clamp(P.flip.t / CFG.FLIP_DUR, 0, 1)) * TAU;
        if (P.flip.type === 'front') fpPitch = -k; else if (P.flip.type === 'back') fpPitch = k;
        else if (P.flip.type === 'right') fpRoll = -k; else fpRoll = k;
      }

      if (fp) {
        let eyeY = P.y + CFG.EYE + bob.y + landDip;
        let roll = this.roll;
        if (P.dead) {
          this.deadT = Math.min(1, this.deadT + dt * 1.5);
          eyeY = P.y + lerp(CFG.EYE, 0.35, easeOut(this.deadT)); roll = lerp(0, 1.1, easeOut(this.deadT));
        } else this.deadT = 0;
        if (P.state === 'mantle') eyeY -= 0.25 * Math.sin(clamp(P.stateT / P.dur, 0, 1) * Math.PI);
        this.camera.position.set(P.x, eyeY, P.z);
        this.camera.rotation.set(pitch + fpPitch + rand(-shake, shake), P.yaw + rand(-shake, shake), roll + fpRoll);
        this.camera.updateMatrixWorld(true);
        this.viewmodel.update(P, t, dt, bob);
      } else {
        // Третье лицо: камера за правым плечом
        const cp = Math.cos(pitch), f = { x: -Math.sin(P.yaw) * cp, y: Math.sin(pitch), z: -Math.cos(P.yaw) * cp };
        const r = rightOf(P.yaw);
        const head = new THREE.Vector3(P.x, P.y + 1.55, P.z);
        const want = head.clone().add(new THREE.Vector3(-f.x * 3.1 + r.x * 0.55, -f.y * 3.1 + 0.35, -f.z * 3.1 + r.z * 0.55));
        if (want.y < 0.3) want.y = 0.3;
        this.camPos.lerp(want, 1 - Math.exp(-14 * dt));
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(head.x + f.x * 4 + r.x * 0.55, head.y + f.y * 4, head.z + f.z * 4 + r.z * 0.55);
        this.camera.rotateZ(rand(-shake, shake));
        this.camera.updateMatrixWorld(true);
      }
    } else {
      // Облёт в демо
      this.orbit += dt * 0.12;
      const cx = (P.x + E.x) / 2, cz = (P.z + E.z) / 2, cy = (P.y + E.y) / 2;
      const r = 4.6 + dist2d(P, E) * 0.4;
      this.camera.position.set(cx + Math.cos(this.orbit) * r, cy + 1.9, cz + Math.sin(this.orbit) * r);
      this.camera.lookAt(cx, cy + 1.15, cz);
      this.camera.updateMatrixWorld(true);
    }

    g.fighters.forEach((f, i) => { if (!(fp && i === 0)) this.bodies[i].update(f, t, dt); });
    this.fx.update(dt);
    this.world.update(t);
    this.composer.render();
  }

  bladeSpeeds() {
    const fp = this.game.mode === 'bot' && this.viewmodel.visible;
    return [fp ? this.viewmodel.anim.speed : this.bodies[0].anim.speed, this.bodies[1].anim.speed];
  }
}
