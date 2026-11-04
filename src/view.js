'use strict';
// Отрисовка: сцена, персонажи, камера (первое/третье лицо, облёт в демо, превью кастомизации), bloom.
class View {
  constructor(canvas, game, looks) {
    this.game = game;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.04, 1200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.world = buildWorld(this.scene);
    this.fx = new Effects3D(this.scene);
    this.chars = [];
    this.looks = [];
    this.setLooks(looks);

    this.composer = new THREE.EffectComposer(this.renderer);
    this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
    this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 1.15, 0.55, 0.78);
    this.composer.addPass(this.bloom);

    this.orbit = 0; this.roll = 0; this.deadT = 0;
    this.previewAng = 0.4; this.previewZoom = 1;
    this.camPos = new THREE.Vector3(0, 2, 6);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  // Персонажи пересобираются, только если поменялась форма; цвета применяются сразу
  setLooks(looks) {
    looks.forEach((L, i) => this.setLook(i, L));
  }
  // Витрина: фигуры вдоль арены, показывающие приёмы. list — [{look, color, style, weapon, title, sub, x, z, yaw}]
  setGallery(list) {
    for (const g of this.gallery || []) { g.ch.dispose(); this.scene.remove(g.label); g.label.material.map.dispose(); g.label.material.dispose(); }
    // Фигуры витрины облегчённые: детализация как на низком качестве (их много, и смотрят на них издалека)
    const keepDetail = CharGen.detail;
    CharGen.detail = Math.max(keepDetail, 1.6);
    this.gallery = (list || []).map(it => {
      const f = new Fighter(9);
      f.reset(it.x, it.z, it.yaw); f.ignite = 1; f.onGround = true; f.style = it.style; f.weapon = it.weapon; f.index = 0;
      const ch = new Character(it.look, it.color, this.scene, false);
      const label = labelSprite(it.title, it.sub);
      this.scene.add(label);
      ch.root.traverse(o => { if (o.isMesh) o.castShadow = false; });   // и без теней — экономим видеокарту
      return { f, ch, label, fig: new ShowcaseFigure(f, it.title) };
    });
    CharGen.detail = keepDetail;
  }

  setLook(i, look) {
    const old = this.chars[i];
    // Сравниваем с ключом, сохранённым при сборке (объект внешности меню меняет на месте)
    const own = i === this.game.localIdx;
    if (old && old.key === charKey(look)) { old.look = cloneLook(look); old.setColors(look); old.setFpOwner(own); return; }
    if (old) old.dispose();
    this.chars[i] = new Character(look, this.game.fighters[i].color, this.scene, own);
    this.looks[i] = look;
  }

  // Качество: 'low' | 'medium' | 'high'. Возвращает true, если нужно пересобрать персонажей.
  setQuality(q) {
    const Q = {
      low:    { pr: 0.75, shadows: 0,    bloom: false, detail: 1.6,  iters: 2, sub: 2 },
      medium: { pr: 1,    shadows: 1024, bloom: true,  detail: 1.25, iters: 3, sub: 3 },
      high:   { pr: 1.5,  shadows: 2048, bloom: true,  detail: 1,    iters: 4, sub: 4 },
    }[q] || null;
    if (!Q) return false;
    this.quality = q; this.maxPr = Q.pr;
    const sun = this.world.sun;
    sun.castShadow = Q.shadows > 0;
    if (Q.shadows && sun.shadow.mapSize.x !== Q.shadows) {
      sun.shadow.mapSize.set(Q.shadows, Q.shadows);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    this.bloom.enabled = Q.bloom;
    CLOTH.iters = Q.iters; CLOTH.maxSub = Q.sub;
    this.resize();
    const rebuild = CharGen.detail !== Q.detail;
    CharGen.detail = Q.detail;
    return rebuild;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio || 1, this.maxPr || 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.composer.setPixelRatio) this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setColors() { this.game.fighters.forEach((f, i) => this.chars[i].setBladeColor(f.color)); }

  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const behind = v.z > 1;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, behind, visible: !behind && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 };
  }

  render(dt, player) {
    const g = this.game, li = g.localIdx, P = g.fighters[li], E = g.fighters[1 - li], t = g.time;
    const cP = this.chars[li], cE = this.chars[1 - li];
    const mode = g.mode;
    const play = g.isPlay;
    const fp = play && !player.thirdPerson;
    const preview = mode === 'preview';

    cE.setVisible(!preview);
    this.camera.layers.set(0);
    if (!fp) this.camera.layers.enable(1);

    // Наклон взгляда игрока
    let pitch = 0;
    if (play) {
      if (player.lockOn) {
        pitch = Math.atan2(E.y + 1.45 - (P.y + CFG.EYE), Math.max(1, dist2d(P, E))) * 0.8;
        player.pitch = pitch;
      } else pitch = player.pitch;
    }
    const enemyPitch = Math.atan2(P.y - E.y, Math.max(1, dist2d(P, E))) * 0.6;

    // Сначала анимация (для вида от первого лица нужны глаза уже после позы)
    cP.update(P, { dt, time: t, pitch: play ? pitch : -enemyPitch, fp });
    if (!preview) cE.update(E, { dt, time: t, pitch: enemyPitch });
    if (this.gallery) for (const g of this.gallery) {
      g.fig.update(dt * (g.speedMul = this.game.speedMul || 1), t);
      g.ch.update(g.f, { dt: dt * g.speedMul, time: t, pitch: 0, fp: false });
      g.label.position.set(g.f.x, g.f.y + 2.25, g.f.z);
    }
    // Камера поворачивается сразу по мыши, не дожидаясь симуляции (важно для онлайна)
    const camYaw = play && !player.lockOn && !P.dead && P.state !== 'bind' ? player.yaw : P.yaw;

    const shake = g.shakeAmt * g.shakeAmt * 0.08;
    if (play) {
      let targetRoll = 0;
      if ((P.state === 'windup' || P.state === 'strike') && P.attack) targetRoll = isRightSide(P.attack.dir) ? -0.05 : isLeftSide(P.attack.dir) ? 0.05 : 0;
      if (P.state === 'stagger') targetRoll = Math.sin(P.stateT * 20) * 0.04;
      this.roll = lerp(this.roll, targetRoll, 1 - Math.exp(-10 * dt));
      if (fp) {
        let fpPitch = 0, fpRoll = 0;
        if (P.state === 'roll') fpPitch = -easeInOut(clamp(P.stateT / P.dur, 0, 1)) * TAU;
        if (P.wallRun) { const rt0 = rightOf(P.yaw); fpRoll += (P.wallRun.nx * rt0.x + P.wallRun.nz * rt0.z) * 0.25; }
        if (P.flip) {
          const k = easeInOut(clamp(P.flip.t / CFG.FLIP_DUR, 0, 1)) * TAU;
          if (P.flip.type === 'front') fpPitch = -k; else if (P.flip.type === 'back') fpPitch = k;
          else if (P.flip.type === 'right') fpRoll = -k; else fpRoll = k;
        }
        let roll = this.roll;
        if (P.dead) { this.deadT = Math.min(1, this.deadT + dt * 1.5); roll = lerp(0, 1.1, easeOut(this.deadT)); } else this.deadT = 0;
        cP.eyeWorld(this.camera.position);
        this.camera.rotation.set(pitch + fpPitch + rand(-shake, shake), camYaw + rand(-shake, shake), roll + fpRoll);
      } else {
        // Третье лицо: камера за правым плечом
        const cp = Math.cos(pitch), f = { x: -Math.sin(camYaw) * cp, y: Math.sin(pitch), z: -Math.cos(camYaw) * cp };
        const r = rightOf(camYaw);
        const head = cP.eyeWorld(new THREE.Vector3());
        const want = head.clone().add(new THREE.Vector3(-f.x * 3.1 + r.x * 0.55, -f.y * 3.1 + 0.3, -f.z * 3.1 + r.z * 0.55));
        if (want.y < 0.3) want.y = 0.3;
        this.camPos.lerp(want, 1 - Math.exp(-14 * dt));
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(head.x + f.x * 4 + r.x * 0.55, head.y + f.y * 4, head.z + f.z * 4 + r.z * 0.55);
        this.camera.rotateZ(rand(-shake, shake));
      }
    } else if (preview) {
      const c = cP, s = c.scale;
      const r = 2.3 * this.previewZoom;
      const a = this.previewAng, rx = -Math.cos(a), rz = -Math.sin(a);
      const off = innerWidth > 800 ? 0.32 * r : 0;   // персонаж справа от панели
      const ty = P.y + lerp(1.05, 1.5, clamp((1 - this.previewZoom) / 0.55, 0, 1)) * s;
      this.camera.position.set(P.x + Math.sin(a) * r - rx * off, ty + 0.25 * this.previewZoom, P.z - Math.cos(a) * r - rz * off);
      this.camera.lookAt(P.x - rx * off, ty, P.z - rz * off);
    } else {
      this.orbit += dt * 0.12;
      const cx = (P.x + E.x) / 2, cz = (P.z + E.z) / 2, cy = (P.y + E.y) / 2;
      const r = 4.2 + dist2d(P, E) * 0.4;
      this.camera.position.set(cx + Math.cos(this.orbit) * r, cy + 1.8, cz + Math.sin(this.orbit) * r);
      this.camera.lookAt(cx, cy + 1.15, cz);
    }
    this.camera.updateMatrixWorld(true);

    this.fx.update(dt);
    this.world.update(t, dt, this.camera.position);
    this.composer.render();
  }

  bladeSpeeds() { const li = this.game.localIdx; return [this.chars[li].poseAnim.speed, this.chars[1 - li].poseAnim.speed]; }
}
