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

  // Каменный пол дуэльного круга
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
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(14, 11, 3, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x14152a, roughness: 0.9 }));
  side.position.y = -1.5;
  scene.add(side);

  // Светящаяся граница круга
  const edge = new THREE.Mesh(new THREE.RingGeometry(CFG.ARENA_R + 0.35, CFG.ARENA_R + 0.45, 128), new THREE.MeshBasicMaterial({ color: 0x9c84ff, side: THREE.DoubleSide }));
  edge.rotation.x = -Math.PI / 2; edge.position.y = 0.01;
  scene.add(edge);

  // Колонны с огнями
  const stone = new THREE.MeshStandardMaterial({ color: 0x23243a, roughness: 0.85 });
  const capMat = new THREE.MeshBasicMaterial({ color: 0xffb27a });
  const caps = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.31;
    const x = Math.cos(a) * 13, z = Math.sin(a) * 13, hgt = i % 2 ? 3.2 : 4.4;
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.7, hgt, 0.7), stone);
    col.position.set(x, hgt / 2, z); col.castShadow = true;
    scene.add(col);
    const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), capMat);
    cap.position.set(x, hgt + 0.55, z);
    scene.add(cap); caps.push(cap);
  }

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
  scene.add(new THREE.HemisphereLight(0x8a7ae0, 0x1a1428, 0.95));
  const rim = new THREE.DirectionalLight(0x6fa8ff, 0.55);
  rim.position.set(-20, 10, 25);
  scene.add(rim);
  const sun = new THREE.DirectionalLight(0xffb38a, 0.75);
  sun.position.set(15, 18, -25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 70 });
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x2a2244, 0.6));

  return {
    update(t) {
      caps.forEach((c, i) => { c.rotation.y = t * 0.8 + i; c.position.y += Math.sin(t * 1.6 + i) * 0.002; });
      stars.material.opacity = 0.75 + Math.sin(t * 0.7) * 0.1;
    },
  };
}
