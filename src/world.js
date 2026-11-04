'use strict';
// Арена: круглая каменная площадка над бездной, ночное небо, газовый гигант.
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function buildWorld(scene) {
  scene.background = new THREE.Color(0x05060f);
  scene.fog = new THREE.FogExp2(0x100b24, 0.016);

  // Небо
  const skyTex = canvasTex(4, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#03040c'); gr.addColorStop(0.42, '#0d0a26');
    gr.addColorStop(0.5, '#2c1236'); gr.addColorStop(0.56, '#120a1e'); gr.addColorStop(1, '#030308');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  scene.add(sky);

  // Звёзды
  const sp = [];
  for (let i = 0; i < 1500; i++) {
    const th = rand(0, TAU), ph = rand(0.05, 1.45), r = 450;
    sp.push(r * Math.cos(th) * Math.cos(ph), r * Math.sin(ph), r * Math.sin(th) * Math.cos(ph));
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe4ff, size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
  scene.add(stars);

  // Газовый гигант с кольцом
  const planetTex = canvasTex(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#f7c49a'); gr.addColorStop(0.35, '#d97a6c'); gr.addColorStop(0.6, '#8e3a5c'); gr.addColorStop(1, '#2a0f30');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${chance(0.5) ? '255,220,190' : '80,20,50'},${rand(0.05, 0.18)})`;
      g.fillRect(0, rand(0, h), w, rand(2, 10));
    }
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 32), new THREE.MeshBasicMaterial({ map: planetTex, fog: false }));
  planet.position.set(150, 95, -300);
  planet.rotation.z = 0.25;
  scene.add(planet);
  const ring = new THREE.Mesh(new THREE.RingGeometry(95, 140, 96), new THREE.MeshBasicMaterial({ color: 0xffd0a8, transparent: true, opacity: 0.22, side: THREE.DoubleSide, fog: false }));
  ring.position.copy(planet.position);
  ring.rotation.set(1.25, 0.2, 0.25);
  scene.add(ring);

  // ---------- Сменная арена ----------
  const crateTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5a4128'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { g.fillStyle = `rgba(0,0,0,${rand(0.05, 0.2)})`; g.fillRect(0, i * 32 + rand(0, 4), w, 2); }
    g.strokeStyle = '#2e2014'; g.lineWidth = 18; g.strokeRect(9, 9, w - 18, h - 18);
    g.lineWidth = 12; g.beginPath(); g.moveTo(12, 12); g.lineTo(w - 12, h - 12); g.stroke();
    g.fillStyle = '#8a8f9e';
    for (const [x, y] of [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]]) { g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); }
  });
  const stoneTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3a3a4c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${chance(0.5) ? '255,255,255' : '0,0,0'},${rand(0.03, 0.08)})`; g.fillRect(rand(0, w), rand(0, h), 2, 2); }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
    for (let y = 0; y < h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); for (let x = (y / 64) % 2 ? 0 : 64; x < w; x += 128) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); } }
  });
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
  const deckTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#34344a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${chance(0.5) ? '255,255,255' : '0,0,0'},${rand(0.03, 0.09)})`; g.fillRect(rand(0, w), rand(0, h), 2, 2); }
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 4;
    for (let y = 0; y <= h; y += 42) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = 'rgba(160,140,255,0.25)'; g.lineWidth = 3; g.strokeRect(2, 0, w - 4, h);
  });
  deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
  const roofTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#1e1f27'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${chance(0.5) ? '255,255,255' : '0,0,0'},${rand(0.02, 0.06)})`; g.fillRect(rand(0, w), rand(0, h), 2, 2); }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3;
    for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    // Лужи
    for (let i = 0; i < 14; i++) {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.save(); g.translate(rand(0, w), rand(0, h)); g.scale(rand(20, 70), rand(12, 40));
      gr.addColorStop(0, 'rgba(10,12,22,0.75)'); gr.addColorStop(1, 'rgba(10,12,22,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore();
    }
  });
  roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping;
  const metalTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#5a6070'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 12) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, 0, 3, h); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 4, 0, 2, h); }
  });
  metalTex.wrapS = metalTex.wrapT = THREE.RepeatWrapping;
  const trimMat = new THREE.MeshBasicMaterial({ color: 0x8f7cff });
  const stone = new THREE.MeshStandardMaterial({ color: 0x23243a, roughness: 0.85 });
  const capMat = new THREE.MeshBasicMaterial({ color: 0xffb27a });
  let arenaGroup = null, caps = [];

  function boxMesh(b, group, collide) {
    const bottom = b.bottom || 0, hgt = b.top - bottom, w = b.x2 - b.x1, d = b.z2 - b.z1;
    let m;
    if (b.mat === 'tank') {
      // Бак: цилиндр вместо коробки
      const r = Math.min(w, d) / 2;
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hgt, 24), new THREE.MeshStandardMaterial({ map: metalTex, color: 0x8a94a8, roughness: 0.35, metalness: 0.6 }));
      tank.position.set((b.x1 + b.x2) / 2, bottom + hgt / 2, (b.z1 + b.z2) / 2);
      tank.castShadow = tank.receiveShadow = true;
      group.add(tank);
      return;
    }
    if (b.mat === 'crate') m = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.8 });
    else if (b.mat === 'roof') { const t = roofTex.clone(); t.needsUpdate = true; t.repeat.set(w / 6, d / 6); m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.28, metalness: 0.25 }); }
    else if (b.mat === 'metal') { const t = metalTex.clone(); t.needsUpdate = true; t.repeat.set(Math.max(w, d), 1); m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.4 }); }
    else if (b.mat === 'glass') m = new THREE.MeshStandardMaterial({ color: 0x86a6cc, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.6 });
    else if (b.mat === 'deck') { const t = deckTex.clone(); t.needsUpdate = true; t.repeat.set(w / 3.2, d / 3.2); m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }); }
    else { const t = stoneTex.clone(); t.needsUpdate = true; t.repeat.set(Math.max(w, d) / 2, Math.max(1, hgt / 2)); m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }); }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), m);
    mesh.position.set((b.x1 + b.x2) / 2, bottom + hgt / 2, (b.z1 + b.z2) / 2);
    // Пол (настил, крыша) тень не отбрасывает: иначе он затеняет сам себя рябью
    mesh.castShadow = collide && b.top > 0.05; mesh.receiveShadow = true;
    group.add(mesh);
    if (collide && (b.mat === 'deck' || b.mat === 'roof' || (b.mat === 'stone' && b.top > 0.8))) {
      // Светящаяся кромка: уступы и край моста читаются в темноте
      // Кромка — четыре узкие полоски по периметру чуть выше верха (не плита во всю площадь,
      // иначе её верх совпадает с полом и картинка мерцает)
      const cx = mesh.position.x, cz = mesh.position.z, t = 0.05, y = b.top + 0.004;
      for (const [sx, sz, px, pz] of [[w + t, t, cx, b.z1], [w + t, t, cx, b.z2], [t, d, b.x1, cz], [t, d, b.x2, cz]]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.012, sz), trimMat);
        strip.position.set(px, y, pz);
        group.add(strip);
      }
    }
  }

  function buildCircle(group) {
    const floorTex = canvasTex(1024, 1024, (g, w, h) => {
      g.fillStyle = '#2a2b3a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = `rgba(${chance(0.5) ? '255,255,255' : '0,0,0'},${rand(0.02, 0.07)})`;
        g.fillRect(rand(0, w), rand(0, h), rand(1, 4), rand(1, 4));
      }
      const cx = w / 2, cy = h / 2;
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 3;
      for (let r = 60; r < w / 2; r += 70) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); }
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * 60, cy + Math.sin(a) * 60); g.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * w); g.stroke();
      }
      g.strokeStyle = 'rgba(170,150,255,0.35)'; g.lineWidth = 4;
      g.beginPath(); g.arc(cx, cy, 58, 0, TAU); g.stroke();
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 96), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82, metalness: 0.12 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    group.add(floor);
    const side = new THREE.Mesh(new THREE.CylinderGeometry(14, 11, 3, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x14152a, roughness: 0.9 }));
    side.position.y = -1.5;
    group.add(side);
    const edge = new THREE.Mesh(new THREE.RingGeometry(ARENA.radius + 0.35, ARENA.radius + 0.45, 128), new THREE.MeshBasicMaterial({ color: 0x9c84ff, side: THREE.DoubleSide }));
    edge.rotation.x = -Math.PI / 2; edge.position.y = 0.01;
    group.add(edge);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.31;
      const x = Math.cos(a) * 13, z = Math.sin(a) * 13, hgt = i % 2 ? 3.2 : 4.4;
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.7, hgt, 0.7), stone);
      col.position.set(x, hgt / 2, z); col.castShadow = true;
      group.add(col);
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), capMat);
      cap.position.set(x, hgt + 0.55, z);
      group.add(cap); caps.push(cap);
    }
  }

  function buildBridge(group) {
    // Свечение бездны далеко внизу
    const glowTex = canvasTex(256, 256, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(150,110,255,0.55)'); gr.addColorStop(0.5, 'rgba(90,50,160,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = -45;
    group.add(glow);
    // Фонари вдоль моста
    for (const z of [-9, -3, 3, 9]) for (const x of [-1.75, 1.75]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.12), stone);
      post.position.set(x * 1.03, -0.15, z); group.add(post);
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), capMat);
      cap.position.set(x * 1.03, 0.65, z); group.add(cap); caps.push(cap);
    }
    // Арки-ворота на площадках
    for (const zc of [15.6, -15.6]) for (const x of [-4.2, 4.2]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.5, 0.6), stone);
      col.position.set(x, 2.75, zc); col.castShadow = true; group.add(col);
    }
    for (const zc of [15.6, -15.6]) {
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.6, 0.7), stone);
      lintel.position.set(0, 5.6, zc); lintel.castShadow = true; group.add(lintel);
    }
  }

  function buildRoof(group) {
    // Огни ночного города далеко внизу
    const cityTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#05060c'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1800; i++) {
        g.fillStyle = chance(0.7) ? `rgba(255,${190 + randInt(50)},${110 + randInt(60)},${rand(0.4, 1)})` : `rgba(140,190,255,${rand(0.4, 1)})`;
        g.fillRect(rand(0, w), rand(0, h), rand(1, 3), rand(1, 3));
      }
    });
    cityTex.wrapS = cityTex.wrapT = THREE.RepeatWrapping; cityTex.repeat.set(6, 6);
    const city = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ map: cityTex, fog: false, color: 0x9a8a9a }));
    city.rotation.x = -Math.PI / 2; city.position.y = -60;
    group.add(city);
    // Антенна с мигающим огнём и неоновая полоса на будке
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0x8a90a0, metalness: 0.8, roughness: 0.3 }));
    pole.position.set(-5.5, 4.4, 4); group.add(pole);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3040 }));
    beacon.position.set(-5.5, 6.05, 4); group.add(beacon); caps.push(beacon);
    beacon.userData.blink = true;
    const neon = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.04), new THREE.MeshBasicMaterial({ color: 0x46e8ff }));
    neon.position.set(-5.5, 2.3, 2.47); group.add(neon);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a2c36, metalness: 0.5, roughness: 0.5 }));
    door.position.set(-5.5, 1, 2.47); group.add(door);
  }

  function setArena(id) {
    ARENA.set(id);
    if (arenaGroup) { scene.remove(arenaGroup); arenaGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    arenaGroup = new THREE.Group(); caps = [];
    if (ARENA.id === 'bridge') buildBridge(arenaGroup); else if (ARENA.id === 'roof') buildRoof(arenaGroup); else buildCircle(arenaGroup);
    for (const b of ARENA.boxes) boxMesh(b, arenaGroup, true);
    for (const b of ARENA.decor) boxMesh(b, arenaGroup, false);
    const rain = ARENA.weather === 'rain';
    scene.fog.density = rain ? 0.03 : ARENA.id === 'bridge' ? 0.022 : 0.016;
    scene.fog.color.set(rain ? 0x0b0d16 : 0x100b24);
    if (typeof rainLines !== 'undefined' && rainLines) rainLines.visible = rain;
    // В дождь небо затянуто: без планеты и звёзд
    planet.visible = ring.visible = stars.visible = !rain;
    sky.material.color.setScalar(rain ? 0.4 : 1);
    scene.add(arenaGroup);
  }
  setArena(ARENA.id);

  // Шпили, растущие из бездны
  const spireMat = new THREE.MeshStandardMaterial({ color: 0x0c0b1c, roughness: 1 });
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffa070 });
  for (let i = 0; i < 70; i++) {
    const a = rand(0, TAU), r = rand(75, 210), w = rand(4, 10), hgt = rand(30, 100);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, w), spireMat);
    m.position.set(Math.cos(a) * r, -50 + hgt / 2, Math.sin(a) * r);
    scene.add(m);
    if (chance(0.6)) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.15, rand(1, 4), w * 1.02), winMat);
      win.position.set(m.position.x, -50 + hgt * rand(0.5, 0.95), m.position.z);
      scene.add(win);
    }
  }

  // Свет
  const hemi = new THREE.HemisphereLight(0x8a7ae0, 0x1a1428, 0.95);
  scene.add(hemi);
  const rim = new THREE.DirectionalLight(0x6fa8ff, 0.55);
  rim.position.set(-20, 10, 25);
  scene.add(rim);
  const sun = new THREE.DirectionalLight(0xffb38a, 0.75);
  sun.position.set(15, 18, -25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.035;
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 70 });
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x2a2244, 0.6));

  // ---------- Дождь и молнии (на арене с погодой) ----------
  const RAIN_N = 1600;
  const rainBase = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) { rainBase[i * 3] = rand(-16, 16); rainBase[i * 3 + 1] = rand(-3, 17); rainBase[i * 3 + 2] = rand(-16, 16); }
  const rainPos = new Float32Array(RAIN_N * 6);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  var rainLines = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.32, depthWrite: false }));
  rainLines.frustumCulled = false;
  rainLines.visible = ARENA.weather === 'rain';
  scene.add(rainLines);
  let lightningT = rand(4, 9), flash = 0, thunderAt = -1;
  const world = {
    setArena,
    sun, hemi,
    onThunder: null,
    weatherUpdate(t, dt, cam) {
      if (ARENA.weather !== 'rain' || !cam) { flash = 0; return; }
      for (let i = 0; i < RAIN_N; i++) {
        let y = rainBase[i * 3 + 1] - 17 * dt;
        if (y < -3) y += 20;
        rainBase[i * 3 + 1] = y;
        const x = cam.x + rainBase[i * 3], z = cam.z + rainBase[i * 3 + 2], yy = cam.y + y, o = i * 6;
        rainPos[o] = x; rainPos[o + 1] = yy; rainPos[o + 2] = z;
        rainPos[o + 3] = x + 0.04; rainPos[o + 4] = yy + 0.5; rainPos[o + 5] = z + 0.02;
      }
      rainGeo.attributes.position.needsUpdate = true;
      // Молния: вспышка неба и света, гром с задержкой
      lightningT -= dt;
      if (lightningT <= 0) { flash = 1; lightningT = rand(6, 15); thunderAt = t + rand(0.4, 1.6); }
      if (thunderAt > 0 && t >= thunderAt) { thunderAt = -1; if (world.onThunder) world.onThunder(); }
      flash = Math.max(0, flash - dt * (flash > 0.6 ? 6 : 2.2));
      const f = flash > 0.6 ? 1 : flash * (0.5 + 0.5 * Math.sin(t * 60));
      hemi.intensity = 0.95 + f * 2.2;
      sky.material.color.setScalar(0.4 + f * 2.5);
    },
  };
  return Object.assign(world, {
    update(t, dt, cam) {
      world.weatherUpdate(t, dt || 0, cam);
      if (ARENA.weather !== 'rain') { hemi.intensity = 0.95; sky.material.color.setScalar(1); }
      caps.forEach((c, i) => { if (c.userData.blink) { c.visible = (t % 1.2) < 0.25; return; } c.rotation.y = t * 0.8 + i; c.position.y += Math.sin(t * 1.6 + i) * 0.002; });
      stars.material.opacity = 0.75 + Math.sin(t * 0.7) * 0.1;
    },
  });
}
