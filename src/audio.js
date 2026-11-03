'use strict';
// Звук целиком синтезируется в WebAudio — никаких файлов.
class AudioFX {
  constructor() { this.ctx = null; this.muted = false; this.hums = []; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    for (let i = 0; i < 2; i++) this.hums.push(this.makeHum(88 + i * 7));
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  makeHum(base) {
    const ctx = this.ctx;
    const mk = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
    const o1 = mk('sawtooth', base), o2 = mk('sawtooth', base * 1.012), o3 = mk('sine', base * 2);
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 400; filt.Q.value = 3;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o1.connect(filt); o2.connect(filt); o3.connect(filt); filt.connect(g);
    if (pan) { g.connect(pan); pan.connect(this.master); } else g.connect(this.master);
    o1.start(); o2.start(); o3.start();
    return { o1, o2, o3, filt, g, pan, base };
  }

  // speed — скорость поворота клинка (рад/с), vol — общая громкость, near — насколько близко к уху
  setHum(i, speed, ignite, pan, vol) {
    if (!this.ctx) return;
    const h = this.hums[i], t = this.ctx.currentTime;
    const s = Math.min(1, speed / 14);
    h.g.gain.setTargetAtTime(ignite * (0.03 + s * 0.12) * vol, t, 0.03);
    const f = h.base * (1 + s * 0.4);
    h.o1.frequency.setTargetAtTime(f, t, 0.03);
    h.o2.frequency.setTargetAtTime(f * 1.012, t, 0.03);
    h.o3.frequency.setTargetAtTime(f * 2, t, 0.03);
    h.filt.frequency.setTargetAtTime(350 + s * 2600, t, 0.03);
    if (h.pan) h.pan.pan.setTargetAtTime(clamp(pan, -1, 1) * 0.8, t, 0.05);
  }

  noise(dur, type, freq, q, vol, freqEnd) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  tone(type, f0, f1, dur, vol) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  swing(heavy) { this.noise(0.28, 'bandpass', 500, 1.5, heavy ? 0.4 : 0.28, 2600); this.tone('sawtooth', 120, 220, 0.2, 0.05); }
  clash(inten, perfect) {
    this.noise(0.25 + inten * 0.25, 'bandpass', 3200, 0.9, 0.15 + 0.5 * inten);
    this.tone('square', 1900 + rand(-200, 200), 1300, 0.2 + inten * 0.3, 0.03 + 0.08 * inten);
    this.tone('sine', 2600, 2400, 0.4, 0.06);
    this.noise(0.08, 'lowpass', 800, 1, 0.4 * inten);
    if (perfect) { this.tone('triangle', 3400, 3000, 0.5, 0.12); this.tone('sine', 880, 1320, 0.25, 0.08); }
  }
  bind(start) {
    if (start) { this.noise(0.6, 'bandpass', 2600, 4, 0.25, 1800); this.tone('sawtooth', 70, 60, 0.6, 0.12); }
    else this.noise(0.06, 'bandpass', 3800, 2, 0.12);
  }
  hit(inten) {
    this.noise(0.35, 'lowpass', 1500, 1, 0.6, 300);
    this.tone('sine', 110, 40, 0.25, 0.5 * inten + 0.15);
    this.noise(0.15, 'highpass', 4000, 1, 0.22);
  }
  jump() { this.noise(0.12, 'lowpass', 700, 1, 0.18); }
  land() { this.noise(0.18, 'lowpass', 300, 1, 0.45); this.tone('sine', 90, 45, 0.15, 0.25); }
  flip() { this.noise(0.45, 'bandpass', 400, 1.2, 0.3, 1400); }
  dash() { this.noise(0.2, 'lowpass', 500, 1, 0.25, 180); }
  ignite() { this.tone('sawtooth', 40, 95, 0.5, 0.12); this.noise(0.45, 'bandpass', 1200, 1, 0.15, 400); }
  retract() { this.tone('sawtooth', 95, 35, 0.4, 0.1); }
  guardBreak() { this.tone('square', 300, 80, 0.4, 0.15); this.noise(0.3, 'lowpass', 2000, 1, 0.4, 200); }
  ko() { this.tone('sine', 60, 30, 1.0, 0.6); }
  ui() { this.tone('sine', 880, 1200, 0.06, 0.08); }
  tick() { this.tone('sine', 1500, 1500, 0.04, 0.03); }
}
